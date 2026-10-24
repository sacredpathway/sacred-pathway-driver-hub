#!/usr/bin/env bash
# =============================================================================
#  Local rehearsal for PROPOSED_20261105120000_smart_payroll_upload.sql
#  THROWAWAY Postgres cluster in a temp dir. Never touches any Supabase project.
#    PGBIN=/usr/lib/postgresql/17/bin ./run.sh   (production runs 17.x)
#
#  1. production-shaped schema + every migration through #3 (same chain as
#     tests/web_settlements/run.sh)
#  2. fingerprint the settlement functions / triggers / policies
#  3. apply the proposed migration TWICE (re-runnable)
#  4. prove migration #3's functions and every existing object are unchanged
#  5. functional tests (10_tests.sql)
#     + Phase 3 claim tests (30_claims.sql)
#  6. re-run the existing settlement suites on top (no regression)
#     + Phase 3 concurrency (40_concurrency.sh, parallel sessions)
#  7. rollback, prove it is gone, re-apply
#  End-to-end app workflow: ./e2e.sh (separate; needs PG_MODULE_DIR)
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WS="$REPO/supabase/tests/web_settlements"
MIGRATIONS=(
  "$WS/vendor/ios_20260912120000_driver_pay_and_settlements.sql"
  "$WS/vendor/ios_20260916120000_settlement_driver_portal.sql"
  "$REPO/supabase/migrations/20261001120000_paystub_payment_integrity.sql"
  "$REPO/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql"
  "$REPO/supabase/migrations/20261002120000_document_automation.sql"
  "$REPO/supabase/migrations/20261023120000_payroll_custom_categories.sql"
  "$REPO/supabase/migrations/20261023130000_web_settlement_atomic_writes.sql"
  "$REPO/supabase/migrations/20261023140000_settlement_lock_order.sql"
)
PROPOSED="$REPO/supabase/migrations_proposed/PROPOSED_20261105120000_smart_payroll_upload.sql"
ROLLBACK="$REPO/supabase/migrations_proposed/ROLLBACK_PROPOSED_20261105120000_smart_payroll_upload.sql"
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54337}"
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

FP_SQL="select md5(pg_get_functiondef('public.sph_web_save_settlement(jsonb)'::regprocedure)) || ' ' ||
  md5(pg_get_functiondef('public.sph_web_transition_settlement(jsonb)'::regprocedure)) || ' ' ||
  (select md5(string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid)), ',' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname not in ('sph_documents_payroll_guard','sph_payroll_claims_guard','sph_payroll_fail','sph_payroll_claim','sph_payroll_claim_release','sph_payroll_claim_finalize','sph_payroll_claim_recover')) || ' ' ||
  (select md5(string_agg(tgrelid::regclass::text||':'||tgname::text||':'||tgenabled::text, ',' order by 1)) from pg_trigger where not tgisinternal and tgname not in ('sph_documents_payroll_guard', 'sph_payroll_claims_guard')) || ' ' ||
  (select md5(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,''), ',' order by 1)) from pg_policies where tablename <> 'document_payroll_claims')"
DATA_SQL="select md5(string_agg(t, '|' order by t)) from (
  select 'settlements:'||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) t from public.settlements x union all
  select 'loads:'||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.loads x union all
  select 'paystubs:'||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.paystubs x union all
  select 'paystub_earnings:'||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.paystub_earnings x) s"

echo "== fixture + migrations through #3"
"${PSQL[@]}" -f "$WS/00_fixture.sql" >/dev/null
"${PSQL[@]}" -f "$WS/01_prod_parity.sql" >/dev/null
for m in "${MIGRATIONS[@]}"; do "${PSQL[@]}" -c "set client_min_messages = warning" -f "$m" >/dev/null; done
"${PSQL[@]}" -f "$WS/05_after_migrations.sql" >/dev/null
echo "== Smart Payroll Upload write path WITHOUT the proposed migration (rolled back)"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/20_write_path.sql" 2>&1 | filter )
BEFORE="$("${PSQL[@]}" -tA -c "$FP_SQL")"
DATA_BEFORE="$("${PSQL[@]}" -tA -c "$DATA_SQL")"
SAVE_MD5="$(echo "$BEFORE" | cut -d' ' -f1)"; TRANS_MD5="$(echo "$BEFORE" | cut -d' ' -f2)"
echo "   migration #3 functions: save=$SAVE_MD5 transition=$TRANS_MD5"

echo "== proposed migration, applied twice"
for pass in 1 2; do "${PSQL[@]}" -c "set client_min_messages = warning" -f "$PROPOSED" >/dev/null; done
AFTER="$("${PSQL[@]}" -tA -c "$FP_SQL")"
DATA_AFTER="$("${PSQL[@]}" -tA -c "$DATA_SQL")"
[ "$BEFORE" = "$AFTER" ] || { echo "FAIL: existing functions/triggers/policies changed"; echo "$BEFORE"; echo "$AFTER"; exit 1; }
echo "PASS preserve: migration #3 functions + all existing functions/triggers/policies byte-identical"
[ "$DATA_BEFORE" = "$DATA_AFTER" ] || { echo "FAIL: payroll data changed"; exit 1; }
echo "PASS preserve: settlements/loads/paystubs/earnings rows unchanged"

echo "== functional tests"
"${PSQL[@]}" -f "$HERE/10_tests.sql" 2>&1 | filter
echo "== Phase 3 confirmation claims (single session, rolled back)"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/30_claims.sql" 2>&1 | filter )

echo "== Smart Payroll Upload write path WITH the proposed migration (rolled back)"
( cd "$HERE" && "${PSQL[@]}" -f "$HERE/20_write_path.sql" 2>&1 | filter )
echo "== existing settlement suites on top of the proposed migration"
"${PSQL[@]}" -f "$WS/10_tests.sql" 2>&1 | filter | grep -c '^PASS' | sed 's/^/   web_settlements 10_tests PASS lines: /'
( cd "$WS" && "${PSQL[@]}" -f "$WS/30_web_payload.sql" 2>&1 | filter | grep -c '^PASS' | sed 's/^/   web payload PASS lines: /' )
( cd "$WS" && "${PSQL[@]}" -f "$WS/40_ios_payload.sql" 2>&1 | filter | grep -c '^PASS' | sed 's/^/   iPhone 2.3.7 payload PASS lines: /' )
"${PSQL[@]}" -f "$WS/25_invariants.sql" 2>&1 | filter | grep -c '^PASS' | sed 's/^/   invariants PASS lines: /'
bash "$WS/20_concurrency.sh" 2>&1 | grep -c '^PASS' | sed 's/^/   concurrency (C1-C9 races) PASS lines: /'
echo "PASS regression: existing suites ran clean (ON_ERROR_STOP) with the proposed migration applied"
echo "== Phase 3 concurrency (parallel sessions)"
bash "$HERE/40_concurrency.sh"

echo "== rollback, then re-apply"
CLAIMS_BEFORE="$("${PSQL[@]}" -tA -c "select count(*) || ':' || md5(coalesce(string_agg(to_jsonb(c)::text, ',' order by id), '')) from public.document_payroll_claims c")"
"${PSQL[@]}" -c "set client_min_messages = warning" -f "$ROLLBACK" >/dev/null
CLAIMS_ARCHIVED="$("${PSQL[@]}" -tA -c "select count(*) || ':' || md5(coalesce(string_agg((to_jsonb(a) - 'archived_at')::text, ',' order by id), '')) from public.document_payroll_claims_archive a")"
[ "$CLAIMS_BEFORE" = "$CLAIMS_ARCHIVED" ] || { echo "FAIL rollback lost claim history ($CLAIMS_BEFORE vs $CLAIMS_ARCHIVED)"; exit 1; }
[ "${CLAIMS_BEFORE%%:*}" -gt 0 ] || { echo "FAIL rollback archive test had no claims to preserve"; exit 1; }
ARCH_PRIV="$("${PSQL[@]}" -tA -c "select has_table_privilege('authenticated','public.document_payroll_claims_archive','INSERT')::int + has_table_privilege('authenticated','public.document_payroll_claims_archive','UPDATE')::int + has_table_privilege('authenticated','public.document_payroll_claims_archive','DELETE')::int + has_table_privilege('anon','public.document_payroll_claims_archive','SELECT')::int")"
[ "$ARCH_PRIV" = "0" ] || { echo "FAIL archive is writable ($ARCH_PRIV)"; exit 1; }
echo "PASS rollback keeps claim history: ${CLAIMS_BEFORE%%:*} claims archived byte-for-byte in document_payroll_claims_archive (read-only)"
GONE="$("${PSQL[@]}" -tA -c "select count(*) from information_schema.columns where table_schema='public' and table_name='documents' and column_name in ('extraction_profile','document_identity','payroll_status','corrections')")"
[ "$GONE" = "0" ] || { echo "FAIL rollback left columns"; exit 1; }
GONE2="$("${PSQL[@]}" -tA -c "select (to_regclass('public.document_payroll_claims') is null)::int + (select count(*) from pg_proc where proname in ('sph_documents_payroll_guard','sph_payroll_claims_guard','sph_payroll_fail','sph_payroll_claim','sph_payroll_claim_release','sph_payroll_claim_finalize','sph_payroll_claim_recover'))")"
[ "$GONE2" = "1" ] || { echo "FAIL rollback left claim objects ($GONE2)"; exit 1; }
AFTER_RB="$("${PSQL[@]}" -tA -c "$FP_SQL")"
[ "$(echo "$AFTER_RB" | cut -d' ' -f1-2)" = "$SAVE_MD5 $TRANS_MD5" ] || { echo "FAIL rollback touched migration #3"; exit 1; }
echo "PASS rollback: new objects removed, migration #3 functions untouched"
"${PSQL[@]}" -c "set client_min_messages = warning" -f "$PROPOSED" >/dev/null
REAPPLY="$("${PSQL[@]}" -tA -c "select (select count(*) from public.document_payroll_claims) || ':' || (select count(*) from public.document_payroll_claims_archive)")"
[ "$REAPPLY" = "0:${CLAIMS_BEFORE%%:*}" ] || { echo "FAIL re-apply state $REAPPLY"; exit 1; }
"${PSQL[@]}" -c "set client_min_messages = warning" -f "$ROLLBACK" >/dev/null
[ "$("${PSQL[@]}" -tA -c "select count(*) from public.document_payroll_claims_archive")" = "${CLAIMS_BEFORE%%:*}" ] || { echo "FAIL second rollback changed the archive"; exit 1; }
"${PSQL[@]}" -c "set client_min_messages = warning" -f "$PROPOSED" >/dev/null
echo "PASS re-apply after rollback (fresh empty claims table, archive intact; a second rollback/re-apply cycle keeps the archive unchanged)"
echo "== done: smart payroll upload migration rehearsal passed"
