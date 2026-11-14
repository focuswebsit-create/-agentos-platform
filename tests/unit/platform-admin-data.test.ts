import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The rule these tests exist for: **a cross-tenant read that cannot be audited
 * does not happen.**
 *
 * `SUPER_ADMIN.md` requires sensitive actions to be logged. The dangerous
 * failure is not a crash — it is a screen that quietly returns every tenant's
 * data while its audit row failed to write, because nobody can account for
 * that access afterwards.
 */

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeDb(options: { rows?: unknown[]; rpcFails?: boolean }) {
  const rpc: RpcCall[] = [];

  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: async () => ({ data: options.rows ?? [], error: null }),
    eq: () => chain,
    in: () => chain,
    gte: () => chain,
  };

  return {
    rpc,
    client: {
      from: () => chain,
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpc.push({ name, args });
        return options.rpcFails
          ? { data: null, error: { message: "audit write failed" } }
          : { data: null, error: null };
      },
    },
  };
}

const mocks = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  isServiceRoleConfigured: vi.fn(() => true),
}));

vi.mock("@/modules/service-role/client", () => mocks);

const ADMIN = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "superadmin" as const,
  mfaRequired: true,
};

const AUDIT_ROW = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  org_id: null,
  actor_user_id: ADMIN.userId,
  actor_type: "platform_admin",
  action: "admin.organizations.list",
  entity_type: "organization",
  entity_id: null,
  created_at: "2026-11-14T10:00:00.000Z",
};

beforeEach(() => {
  mocks.isServiceRoleConfigured.mockReturnValue(true);
});

describe("adminAuditLog", () => {
  it("returns rows and records that it was read", async () => {
    const db = fakeDb({ rows: [AUDIT_ROW] });
    mocks.createServiceRoleClient.mockReturnValue(db.client);

    const { adminAuditLog } = await import("@/modules/platform-admin/data");
    const rows = await adminAuditLog(ADMIN);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("admin.organizations.list");

    const audit = db.rpc.find((r) => r.name === "log_platform_audit");
    expect(audit).toBeDefined();
    expect(audit?.args.p_action).toBe("admin.audit.read");
    // The administrator is named. A row with a null actor is a record of
    // something having happened and nobody being responsible.
    expect(audit?.args.p_actor_user_id).toBe(ADMIN.userId);
  });

  it("refuses to return data when the audit row cannot be written", async () => {
    const db = fakeDb({ rows: [AUDIT_ROW], rpcFails: true });
    mocks.createServiceRoleClient.mockReturnValue(db.client);

    const { adminAuditLog } = await import("@/modules/platform-admin/data");
    // Throwing here produces a broken admin screen, which someone notices and
    // fixes. The alternative is unlogged access to every tenant, which nobody
    // notices at all.
    await expect(adminAuditLog(ADMIN)).rejects.toThrow(/audit record could not be written/);
  });

  it("refuses when the service role is unavailable", async () => {
    mocks.isServiceRoleConfigured.mockReturnValue(false);
    const db = fakeDb({ rows: [AUDIT_ROW] });
    mocks.createServiceRoleClient.mockReturnValue(db.client);

    const { adminAuditLog } = await import("@/modules/platform-admin/data");
    await expect(adminAuditLog(ADMIN)).rejects.toThrow();
  });

  it("does not read the metadata column", async () => {
    // metadata_redacted is bounded by a CHECK in 0001, but that is a promise
    // about what callers wrote. Not selecting it is the version of the promise
    // a future careless caller cannot break.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/modules/platform-admin/data.ts", "utf8"),
    );
    // Checked against the select lists, not the whole file: the column is
    // named in a comment explaining why it is absent, and an assertion that
    // forbade mentioning it would push that explanation out of the code.
    const selected = [...source.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1] ?? "");
    expect(selected.length).toBeGreaterThan(0);
    for (const list of selected) {
      expect(list, list).not.toContain("metadata");
    }
  });
});
