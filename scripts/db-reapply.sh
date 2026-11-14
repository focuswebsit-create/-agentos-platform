#!/usr/bin/env bash
#
# Rebuilds the schema of the LOCAL verification database from the migration
# files, then leaves it ready for tests/db/rls-suite.mjs.
#
# Why this exists: the suite does not create the schema it tests. Run against a
# database built from older migrations it reports failures that are not
# regressions — and, far worse, it can report PASS for a policy the current
# migrations no longer contain. Rebuilding first makes the suite a statement
# about the files in the repository rather than about whatever happens to be in
# the cluster.
#
# Scope guards, all fatal:
#   - PGHOST must be a unix socket path. The verification cluster has no TCP
#     listener; a hostname here would mean the connection target is something
#     else entirely, and a Supabase project is exactly the something else this
#     must never reach.
#   - PGDATABASE must be the disposable test database by name.
# Credentials come from .env.test.local, which is gitignored and local-only.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.test.local ] || {
  echo "FATAL: .env.test.local is missing." >&2
  echo "       The local verification cluster is not set up in this session;" >&2
  echo "       see docs/SUPABASE_SETUP.md. Do not point this at Supabase." >&2
  exit 1
}
set -a; . ./.env.test.local; set +a

[ "${PGHOST:0:1}" = "/" ] || { echo "FATAL: PGHOST is not a unix socket path — refusing." >&2; exit 1; }
[ "${PGDATABASE:-}" = "agentos_rls_test" ] || { echo "FATAL: PGDATABASE is '${PGDATABASE:-}', not agentos_rls_test — refusing." >&2; exit 1; }

export PGPASSWORD="$AGENTOS_MIGRATOR_PASSWORD"
PSQL=(psql -v ON_ERROR_STOP=1 -X -q -h "$PGHOST" -p "$PGPORT" -U "$AGENTOS_MIGRATOR_USER" -d "$PGDATABASE")

# One transaction: a half-dropped schema is worse than either state.
"${PSQL[@]}" -c 'begin;
  drop schema if exists public cascade;
  drop schema if exists auth cascade;
  create schema public authorization agentos_migrator;
commit;' >/dev/null
echo "reset: public + auth dropped and recreated"

for f in supabase/tests/01_supabase_shim.sql supabase/migrations/[0-9]*.sql; do
  # --single-transaction so a failing file leaves nothing behind; ON_ERROR_STOP
  # so the first error aborts instead of the rest running against a broken schema.
  "${PSQL[@]}" --single-transaction -f "$f" >/dev/null
  echo "applied: $f"
done
echo "schema rebuilt from the migration files"
