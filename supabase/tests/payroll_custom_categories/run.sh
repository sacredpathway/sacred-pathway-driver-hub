#!/usr/bin/env bash
# Local database tests for 20261024011809_payroll_custom_categories.sql.
# Throwaway Postgres cluster in a temp dir — never touches any Supabase project.
#   PGBIN=/usr/lib/postgresql/16/bin ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$REPO/supabase/migrations/20261024011809_payroll_custom_categories.sql"
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54331}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
echo "SERVER_VERSION $("$PGBIN/postgres" --version)"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
echo "== fixture"
"${PSQL[@]}" -f "$HERE/00_fixture.sql" >/dev/null
echo "== migration (applied twice to prove it is re-runnable)"
for pass in 1 2; do "${PSQL[@]}" -c "set client_min_messages = warning" -f "$MIGRATION" >/dev/null; done
echo "== functional tests"
"${PSQL[@]}" -f "$HERE/10_tests.sql" 2>&1 | sed -n 's/^psql:[^ ]* NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p'
echo "== done: all payroll custom category database tests passed"
