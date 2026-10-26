#!/usr/bin/env bash
# =============================================================================
#  Local database tests for 20261001120000_paystub_payment_integrity.sql
#  and 20261001120100_cross_platform_payment_integrity.sql
# -----------------------------------------------------------------------------
#  Spins up a THROWAWAY Postgres cluster in a temp dir (never touches any
#  Supabase project), loads the production-mirroring fixture, applies the
#  migration verbatim, then runs functional + concurrency tests.
#
#    PGBIN=/usr/lib/postgresql/16/bin ./run.sh
#
#  Needs PostgreSQL >= 14 server binaries. When run as root, the cluster runs
#  as the `postgres` OS user.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATIONS=(
  "$REPO/supabase/migrations/20261001120000_paystub_payment_integrity.sql"
  "$REPO/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql"
)
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54329}"
WORK="$(mktemp -d)"
chmod 755 "$WORK"

as_pg() {
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}
cleanup() {
  as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" -w start >/dev/null
echo "SERVER_VERSION $("$PGBIN/postgres" --version)"

export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)

echo "== fixture"
"${PSQL[@]}" -f "$HERE/00_fixture.sql" >/dev/null
echo "== migrations (applied verbatim in order, twice to prove they are re-runnable)"
for pass in 1 2; do
  for m in "${MIGRATIONS[@]}"; do
    "${PSQL[@]}" -1 -c "set client_min_messages = warning" -f "$m" >/dev/null
  done
done
filter() { sed -n 's/^psql:[^ ]* NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p'; }
echo "== functional tests: web paystub integrity"
"${PSQL[@]}" -f "$HERE/10_tests.sql" 2>&1 | filter
echo "== functional tests: cross-platform (iPhone settlements)"
"${PSQL[@]}" -f "$HERE/30_cross_platform.sql" 2>&1 | filter
echo "== concurrency tests: web paystubs"
bash "$HERE/20_concurrency.sh"
echo "== concurrency tests: web vs iPhone"
bash "$HERE/40_cross_platform_concurrency.sh"
echo "== done: all database tests passed"
