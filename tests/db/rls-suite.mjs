/**
 * AgentOS P1 — RLS and tenancy verification suite.
 *
 * Runs against the LOCAL isolated PostgreSQL cluster only. It never touches
 * Supabase. Credentials come from .env.test.local (gitignored, mode 600).
 *
 * Three connection identities, deliberately separated:
 *
 *   migrator      owns the schema. Owners are exempt from RLS, exactly as
 *                 `postgres` is in Supabase, so this client is used ONLY to
 *                 build fixtures - never to assert a policy.
 *   tester        owns nothing. RLS therefore applies to it. Every assertion
 *                 runs here under `SET ROLE authenticated` with a synthetic
 *                 request.jwt.claims, which is how PostgREST presents a user.
 *   serviceProbe  the only account permitted to SET ROLE service_role.
 *
 * A test that cannot run is reported as SKIP, never as PASS.
 */
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.test.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

// PGDATABASE may be overridden so the whole suite can be run against a
// freshly migrated clean-room database without editing .env.test.local.
const base = {
  host: env.PGHOST,
  port: Number(env.PGPORT),
  database: process.env.PGDATABASE || env.PGDATABASE,
};
const asMigrator = () =>
  new pg.Client({
    ...base,
    user: env.AGENTOS_MIGRATOR_USER,
    password: env.AGENTOS_MIGRATOR_PASSWORD,
  });
const asTester = () =>
  new pg.Client({ ...base, user: env.AGENTOS_TESTER_USER, password: env.AGENTOS_TESTER_PASSWORD });
const asProbe = () =>
  new pg.Client({
    ...base,
    user: env.AGENTOS_SERVICE_PROBE_USER,
    password: env.AGENTOS_SERVICE_PROBE_PASSWORD,
  });

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */
let pass = 0,
  fail = 0,
  skip = 0;
const failures = [];

function ok(group, name) {
  pass++;
  console.log(`  PASS  ${group} :: ${name}`);
}
function bad(group, name, detail) {
  fail++;
  failures.push(`${group} :: ${name} — ${detail}`);
  console.log(`  FAIL  ${group} :: ${name}\n          ${detail}`);
}
/* Every test in this suite currently runs; `skip` stays 0 and is printed in the
   summary so a future skipped test can never be mistaken for a pass. */

async function expectDenied(group, name, fn, expectText) {
  try {
    await fn();
    bad(group, name, "the operation SUCCEEDED but should have been denied");
  } catch (e) {
    const m = String(e.message || e);
    if (expectText && !m.includes(expectText)) {
      bad(group, name, `denied, but with an unexpected error: ${m.split("\n")[0]}`);
    } else ok(group, name);
  }
}
async function expectAllowed(group, name, fn) {
  try {
    await fn();
    ok(group, name);
  } catch (e) {
    bad(group, name, `should have been allowed but failed: ${String(e.message).split("\n")[0]}`);
  }
}
async function expectRows(group, name, fn, expected) {
  try {
    const r = await fn();
    if (r.rowCount === expected) ok(group, name);
    else bad(group, name, `expected ${expected} row(s), got ${r.rowCount}`);
  } catch (e) {
    bad(group, name, `query errored: ${String(e.message).split("\n")[0]}`);
  }
}

/** Run fn with the session acting as `userId` under the authenticated role. */
async function act(client, userId, fn, aal = "aal1") {
  await client.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated", aal }),
  ]);
  await client.query("SET ROLE authenticated");
  try {
    return await fn();
  } finally {
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('request.jwt.claims', NULL, false)");
  }
}

const uuid = () => crypto.randomUUID();
const sha256 = (t) => createHash("sha256").update(t).digest();

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */
async function makeUser(m, email, { verified = true } = {}) {
  const id = uuid();
  await m.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)`, [
    id,
    email.toLowerCase(),
    verified ? new Date() : null,
  ]);
  return id;
}
async function makeOrg(m, slug, ownerId, seatLimit = 5) {
  const { rows } = await m.query(
    `insert into public.organizations (slug, name, seat_limit) values ($1, $2, $3) returning id`,
    [slug, slug, seatLimit],
  );
  const orgId = rows[0].id;
  await m.query(`insert into public.memberships (org_id, user_id, role) values ($1,$2,'owner')`, [
    orgId,
    ownerId,
  ]);
  return orgId;
}
async function addMember(m, orgId, userId, role) {
  await m.query(`insert into public.memberships (org_id, user_id, role) values ($1,$2,$3)`, [
    orgId,
    userId,
    role,
  ]);
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
const m = asMigrator(),
  t = asTester(),
  p = asProbe();
await m.connect();
await t.connect();
await p.connect();

const tag = randomBytes(3).toString("hex");

try {
  /* ---- fixtures -------------------------------------------------- */
  const ownerA = await makeUser(m, `ownerA-${tag}@example.test`);
  const adminA = await makeUser(m, `adminA-${tag}@example.test`);
  const memberA = await makeUser(m, `memberA-${tag}@example.test`);
  const viewerA = await makeUser(m, `viewerA-${tag}@example.test`);
  const ownerB = await makeUser(m, `ownerB-${tag}@example.test`);

  const orgA = await makeOrg(m, `org-a-${tag}`, ownerA, 10);
  const orgB = await makeOrg(m, `org-b-${tag}`, ownerB, 10);
  await addMember(m, orgA, adminA, "admin");
  await addMember(m, orgA, memberA, "member");
  await addMember(m, orgA, viewerA, "viewer");

  await m.query(
    `insert into public.invitations (org_id, email, role, token_hash, expires_at, invited_by)
     values ($1,$2,'member',$3, now() + interval '7 days', $4)`,
    [orgA, `invitee-${tag}@example.test`, sha256(`seed-${tag}`), ownerA],
  );
  await m.query(
    `select public.log_audit($1,'system','fixture.seed','organization',$1,'{}'::jsonb)`,
    [orgA],
  );

  /* ---- 0. sanity: RLS is actually engaged ------------------------ */
  let g = "0-sanity";
  {
    const asOwnerRows = await act(t, ownerA, () =>
      t.query(`select 1 from public.organizations where id = $1`, [orgA]),
    );
    if (asOwnerRows.rowCount === 1) ok(g, "member of org A can see org A");
    else bad(g, "member of org A can see org A", `expected 1 row, got ${asOwnerRows.rowCount}`);

    await t.query("SET ROLE authenticated");
    const noClaims = await t.query(`select 1 from public.organizations`);
    await t.query("RESET ROLE");
    if (noClaims.rowCount === 0) ok(g, "authenticated with no JWT claims sees nothing");
    else
      bad(g, "authenticated with no JWT claims sees nothing", `leaked ${noClaims.rowCount} row(s)`);
  }

  /* ---- 1. cross-tenant isolation --------------------------------- */
  g = "1-cross-tenant";
  await act(t, ownerB, async () => {
    await expectRows(
      g,
      "org B owner cannot read org A",
      () => t.query(`select 1 from public.organizations where id=$1`, [orgA]),
      0,
    );
    await expectRows(
      g,
      "org B owner cannot read org A memberships",
      () => t.query(`select 1 from public.memberships where org_id=$1`, [orgA]),
      0,
    );
    await expectRows(
      g,
      "org B owner cannot read org A invitations",
      () => t.query(`select 1 from public.invitations where org_id=$1`, [orgA]),
      0,
    );
    await expectRows(
      g,
      "org B owner cannot read org A audit events",
      () => t.query(`select 1 from public.audit_events where org_id=$1`, [orgA]),
      0,
    );
    await expectRows(
      g,
      "org B owner cannot read org A profiles",
      () => t.query(`select 1 from public.profiles where user_id=$1`, [memberA]),
      0,
    );
    await expectDenied(g, "org B owner cannot update org A", () =>
      t.query(`update public.organizations set name='pwned' where id=$1`, [orgA]).then((r) => {
        if (r.rowCount === 0) throw new Error("0 rows updated");
      }),
    );
    await expectDenied(g, "org B owner cannot invite into org A", () =>
      t.query(
        `insert into public.invitations (org_id,email,role,token_hash,expires_at,invited_by)
               values ($1,$2,'member',$3, now()+interval '1 day', $4)`,
        [orgA, `x-${tag}@example.test`, sha256(`x-${tag}`), ownerB],
      ),
    );
  });

  /* ---- 2. role matrix -------------------------------------------- */
  g = "2-role-matrix";
  await act(t, viewerA, async () => {
    await expectRows(
      g,
      "viewer can read the organisation",
      () => t.query(`select 1 from public.organizations where id=$1`, [orgA]),
      1,
    );
    await expectRows(
      g,
      "viewer can read the member list",
      () => t.query(`select 1 from public.memberships where org_id=$1`, [orgA]),
      4,
    );
    await expectRows(
      g,
      "viewer CANNOT see invitations",
      () => t.query(`select 1 from public.invitations where org_id=$1`, [orgA]),
      0,
    );
    await expectRows(
      g,
      "viewer CANNOT see audit events",
      () => t.query(`select 1 from public.audit_events where org_id=$1`, [orgA]),
      0,
    );
    await expectDenied(g, "viewer cannot update the organisation", () =>
      t.query(`update public.organizations set name='v' where id=$1`, [orgA]).then((r) => {
        if (r.rowCount === 0) throw new Error("0 rows");
      }),
    );
    await expectDenied(g, "viewer cannot invite", () =>
      t.query(
        `insert into public.invitations (org_id,email,role,token_hash,expires_at,invited_by)
               values ($1,$2,'member',$3, now()+interval '1 day',$4)`,
        [orgA, `v-${tag}@example.test`, sha256(`v-${tag}`), viewerA],
      ),
    );
  });
  await act(t, memberA, async () => {
    await expectDenied(g, "member cannot invite", () =>
      t.query(
        `insert into public.invitations (org_id,email,role,token_hash,expires_at,invited_by)
               values ($1,$2,'member',$3, now()+interval '1 day',$4)`,
        [orgA, `mm-${tag}@example.test`, sha256(`mm-${tag}`), memberA],
      ),
    );
    await expectRows(
      g,
      "member CANNOT see invitations",
      () => t.query(`select 1 from public.invitations where org_id=$1`, [orgA]),
      0,
    );
  });
  await act(t, adminA, async () => {
    await expectAllowed(g, "admin can read invitations", () =>
      t.query(`select 1 from public.invitations where org_id=$1`, [orgA]),
    );
    await expectAllowed(g, "admin can update the organisation name", () =>
      t.query(`update public.organizations set name='renamed' where id=$1`, [orgA]),
    );
    await expectDenied(
      g,
      "admin CANNOT raise seat_limit (column privilege withheld)",
      () => t.query(`update public.organizations set seat_limit=999 where id=$1`, [orgA]),
      "permission denied",
    );
    await expectDenied(
      g,
      "admin CANNOT change org status (column privilege withheld)",
      () => t.query(`update public.organizations set status='suspended' where id=$1`, [orgA]),
      "permission denied",
    );
  });

  /* ---- 3. privilege escalation ----------------------------------- */
  g = "3-escalation";
  await act(t, adminA, async () => {
    await expectDenied(g, "admin cannot promote a member to admin", () =>
      t
        .query(`update public.memberships set role='admin' where org_id=$1 and user_id=$2`, [
          orgA,
          memberA,
        ])
        .then((r) => {
          if (r.rowCount === 0) throw new Error("0 rows updated (policy denied)");
        }),
    );
    await expectDenied(g, "admin cannot demote the owner", () =>
      t
        .query(`update public.memberships set role='member' where org_id=$1 and user_id=$2`, [
          orgA,
          ownerA,
        ])
        .then((r) => {
          if (r.rowCount === 0) throw new Error("0 rows updated (policy denied)");
        }),
    );
    await expectDenied(g, "admin cannot remove the owner", () =>
      t
        .query(`delete from public.memberships where org_id=$1 and user_id=$2`, [orgA, ownerA])
        .then((r) => {
          if (r.rowCount === 0) throw new Error("0 rows deleted (policy denied)");
        }),
    );
    await expectDenied(g, "admin cannot change their OWN role", () =>
      t
        .query(`update public.memberships set role='owner' where org_id=$1 and user_id=$2`, [
          orgA,
          adminA,
        ])
        .then((r) => {
          if (r.rowCount === 0) throw new Error("0 rows updated (policy denied)");
        }),
    );
    await expectDenied(g, "admin cannot invite at admin level", () =>
      t.query(
        `insert into public.invitations (org_id,email,role,token_hash,expires_at,invited_by)
               values ($1,$2,'admin',$3, now()+interval '1 day',$4)`,
        [orgA, `esc-${tag}@example.test`, sha256(`esc-${tag}`), adminA],
      ),
    );
  });

  /* ---- 4. audit forgery ------------------------------------------ */
  g = "4-audit-forgery";
  await act(t, memberA, async () => {
    await expectDenied(
      g,
      "cannot EXECUTE log_audit",
      () =>
        t.query(`select public.log_audit($1,'system','forged','organization',$1,'{}'::jsonb)`, [
          orgA,
        ]),
      "permission denied",
    );
    await expectDenied(
      g,
      "cannot INSERT into audit_events",
      () =>
        t.query(
          `insert into public.audit_events (org_id,actor_type,action,entity_type)
               values ($1,'system','forged','organization')`,
          [orgA],
        ),
      "permission denied",
    );
  });
  await act(t, adminA, async () => {
    await expectDenied(
      g,
      "admin cannot UPDATE an audit row",
      () => t.query(`update public.audit_events set action='rewritten' where org_id=$1`, [orgA]),
      "permission denied",
    );
    await expectDenied(
      g,
      "admin cannot DELETE an audit row",
      () => t.query(`delete from public.audit_events where org_id=$1`, [orgA]),
      "permission denied",
    );
  });
  await expectDenied(
    g,
    "even the schema owner cannot UPDATE audit rows (trigger)",
    () => m.query(`update public.audit_events set action='rewritten' where org_id=$1`, [orgA]),
    "AUDIT_EVENTS_APPEND_ONLY",
  );
  await expectDenied(
    g,
    "even the schema owner cannot DELETE audit rows (trigger)",
    () => m.query(`delete from public.audit_events where org_id=$1`, [orgA]),
    "AUDIT_EVENTS_APPEND_ONLY",
  );
  await expectDenied(
    g,
    "a credential-shaped key is rejected by CHECK",
    () =>
      m.query(
        `insert into public.audit_events (org_id,actor_type,action,entity_type,metadata_redacted)
             values ($1,'system','x','y','{"token":"abc"}'::jsonb)`,
        [orgA],
      ),
    "audit_events_no_secret_keys",
  );

  /* ---- 5. internal functions ------------------------------------- */
  g = "5-internal-functions";
  await act(t, memberA, async () => {
    await expectDenied(
      g,
      "cannot EXECUTE org_seats_taken (tenant-size oracle)",
      () => t.query(`select public.org_seats_taken($1)`, [orgA]),
      "permission denied",
    );
  });
  await act(t, ownerB, async () => {
    await expectDenied(
      g,
      "non-member cannot read seat usage of another org",
      () => t.query(`select * from public.org_seat_usage($1)`, [orgA]),
      "ORG_ACCESS_DENIED",
    );
  });
  await act(t, adminA, async () => {
    await expectAllowed(g, "admin CAN read their own org's seat usage", () =>
      t.query(`select * from public.org_seat_usage($1)`, [orgA]),
    );
  });
  await act(t, memberA, async () => {
    // Two mechanisms protect this table independently: the privilege is revoked
    // AND RLS is on with no policy. The privilege check fires first, so what is
    // actually observed is "permission denied" rather than an empty set - a
    // stricter outcome than the zero rows originally asserted here. Either is a
    // pass; leaking a row is not.
    const name = "platform_admins is unreadable by authenticated";
    try {
      const r = await t.query(`select 1 from public.platform_admins`);
      if (r.rowCount === 0) ok(g, `${name} (zero rows)`);
      else bad(g, name, `leaked ${r.rowCount} row(s)`);
    } catch (e) {
      if (String(e.message).includes("permission denied")) ok(g, `${name} (permission denied)`);
      else bad(g, name, `unexpected error: ${String(e.message).split("\n")[0]}`);
    }
  });
  {
    const r = await m.query(
      `select relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname='memberships'`,
    );
    if (r.rows[0].relforcerowsecurity === false)
      ok(g, "FORCE RLS is OFF on memberships (no helper recursion)");
    else bad(g, "FORCE RLS is OFF on memberships", "it is ON - the RLS helpers will recurse");
  }

  /* ---- 6. last owner --------------------------------------------- */
  g = "6-last-owner";
  await expectDenied(
    g,
    "cannot delete the last owner",
    () => m.query(`delete from public.memberships where org_id=$1 and user_id=$2`, [orgB, ownerB]),
    "ORG_REQUIRES_OWNER",
  );
  await expectDenied(
    g,
    "cannot demote the last owner",
    () =>
      m.query(`update public.memberships set role='admin' where org_id=$1 and user_id=$2`, [
        orgB,
        ownerB,
      ]),
    "ORG_REQUIRES_OWNER",
  );
  {
    const u = await makeUser(m, `succ-${tag}@example.test`);
    await addMember(m, orgB, u, "member");
    await expectAllowed(
      g,
      "ownership transfer succeeds in ONE transaction (deferred trigger)",
      async () => {
        await m.query("BEGIN");
        await m.query(`update public.memberships set role='owner' where org_id=$1 and user_id=$2`, [
          orgB,
          u,
        ]);
        await m.query(`update public.memberships set role='admin' where org_id=$1 and user_id=$2`, [
          orgB,
          ownerB,
        ]);
        await m.query("COMMIT");
      },
    );
  }

  /* ---- 7. concurrency -------------------------------------------- */
  g = "7-concurrency";
  {
    // Seat race: limit 2, owner already holds 1. Two concurrent inserts, one seat.
    const o = await makeUser(m, `raceowner-${tag}@example.test`);
    const orgR = await makeOrg(m, `org-race-${tag}`, o, 2);
    const u1 = await makeUser(m, `r1-${tag}@example.test`);
    const u2 = await makeUser(m, `r2-${tag}@example.test`);

    const c1 = asMigrator(),
      c2 = asMigrator();
    await c1.connect();
    await c2.connect();
    await c1.query("BEGIN");
    await c2.query("BEGIN");
    const r1 = c1.query(
      `insert into public.memberships (org_id,user_id,role) values ($1,$2,'member')`,
      [orgR, u1],
    );
    await new Promise((r) => setTimeout(r, 150)); // let c1 take the row lock first
    const r2 = c2.query(
      `insert into public.memberships (org_id,user_id,role) values ($1,$2,'member')`,
      [orgR, u2],
    );
    const o1 = await r1.then(() => "ok").catch((e) => e.message);
    await c1.query("COMMIT").catch(() => {});
    const o2 = await r2.then(() => "ok").catch((e) => e.message);
    await c2.query("COMMIT").catch(() => {});
    await c1.end();
    await c2.end();

    const okCount = [o1, o2].filter((x) => x === "ok").length;
    const capped = [o1, o2].filter((x) => String(x).includes("SEAT_LIMIT_REACHED")).length;
    if (okCount === 1 && capped === 1)
      ok(g, "seat quota under two concurrent transactions: exactly one admitted");
    else
      bad(
        g,
        "seat quota under two concurrent transactions",
        `expected 1 success + 1 SEAT_LIMIT_REACHED, got [${o1}] / [${o2}]`,
      );
  }
  {
    // Last-owner race: two owners, each transaction removes a different one.
    const oa = await makeUser(m, `ro1-${tag}@example.test`);
    const ob = await makeUser(m, `ro2-${tag}@example.test`);
    const orgO = await makeOrg(m, `org-owner-race-${tag}`, oa, 10);
    await addMember(m, orgO, ob, "owner");

    const c1 = asMigrator(),
      c2 = asMigrator();
    await c1.connect();
    await c2.connect();
    await c1.query("BEGIN");
    await c2.query("BEGIN");
    await c1.query(`delete from public.memberships where org_id=$1 and user_id=$2`, [orgO, oa]);
    await c2.query(`delete from public.memberships where org_id=$1 and user_id=$2`, [orgO, ob]);
    const e1 = await c1
      .query("COMMIT")
      .then(() => "ok")
      .catch((e) => e.message);
    const e2 = await c2
      .query("COMMIT")
      .then(() => "ok")
      .catch((e) => e.message);
    await c1.end();
    await c2.end();

    const left = await m.query(
      `select count(*)::int n from public.memberships where org_id=$1 and role='owner'`,
      [orgO],
    );
    if (left.rows[0].n >= 1)
      ok(g, `last-owner invariant holds under concurrent removal (owners left: ${left.rows[0].n})`);
    else
      bad(
        g,
        "last-owner invariant under concurrent removal",
        `organisation left with 0 owners; commits: [${e1}] / [${e2}]`,
      );
  }

  /* ---- 8. invitation acceptance ---------------------------------- */
  g = "8-invitations";
  {
    const mkInv = async (orgId, email, token, { expires = "7 days", status = "pending" } = {}) => {
      const { rows } = await m.query(
        `insert into public.invitations (org_id,email,role,token_hash,expires_at,invited_by,status)
         values ($1,$2,'member',$3, now() + $4::interval, $5, $6) returning id`,
        [orgId, email.toLowerCase(), sha256(token), expires, ownerA, status],
      );
      return rows[0].id;
    };

    const good = await makeUser(m, `acc-${tag}@example.test`);
    const other = await makeUser(m, `oth-${tag}@example.test`);
    const unver = await makeUser(m, `unv-${tag}@example.test`, { verified: false });

    const tok1 = `tok1-${tag}`;
    await mkInv(orgA, `acc-${tag}@example.test`, tok1);
    const tok2 = `tok2-${tag}`;
    await mkInv(orgA, `exp-${tag}@example.test`, tok2, { expires: "-1 day" });
    const tok3 = `tok3-${tag}`;
    await mkInv(orgA, `oth2-${tag}@example.test`, tok3);
    const tok4 = `tok4-${tag}`;
    await mkInv(orgA, `unv-${tag}@example.test`, tok4);

    await act(t, other, () =>
      expectDenied(
        g,
        "expired invitation is rejected",
        () => t.query(`select public.accept_invitation($1)`, [sha256(tok2)]),
        "INVITATION_INVALID",
      ),
    );
    await act(t, other, () =>
      expectDenied(
        g,
        "invitation addressed to someone else is rejected",
        () => t.query(`select public.accept_invitation($1)`, [sha256(tok3)]),
        "INVITATION_INVALID",
      ),
    );
    await act(t, unver, () =>
      expectDenied(
        g,
        "unverified email cannot accept",
        () => t.query(`select public.accept_invitation($1)`, [sha256(tok4)]),
        "EMAIL_NOT_VERIFIED",
      ),
    );
    await act(t, other, () =>
      expectDenied(
        g,
        "unknown token is rejected with the same generic error",
        () => t.query(`select public.accept_invitation($1)`, [sha256("no-such-token")]),
        "INVITATION_INVALID",
      ),
    );

    await act(t, good, () =>
      expectAllowed(g, "valid invitation is accepted", () =>
        t.query(`select public.accept_invitation($1)`, [sha256(tok1)]),
      ),
    );
    await act(t, good, () =>
      expectDenied(
        g,
        "the same token cannot be used twice",
        () => t.query(`select public.accept_invitation($1)`, [sha256(tok1)]),
        "INVITATION_INVALID",
      ),
    );

    const tok5 = `tok5-${tag}`;
    await mkInv(orgA, `rev-${tag}@example.test`, tok5, { status: "pending" });
    await m.query(
      `update public.invitations set status='revoked', revoked_at=now() where token_hash=$1`,
      [sha256(tok5)],
    );
    const revUser = await makeUser(m, `rev-${tag}@example.test`);
    await act(t, revUser, () =>
      expectDenied(
        g,
        "revoked invitation cannot be accepted",
        () => t.query(`select public.accept_invitation($1)`, [sha256(tok5)]),
        "INVITATION_INVALID",
      ),
    );
  }

  /* ---- 8b. platform audit writer --------------------------------- */
  g = "8b-platform-audit";
  await act(t, memberA, async () => {
    await expectDenied(
      g,
      "authenticated cannot EXECUTE log_platform_audit (would let anyone name any actor)",
      () =>
        t.query(`select public.log_platform_audit($1,'forged','organization',$2)`, [memberA, orgA]),
      "permission denied",
    );
  });
  await expectAllowed(g, "service_role CAN write a platform audit row", async () => {
    await p.query("SET ROLE service_role");
    await p.query(`select public.log_platform_audit($1,'admin.read','platform_admins',null)`, [
      ownerA,
    ]);
    await p.query("RESET ROLE");
  });
  {
    const r = await m.query(
      `select actor_user_id, actor_type from public.audit_events
        where action='admin.read' order by created_at desc limit 1`,
    );
    if (r.rows[0]?.actor_user_id === ownerA && r.rows[0]?.actor_type === "platform_admin") {
      ok(g, "the audit row names the acting administrator, not NULL");
    } else {
      bad(
        g,
        "the audit row names the acting administrator",
        `got actor_user_id=${r.rows[0]?.actor_user_id} actor_type=${r.rows[0]?.actor_type}`,
      );
    }
  }
  await expectDenied(
    g,
    "a platform audit row without an actor is refused",
    async () => {
      await p.query("SET ROLE service_role");
      try {
        await p.query(`select public.log_platform_audit(null,'x','y',null)`);
      } finally {
        await p.query("RESET ROLE").catch(() => {});
      }
    },
    "PLATFORM_AUDIT_REQUIRES_ACTOR",
  );

  /* ---- 9. service_role boundary ---------------------------------- */
  g = "9-service-role";
  await expectDenied(
    g,
    "tester account cannot SET ROLE service_role",
    () => t.query("SET ROLE service_role"),
    "permission denied",
  );
  await t.query("RESET ROLE").catch(() => {});
  await expectAllowed(g, "service probe can SET ROLE service_role", async () => {
    await p.query("SET ROLE service_role");
    await p.query("RESET ROLE");
  });
  await expectAllowed(
    g,
    "service_role can read platform_admins (BYPASSRLS, as in Supabase)",
    async () => {
      await p.query("SET ROLE service_role");
      await p.query(`select 1 from public.platform_admins`);
      await p.query("RESET ROLE");
    },
  );

  /* ---- 10. agents and agent_versions (P2) ------------------------ */
  g = "10-agents";
  {
    const ownerA = await makeUser(m, `ag-owner-a-${tag}@example.test`);
    const orgA = await makeOrg(m, `org-ag-a-${tag}`, ownerA, 10);
    const memberA = await makeUser(m, `ag-member-a-${tag}@example.test`);
    const viewerA = await makeUser(m, `ag-viewer-a-${tag}@example.test`);
    const adminA = await makeUser(m, `ag-admin-a-${tag}@example.test`);
    await addMember(m, orgA, memberA, "member");
    await addMember(m, orgA, viewerA, "viewer");
    await addMember(m, orgA, adminA, "admin");

    const ownerB = await makeUser(m, `ag-owner-b-${tag}@example.test`);
    const orgB = await makeOrg(m, `org-ag-b-${tag}`, ownerB, 10);

    // create_agent() re-derives the caller from auth.uid(), so fixture agents
    // have to be created as a user. Doing it as the schema owner raises
    // AUTH_REQUIRED, which is the function behaving correctly.
    const mkAgent = async (name) => {
      let id;
      await act(t, memberA, async () => {
        const r = await t.query(`select public.create_agent($1,$2,null) as id`, [orgA, name]);
        id = r.rows[0].id;
      });
      return id;
    };

    /* -- creation and the role matrix -- */
    let agentA;
    await expectAllowed(g, "a member can create an agent", () =>
      act(t, memberA, async () => {
        const r = await t.query(`select public.create_agent($1,$2,$3) as id`, [
          orgA,
          "Support triage",
          "demo",
        ]);
        agentA = r.rows[0].id;
      }),
    );
    await expectDenied(
      g,
      "a viewer cannot create an agent",
      () =>
        act(t, viewerA, () =>
          t.query(`select public.create_agent($1,$2,null)`, [orgA, "Viewer attempt"]),
        ),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "an outsider cannot create an agent in someone else's org",
      () =>
        act(t, ownerB, () =>
          t.query(`select public.create_agent($1,$2,null)`, [orgA, "Outsider attempt"]),
        ),
      "ORG_ACCESS_DENIED",
    );

    await expectRows(
      g,
      "create_agent opens exactly one draft",
      () =>
        m.query(`select 1 from public.agent_versions where agent_id=$1 and published_at is null`, [
          agentA,
        ]),
      1,
    );

    /* -- cross-tenant reads: the release blocker in SECURITY.md 1 -- */
    await expectRows(
      g,
      "org B owner sees 0 of org A's agents",
      () => act(t, ownerB, () => t.query(`select id from public.agents where org_id=$1`, [orgA])),
      0,
    );
    await expectRows(
      g,
      "org B owner sees 0 of org A's agent versions",
      () =>
        act(t, ownerB, () =>
          t.query(`select id from public.agent_versions where org_id=$1`, [orgA]),
        ),
      0,
    );
    await expectRows(
      g,
      "a viewer in org A DOES see org A's agents",
      () => act(t, viewerA, () => t.query(`select id from public.agents where org_id=$1`, [orgA])),
      1,
    );

    /* -- editing the draft -- */
    const draftId = (
      await m.query(
        `select id from public.agent_versions where agent_id=$1 and published_at is null`,
        [agentA],
      )
    ).rows[0].id;

    await expectRows(
      g,
      "a member can edit the draft config",
      () =>
        act(t, memberA, () =>
          t.query(`update public.agent_versions set config_json=$2 where id=$1`, [
            draftId,
            JSON.stringify({ provider: "anthropic", model: "claude-x", max_steps: 5 }),
          ]),
        ),
      1,
    );
    await expectRows(
      g,
      "a viewer editing the draft changes 0 rows (invisible, not an error)",
      () =>
        act(t, viewerA, () =>
          t.query(`update public.agent_versions set config_json='{"x":1}'::jsonb where id=$1`, [
            draftId,
          ]),
        ),
      0,
    );
    await expectRows(
      g,
      "org B owner editing org A's draft changes 0 rows",
      () =>
        act(t, ownerB, () =>
          t.query(`update public.agent_versions set config_json='{"x":1}'::jsonb where id=$1`, [
            draftId,
          ]),
        ),
      0,
    );

    /* -- columns withheld from every customer role -- */
    for (const [col, val] of [
      ["published_at", "now()"],
      ["version", "1"],
    ]) {
      await expectDenied(
        g,
        `no role may write agent_versions.${col} directly`,
        () =>
          act(t, ownerA, () =>
            t.query(`update public.agent_versions set ${col}=${val} where id=$1`, [draftId]),
          ),
        "permission denied",
      );
    }
    for (const [col, val] of [
      ["status", `'published'`],
      ["active_version_id", `gen_random_uuid()`],
      ["org_id", `gen_random_uuid()`],
    ]) {
      await expectDenied(
        g,
        `no role may write agents.${col} directly`,
        () =>
          act(t, ownerA, () =>
            t.query(`update public.agents set ${col}=${val} where id=$1`, [agentA]),
          ),
        "permission denied",
      );
    }
    await expectRows(
      g,
      "a member CAN rename an agent",
      () =>
        act(t, memberA, () =>
          t.query(`update public.agents set name='Renamed' where id=$1`, [agentA]),
        ),
      1,
    );
    await expectRows(
      g,
      "a viewer renaming an agent changes 0 rows",
      () =>
        act(t, viewerA, () =>
          t.query(`update public.agents set name='Viewer rename' where id=$1`, [agentA]),
        ),
      0,
    );

    /* -- publishing -- */
    let v1;
    await expectAllowed(g, "a member can publish the draft", () =>
      act(t, memberA, async () => {
        const r = await t.query(`select public.publish_agent_version($1) as out`, [agentA]);
        v1 = r.rows[0].out;
        if (v1.version !== 1) throw new Error(`expected version 1, got ${v1.version}`);
      }),
    );
    {
      const r = await m.query(`select status, active_version_id from public.agents where id=$1`, [
        agentA,
      ]);
      const row = r.rows[0];
      if (row.status === "published" && row.active_version_id === v1.version_id)
        ok(g, "publishing sets status and points active_version_id at the frozen version");
      else
        bad(
          g,
          "publishing sets status and points active_version_id at the frozen version",
          `got status=${row.status} active=${row.active_version_id} expected=${v1.version_id}`,
        );
    }
    await expectRows(
      g,
      "publishing leaves exactly one fresh draft behind",
      () =>
        m.query(`select 1 from public.agent_versions where agent_id=$1 and published_at is null`, [
          agentA,
        ]),
      1,
    );
    {
      const r = await m.query(
        `select config_json from public.agent_versions where agent_id=$1 and published_at is null`,
        [agentA],
      );
      if (r.rows[0].config_json?.model === "claude-x")
        ok(g, "the fresh draft carries the published configuration forward");
      else
        bad(
          g,
          "the fresh draft carries the published configuration forward",
          `got ${JSON.stringify(r.rows[0].config_json)}`,
        );
    }

    /* -- a published version is frozen -- */
    await expectRows(
      g,
      "an owner editing a published version changes 0 rows (RLS)",
      () =>
        act(t, ownerA, () =>
          t.query(
            `update public.agent_versions set config_json='{"tampered":true}'::jsonb where id=$1`,
            [v1.version_id],
          ),
        ),
      0,
    );
    await expectDenied(
      g,
      "even the schema owner cannot edit a published version (trigger, not RLS)",
      () =>
        m.query(
          `update public.agent_versions set config_json='{"tampered":true}'::jsonb where id=$1`,
          [v1.version_id],
        ),
      "AGENT_VERSION_IMMUTABLE",
    );
    await expectDenied(
      g,
      "a draft cannot be moved to another agent",
      async () => {
        const other = await mkAgent("Other agent");
        // The CURRENT draft, not `draftId`: that one was published above, so the
        // immutability guard would answer first and the identity guard - the
        // thing under test - would never run.
        const live = (
          await m.query(
            `select id from public.agent_versions where agent_id=$1 and published_at is null`,
            [agentA],
          )
        ).rows[0].id;
        await m.query(`update public.agent_versions set agent_id=$2 where id=$1`, [live, other]);
      },
      "AGENT_VERSION_IDENTITY_IMMUTABLE",
    );

    /* -- keys, not conventions -- */
    await expectDenied(
      g,
      "a second draft for the same agent is rejected by the unique index",
      () =>
        m.query(
          `insert into public.agent_versions (org_id, agent_id, config_json) values ($1,$2,'{}'::jsonb)`,
          [orgA, agentA],
        ),
      "agent_versions_one_draft_per_agent",
    );
    await expectDenied(
      g,
      "a version cannot be filed under a different org than its agent",
      () =>
        // Inserted as a published version on purpose: agentA already has a
        // draft, so an unpublished row would trip the one-draft index first and
        // the composite foreign key - the thing under test - would never be
        // reached.
        m.query(
          `insert into public.agent_versions (org_id, agent_id, version, published_at, config_json)
           values ($1,$2,99,now(),'{}'::jsonb)`,
          [orgB, agentA],
        ),
      "agent_versions_agent_fk",
    );
    await expectDenied(
      g,
      "active_version_id cannot point at another agent's version",
      async () => {
        const agentC = await mkAgent("Agent C");
        await m.query(`update public.agents set active_version_id=$2 where id=$1`, [
          agentC,
          v1.version_id,
        ]);
      },
      "agents_active_version_fk",
    );

    /* -- publish guards -- */
    await expectDenied(
      g,
      "publishing an empty configuration is refused",
      async () => {
        const empty = await mkAgent("Empty agent");
        await act(t, memberA, () => t.query(`select public.publish_agent_version($1)`, [empty]));
      },
      "AGENT_CONFIG_INVALID",
    );
    await expectDenied(
      g,
      "org B owner cannot publish org A's agent",
      () => act(t, ownerB, () => t.query(`select public.publish_agent_version($1)`, [agentA])),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "a viewer cannot publish",
      () => act(t, viewerA, () => t.query(`select public.publish_agent_version($1)`, [agentA])),
      "ORG_ACCESS_DENIED",
    );

    /* -- archiving -- */
    await expectDenied(
      g,
      "a member cannot archive an agent",
      () => act(t, memberA, () => t.query(`select public.set_agent_archived($1,true)`, [agentA])),
      "ORG_ACCESS_DENIED",
    );
    await expectAllowed(g, "an admin can archive an agent", () =>
      act(t, adminA, () => t.query(`select public.set_agent_archived($1,true)`, [agentA])),
    );
    await expectDenied(
      g,
      "an archived agent cannot be published",
      () => act(t, memberA, () => t.query(`select public.publish_agent_version($1)`, [agentA])),
      "AGENT_ARCHIVED",
    );
    await expectRows(
      g,
      "a member cannot rename an archived agent",
      () =>
        act(t, memberA, () =>
          t.query(`update public.agents set name='Rename archived' where id=$1`, [agentA]),
        ),
      0,
    );
    await expectAllowed(g, "restoring returns it to 'published', not to 'draft'", () =>
      act(t, adminA, async () => {
        const r = await t.query(`select public.set_agent_archived($1,false) as s`, [agentA]);
        if (r.rows[0].s !== "published") throw new Error(`got status ${r.rows[0].s}`);
      }),
    );

    /* -- publish under concurrency -- */
    {
      const racer = await mkAgent("Race agent");
      await m.query(
        `update public.agent_versions set config_json='{"model":"m"}'::jsonb
         where agent_id=$1 and published_at is null`,
        [racer],
      );

      const c1 = asMigrator(),
        c2 = asMigrator();
      await c1.connect();
      await c2.connect();
      const claims = JSON.stringify({ sub: memberA, role: "authenticated", aal: "aal1" });
      for (const c of [c1, c2]) {
        await c.query("SELECT set_config('request.jwt.claims', $1, false)", [claims]);
        await c.query("BEGIN");
      }
      const p1 = c1.query(`select public.publish_agent_version($1) as out`, [racer]);
      await new Promise((r) => setTimeout(r, 150)); // let c1 take the agent row lock
      const p2 = c2.query(`select public.publish_agent_version($1) as out`, [racer]);
      const r1 = await p1.then((r) => r.rows[0].out.version).catch((e) => e.message);
      await c1.query("COMMIT").catch(() => {});
      const r2 = await p2.then((r) => r.rows[0].out.version).catch((e) => e.message);
      await c2.query("COMMIT").catch(() => {});
      await c1.end();
      await c2.end();

      const { rows: nums } = await m.query(
        `select version from public.agent_versions
         where agent_id=$1 and version is not null order by version`,
        [racer],
      );
      const distinct = new Set(nums.map((r) => r.version));
      if (distinct.size === nums.length && nums.length >= 1)
        ok(
          g,
          `two concurrent publishes produced no duplicate version number (got [${r1}] / [${r2}])`,
        );
      else
        bad(
          g,
          "two concurrent publishes produced no duplicate version number",
          `versions in table: ${nums.map((r) => r.version).join(",")} (outcomes [${r1}] / [${r2}])`,
        );
    }
  }

  /* ---- 11. template catalog (P2) --------------------------------- */
  g = "11-templates";
  {
    const ownerT = await makeUser(m, `tpl-owner-${tag}@example.test`);
    const orgT = await makeOrg(m, `org-tpl-${tag}`, ownerT, 10);
    const memberT = await makeUser(m, `tpl-member-${tag}@example.test`);
    const viewerT = await makeUser(m, `tpl-viewer-${tag}@example.test`);
    await addMember(m, orgT, memberT, "member");
    await addMember(m, orgT, viewerT, "viewer");

    const outsider = await makeUser(m, `tpl-out-${tag}@example.test`);
    const orgOther = await makeOrg(m, `org-tpl-other-${tag}`, outsider, 10);

    const DEFINITION = {
      name: "תבנית תמיכה",
      description: "מענה ראשוני ללקוחות בעברית, בלי להמציא מדיניות.",
      role: "נציג תמיכה",
      instructions: "ענה בעברית, בקצרה, והפנה לנציג אנושי כשחסר מידע.",
      provider: "anthropic",
      model: "anthropic:sonnet-family",
      tools: [],
      knowledgeBaseIds: [],
      maxSteps: 6,
      maxSpendUsdMicros: 500000,
    };

    /** Templates are platform data: only the privileged connection writes them. */
    const makeTemplate = async (slug, visibility, { publish = true } = {}) => {
      const t0 = (
        await m.query(
          `insert into public.global_templates (slug, category, name, description, visibility)
           values ($1,'support',$1,'A template used by the verification suite.',$2) returning id`,
          [slug, visibility],
        )
      ).rows[0].id;
      const v0 = (
        await m.query(
          `insert into public.global_template_versions
             (template_id, version, definition_json, published_at)
           values ($1, 1, $2::jsonb, $3) returning id`,
          [t0, JSON.stringify(DEFINITION), publish ? new Date() : null],
        )
      ).rows[0].id;
      if (publish) {
        await m.query(`update public.global_templates set active_version_id=$2 where id=$1`, [
          t0,
          v0,
        ]);
      }
      return { templateId: t0, versionId: v0 };
    };

    const pub = await makeTemplate(`tpl-public-${tag}`, "public");
    const draftTpl = await makeTemplate(`tpl-draft-${tag}`, "draft");
    const retired = await makeTemplate(`tpl-retired-${tag}`, "retired");
    const unpublished = await makeTemplate(`tpl-unpub-${tag}`, "public", { publish: false });

    /* -- the P2 gate: unauthorized template editing denied -- */
    for (const [label, sql, params] of [
      [
        "insert a template",
        `insert into public.global_templates (slug, category, name, description, visibility)
         values ('pirate-tpl','x','Pirate','Injected by a customer.','public')`,
        [],
      ],
      [
        "update a template",
        `update public.global_templates set visibility='public' where id=$1`,
        [draftTpl.templateId],
      ],
      ["delete a template", `delete from public.global_templates where id=$1`, [pub.templateId]],
      [
        "insert a template version",
        `insert into public.global_template_versions (template_id, version, definition_json)
         values ($1, 99, '{}'::jsonb)`,
        [pub.templateId],
      ],
      [
        "update a template version",
        `update public.global_template_versions set definition_json='{"owned":true}'::jsonb where id=$1`,
        [pub.versionId],
      ],
      [
        "delete a template version",
        `delete from public.global_template_versions where id=$1`,
        [pub.versionId],
      ],
    ]) {
      await expectDenied(
        g,
        `an org owner cannot ${label}`,
        () => act(t, ownerT, () => t.query(sql, params)),
        "permission denied",
      );
    }

    /* -- what a customer may see -- */
    await expectRows(
      g,
      "a public template is listed",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_templates where id=$1`, [pub.templateId]),
        ),
      1,
    );
    await expectRows(
      g,
      "a draft template is invisible, not merely unlisted",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_templates where id=$1`, [draftTpl.templateId]),
        ),
      0,
    );
    await expectRows(
      g,
      "a retired template is gone from the catalog",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_templates where id=$1`, [retired.templateId]),
        ),
      0,
    );
    await expectRows(
      g,
      "a published version of a PUBLIC template is readable",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_template_versions where id=$1`, [pub.versionId]),
        ),
      1,
    );
    await expectRows(
      g,
      "a published version of a DRAFT template is NOT readable (no side door)",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_template_versions where id=$1`, [
            draftTpl.versionId,
          ]),
        ),
      0,
    );
    await expectRows(
      g,
      "an unpublished version of a public template is NOT readable",
      () =>
        act(t, memberT, () =>
          t.query(`select id from public.global_template_versions where id=$1`, [
            unpublished.versionId,
          ]),
        ),
      0,
    );

    /* -- installing -- */
    let installedAgent;
    await expectAllowed(g, "a member can install a public template", () =>
      act(t, memberT, async () => {
        const r = await t.query(`select public.install_template($1,$2,null) as id`, [
          orgT,
          pub.versionId,
        ]);
        installedAgent = r.rows[0].id;
      }),
    );
    await expectRows(
      g,
      "installing creates the agent, its draft and the installation record",
      () =>
        m.query(
          `select 1 from public.agents a
             join public.agent_versions v on v.agent_id = a.id and v.published_at is null
             join public.template_installations i on i.linked_agent_id = a.id
           where a.id = $1 and i.template_version_id = $2`,
          [installedAgent, pub.versionId],
        ),
      1,
    );
    {
      const r = await m.query(
        `select v.config_json from public.agent_versions v
         where v.agent_id=$1 and v.published_at is null`,
        [installedAgent],
      );
      const cfg = r.rows[0].config_json;
      if (cfg.model === DEFINITION.model && cfg.name === undefined)
        ok(g, "the copied draft keeps the definition but drops its stale name");
      else
        bad(
          g,
          "the copied draft keeps the definition but drops its stale name",
          `got ${JSON.stringify(cfg)}`,
        );
    }
    await expectRows(
      g,
      "the installed agent is ordinary tenant data a member can edit",
      () =>
        act(t, memberT, () =>
          t.query(
            `update public.agent_versions set config_json='{"model":"changed"}'::jsonb
             where agent_id=$1 and published_at is null`,
            [installedAgent],
          ),
        ),
      1,
    );

    /* -- install guards -- */
    await expectDenied(
      g,
      "a viewer cannot install",
      () =>
        act(t, viewerT, () =>
          t.query(`select public.install_template($1,$2,null)`, [orgT, pub.versionId]),
        ),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "an outsider cannot install into someone else's org",
      () =>
        act(t, outsider, () =>
          t.query(`select public.install_template($1,$2,null)`, [orgT, pub.versionId]),
        ),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "a draft template cannot be installed even with its version id in hand",
      () =>
        act(t, memberT, () =>
          t.query(`select public.install_template($1,$2,null)`, [orgT, draftTpl.versionId]),
        ),
      "TEMPLATE_NOT_AVAILABLE",
    );
    await expectDenied(
      g,
      "a retired template cannot be installed again",
      () =>
        act(t, memberT, () =>
          t.query(`select public.install_template($1,$2,null)`, [orgT, retired.versionId]),
        ),
      "TEMPLATE_NOT_AVAILABLE",
    );
    await expectDenied(
      g,
      "an unpublished version cannot be installed",
      () =>
        act(t, memberT, () =>
          t.query(`select public.install_template($1,$2,null)`, [orgT, unpublished.versionId]),
        ),
      "TEMPLATE_NOT_AVAILABLE",
    );

    /* -- installations are tenant data -- */
    await expectRows(
      g,
      "org B sees 0 of org A's installations",
      () =>
        act(t, outsider, () =>
          t.query(`select id from public.template_installations where org_id=$1`, [orgT]),
        ),
      0,
    );
    await expectRows(
      g,
      "a viewer in the installing org DOES see the installation",
      () =>
        act(t, viewerT, () =>
          t.query(`select id from public.template_installations where org_id=$1`, [orgT]),
        ),
      1,
    );
    await expectDenied(
      g,
      "nobody can rewrite an installation record",
      () =>
        act(t, ownerT, () =>
          t.query(`update public.template_installations set linked_agent_id=null where org_id=$1`, [
            orgT,
          ]),
        ),
      "permission denied",
    );

    /* -- the copy survives the catalog changing under it -- */
    await m.query(`update public.global_templates set visibility='retired' where id=$1`, [
      pub.templateId,
    ]);
    await expectRows(
      g,
      "retiring the template leaves the installed copy untouched",
      () => m.query(`select 1 from public.agents where id=$1`, [installedAgent]),
      1,
    );
    await m.query(`update public.global_templates set visibility='public' where id=$1`, [
      pub.templateId,
    ]);

    /* -- platform-side invariants -- */
    await expectDenied(
      g,
      "even the schema owner cannot edit a published template version",
      () =>
        m.query(
          `update public.global_template_versions set definition_json='{"x":1}'::jsonb where id=$1`,
          [pub.versionId],
        ),
      "TEMPLATE_VERSION_IMMUTABLE",
    );
    await expectDenied(
      g,
      "a template's active version cannot belong to another template",
      () =>
        m.query(`update public.global_templates set active_version_id=$2 where id=$1`, [
          retired.templateId,
          pub.versionId,
        ]),
      "global_templates_active_version_fk",
    );
    await expectDenied(
      g,
      "an installation cannot link to another org's agent",
      () =>
        m.query(
          `insert into public.template_installations (org_id, template_version_id, linked_agent_id)
           values ($1,$2,$3)`,
          [orgOther, pub.versionId, installedAgent],
        ),
      "template_installations_agent_fk",
    );
    await expectAllowed(
      g,
      "service_role may write the catalog (that is how the platform publishes)",
      async () => {
        await p.query("SET ROLE service_role");
        try {
          await p.query(
            `insert into public.global_templates (slug, category, name, description)
             values ($1,'support','Probe','Written by the service role on purpose.')`,
            [`tpl-probe-${tag}`],
          );
        } finally {
          await p.query("RESET ROLE").catch(() => {});
        }
      },
    );
  }

  /* ---- 12. runtime: runs, trace, spend cap, idempotency (P3) ----- */
  g = "12-runtime";
  {
    const ownerR = await makeUser(m, `run-owner-${tag}@example.test`);
    const orgR = await makeOrg(m, `org-run-${tag}`, ownerR, 10);
    const memberR = await makeUser(m, `run-member-${tag}@example.test`);
    const viewerR = await makeUser(m, `run-viewer-${tag}@example.test`);
    await addMember(m, orgR, memberR, "member");
    await addMember(m, orgR, viewerR, "viewer");

    const strangerR = await makeUser(m, `run-out-${tag}@example.test`);
    const orgStranger = await makeOrg(m, `org-run-other-${tag}`, strangerR, 10);

    const BUDGET = 2_000_000; // $2.00 in micros

    /** An agent with a published version, which is the only runnable thing. */
    const publishedAgent = async (name, budget = BUDGET) => {
      let id;
      await act(t, memberR, async () => {
        id = (await t.query(`select public.create_agent($1,$2,null) as id`, [orgR, name])).rows[0]
          .id;
      });
      await m.query(
        `update public.agent_versions set config_json = $2::jsonb
         where agent_id=$1 and published_at is null`,
        [id, JSON.stringify({ provider: "anthropic", model: "m", maxSpendUsdMicros: budget })],
      );
      await act(t, memberR, () => t.query(`select public.publish_agent_version($1)`, [id]));
      return id;
    };

    const setCap = (cap) =>
      m.query(`update public.organizations set monthly_spend_cap_usd_micros=$2 where id=$1`, [
        orgR,
        cap,
      ]);

    /* -- dispatch and the role matrix -- */
    const agentR = await publishedAgent("Runnable agent");
    let runId;
    await expectAllowed(g, "a member can start a run", () =>
      act(t, memberR, async () => {
        const r = await t.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [agentR]);
        runId = r.rows[0].out.run_id;
        if (r.rows[0].out.reused !== false) throw new Error("a fresh run reported reused=true");
      }),
    );
    await expectDenied(
      g,
      "a viewer cannot start a run",
      () =>
        act(t, viewerR, () => t.query(`select public.start_run($1,'{}'::jsonb,null)`, [agentR])),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "an outsider cannot start a run in someone else's org",
      () =>
        act(t, strangerR, () => t.query(`select public.start_run($1,'{}'::jsonb,null)`, [agentR])),
      "ORG_ACCESS_DENIED",
    );

    /* -- a run pins a PUBLISHED version -- */
    {
      const r = await m.query(
        `select r.agent_version_id, v.published_at, r.budget_usd_micros, r.status
         from public.runs r join public.agent_versions v on v.id = r.agent_version_id
         where r.id=$1`,
        [runId],
      );
      const row = r.rows[0];
      if (
        row.published_at !== null &&
        Number(row.budget_usd_micros) === BUDGET &&
        row.status === "queued"
      )
        ok(g, "the run pins a published version and takes its budget from it");
      else
        bad(
          g,
          "the run pins a published version and takes its budget from it",
          `published_at=${row.published_at} budget=${row.budget_usd_micros} status=${row.status}`,
        );
    }
    await expectDenied(
      g,
      "a draft-only agent has nothing to run",
      async () => {
        let draftOnly;
        await act(t, memberR, async () => {
          draftOnly = (
            await t.query(`select public.create_agent($1,$2,null) as id`, [orgR, "Never published"])
          ).rows[0].id;
        });
        await act(t, memberR, () =>
          t.query(`select public.start_run($1,'{}'::jsonb,null)`, [draftOnly]),
        );
      },
      "AGENT_VERSION_MISSING",
    );
    await expectDenied(
      g,
      "an archived agent cannot be run",
      async () => {
        const archived = await publishedAgent("To be archived");
        await act(t, ownerR, () =>
          t.query(`select public.set_agent_archived($1,true)`, [archived]),
        );
        await act(t, memberR, () =>
          t.query(`select public.start_run($1,'{}'::jsonb,null)`, [archived]),
        );
      },
      "AGENT_ARCHIVED",
    );

    /* -- idempotency -- */
    {
      const key = `idem-${tag}`;
      let first, second;
      await act(t, memberR, async () => {
        first = (await t.query(`select public.start_run($1,'{}'::jsonb,$2) as out`, [agentR, key]))
          .rows[0].out;
        second = (await t.query(`select public.start_run($1,'{}'::jsonb,$2) as out`, [agentR, key]))
          .rows[0].out;
      });
      if (first.run_id === second.run_id && first.reused === false && second.reused === true)
        ok(g, "the same idempotency key returns the same run, marked reused");
      else
        bad(
          g,
          "the same idempotency key returns the same run, marked reused",
          `${JSON.stringify(first)} vs ${JSON.stringify(second)}`,
        );
    }

    /* -- the spend cap, and reserved counting against it -- */
    {
      // Room for exactly two runs at $2 each, with nothing settled.
      await setCap(5_000_000);
      const capAgent = await publishedAgent("Cap agent");
      await m.query(
        `update public.usage_periods set spent_usd_micros=0, reserved_usd_micros=0
         where org_id=$1`,
        [orgR],
      );
      // Clear what earlier tests reserved, so this measures the cap and not them.
      await m.query(
        `update public.usage_reservations set status='released' where org_id=$1 and status='active'`,
        [orgR],
      );

      const outcomes = [];
      for (let i = 0; i < 3; i++) {
        try {
          await act(t, memberR, () =>
            t.query(`select public.start_run($1,'{}'::jsonb,null)`, [capAgent]),
          );
          outcomes.push("ok");
        } catch (e) {
          outcomes.push(String(e.message).split("\n")[0]);
        }
      }
      const admitted = outcomes.filter((o) => o === "ok").length;
      const capped = outcomes.filter((o) => o.includes("USAGE_LIMIT_REACHED")).length;
      if (admitted === 2 && capped === 1)
        ok(g, "reserved budget counts against the cap: 2 admitted, the 3rd refused");
      else
        bad(
          g,
          "reserved budget counts against the cap: 2 admitted, the 3rd refused",
          `outcomes: ${outcomes.join(" | ")}`,
        );
    }

    /* -- settlement is the execution plane's, not the customer's -- */
    await expectDenied(
      g,
      "no customer role may execute settle_run",
      () =>
        act(t, ownerR, () =>
          t.query(`select public.settle_run($1,'succeeded'::public.run_status,1,null,null)`, [
            runId,
          ]),
        ),
      "permission denied",
    );
    for (const [col, val] of [
      ["status", `'succeeded'::public.run_status`],
      ["spent_usd_micros", "0"],
    ]) {
      await expectDenied(
        g,
        `no customer role may write runs.${col} directly`,
        () =>
          act(t, ownerR, () =>
            t.query(`update public.runs set ${col}=${val} where id=$1`, [runId]),
          ),
        "permission denied",
      );
    }
    // A run of its own. The spend-cap block above releases every active
    // reservation in this organisation, so settling an earlier run would find
    // nothing to release - and an assertion on `spent` alone would still have
    // passed, which is how a settlement that never frees budget goes unnoticed.
    const settleAgent = await publishedAgent("Settlement");
    await setCap(50_000_000);
    let settleRun;
    await act(t, memberR, async () => {
      settleRun = (
        await t.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [settleAgent])
      ).rows[0].out.run_id;
    });
    await expectAllowed(g, "service_role settles a run, moving reserved into spent", async () => {
      await p.query("SET ROLE service_role");
      try {
        const before = (
          await p.query(
            `select spent_usd_micros, reserved_usd_micros from public.usage_periods where org_id=$1`,
            [orgR],
          )
        ).rows[0];
        await p.query(`select public.settle_run($1,'succeeded'::public.run_status,$2,null,null)`, [
          settleRun,
          750000,
        ]);
        const after = (
          await p.query(
            `select spent_usd_micros, reserved_usd_micros from public.usage_periods where org_id=$1`,
            [orgR],
          )
        ).rows[0];
        const spentDelta = Number(after.spent_usd_micros) - Number(before.spent_usd_micros);
        const reservedDelta =
          Number(before.reserved_usd_micros) - Number(after.reserved_usd_micros);
        if (spentDelta !== 750000) throw new Error(`spent moved by ${spentDelta}, expected 750000`);
        if (reservedDelta !== BUDGET)
          throw new Error(`reserved released ${reservedDelta}, expected ${BUDGET}`);
      } finally {
        await p.query("RESET ROLE").catch(() => {});
      }
    });
    await expectDenied(
      g,
      "settle_run refuses a non-terminal status",
      async () => {
        await p.query("SET ROLE service_role");
        try {
          await p.query(`select public.settle_run($1,'running'::public.run_status,0,null,null)`, [
            settleRun,
          ]);
        } finally {
          await p.query("RESET ROLE").catch(() => {});
        }
      },
      "VALIDATION_FAILED",
    );

    /* -- cancellation gives the budget back -- */
    {
      const cancelAgent = await publishedAgent("Cancellable");
      await setCap(50_000_000);
      let cancelRun;
      await act(t, memberR, async () => {
        cancelRun = (
          await t.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [cancelAgent])
        ).rows[0].out.run_id;
      });
      const before = Number(
        (
          await m.query(`select reserved_usd_micros from public.usage_periods where org_id=$1`, [
            orgR,
          ])
        ).rows[0].reserved_usd_micros,
      );
      await expectAllowed(g, "a member can cancel their org's run", () =>
        act(t, memberR, () => t.query(`select public.cancel_run($1)`, [cancelRun])),
      );
      const after = Number(
        (
          await m.query(`select reserved_usd_micros from public.usage_periods where org_id=$1`, [
            orgR,
          ])
        ).rows[0].reserved_usd_micros,
      );
      if (before - after === BUDGET) ok(g, "cancelling releases the reservation");
      else bad(g, "cancelling releases the reservation", `reserved moved by ${before - after}`);

      await expectAllowed(g, "cancelling an already-finished run is not an error", () =>
        act(t, memberR, async () => {
          const r = await t.query(`select public.cancel_run($1) as s`, [cancelRun]);
          if (r.rows[0].s !== "cancelled") throw new Error(`got ${r.rows[0].s}`);
        }),
      );
      await expectDenied(
        g,
        "an outsider cannot cancel another org's run",
        () => act(t, strangerR, () => t.query(`select public.cancel_run($1)`, [cancelRun])),
        "ORG_ACCESS_DENIED",
      );
    }

    /* -- abandoned runs do not hold budget forever -- */
    {
      const lostAgent = await publishedAgent("Abandoned");
      let lostRun;
      await act(t, memberR, async () => {
        lostRun = (
          await t.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [lostAgent])
        ).rows[0].out.run_id;
      });
      await m.query(
        `update public.usage_reservations set expires_at = now() - interval '1 minute'
         where run_id=$1 and status='active'`,
        [lostRun],
      );
      await expectAllowed(g, "the sweeper reclaims an expired reservation", async () => {
        await p.query("SET ROLE service_role");
        try {
          const n = (await p.query(`select public.expire_stale_reservations() as n`)).rows[0].n;
          if (Number(n) < 1) throw new Error(`swept ${n} reservations, expected at least 1`);
        } finally {
          await p.query("RESET ROLE").catch(() => {});
        }
      });
      const row = (
        await m.query(
          `select r.status, r.error_code, res.status as res_status
           from public.runs r
           join public.usage_reservations res on res.run_id = r.id
           where r.id=$1`,
          [lostRun],
        )
      ).rows[0];
      if (
        row.status === "failed" &&
        row.error_code === "RUN_ABANDONED" &&
        row.res_status === "expired"
      )
        ok(g, "an abandoned run is marked failed rather than left running forever");
      else
        bad(
          g,
          "an abandoned run is marked failed rather than left running forever",
          `run=${row.status}/${row.error_code} reservation=${row.res_status}`,
        );
    }

    /* -- who may read what -- */
    await expectRows(
      g,
      "org B sees 0 of org A's runs",
      () => act(t, strangerR, () => t.query(`select id from public.runs where org_id=$1`, [orgR])),
      0,
    );
    await expectRows(
      g,
      "a viewer DOES see the org's runs",
      () => act(t, viewerR, () => t.query(`select id from public.runs where id=$1`, [runId])),
      1,
    );
    {
      await m.query(
        `insert into public.run_steps (org_id, run_id, step_index, kind, status, provider, model)
         values ($1,$2,0,'model_call','succeeded','anthropic','m')`,
        [orgR, runId],
      );
      await m.query(
        `insert into public.usage_events (org_id, run_id, provider, model, cost_usd_micros, estimate_source)
         values ($1,$2,'anthropic','m',750000,'provider_reported')`,
        [orgR, runId],
      );
    }
    await expectRows(
      g,
      "a viewer sees the trace, which carries no prompt or completion text",
      () =>
        act(t, viewerR, () => t.query(`select id from public.run_steps where run_id=$1`, [runId])),
      1,
    );
    await expectRows(
      g,
      "a viewer does NOT see per-call spend",
      () =>
        act(t, viewerR, () =>
          t.query(`select id from public.usage_events where org_id=$1`, [orgR]),
        ),
      0,
    );
    await expectRows(
      g,
      "a member does NOT see per-call spend either",
      () =>
        act(t, memberR, () =>
          t.query(`select id from public.usage_events where org_id=$1`, [orgR]),
        ),
      0,
    );
    await expectRows(
      g,
      "an owner DOES see per-call spend",
      () =>
        act(t, ownerR, () => t.query(`select id from public.usage_events where org_id=$1`, [orgR])),
      1,
    );
    await expectRows(
      g,
      "org B sees 0 of org A's run steps",
      () =>
        act(t, strangerR, () => t.query(`select id from public.run_steps where org_id=$1`, [orgR])),
      0,
    );
    for (const [label, userId] of [
      ["owner", ownerR],
      ["member", memberR],
      ["viewer", viewerR],
    ]) {
      // Same shape as the platform_admins check: RLS with no policy returns no
      // rows, and the revoked privilege refuses outright. Either is a pass;
      // leaking a row is not.
      const name = `usage_reservations is invisible to ${label}`;
      try {
        const r = await act(t, userId, () =>
          t.query(`select id from public.usage_reservations where org_id=$1`, [orgR]),
        );
        if (r.rowCount === 0) ok(g, `${name} (zero rows)`);
        else bad(g, name, `leaked ${r.rowCount} row(s)`);
      } catch (e) {
        if (String(e.message).includes("permission denied")) ok(g, `${name} (permission denied)`);
        else bad(g, name, `unexpected error: ${String(e.message).split("\n")[0]}`);
      }
    }
    await expectDenied(
      g,
      "a member cannot read the org usage summary",
      () => act(t, memberR, () => t.query(`select public.org_usage_summary($1)`, [orgR])),
      "ORG_ACCESS_DENIED",
    );
    await expectAllowed(g, "an owner can read the org usage summary", () =>
      act(t, ownerR, async () => {
        const r = await t.query(`select public.org_usage_summary($1) as s`, [orgR]);
        if (typeof r.rows[0].s.capUsdMicros !== "number") throw new Error("no cap in the summary");
      }),
    );
    await expectDenied(
      g,
      "the usage summary is not an oracle for another org",
      () => act(t, ownerR, () => t.query(`select public.org_usage_summary($1)`, [orgStranger])),
      "ORG_ACCESS_DENIED",
    );
    await expectDenied(
      g,
      "nobody may raise their own spend cap",
      () =>
        act(t, ownerR, () =>
          t.query(
            `update public.organizations set monthly_spend_cap_usd_micros=999999999 where id=$1`,
            [orgR],
          ),
        ),
      "permission denied",
    );

    /* -- keys and constraints -- */
    await expectDenied(
      g,
      "a run cannot pin another org's agent version",
      async () => {
        let foreignAgent;
        await act(t, strangerR, async () => {
          foreignAgent = (
            await t.query(`select public.create_agent($1,$2,null) as id`, [orgStranger, "Theirs"])
          ).rows[0].id;
        });
        const foreignVersion = (
          await m.query(
            `select id from public.agent_versions where agent_id=$1 and published_at is null`,
            [foreignAgent],
          )
        ).rows[0].id;
        await m.query(
          `insert into public.runs (org_id, agent_id, agent_version_id, budget_usd_micros)
           values ($1,$2,$3,1000)`,
          [orgR, agentR, foreignVersion],
        );
      },
      "runs_version_fk",
    );
    await expectDenied(
      g,
      "a finished run must have an end time",
      () =>
        m.query(
          `insert into public.runs (org_id, agent_id, agent_version_id, budget_usd_micros, status)
           values ($1,$2,(select agent_version_id from public.runs where id=$3),1000,'succeeded')`,
          [orgR, agentR, runId],
        ),
      "runs_ended_consistent",
    );

    /* -- the cap under concurrency -- */
    {
      const raceAgent = await publishedAgent("Cap race");
      await m.query(
        `update public.usage_periods set spent_usd_micros=0, reserved_usd_micros=0 where org_id=$1`,
        [orgR],
      );
      await m.query(
        `update public.usage_reservations set status='released' where org_id=$1 and status='active'`,
        [orgR],
      );
      await setCap(3_000_000); // room for exactly one $2 run

      const c1 = asMigrator(),
        c2 = asMigrator();
      await c1.connect();
      await c2.connect();
      const claims = JSON.stringify({ sub: memberR, role: "authenticated", aal: "aal1" });
      for (const c of [c1, c2]) {
        await c.query("SELECT set_config('request.jwt.claims', $1, false)", [claims]);
        await c.query("BEGIN");
      }
      const d1 = c1.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [raceAgent]);
      await new Promise((r) => setTimeout(r, 150)); // let c1 take the organisation lock
      const d2 = c2.query(`select public.start_run($1,'{}'::jsonb,null) as out`, [raceAgent]);
      const o1 = await d1.then(() => "ok").catch((e) => e.message);
      await c1.query("COMMIT").catch(() => {});
      const o2 = await d2.then(() => "ok").catch((e) => e.message);
      await c2.query("COMMIT").catch(() => {});
      await c1.end();
      await c2.end();

      const admitted = [o1, o2].filter((x) => x === "ok").length;
      const capped = [o1, o2].filter((x) => String(x).includes("USAGE_LIMIT_REACHED")).length;
      if (admitted === 1 && capped === 1)
        ok(g, "spend cap under two concurrent dispatches: exactly one admitted");
      else
        bad(
          g,
          "spend cap under two concurrent dispatches: exactly one admitted",
          `[${o1}] / [${o2}]`,
        );
    }

    /* -- idempotency under concurrency -- */
    {
      const idemAgent = await publishedAgent("Idempotency race");
      await setCap(50_000_000);
      const key = `race-idem-${tag}`;
      const c1 = asMigrator(),
        c2 = asMigrator();
      await c1.connect();
      await c2.connect();
      const claims = JSON.stringify({ sub: memberR, role: "authenticated", aal: "aal1" });
      for (const c of [c1, c2]) {
        await c.query("SELECT set_config('request.jwt.claims', $1, false)", [claims]);
      }
      const results = await Promise.allSettled([
        c1.query(`select public.start_run($1,'{}'::jsonb,$2) as out`, [idemAgent, key]),
        c2.query(`select public.start_run($1,'{}'::jsonb,$2) as out`, [idemAgent, key]),
      ]);
      await c1.end();
      await c2.end();

      const { rows } = await m.query(
        `select count(*)::int as n from public.runs where org_id=$1 and idempotency_key=$2`,
        [orgR, key],
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (rows[0].n === 1 && failures.length === 0)
        ok(g, "two concurrent dispatches with one idempotency key create exactly one run");
      else
        bad(
          g,
          "two concurrent dispatches with one idempotency key create exactly one run",
          `runs=${rows[0].n} rejected=${failures.map((f) => String(f.reason).split("\n")[0]).join(" | ")}`,
        );
    }
  }

  /* ---- 13. suspension actually suspends (P6) --------------------- */
  g = "13-suspension";
  {
    const ownerS = await makeUser(m, `susp-owner-${tag}@example.test`);
    const orgS = await makeOrg(m, `org-susp-${tag}`, ownerS, 10);
    const adminUser = await makeUser(m, `susp-admin-${tag}@example.test`);

    // A runnable agent, so the block is tested against something that would
    // otherwise succeed.
    let agentS;
    await act(t, ownerS, async () => {
      agentS = (
        await t.query(`select public.create_agent($1,$2,null) as id`, [orgS, "Suspended co"])
      ).rows[0].id;
    });
    await m.query(
      `update public.agent_versions set config_json = $2::jsonb
       where agent_id=$1 and published_at is null`,
      [agentS, JSON.stringify({ provider: "mock", model: "m", maxSpendUsdMicros: 1000000 })],
    );
    await act(t, ownerS, () => t.query(`select public.publish_agent_version($1)`, [agentS]));

    await expectAllowed(g, "an active org can dispatch", () =>
      act(t, ownerS, () => t.query(`select public.start_run($1,'{}'::jsonb,null)`, [agentS])),
    );

    /* -- only the platform may suspend -- */
    await expectDenied(
      g,
      "an owner cannot execute set_org_suspended",
      () =>
        act(t, ownerS, () =>
          t.query(`select public.set_org_suspended($1,$2,true,'abuse')`, [ownerS, orgS]),
        ),
      "permission denied",
    );
    await expectDenied(
      g,
      "an owner cannot write organizations.status directly",
      () =>
        act(t, ownerS, () =>
          t.query(`update public.organizations set status='suspended' where id=$1`, [orgS]),
        ),
      "permission denied",
    );
    await expectDenied(
      g,
      "suspending without a reason is refused",
      async () => {
        await p.query("SET ROLE service_role");
        try {
          await p.query(`select public.set_org_suspended($1,$2,true,null)`, [adminUser, orgS]);
        } finally {
          await p.query("RESET ROLE").catch(() => {});
        }
      },
      "SUSPENSION_REQUIRES_REASON",
    );
    await expectDenied(
      g,
      "suspending with no acting administrator is refused",
      async () => {
        await p.query("SET ROLE service_role");
        try {
          await p.query(`select public.set_org_suspended(null,$1,true,'abuse')`, [orgS]);
        } finally {
          await p.query("RESET ROLE").catch(() => {});
        }
      },
      "PLATFORM_AUDIT_REQUIRES_ACTOR",
    );

    /* -- suspension blocks spending, and nothing else -- */
    await expectAllowed(g, "the platform can suspend with a reason", async () => {
      await p.query("SET ROLE service_role");
      try {
        const r = await p.query(`select public.set_org_suspended($1,$2,true,$3) as s`, [
          adminUser,
          orgS,
          "Payment dispute under review",
        ]);
        if (r.rows[0].s !== "suspended") throw new Error(`got ${r.rows[0].s}`);
      } finally {
        await p.query("RESET ROLE").catch(() => {});
      }
    });
    await expectDenied(
      g,
      "a suspended org cannot dispatch a run",
      () => act(t, ownerS, () => t.query(`select public.start_run($1,'{}'::jsonb,null)`, [agentS])),
      "ORG_SUSPENDED",
    );
    await expectRows(
      g,
      "a suspended org can still READ its own agents",
      () => act(t, ownerS, () => t.query(`select id from public.agents where org_id=$1`, [orgS])),
      1,
    );
    await expectRows(
      g,
      "a suspended org can still edit a draft, so it is not locked out of its data",
      () =>
        act(t, ownerS, () =>
          t.query(
            `update public.agent_versions set config_json='{"model":"x"}'::jsonb
             where agent_id=$1 and published_at is null`,
            [agentS],
          ),
        ),
      1,
    );
    {
      const r = await act(t, ownerS, () =>
        t.query(
          `select status, suspension_reason, suspended_at from public.organizations where id=$1`,
          [orgS],
        ),
      );
      const row = r.rows[0];
      if (
        row.status === "suspended" &&
        row.suspension_reason === "Payment dispute under review" &&
        row.suspended_at !== null
      )
        ok(g, "the customer can read why they were suspended, and when");
      else
        bad(
          g,
          "the customer can read why they were suspended, and when",
          `${row.status} / ${row.suspension_reason} / ${row.suspended_at}`,
        );
    }
    {
      const r = await m.query(
        `select actor_user_id, action, metadata_redacted ->> 'reason' as reason
         from public.audit_events where action='admin.org.suspended'
         order by created_at desc limit 1`,
      );
      const row = r.rows[0];
      if (row && row.actor_user_id === adminUser && row.reason === "Payment dispute under review")
        ok(g, "the suspension is audited with its actor and its reason");
      else bad(g, "the suspension is audited with its actor and its reason", JSON.stringify(row));
    }

    /* -- the three facts move together -- */
    await expectDenied(
      g,
      "suspended with no reason is unrepresentable, even for the schema owner",
      async () => {
        const fresh = (
          await m.query(
            `insert into public.organizations (slug,name) values ($1,$1) returning id`,
            [`org-consist-${tag}`],
          )
        ).rows[0].id;
        await m.query(`update public.organizations set status='suspended' where id=$1`, [fresh]);
      },
      "organizations_suspension_consistent",
    );

    /* -- restoring -- */
    await expectAllowed(g, "the platform can restore", async () => {
      await p.query("SET ROLE service_role");
      try {
        const r = await p.query(`select public.set_org_suspended($1,$2,false,null) as s`, [
          adminUser,
          orgS,
        ]);
        if (r.rows[0].s !== "active") throw new Error(`got ${r.rows[0].s}`);
      } finally {
        await p.query("RESET ROLE").catch(() => {});
      }
    });
    await expectAllowed(g, "a restored org can dispatch again", () =>
      act(t, ownerS, () => t.query(`select public.start_run($1,'{}'::jsonb,null)`, [agentS])),
    );
    {
      const r = await m.query(
        `select suspended_at, suspension_reason from public.organizations where id=$1`,
        [orgS],
      );
      if (r.rows[0].suspended_at === null && r.rows[0].suspension_reason === null)
        ok(g, "restoring clears the reason and the timestamp");
      else bad(g, "restoring clears the reason and the timestamp", JSON.stringify(r.rows[0]));
    }
  }

  /* ---- 14. anon executes nothing (Supabase default privileges) --- */
  g = "14-anon-execute";
  {
    // A real Supabase project grants EXECUTE on every new public function to
    // anon and authenticated DIRECTLY, through default privileges, not through
    // PUBLIC. The shim now reproduces that, so this group sees what production
    // would. Before the shim did, every "anon cannot execute" assertion in this
    // suite was passing for the wrong reason.
    const { rows } = await m.query(`
      select p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'EXECUTE')
      order by 1`);
    if (rows.length === 0) ok(g, "anon holds EXECUTE on no public function");
    else
      bad(
        g,
        "anon holds EXECUTE on no public function",
        `anon can execute: ${rows.map((r) => r.proname).join(", ")}`,
      );

    // The privilege check above is the real assertion. This one proves the
    // privilege is what stops it, rather than the function's own auth.uid()
    // check happening to reject the caller.
    await expectDenied(
      g,
      "an anonymous caller is refused by privilege, before the function body runs",
      async () => {
        await t.query("SET ROLE anon");
        try {
          await t.query(`select public.create_organization('Probe','probe-anon')`);
        } finally {
          await t.query("RESET ROLE").catch(() => {});
        }
      },
      "permission denied",
    );

    // authenticated must keep what it needs: the customer RPCs exist to be
    // called by signed-in users.
    for (const fn of ["create_organization", "create_agent", "start_run", "install_template"]) {
      const r = await m.query(
        `select bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) as ok
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = $1`,
        [fn],
      );
      if (r.rows[0]?.ok) ok(g, `authenticated keeps EXECUTE on ${fn}`);
      else bad(g, `authenticated keeps EXECUTE on ${fn}`, "privilege missing");
    }
  }

  /* ---- 15. the first-run path, end to end: YADINOS --------------- */
  g = "15-first-run";
  {
    // Every other group builds its organisations with makeOrg(), which inserts
    // as the schema owner and never calls create_organization(). So the very
    // first thing a customer does - the action that failed on the preview -
    // had never been exercised through the function they actually call.
    // This group walks that path exactly, as the signed-in user, through RPCs
    // only, the way the onboarding screen does.
    const founder = await makeUser(m, `yadinos-founder-${tag}@example.test`);
    const stranger = await makeUser(m, `yadinos-stranger-${tag}@example.test`);
    const slug = `yadinos-${tag}`;

    let orgId;
    await expectAllowed(g, "a verified user can create YADINOS", () =>
      act(t, founder, async () => {
        const r = await t.query(`select public.create_organization($1,$2) as id`, [
          "YADINOS",
          slug,
        ]);
        orgId = r.rows[0].id;
      }),
    );

    await expectRows(
      g,
      "the creator is its owner",
      () =>
        m.query(
          `select 1 from public.memberships where org_id=$1 and user_id=$2 and role='owner'`,
          [orgId, founder],
        ),
      1,
    );
    await expectRows(
      g,
      "the creator can read it back through RLS",
      () =>
        act(t, founder, () =>
          t.query(`select id from public.organizations where id=$1 and name='YADINOS'`, [orgId]),
        ),
      1,
    );
    await expectRows(
      g,
      "a stranger cannot see it",
      () =>
        act(t, stranger, () => t.query(`select id from public.organizations where id=$1`, [orgId])),
      0,
    );
    await expectRows(
      g,
      "its creation is audited",
      () =>
        m.query(
          `select 1 from public.audit_events
           where org_id=$1 and action='organization.created' and actor_user_id=$2`,
          [orgId, founder],
        ),
      1,
    );

    // The next thing the customer does: their first agent.
    let agentId;
    await expectAllowed(g, "the owner can create a first agent in it", () =>
      act(t, founder, async () => {
        const r = await t.query(`select public.create_agent($1,$2,null) as id`, [
          orgId,
          "סוכן ראשון",
        ]);
        agentId = r.rows[0].id;
      }),
    );
    await expectRows(
      g,
      "the agent has its draft, ready to edit",
      () =>
        act(t, founder, () =>
          t.query(
            `select 1 from public.agent_versions where agent_id=$1 and published_at is null`,
            [agentId],
          ),
        ),
      1,
    );

    // The refusals the onboarding screen has to translate.
    await expectDenied(
      g,
      "a taken slug answers ORG_SLUG_TAKEN, not a generic failure",
      () =>
        act(t, stranger, () =>
          t.query(`select public.create_organization($1,$2)`, ["Copycat", slug]),
        ),
      "ORG_SLUG_TAKEN",
    );
    await expectDenied(
      g,
      "an unverified email answers EMAIL_NOT_VERIFIED",
      async () => {
        const unverified = await makeUser(m, `yadinos-unverified-${tag}@example.test`, {
          verified: false,
        });
        await act(t, unverified, () =>
          t.query(`select public.create_organization($1,$2)`, ["Early", `early-${tag}`]),
        );
      },
      "EMAIL_NOT_VERIFIED",
    );
    {
      // 0018: someone who signed up BEFORE the profile trigger existed has no
      // profile row. That was everyone who registered through the preview
      // before the migrations were applied, and the team screen joined to
      // profiles, so it hid the organisation's own owner and read as zero
      // members. Replays that: insert a user with the trigger off, then run
      // 0018's statement and confirm the row appears.
      const early = "11111111-2222-4333-8444-" + tag.toString().padStart(12, "0").slice(-12);
      await m.query("alter table auth.users disable trigger on_auth_user_created");
      try {
        await m.query(
          `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
           values ($1, $2, now(), '{"display_name":"Early Founder"}'::jsonb)`,
          [early, `early-founder-${tag}@example.test`],
        );
      } finally {
        await m.query("alter table auth.users enable trigger on_auth_user_created");
      }
      const before = await m.query(`select 1 from public.profiles where user_id=$1`, [early]);
      const backfill = readFileSync(
        new URL("../../supabase/migrations/0018_backfill_profiles.sql", import.meta.url),
        "utf8",
      );
      await m.query(backfill);
      const after = await m.query(`select display_name from public.profiles where user_id=$1`, [
        early,
      ]);
      if (before.rowCount === 0 && after.rows[0]?.display_name === "Early Founder")
        ok(g, "0018 gives an early sign-up the profile the trigger would have made");
      else
        bad(
          g,
          "0018 gives an early sign-up the profile the trigger would have made",
          `before=${before.rowCount} after=${JSON.stringify(after.rows)}`,
        );

      // Running it again must change nothing.
      const count1 = (await m.query(`select count(*)::int as n from public.profiles`)).rows[0].n;
      await m.query(backfill);
      const count2 = (await m.query(`select count(*)::int as n from public.profiles`)).rows[0].n;
      if (count1 === count2) ok(g, "0018 is safe to run twice");
      else bad(g, "0018 is safe to run twice", `${count1} -> ${count2}`);
    }
    {
      // The slug is normalised to lower case, so "YADINOS" and "yadinos" are
      // the same workspace rather than two that look identical.
      const upper = `UPPER-${tag}`.toUpperCase();
      let id;
      await act(t, stranger, async () => {
        id = (await t.query(`select public.create_organization($1,$2) as id`, ["Upper", upper]))
          .rows[0].id;
      });
      const r = await m.query(`select slug from public.organizations where id=$1`, [id]);
      if (r.rows[0].slug === upper.toLowerCase()) ok(g, "the slug is stored in lower case");
      else bad(g, "the slug is stored in lower case", `got ${r.rows[0].slug}`);
    }
  }
} finally {
  await m.end().catch(() => {});
  await t.end().catch(() => {});
  await p.end().catch(() => {});
}

console.log(`\n${"=".repeat(62)}`);
console.log(`PASS ${pass}   FAIL ${fail}   SKIP ${skip}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log("=".repeat(62));
console.log("Scope: local PostgreSQL 16 with the Supabase shim. NOT verified against");
console.log("Supabase: JWT authenticity, GoTrue, real TOTP/AAL2, PostgREST, email.");
process.exit(fail > 0 ? 1 : 0);
