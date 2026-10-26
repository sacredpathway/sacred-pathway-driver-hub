#!/usr/bin/env bash
# =============================================================================
#  End-to-end Smart Payroll Upload workflow on a THROWAWAY Postgres cluster:
#  real server actions + real settlement functions + Phase 3 claims, RLS on.
#    PG_MODULE_DIR=/path/with/node_modules/pg  PGBIN=/usr/lib/postgresql/16/bin ./e2e.sh
#  `pg` is NOT added to web-app/package.json; point PG_MODULE_DIR at any folder
#  where `npm install pg` was run (test-only dependency).
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WS="$REPO/supabase/tests/web_settlements"
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54338}"
: "${PG_MODULE_DIR:?set PG_MODULE_DIR to a folder containing node_modules/pg}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c max_connections=60" -l "$WORK/pg.log" -w start >/dev/null
echo "SERVER_VERSION $("$PGBIN/postgres" --version)"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
P=(psql -X -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f "$WS/00_fixture.sql" >/dev/null
"${P[@]}" -f "$WS/01_prod_parity.sql" >/dev/null 2>&1
for m in "$WS/vendor/ios_20260912120000_driver_pay_and_settlements.sql" "$WS/vendor/ios_20260916120000_settlement_driver_portal.sql" \
         "$REPO"/supabase/migrations/20261001120000_paystub_payment_integrity.sql "$REPO"/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql \
         "$REPO"/supabase/migrations/20261002120000_document_automation.sql "$REPO"/supabase/migrations/20261024011809_payroll_custom_categories.sql \
         "$REPO"/supabase/migrations/20261024012624_web_settlement_atomic_writes.sql "$REPO"/supabase/migrations/20261024092246_settlement_lock_order.sql \
         "$REPO"/supabase/migrations/20261025225011_smart_payroll_upload.sql; do
  "${P[@]}" -c "set client_min_messages = warning" -f "$m" >/dev/null
done
"${P[@]}" -f "$WS/05_after_migrations.sql" >/dev/null
"${P[@]}" -f "$HERE/50_e2e_fixture.sql" >/dev/null
cd "$REPO/web-app"
SPU_E2E_PGHOST="$WORK" SPU_E2E_PGPORT="$PORT" SPU_E2E_PG_MODULE="$PG_MODULE_DIR/node_modules/pg/package.json" \
  ./node_modules/.bin/vitest run --reporter=verbose lib/payrollUpload/workflow.e2e.test.ts
