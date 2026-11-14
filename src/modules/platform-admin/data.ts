import "server-only";
import { createServiceRoleClient } from "@/modules/service-role/client";
import { auditOrRefuse, type PlatformAdmin } from "./guard";

/**
 * Cross-tenant reads for Super Admin.
 *
 * These are the only functions in the product that deliberately read across
 * organisations, so `SUPER_ADMIN.md` governs every one of them:
 *
 *  - **Each takes the acting administrator.** Not a flag, not an assumption —
 *    the row that `requirePlatformAdmin()` returned. A function that could be
 *    called without one would be a cross-tenant read with no accountable party.
 *  - **Each writes an audit record, and refuses if it cannot.** "Logged
 *    sensitive actions" is the clause, and reading every customer's name and
 *    spend is a sensitive action even though it changes nothing. `auditOrRefuse`
 *    throws when the row does not land, so a failed audit produces a broken
 *    admin screen — which someone notices — instead of unlogged access to every
 *    tenant, which nobody notices at all.
 *  - **None of them selects customer content.** No prompts, no run inputs or
 *    outputs, no invitation tokens, no keys. `SUPER_ADMIN.md`: "private customer
 *    prompt/file not accessible by default", and the default is the only mode
 *    that exists here — break-glass access is not implemented, so it cannot be
 *    misused.
 *
 * Audit volume is kept sane by recording one row per listing (with how many
 * rows it returned) and one per organisation opened, rather than one per
 * record read. A log nobody can scan is a log nobody reads.
 */

export type AdminOrgRow = {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  seatLimit: number;
  memberCount: number;
  agentCount: number;
  runCount: number;
  lastRunAt: string | null;
  spentThisPeriodUsdMicros: number;
  suspensionReason: string | null;
};

export type AdminUsageRow = {
  orgId: string;
  orgName: string;
  provider: string;
  model: string;
  calls: number;
  costUsdMicros: number;
};

export type AdminAuditRow = {
  id: string;
  orgId: string | null;
  actorUserId: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

/** Platform totals. Everything that needs billing is absent, not zero. */
export type AdminOverview = {
  organizations: number;
  suspendedOrganizations: number;
  members: number;
  agents: number;
  runs: number;
  failedRuns: number;
  spentThisPeriodUsdMicros: number;
};

function currentPeriodStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function adminOverview(admin: PlatformAdmin): Promise<AdminOverview> {
  const db = createServiceRoleClient();

  // `head: true` fetches no rows, only the count, so these stay cheap as the
  // tables grow. The optional (column, value) pair is enough for every count
  // this screen needs; a general filter callback would need casts that defeat
  // the point of having types at all.
  const count = async (table: string, column?: string, value?: string) => {
    const base = db.from(table).select("*", { count: "exact", head: true });
    const { count: n } = await (column ? base.eq(column, value ?? "") : base);
    return n ?? 0;
  };

  const [organizations, suspended, members, agents, runs, failedRuns] = await Promise.all([
    count("organizations"),
    count("organizations", "status", "suspended"),
    count("memberships"),
    count("agents"),
    count("runs"),
    count("runs", "status", "failed"),
  ]);

  const { data: periods } = await db
    .from("usage_periods")
    .select("spent_usd_micros")
    .eq("period_start", currentPeriodStart());

  const spent = ((periods ?? []) as Array<{ spent_usd_micros: string | number }>).reduce(
    (sum, row) => sum + Number(row.spent_usd_micros),
    0,
  );

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.overview.read",
    entityType: "platform",
    metadata: { organizations },
  });

  return {
    organizations,
    suspendedOrganizations: suspended,
    members,
    agents,
    runs,
    failedRuns,
    spentThisPeriodUsdMicros: spent,
  };
}

export async function adminListOrganizations(
  admin: PlatformAdmin,
  limit = 100,
): Promise<AdminOrgRow[]> {
  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("organizations")
    .select("id, slug, name, status, created_at, seat_limit, suspension_reason")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  const orgs = data as Array<{
    id: string;
    slug: string;
    name: string;
    status: "active" | "suspended";
    created_at: string;
    seat_limit: number;
    suspension_reason: string | null;
  }>;
  if (orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id);

  // Counted in bulk rather than per organisation. A per-row query here is N+1
  // against a table that grows with the business, and the admin list is
  // precisely the screen that gets slower as the product succeeds.
  const [memberships, agents, runs, periods] = await Promise.all([
    db.from("memberships").select("org_id").in("org_id", ids),
    db.from("agents").select("org_id").in("org_id", ids),
    db.from("runs").select("org_id, created_at").in("org_id", ids),
    db
      .from("usage_periods")
      .select("org_id, spent_usd_micros")
      .in("org_id", ids)
      .eq("period_start", currentPeriodStart()),
  ]);

  const tally = (rows: unknown, key = "org_id") => {
    const map = new Map<string, number>();
    for (const row of (rows ?? []) as Array<Record<string, string>>) {
      const id = row[key];
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  };

  const memberCounts = tally(memberships.data);
  const agentCounts = tally(agents.data);
  const runCounts = tally(runs.data);

  const lastRun = new Map<string, string>();
  for (const row of (runs.data ?? []) as Array<{ org_id: string; created_at: string }>) {
    const current = lastRun.get(row.org_id);
    if (!current || row.created_at > current) lastRun.set(row.org_id, row.created_at);
  }

  const spend = new Map<string, number>();
  for (const row of (periods.data ?? []) as Array<{
    org_id: string;
    spent_usd_micros: string | number;
  }>) {
    spend.set(row.org_id, Number(row.spent_usd_micros));
  }

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.organizations.list",
    entityType: "organization",
    metadata: { returned: orgs.length },
  });

  return orgs.map((o) => ({
    id: o.id,
    slug: o.slug,
    name: o.name,
    status: o.status,
    createdAt: o.created_at,
    seatLimit: o.seat_limit,
    memberCount: memberCounts.get(o.id) ?? 0,
    agentCount: agentCounts.get(o.id) ?? 0,
    runCount: runCounts.get(o.id) ?? 0,
    lastRunAt: lastRun.get(o.id) ?? null,
    spentThisPeriodUsdMicros: spend.get(o.id) ?? 0,
    suspensionReason: o.suspension_reason,
  }));
}

/**
 * Spend by organisation, provider and model, for the current period.
 *
 * Aggregated in the application rather than in SQL because there is no view
 * for it yet and adding one is a migration; the row counts here are bounded by
 * the usage a single month produces, and this is an internal screen with one
 * reader. When that stops being true it becomes a materialised view, which
 * `DATA_MODEL.md` already anticipates ("partition usage if scale requires").
 */
export async function adminUsageBreakdown(
  admin: PlatformAdmin,
  limit = 500,
): Promise<AdminUsageRow[]> {
  const db = createServiceRoleClient();

  const since = `${currentPeriodStart()}T00:00:00Z`;
  const { data, error } = await db
    .from("usage_events")
    .select("org_id, provider, model, cost_usd_micros")
    .gte("created_at", since)
    .limit(limit);

  if (error || !data) return [];
  const events = data as Array<{
    org_id: string;
    provider: string;
    model: string;
    cost_usd_micros: string | number;
  }>;
  if (events.length === 0) return [];

  const { data: orgData } = await db
    .from("organizations")
    .select("id, name")
    .in("id", [...new Set(events.map((e) => e.org_id))]);

  const names = new Map(
    ((orgData ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]),
  );

  const grouped = new Map<string, AdminUsageRow>();
  for (const event of events) {
    const key = `${event.org_id}\u0000${event.provider}\u0000${event.model}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.calls += 1;
      existing.costUsdMicros += Number(event.cost_usd_micros);
    } else {
      grouped.set(key, {
        orgId: event.org_id,
        orgName: names.get(event.org_id) ?? "—",
        provider: event.provider,
        model: event.model,
        calls: 1,
        costUsdMicros: Number(event.cost_usd_micros),
      });
    }
  }

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.usage.read",
    entityType: "platform",
    metadata: { groups: grouped.size },
  });

  return [...grouped.values()].sort((a, b) => b.costUsdMicros - a.costUsdMicros);
}

/**
 * The audit log itself.
 *
 * `metadata_redacted` is deliberately NOT selected. It is bounded and redacted
 * by the CHECK constraint in 0001, but "redacted by constraint" is a promise
 * about what callers wrote, and this screen does not need it to show who did
 * what and when. Not selecting it is the version of that promise that cannot
 * be broken by a future caller writing something careless.
 */
export async function adminAuditLog(admin: PlatformAdmin, limit = 100): Promise<AdminAuditRow[]> {
  const db = createServiceRoleClient();

  const { data, error } = await db
    .from("audit_events")
    .select("id, org_id, actor_user_id, actor_type, action, entity_type, entity_id, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  await auditOrRefuse({
    actorUserId: admin.userId,
    action: "admin.audit.read",
    entityType: "audit_events",
    metadata: { returned: data.length },
  });

  return (
    data as Array<{
      id: string;
      org_id: string | null;
      actor_user_id: string | null;
      actor_type: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    actorUserId: row.actor_user_id,
    actorType: row.actor_type,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    createdAt: row.created_at,
  }));
}

export type SuspensionResult = { ok: true; status: string } | { ok: false; code: string };

/**
 * Suspend an organisation from new runs, or restore it.
 *
 * `SUPER_ADMIN.md`: "Suspend account from new runs with reason, warning and
 * safety audit; never silently delete account/content." All four parts are
 * here, and three of them are in the database rather than this function:
 * `set_org_suspended()` refuses without a reason, writes the audit row with
 * the acting administrator, and the CHECK in 0016 makes "suspended with no
 * reason" unrepresentable.
 *
 * Deliberately not a direct UPDATE. The reason, the timestamp and the audit
 * record have to move with the status, and a route that wrote the column
 * could omit any of them.
 */
export async function adminSetOrgSuspended(
  admin: PlatformAdmin,
  input: { orgId: string; suspended: boolean; reason?: string },
): Promise<SuspensionResult> {
  const db = createServiceRoleClient();

  const { data, error } = await db.rpc("set_org_suspended", {
    p_actor_user_id: admin.userId,
    p_org_id: input.orgId,
    p_suspended: input.suspended,
    p_reason: input.reason ?? null,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("SUSPENSION_REQUIRES_REASON"))
      return { ok: false, code: "REASON_REQUIRED" };
    if (message.includes("ORG_NOT_FOUND")) return { ok: false, code: "ORG_NOT_FOUND" };
    return { ok: false, code: "WRITE_FAILED" };
  }

  // No auditOrRefuse here: set_org_suspended() writes the audit row inside the
  // same transaction as the status change, so there is no window in which one
  // happened and the other did not. Auditing again from here would double the
  // record.
  return { ok: true, status: String(data) };
}
