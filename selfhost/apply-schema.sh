#!/usr/bin/env bash
# Apply the IFN app schema into the self-hosted Supabase Postgres.
# BLANK schema only (no data). Safe to re-run — "already exists" / "cannot change return type"
# warnings are harmless and filtered out below.
#
# The file order is NOT a strict topological sort: a few files forward-reference objects created
# by later files (readonly -> banned/post_votes, notifications_admin -> problem_solutions, pipeline
# -> storage.objects). On a truly fresh DB those fail on a single pass, so we run TWO passes:
# pass 1 resolves the forward refs best-effort, pass 2 is the real run that reports errors.
#
# Usage:  ./selfhost/apply-schema.sh
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$REPO/selfhost/docker-compose.yml"
DBROOT="$REPO/db"

ORDER="profiles readonly posts votes tags comments feed admin teamboard calendar directory \
onboarding notifications pipeline notifications_admin polls problemhub problem_upvotes \
problem_votes_v2 invites registration_requests member_type autopsies security_hardening login_only"

psql_db()  { docker compose -f "$COMPOSE" exec -T db psql -U postgres -d postgres "$@"; }
apply_one() { psql_db -q -v ON_ERROR_STOP=0 -f - < "$DBROOT/$1.sql" 2>&1; }

# The storage service migrates storage.objects/buckets on container startup; pipeline.sql + the
# bucket policies need them. Wait up to ~60s so a fresh `up -d` + apply doesn't race it.
for i in $(seq 1 30); do
  [ "$(psql_db -tAc "select to_regclass('storage.objects') is not null" 2>/dev/null | tr -d '[:space:]')" = t ] && break
  echo "waiting for storage schema… ($i)"; sleep 2
done

echo "— pass 1 (resolve forward refs) —"
for f in $ORDER; do [ -f "$DBROOT/$f.sql" ] && apply_one "$f" >/dev/null 2>&1; done

echo "— pass 2 —"
fail=0
for f in $ORDER; do
  [ -f "$DBROOT/$f.sql" ] || { echo "‼ MISSING db/$f.sql"; fail=1; continue; }
  out=$(apply_one "$f")
  errs=$(echo "$out" | grep -iE 'ERROR:' \
          | grep -ivE 'already exists|cannot change return type of existing function' | head -6)
  if [ -n "$errs" ]; then echo "✗ $f.sql"; echo "$errs" | sed 's/^/    /'; fail=1
  else echo "✓ $f.sql"; fi
done
exit $fail
