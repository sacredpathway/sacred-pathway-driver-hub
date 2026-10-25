#!/usr/bin/env bash
# =============================================================================
#  Automatic upload -> paystub, end to end, on a THROWAWAY Postgres cluster:
#  real server actions (upload, process, create load, settlements), real
#  routing, real claims and real sph_web_save_settlement, RLS on. Synthetic
#  documents only; the AI model and file storage are simulated.
#    PG_MODULE_DIR=/path/with/node_modules/pg  PGBIN=/usr/lib/postgresql/16/bin ./e2e.sh
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WS="$REPO/supabase/tests/web_settlements"
SPU="$REPO/supabase/tests/smart_payroll_upload"
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54339}"
: "${PG_MODULE_DIR:?set PG_MODULE_DIR to a folder containing node_modules/pg}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c max_connections=80" -l "$WORK/pg.log" -w start >/dev/null
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
P=(psql -X -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f "$WS/00_fixture.sql" >/dev/null
"${P[@]}" -f "$WS/01_prod_parity.sql" >/dev/null 2>&1
for m in "$WS/vendor/ios_20260912120000_driver_pay_and_settlements.sql" "$WS/vendor/ios_20260916120000_settlement_driver_portal.sql" \
         "$REPO"/supabase/migrations/20261001120000_paystub_payment_integrity.sql "$REPO"/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql \
         "$REPO"/supabase/migrations/20261002120000_document_automation.sql "$REPO"/supabase/migrations/2026102*_payroll_custom_categories.sql \
         "$REPO"/supabase/migrations/2026102*_web_settlement_atomic_writes.sql "$REPO"/supabase/migrations/2026102*_settlement_lock_order.sql \
         "$REPO"/supabase/migrations_proposed/PROPOSED_20261105120000_smart_payroll_upload.sql; do
  "${P[@]}" -c "set client_min_messages = warning" -f "$m" >/dev/null
done
"${P[@]}" -f "$WS/05_after_migrations.sql" >/dev/null
"${P[@]}" -f "$SPU/50_e2e_fixture.sql" >/dev/null 2>&1
"${P[@]}" -f "$HERE/60_autopay_fixture.sql" >/dev/null
# Fingerprint of the settlement write functions BEFORE (must be unchanged after).
"${P[@]}" -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sph_web_save_settlement','sph_web_transition_settlement')" > "$WORK/fn-before"
cd "$REPO/web-app"
SPU_E2E_PGHOST="$WORK" SPU_E2E_PGPORT="$PORT" SPU_E2E_PG_MODULE="$PG_MODULE_DIR/node_modules/pg/package.json" \
  ./node_modules/.bin/vitest run --reporter=verbose lib/autopay/autopay.e2e.test.ts
"${P[@]}" -At -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sph_web_save_settlement','sph_web_transition_settlement')" > "$WORK/fn-after"
cmp -s "$WORK/fn-before" "$WORK/fn-after" && echo "PASS settlement functions unchanged ($(cat "$WORK/fn-after"))" || { echo "FAIL settlement functions changed"; exit 1; }
