#!/usr/bin/env bash
# =============================================================================
#  Smart Payroll Upload — Phase 3 concurrency (parallel psql sessions).
#  Runs against the throwaway cluster started by run.sh (PGHOST/PGPORT set),
#  AFTER the proposed migration. Each "tab" is its own connection doing what
#  the web server action does, each step in its own transaction:
#     claim -> sph_web_save_settlement (the app's real create JSON) -> finalize
#  The JSON is generated/spu_create_payload.json with fresh ids per tab.
# =============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAY="$(cat "$HERE/generated/spu_create_payload.json")"
A=aaaaaaaa-0000-0000-0000-000000000001
D1=aaaaaaaa-0000-0000-0000-00000000d001
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
Q=(psql -X -q -tA -v ON_ERROR_STOP=1)
uuid() { cat /proc/sys/kernel/random/uuid; }
fail() { echo "FAIL $*"; exit 1; }

# fixture: load + document per scenario (committed; throwaway cluster)
mk() { # $1 suffix (4 hex) -> load aaaa…a4<sfx>, docs dddd…4<sfx>01..08
  "${Q[@]}" -c "insert into public.loads (id, profile_id, driver_id, load_number, pickup_date, delivery_date, total_revenue, line_haul_rate, status)
    values ('aaaaaaaa-0000-0000-0000-0000000a$1', '$A', '$D1', 'SYN-K$1', '2026-10-13', '2026-10-14', 1850, 1850, 'ready_for_settlement')"
  for i in 1 2 3 4 5 6 7 8; do
    "${Q[@]}" -c "insert into public.documents (id, profile_id, document_type, storage_path, status, extraction_version, review_status)
      values ('dddddddd-0000-4000-8000-0000$1000$i', '$A', 'rate_confirmation', 'a/k$1$i.pdf', 'processed', 'v3', 'needs_review')"
  done
}
load_of() { echo "aaaaaaaa-0000-0000-0000-0000000a$1"; }
doc_of() { echo "dddddddd-0000-4000-8000-0000$1000$2"; }
payload_for() { # $1 load id -> payload with fresh settlement/line ids and number
  local sid line; sid="$(uuid)"; line="$(uuid)"
  echo "$PAY" | sed "s/5e000000-0000-4000-8000-000000049155/$sid/g; s/5e000000-0000-4000-8000-000000049156/$line/g; s/aaaaaaaa-0000-0000-0000-0000000a3001/$1/g; s/SP-2026-0001/SPK-${sid:0:8}/"
}

# One browser tab confirming. $1 doc $2 load $3 mode(claim|noclaim|failsave|crash) $4 sleep-after-claim
tab() {
  local pl; pl="$(payload_for "$2")"
  [ "$3" = "failsave" ] && pl="$(echo "$pl" | sed "s/$D1/bbbbbbbb-0000-0000-0000-00000000d001/g")"
  if [ "$3" = "noclaim" ]; then
    "${Q[@]}" -v pl="$pl" <<SQL
set role authenticated; set request.jwt.claim.sub = '$A';
select public.sph_web_save_settlement(:'pl'::jsonb) is not null;
SQL
    return
  fi
  "${Q[@]}" -v pl="$pl" <<SQL
set role authenticated; set request.jwt.claim.sub = '$A';
select x.c->>'claim_id' as cid, x.c->>'claim_token' as tok
  from (select public.sph_payroll_claim(jsonb_build_object('document_id', '$1', 'load_id', '$2', 'plan', 'create')) as c) x \gset
select 'CLAIMED';
select pg_sleep($4);
\set ON_ERROR_STOP off
select public.sph_web_save_settlement(:'pl'::jsonb) is not null as saved \gset
\if :{?saved}
\else
  select 'SAVE_FAILED ' || public.sph_payroll_claim_release(jsonb_build_object('claim_id', :'cid', 'claim_token', :'tok', 'reason', 'save_refused'));
  \quit
\endif
\set ON_ERROR_STOP on
\if $( [ "$3" = "crash" ] && echo true || echo false )
  select 'CRASHED_AFTER_SAVE';
  \quit
\endif
select 'FINALIZED ' || (public.sph_payroll_claim_finalize(jsonb_build_object('claim_id', :'cid', 'claim_token', :'tok', 'settlement_id', (:'pl'::jsonb)->>'settlement_id'))->>'settlement_load_id');
SQL
}

drafts_with() { "${Q[@]}" -c "select count(distinct sl.settlement_id) from public.settlement_loads sl where sl.load_id = '$1'"; }
classify() { # summarise a set of tab logs
  local ok=0 conflict=0 other=0 f
  for f in "$@"; do
    if grep -q '^FINALIZED ' "$f"; then ok=$((ok+1))
    elif grep -qE 'being confirmed in another tab|already on a settlement|already linked' "$f"; then conflict=$((conflict+1))
    else other=$((other+1)); fi
  done
  echo "$ok $conflict $other"
}

echo "== K0 baseline: 6 simultaneous creates for one load WITHOUT the claim"
mk 4000; L="$(load_of 4000)"
for i in 1 2 3 4 5 6; do tab "$(doc_of 4000 1)" "$L" noclaim 0 >"$OUT/k0.$i" 2>&1 & done; wait
n="$(drafts_with "$L")"
[ "$n" -ge 2 ] || fail "K0: expected the unprotected race to produce >1 draft, got $n"
echo "PASS K0 race is real: without the claim, 6 tabs produced $n drafts for the same load (the database allows a load on several drafts)"

for round in 1 2 3; do
  sfx="41${round}0"; mk "$sfx"; L="$(load_of "$sfx")"; D="$(doc_of "$sfx" 1)"
  for i in 1 2 3 4 5 6 7 8; do tab "$D" "$L" claim 0.3 >"$OUT/k1.$round.$i" 2>&1 & done; wait
  read -r ok conflict other <<<"$(classify "$OUT"/k1."$round".*)"
  [ "$ok" = 1 ] && [ "$conflict" = 7 ] && [ "$other" = 0 ] || { cat "$OUT"/k1."$round".*; fail "K1 round $round: ok=$ok conflict=$conflict other=$other"; }
  [ "$(drafts_with "$L")" = 1 ] || fail "K1 round $round: drafts=$(drafts_with "$L")"
  [ "$("${Q[@]}" -c "select count(*) from public.document_payroll_claims where document_id = '$D' and status = 'confirmed'")" = 1 ] || fail "K1 claims"
  [ "$("${Q[@]}" -c "select (d.settlement_id = c.settlement_id)::int from public.documents d join public.document_payroll_claims c on c.document_id = d.id and c.status = 'confirmed' where d.id = '$D'")" = 1 ] || fail "K1 link"
done
echo "PASS K1 two tabs (x8, 3 rounds): same document, same load, simultaneous -> exactly 1 draft, 7 refused before any write, document linked once"

mk 4200; L="$(load_of 4200)"
for i in 1 2 3 4 5 6 7 8; do tab "$(doc_of 4200 "$i")" "$L" claim 0.3 >"$OUT/k2.$i" 2>&1 & done; wait
read -r ok conflict other <<<"$(classify "$OUT"/k2.*)"
[ "$ok" = 1 ] && [ "$conflict" = 7 ] && [ "$other" = 0 ] || { cat "$OUT"/k2.*; fail "K2: ok=$ok conflict=$conflict other=$other"; }
[ "$(drafts_with "$L")" = 1 ] || fail "K2 drafts"
echo "PASS K2 8 different documents for one load, simultaneous -> exactly 1 draft; 7 refused"

mk 4300; mk 4301; mk 4302; mk 4303
D="$(doc_of 4300 1)"
for s in 4300 4301 4302 4303; do tab "$D" "$(load_of $s)" claim 0.3 >"$OUT/k3.$s" 2>&1 & done; wait
read -r ok conflict other <<<"$(classify "$OUT"/k3.*)"
[ "$ok" = 1 ] && [ "$conflict" = 3 ] && [ "$other" = 0 ] || { cat "$OUT"/k3.*; fail "K3: ok=$ok conflict=$conflict other=$other"; }
total=0; for s in 4300 4301 4302 4303; do total=$((total + $(drafts_with "$(load_of $s)"))); done
[ "$total" = 1 ] || fail "K3 drafts $total"
echo "PASS K3 one document, 4 tabs choosing different loads, simultaneous -> exactly 1 draft"

mk 4400; L="$(load_of 4400)"; D="$(doc_of 4400 1)"
tab "$D" "$L" failsave 1.0 >"$OUT/k4.fail" 2>&1 &
sleep 0.3
for i in 1 2 3; do tab "$D" "$L" claim 0 >"$OUT/k4.$i" 2>&1 & done; wait
grep -q 'SAVE_FAILED t' "$OUT/k4.fail" || { cat "$OUT/k4.fail"; fail "K4: failing tab did not release"; }
read -r ok conflict other <<<"$(classify "$OUT"/k4.[123])"
[ "$ok" = 0 ] && [ "$conflict" = 3 ] || fail "K4 during: ok=$ok conflict=$conflict"
tab "$D" "$L" claim 0 >"$OUT/k4.retry" 2>&1
grep -q '^FINALIZED ' "$OUT/k4.retry" || { cat "$OUT/k4.retry"; fail "K4 retry"; }
[ "$(drafts_with "$L")" = 1 ] || fail "K4 drafts"
echo "PASS K4 the claim winner's save is refused -> claim released at once -> the immediate retry succeeds (1 draft, no stuck claim)"

mk 4500; L="$(load_of 4500)"; D="$(doc_of 4500 1)"
tab "$D" "$L" crash 0 >"$OUT/k5.crash" 2>&1
grep -q CRASHED_AFTER_SAVE "$OUT/k5.crash" || fail "K5 crash setup"
"${Q[@]}" -c "set session_replication_role = replica; update public.document_payroll_claims set created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes' where document_id = '$D'" >/dev/null
for i in 1 2 3 4; do
  "${Q[@]}" >"$OUT/k5.$i" 2>&1 <<SQL &
set role authenticated; set request.jwt.claim.sub = '$A';
select public.sph_payroll_claim_recover('{"document_id":"$D"}')->>'state';
SQL
done; wait
rec="$(cat "$OUT"/k5.[1234] | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
[ "$(cat "$OUT"/k5.[1234] | grep -c '^recovered$')" = 1 ] && [ "$(cat "$OUT"/k5.[1234] | grep -c '^linked$')" = 3 ] || fail "K5 recover: $rec"
[ "$(drafts_with "$L")" = 1 ] || fail "K5 drafts"
[ "$("${Q[@]}" -c "select (settlement_id is not null)::int from public.documents where id = '$D'")" = 1 ] || fail "K5 link"
echo "PASS K5 request died after saving (before linking); 4 simultaneous retries -> 1 recovers the link, 3 see it linked, still 1 draft"

# K6 lock graph: an iPhone-style save (settlement + load FOR UPDATE, line that
# references the document) holds its locks while Smart Payroll claims and
# finalizes. The claim must not wait for it; finalize waits for the settlement
# lock and both finish (no deadlock, SQLSTATE 40P01 never raised).
mk 4600; mk 4601; D="$(doc_of 4600 1)"; S="$(uuid)"
"${Q[@]}" -c "insert into public.settlements (id, profile_id, driver_id, status) values ('$S', '$A', '$D1', 'draft')"
"${Q[@]}" >"$OUT/k6.ios" 2>&1 <<SQL &
begin;
set local role authenticated; set local request.jwt.claim.sub = '$A';
select 1 from public.settlements where id = '$S' for update;
select 1 from public.loads where id = '$(load_of 4600)' for update;
insert into public.settlement_loads (settlement_id, profile_id, load_id, load_number, rate_confirmation_document_id)
values ('$S', '$A', '$(load_of 4600)', 'SYN-K4600', '$D');
select pg_sleep(2);
commit;
select 'IOS_DONE';
SQL
sleep 0.5
t0=$(date +%s%N)
"${Q[@]}" >"$OUT/k6.claim" 2>&1 <<SQL
set role authenticated; set request.jwt.claim.sub = '$A';
select x.c->>'claim_id' as cid, x.c->>'claim_token' as tok
  from (select public.sph_payroll_claim(jsonb_build_object('document_id', '$D', 'load_id', '$(load_of 4601)', 'plan', 'add_to_draft', 'target_settlement_id', '$S')) as c) x \gset
\if :{?cid}
\else
\quit
\endif
select 'CLAIM_MS ' || 0;
SQL
t1=$(date +%s%N)
claim_ms=$(( (t1 - t0) / 1000000 ))
wait
grep -q IOS_DONE "$OUT/k6.ios" || { cat "$OUT/k6.ios"; fail "K6 iPhone-style save"; }
grep -q 'CLAIM_MS' "$OUT/k6.claim" || { cat "$OUT/k6.claim"; fail "K6 claim"; }
[ "$claim_ms" -lt 1200 ] || fail "K6 claim waited ${claim_ms} ms for the iPhone-style save"
echo "PASS K6 lock graph: claim took ${claim_ms} ms while an iPhone-style save held the settlement + load locks and referenced the document (no wait, no deadlock)"
# the web save that follows the claim adds the claimed load to the draft
"${Q[@]}" -c "insert into public.settlement_loads (settlement_id, profile_id, load_id, load_number) values ('$S', '$A', '$(load_of 4601)', 'SYN-K4601')"

# finalize vs a settlement-row lock held by a save: waits, then succeeds
"${Q[@]}" >"$OUT/k6b.save" 2>&1 <<SQL &
begin;
set local role authenticated; set local request.jwt.claim.sub = '$A';
select 1 from public.settlements where id = '$S' for update;
select pg_sleep(1.5);
commit;
select 'SAVE_DONE';
SQL
sleep 0.3
"${Q[@]}" >"$OUT/k6b.fin" 2>&1 <<SQL
set role authenticated; set request.jwt.claim.sub = '$A';
select 'FINALIZED ' || (public.sph_payroll_claim_finalize(jsonb_build_object(
  'claim_id', (select id from public.document_payroll_claims where document_id = '$D' and status = 'pending'),
  'claim_token', (select claim_token from public.document_payroll_claims where document_id = '$D' and status = 'pending'),
  'settlement_id', '$S'))->>'settlement_load_id');
SQL
wait
grep -q SAVE_DONE "$OUT/k6b.save" && grep -q '^FINALIZED ' "$OUT/k6b.fin" || { cat "$OUT"/k6b.*; fail "K6b"; }
! grep -q 40P01 "$OUT"/k6* || fail "K6 deadlock"
echo "PASS K6b finalize waits for a save holding the settlement lock, then links (no deadlock)"
echo "== concurrency: all scenarios passed"
