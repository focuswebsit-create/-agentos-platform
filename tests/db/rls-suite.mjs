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
