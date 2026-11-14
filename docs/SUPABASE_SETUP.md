# Supabase Development — manual setup for P1

Everything here needs the owner. None of it has been done, and none of it can
be done from the development environment: `api.supabase.com` is denied by the
network policy, there is no DNS or TCP route to the database port, and no
Supabase migration has been applied.

Until these steps are complete, P1 runs only against the local verification
cluster (ADR-0004) and the items in "Not verified" below stay unverified.

---

## 0. Confirm the target project — do this first

The environment holds a project reference beginning `krys…` (20 characters).
**Nothing can confirm from inside the container that this is the
`AgentOS-Development` project rather than another one.**

In the dashboard: **Project Settings → General**. Compare the Reference ID with
the first four characters above. If the project shown as
`AgentOS-Development` does not start with `krys`, **stop** — the environment is
pointed somewhere else, and applying a migration would be an irreversible
change to the wrong database.

## 1. Apply the migrations

Review `supabase/migrations/0001` – `0005` (1202 lines), then apply them **in
order** through the SQL Editor or the CLI on your own machine.

Do **not** apply `supabase/tests/01_supabase_shim.sql`. It exists only to let a
plain PostgreSQL stand in for Supabase locally, and would collide with the real
`auth` schema.

Each file is idempotent only in the sense that it fails loudly on a re-run;
apply each exactly once, and stop at the first error.

## 2. Create the secret key

**Project Settings → API Keys → Create secret key.** Store the value as the
`SUPABASE_SECRET_KEY` environment secret.

- never with a `NEXT_PUBLIC_` prefix — that inlines it into the browser bundle;
- never in the repository, a pull request, a log or a model prompt.

Without it the platform-admin guard cannot read its allowlist, and `/admin`
fails closed for everyone. That is the intended behaviour, not a bug.

## 3. Configure custom SMTP — required in practice

**Project Settings → Authentication → SMTP Settings.**

Supabase's built-in mailer is rate-limited and documented as unsuitable for
production. Without your own SMTP you cannot complete a sign-up, because email
confirmation is required, and you cannot test password reset.

**Do not disable email confirmation to work around this.** Turning
`mailer_autoconfirm` on would let anyone create an account for an address they
do not control, and would let them accept an invitation addressed to someone
else.

Note: custom SMTP covers Supabase's *own* auth emails. It does **not** send
organisation invitations — those are a separate mechanism with no provider
wired up, by design (see `src/modules/invitations/email-sender.ts`).

## 4. Password policy

**Authentication → Policies.**

- Minimum length **10** — matches `PasswordSchema` in the application, so a
  password accepted by the form is not then rejected by the server.
- Require a mix of character classes.
- **Enable leaked-password protection** (HaveIBeenPwned). This is the single
  highest-value setting on the page.

## 5. URLs

**Authentication → URL Configuration.**

- **Site URL:** the deployment origin.
- **Redirect URLs:** add `<origin>/auth/callback`. Every emailed link lands
  there; without it, confirmation and recovery links fail.

Keep the list tight. A loose wildcard here is an open-redirect primitive.

## 6. Session lifetime

**Authentication → Sessions.** `SUPER_ADMIN.md` requires short sessions for the
platform boundary. Supabase sets JWT expiry per project, not per role, so pick a
value you are willing to apply to customers too, and treat admin re-authentication
as the stricter control.

## 7. Create the first platform administrator

Only after steps 1–2.

```sql
insert into public.platform_admins (user_id, role, mfa_required, active)
values ('<the auth.users id>', 'superadmin', true, true);
```

Then sign in as that user and enrol TOTP. With `mfa_required = true` the
account cannot reach `/admin` until a second factor is verified — `/admin`
will answer 404 until then, which is correct.

Add administrators one at a time, deliberately. This table is the entire
allowlist for the platform boundary.

---

## Not verified until the above is done

| # | What | Why it cannot be checked locally |
|---|---|---|
| 1 | JWT authenticity: signature, expiry, refresh rotation | the shim injects claims directly |
| 2 | That `aal2` follows a genuinely verified second factor | GoTrue property, not a database one |
| 3 | GoTrue sign-up, sign-in, confirmation, recovery | no GoTrue locally |
| 4 | Email delivery | no SMTP |
| 5 | Real TOTP enrolment | needs a device and a live session |
| 6 | PostgREST behaviour and schema cache | no PostgREST locally |
| 7 | Two-organisation isolation end to end through the UI | needs real sessions |
| 8 | Password policy and leaked-password protection | dashboard settings |

Items 1–8 are reported as **not verified**, never as passing.
