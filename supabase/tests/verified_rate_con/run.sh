#!/usr/bin/env bash
# =============================================================================
#  Migration #6 (verified rate-confirmation safeguard) on a THROWAWAY Postgres
#  cluster: production migration chain #1-#5, then #6, then every bypass /
#  verification / isolation / concurrency / rollback scenario, run as real
#  `authenticated` sessions under RLS.
#    PGBIN=/usr/lib/postgresql/16/bin ./run.sh
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
WS="$REPO/supabase/tests/web_settlements"
SPU="$REPO/supabase/tests/smart_payroll_upload"
M6="$REPO/supabase/migrations/20261026045202_verified_rate_con_safeguard.sql"
M6R="$REPO/supabase/migrations_proposed/ROLLBACK_PROPOSED_20261107120000_verified_rate_con_safeguard.sql"
PGBIN="${PGBIN:-$(dirname "$(command -v postgres 2>/dev/null || echo /usr/lib/postgresql/16/bin/postgres)")}"
PORT="${PGPORT_TEST:-54341}"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
cleanup() { as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
[ "$(id -u)" = "0" ] && chown postgres "$WORK"
as_pg "$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
as_pg "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c max_connections=80" -l "$WORK/pg.log" -w start >/dev/null
echo "SERVER_VERSION $("$PGBIN/postgres" --version)"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
P=(psql -X -v ON_ERROR_STOP=1 -q)
"${P[@]}" -f "$WS/00_fixture.sql" >/dev/null
"${P[@]}" -f "$WS/01_prod_parity.sql" >/dev/null 2>&1
for m in "$WS/vendor/ios_20260912120000_driver_pay_and_settlements.sql" "$WS/vendor/ios_20260916120000_settlement_driver_portal.sql" \
         "$REPO"/supabase/migrations/20261001120000_paystub_payment_integrity.sql "$REPO"/supabase/migrations/20261001120100_cross_platform_payment_integrity.sql \
         "$REPO"/supabase/migrations/20261002120000_document_automation.sql "$REPO"/supabase/migrations/2026102*_payroll_custom_categories.sql \
         "$REPO"/supabase/migrations/2026102*_web_settlement_atomic_writes.sql "$REPO"/supabase/migrations/2026102*_settlement_lock_order.sql \
         "$REPO"/supabase/migrations/20261025225011_smart_payroll_upload.sql "$REPO"/supabase/migrations/20261026003052_auto_create_load.sql; do
  "${P[@]}" -c "set client_min_messages = warning" -f "$m" >/dev/null
done
"${P[@]}" -f "$WS/05_after_migrations.sql" >/dev/null
"${P[@]}" -f "$SPU/50_e2e_fixture.sql" >/dev/null 2>&1
"${P[@]}" -c "set client_min_messages = warning" -f "$M6" >/dev/null
"${P[@]}" -c "set client_min_messages = warning" -f "$M6" >/dev/null   # idempotent re-apply
"${P[@]}" -f "$HERE/00_fixture.sql" >/dev/null

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "PASS $1"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL $1 :: $2"; }
q()    { "${P[@]}" -At -c "$1"; }
A=aaaaaaaa-0000-4000-8000-00000000000a; B=bbbbbbbb-0000-4000-8000-00000000000b
DRV=aaaaaaaa-0000-4000-8000-0000000000d1; OLD=aaaaaaaa-0000-4000-8000-0000000000d2; BDRV=bbbbbbbb-0000-4000-8000-0000000000d1
doc() { echo "aaaaaaaa-0000-4000-8000-00000000d$1"; }
# Run SQL as a signed-in user (RLS on). Prints the result, or "ERR <sqlstate> <hint>".
as_user() { # uid sql
  "${P[@]}" -At -v ON_ERROR_STOP=1 -c "begin; set local role authenticated;
    set local "request.jwt.claim.sub" = '$1'; set local "request.jwt.claims" = '{\"sub\":\"$1\",\"role\":\"authenticated\"}';
    $2; commit;" 2>&1 | sed -E 's/^.*ERROR:  ([^\n]*)$/ERR \1/' | tr '\n' ' ' || true
}
call() { # uid json
  "${P[@]}" -At 2>&1 <<SQL | tr '\n' ' ' || true
\set VERBOSITY verbose
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = '$1'; set local "request.jwt.claims" = '{"sub":"$1","role":"authenticated"}';
select public.sph_load_create_verified('$2'::jsonb);
commit;
SQL
  true
}
loads_now() { q "select count(*) from public.loads"; }
side_tables() { q "select (select count(*) from public.settlements)||'/'||(select count(*) from public.document_payroll_claims)||'/'||(select count(*) from public.paystubs)"; }
L0=$(loads_now); S0=$(side_tables)

# --- attestation facts ---------------------------------------------------------
[ "$(q "select count(*) from public.document_extraction_attestations")" = "14" ] && ok "server (no-JWT admin) v3 writes attested: 14 (v2 doc not attested)" || bad "attestation count" "$(q "select count(*) from public.document_extraction_attestations")"
[ "$(q "select count(*) from public.document_extraction_attestations where document_id = '$(doc 011)'")" = "0" ] && ok "v2 extraction is never attested" || bad "v2 attested" ""
# service_role JWT path (the Edge Function) attests
q "begin; set local role service_role; set local "request.jwt.claims" = '{\"role\":\"service_role\"}';
   update public.documents set extraction_version='v3', extracted_data = extracted_data where id = '$(doc 011)'; commit;" >/dev/null
[ "$(q "select attested_role from public.document_extraction_attestations where document_id = '$(doc 011)'")" = "service_role" ] && ok "service_role JWT write (Edge Function) is attested" || bad "service_role attest" ""
# ...and a server re-extraction to v2 withdraws it
q "update public.documents set extraction_version='v2' where id = '$(doc 011)'" >/dev/null
[ "$(q "select count(*) from public.document_extraction_attestations where document_id = '$(doc 011)'")" = "0" ] && ok "server re-extraction to v2 withdraws the attestation" || bad "withdraw" ""

# --- forged documents by the user ----------------------------------------------
out=$(as_user $A "insert into public.documents (id, profile_id, storage_path, status, document_type, extraction_version, extracted_data)
   select 'aaaaaaaa-0000-4000-8000-00000000d002', '$A', 'a/2.pdf', 'processed', 'rate_confirmation', 'v3', extracted_data from public.documents where id = '$(doc 001)'")
[ "$(q "select count(*) from public.document_extraction_attestations where document_id = '$(doc 002)'")" = "0" ] && ok "user-inserted v3 document (copied verified data) is NOT attested" || bad "user insert attested" "$out"
as_user $A "update public.documents set extracted_data = jsonb_set(extracted_data, '{values,total_revenue}', '9999') where id = '$(doc 003)'" >/dev/null
[ "$(q "select (snapshot->'values'->>'total_revenue') from public.document_extraction_attestations where document_id = '$(doc 003)'")" = "1800" ] && ok "user edit of extracted_data does not refresh the attestation" || bad "user edit refreshed" ""
# a user inside a SECURITY DEFINER context is still untrusted (JWT role = authenticated)
q "create or replace function public.tmp_definer_touch(d uuid) returns void language sql security definer set search_path=public as \$\$ update public.documents set extracted_data = extracted_data || '{\"x\":1}' where id = d \$\$; grant execute on function public.tmp_definer_touch(uuid) to authenticated;" >/dev/null
as_user $A "select public.tmp_definer_touch('$(doc 007)')" >/dev/null
[ "$(q "select (snapshot ? 'x')::text from public.document_extraction_attestations where document_id = '$(doc 007)'")" = "false" ] && ok "user via SECURITY DEFINER function is still untrusted (no re-attest)" || bad "definer trusted" ""
q "drop function public.tmp_definer_touch(uuid)" >/dev/null
# attestation table: users can't write, can only read their own
out=$(as_user $A "insert into public.document_extraction_attestations values ('$(doc 002)', '$A', 'v3', '{}', now(), 'x')"); echo "$out" | grep -q "permission denied" && ok "user cannot INSERT attestations" || bad "insert attest" "$out"
out=$(as_user $A "update public.document_extraction_attestations set snapshot = '{}' where document_id = '$(doc 004)'"); echo "$out" | grep -q "permission denied" && ok "user cannot UPDATE attestations" || bad "update attest" "$out"
out=$(as_user $A "delete from public.document_extraction_attestations where document_id = '$(doc 004)'"); echo "$out" | grep -q "permission denied" && ok "user cannot DELETE attestations" || bad "delete attest" "$out"
[ "$(as_user $A "select count(*) from public.document_extraction_attestations" | xargs)" = "13" ] && ok "carrier A sees only its own 13 attestations (B's hidden)" || bad "attest isolation" "$(as_user $A "select count(*) from public.document_extraction_attestations")"

# --- the function: rejections (no load may appear) -----------------------------
expect_err() { # label hint-regex uid json
  local out; out=$(call "$3" "$4"); if echo "$out" | grep -Eq "$2"; then ok "$1"; else bad "$1" "$out"; fi
}
expect_err "no document_id -> refused (document_required)"           "sph:document_required"  $A '{"load_number":"EVIL-1","total_revenue":5000,"broker_name":"x","origin":"a","destination":"b","pickup_date":"2026-10-01","delivery_date":"2026-10-02"}'
expect_err "forged (random) document id -> refused"                 "sph:document_not_found" $A '{"document_id":"12345678-1234-4123-8123-123456789abc","driver_id":"'$DRV'"}'
expect_err "malformed document id -> refused"                        "sph:bad_request"        $A '{"document_id":"not-a-uuid"}'
expect_err "A uses B's document -> refused (not found under A)"      "sph:document_not_found" $A '{"document_id":"bbbbbbbb-0000-4000-8000-00000000d001","driver_id":"'$DRV'"}'
expect_err "B uses A's document -> refused"                          "sph:document_not_found" $B '{"document_id":"'$(doc 001)'","driver_id":"'$BDRV'"}'
expect_err "user-forged v3 document (not server-read) -> refused"    "sph:not_attested"       $A '{"document_id":"'$(doc 002)'","driver_id":"'$DRV'"}'
expect_err "edited after extraction -> refused"                      "sph:edited_after_extraction" $A '{"document_id":"'$(doc 003)'","driver_id":"'$DRV'"}'
expect_err "medium confidence -> refused"                            "not_high_confidence"    $A '{"document_id":"'$(doc 004)'","driver_id":"'$DRV'"}'
expect_err "incomplete (missing total) -> refused"                   "missing_fields.*no_revenue|no_revenue.*missing_fields|missing_fields|no_revenue" $A '{"document_id":"'$(doc 005)'","driver_id":"'$DRV'"}'
expect_err "rejected document -> refused"                            "rejected"               $A '{"document_id":"'$(doc 006)'","driver_id":"'$DRV'"}'
as_user $A "update public.documents set corrections = '[{\"field\":\"total_revenue\",\"extracted\":1800,\"saved\":1900}]' where id = '$(doc 007)'" >/dev/null
q "update public.documents set extracted_data = extracted_data - 'x' where id = '$(doc 007)'" >/dev/null  # restore server copy (admin)
expect_err "human-corrected document -> refused"                     "human_corrected"        $A '{"document_id":"'$(doc 007)'","driver_id":"'$DRV'"}'
expect_err "carrier printed is not this account -> refused"          "carrier_not_ours"       $A '{"document_id":"'$(doc 008)'","driver_id":"'$DRV'"}'
expect_err "printed driver != chosen driver -> refused"              "driver_not_verified"    $A '{"document_id":"'$(doc 009)'","driver_id":"'$DRV'"}'
expect_err "duplicate upload -> refused"                             "duplicate_upload"       $A '{"document_id":"'$(doc 010)'","driver_id":"'$DRV'"}'
expect_err "v2 (not payroll-verified) -> refused"                    "sph:not_attested"       $A '{"document_id":"'$(doc 011)'","driver_id":"'$DRV'"}'
expect_err "evidence mismatch -> refused"                            "evidence_mismatch"      $A '{"document_id":"'$(doc 014)'","driver_id":"'$DRV'"}'
expect_err "upload type-hint disagreement -> refused"                "type_hint_mismatch"     $A '{"document_id":"'$(doc 015)'","driver_id":"'$DRV'"}'
expect_err "verified doc + another carrier's driver -> refused"      "sph:cross_account"      $A '{"document_id":"'$(doc 001)'","driver_id":"'$BDRV'"}'
expect_err "verified doc + inactive driver -> refused"               "driver_not_verified"    $A '{"document_id":"'$(doc 001)'","driver_id":"'$OLD'"}'
expect_err "verified doc + no driver -> refused"                     "driver_not_verified"    $A '{"document_id":"'$(doc 001)'"}'
out=$("${P[@]}" -At -c "begin; set local role anon; select public.sph_load_create_verified('{\"document_id\":\"$(doc 001)\"}'::jsonb); commit;" 2>&1 || true)
echo "$out" | grep -q "permission denied" && ok "anon cannot call the function" || bad "anon" "$out"
[ "$(loads_now)" = "$L0" ] && ok "no load created by any refused call ($L0 loads)" || bad "loads after refusals" "$(loads_now) vs $L0"

# --- verified creation: values come from the attestation, not the request --------
out=$(call $A '{"document_id":"'$(doc 001)'","driver_id":"'$DRV'","load_number":"EVIL-9","total_revenue":999999,"broker_name":"Mallory"}')
echo "$out" | grep -q '"created": true' && ok "fully verified rate con -> load created" || bad "verified create" "$out"
row=$(q "select load_number||'|'||total_revenue||'|'||broker_name||'|'||driver_id||'|'||profile_id from public.loads where load_number in ('LN-1001','EVIL-9')")
[ "$row" = "LN-1001|2500.00|Echo Brokerage|$DRV|$A" ] && ok "load built from attested values (forged body ignored): $row" || bad "attested values" "$row"
out=$(call $A '{"document_id":"'$(doc 001)'","driver_id":"'$DRV'"}')
echo "$out" | grep -q '"created": false' && [ "$(q "select count(*) from public.loads where load_number='LN-1001'")" = "1" ] && ok "same document again -> existing load, no duplicate" || bad "dedupe" "$out"

# --- manual creation is unchanged -------------------------------------------------
out=$(as_user $A "insert into public.loads (profile_id, load_number, total_revenue, broker_name) values ('$A','MAN-0001',700,'Walk-in') returning load_number")
echo "$out" | grep -q "MAN-0001" && ok "manual load insert (no document) still works" || bad "manual insert" "$out"
out=$(as_user $A "insert into public.loads (profile_id, load_number, total_revenue) values ('$B','MAN-X',1) returning id")
echo "$out" | grep -q "row-level security" && ok "manual insert for another carrier refused by RLS" || bad "manual cross-carrier" "$out"
out=$(call $A '{"document_id":"'$(doc 013)'","driver_id":"'$DRV'"}')
mid=$(q "select id from public.loads where load_number='MAN-0001'")
echo "$out" | grep -q "\"id\": \"$mid\", \"created\": false" && ok "verified rate con for a manually-entered number -> joins that load (no duplicate)" || bad "join manual" "$out"

# --- rollback behaviour -------------------------------------------------------------
before=$(loads_now)
"${P[@]}" -At -c "begin; set local role authenticated; set local "request.jwt.claim.sub" = '$B';
  select public.sph_load_create_verified('{\"document_id\":\"bbbbbbbb-0000-4000-8000-00000000d001\",\"driver_id\":\"$BDRV\"}'::jsonb); rollback;" >/dev/null
[ "$(loads_now)" = "$before" ] && ok "created inside a transaction that rolls back -> no load persists" || bad "rollback" ""
"${P[@]}" -At -c "begin; set local role authenticated; set local "request.jwt.claim.sub" = '$B';
  select public.sph_load_create_verified('{\"document_id\":\"bbbbbbbb-0000-4000-8000-00000000d001\",\"driver_id\":\"$BDRV\"}'::jsonb);
  select 1/0; commit;" >/dev/null 2>&1 || true
[ "$(loads_now)" = "$before" ] && ok "error later in the same transaction -> creation rolled back" || bad "rollback on error" ""
out=$(call $B '{"document_id":"bbbbbbbb-0000-4000-8000-00000000d001","driver_id":"'$BDRV'"}')
echo "$out" | grep -q '"created": true' && ok "carrier B's own verified rate con -> B's load (isolation both ways)" || bad "B create" "$out"

# --- concurrency: 8 sessions, same verified document -> exactly one load ------------
for i in $(seq 1 8); do
  call $A '{"document_id":"'$(doc 012)'","driver_id":"'$DRV'"}' > "$WORK/race-$i" 2>&1 &
done; wait
n=$(q "select count(*) from public.loads where load_number='LN-RACE'"); c=$(cat "$WORK"/race-* | grep -o '"created": true' | wc -l)
[ "$n" = "1" ] && [ "$c" = "1" ] && ok "8 concurrent creates -> 1 load (1 created, 7 joined)" || bad "race" "loads=$n created=$c $(cat "$WORK"/race-*)"

# --- nothing else was produced -------------------------------------------------------
[ "$(side_tables)" = "$S0" ] && ok "settlements/claims/paystubs unchanged ($S0)" || bad "side tables" "$(side_tables) vs $S0"

# --- rollback migration + re-apply ---------------------------------------------------
"${P[@]}" -c "set client_min_messages = warning" -f "$M6R" >/dev/null
r1=$(q "select count(*) from pg_class where relname='document_extraction_attestations'")$(q "select count(*) from pg_trigger where tgname='sph_documents_attest_extraction'")
b1=$(q "select md5(prosrc) from pg_proc where proname='sph_load_create_verified'")
"${P[@]}" -c "set client_min_messages = warning" -f "$REPO/supabase/migrations/20261026003052_auto_create_load.sql" >/dev/null
b5=$(q "select md5(prosrc) from pg_proc where proname='sph_load_create_verified'")
[ "$r1" = "00" ] && [ "$b1" = "$b5" ] && ok "rollback removes table+trigger and restores #5's function exactly ($b5)" || bad "rollback" "$r1 $b1 $b5"
"${P[@]}" -c "set client_min_messages = warning" -f "$M6" >/dev/null && "${P[@]}" -c "set client_min_messages = warning" -f "$M6" >/dev/null && ok "#6 re-applies cleanly (twice)" || bad "reapply" ""

echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
