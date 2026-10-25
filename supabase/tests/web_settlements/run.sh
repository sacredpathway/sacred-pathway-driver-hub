#!/usr/bin/env bash
# =============================================================================
#  Local database tests for the web settlement workflow:
#    20261024011809_payroll_custom_categories.sql
#    20261024012624_web_settlement_atomic_writes.sql
#    20261024092246_settlement_lock_order.sql (lock order; fixes race C6)
#  on a production-shaped schema: base tables + the iPhone repo's settlement
#  migrations (vendored verbatim) + the web payment-integrity guards.
#
#  THROWAWAY Postgres cluster in a temp dir. Never touches any Supabase project.
#    PGBIN=/usr/lib/postgresql/17/bin ./run.sh   (production runs 17.x)
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATIONS=(
  "$HERE/vendor/ios_20260912120000_driver_pay_and_settlements.sql"
  "$HERE/vendor/ios_20260916120000_settlement_driver_portal.sql"
  "$REPO/supabase/migrations/20261001120000_paystub_payment_integrity.sql"
  "$REPO/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql"
  "$REPO/supabase/migrations/20261002120000_document_automation.sql"
  "$REPO/supabase/migrations/20261024011809_payroll_custom_categories.sql"
  "$REPO/supabase/migrations/20261024012624_web_settlement_atomic_writes.sql"
  "$REPO/supabase/migrations/20261024092246_settlement_lock_order.sql"
)
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54333}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c max_connections=60" -l "$WORK/pg.log" -w start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
filter() { sed -n 's/^psql:[^ ]* NOTICE:  //p; s/^NOTICE:  //p; /ERROR/p'; }

echo "== fixture (production-shaped base schema + history rows)"
"${PSQL[@]}" -f "$HERE/00_fixture.sql" >/dev/null
"${PSQL[@]}" -f "$HERE/01_prod_parity.sql" >/dev/null
echo "== migrations, applied verbatim in order, twice (re-runnable)"
for pass in 1 2; do
  for m in "${MIGRATIONS[@]}"; do
    "${PSQL[@]}" -c "set client_min_messages = warning" -f "$m" >/dev/null
  done
done
"${PSQL[@]}" -f "$HERE/05_after_migrations.sql" >/dev/null
echo "== functional tests"
"${PSQL[@]}" -f "$HERE/10_tests.sql" 2>&1 | filter
echo "== the web app's real save payload"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/30_web_payload.sql" 2>&1 | filter )
echo "== the iPhone 2.3.7 app's real atomic payloads"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/40_ios_payload.sql" 2>&1 | filter )
echo "== concurrency tests"
bash "$HERE/20_concurrency.sh"
"${PSQL[@]}" -f "$HERE/25_invariants.sql" 2>&1 | filter
echo "== history preservation"
"${PSQL[@]}" -f "$HERE/90_history.sql" 2>&1 | filter
echo "== draft lock for finalized settlements (REVIEW_BEFORE_APPLYING_20261024120000)"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/50_lock_finalized.sql" 2>&1 | filter )
echo "== done: all web settlement database tests passed"
