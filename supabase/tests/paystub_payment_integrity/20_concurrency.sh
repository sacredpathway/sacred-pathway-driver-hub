#!/usr/bin/env bash
# =============================================================================
#  Race / concurrency tests — two real sessions against the throwaway cluster
#  started by run.sh (PGHOST/PGPORT exported there). Session 1 holds its
#  transaction open with pg_sleep while session 2 runs; the assertions check
#  the committed end state.
# =============================================================================
set -euo pipefail

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -At)
AS_A="set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';"
DA="aaaaaaaa-0000-0000-0000-00000000d001"

q()   { "${PSQL[@]}" -c "$AS_A $1"; }
sup() { "${PSQL[@]}" -c "$1"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; exit 1; }

new_load()  { q "select tst.new_load('ready_for_settlement');" | tail -1; }
new_draft() { q "select tst.new_draft('$DA');" | tail -1; }
attach()    { q "select tst.attach('$1', '$2');" >/dev/null; }

# Runs SQL in session 2 and prints "OK" or the error message.
try() { "${PSQL[@]}" -c "$AS_A $1" >/dev/null 2>"$TMPE" && echo OK || sed -n 's/^ERROR:  //p' "$TMPE" | head -1; }
TMPE="$(mktemp)"; trap 'rm -f "$TMPE"' EXIT

# ---- R1: two paystubs with the same load issued at the same time ----------
L=$(new_load); P1=$(new_draft); P2=$(new_draft); attach "$P1" "$L"; attach "$P2" "$L"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P1'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P2');")
wait
S=$(sup "select string_agg(status, ',' order by id = '$P1' desc) from paystubs where id in ('$P1','$P2');")
LS=$(sup "select status from loads where id = '$L';")
[[ "$R" == load_settled* && "$S" == "issued,draft" && "$LS" == "settled" ]] \
  && pass "R1 concurrent issue of two paystubs sharing a load: one wins, loser blocked ($R)" \
  || fail "R1 got R=[$R] S=[$S] L=[$LS]"

# ---- R2: same race, loser starts first but commits second ------------------
L=$(new_load); P1=$(new_draft); P2=$(new_draft); attach "$P1" "$L"; attach "$P2" "$L"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P2'); select pg_sleep(2); rollback;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P1');")
wait
S=$(sup "select string_agg(status, ',' order by id = '$P1' desc) from paystubs where id in ('$P1','$P2');")
[[ "$R" == OK && "$S" == "issued,draft" ]] \
  && pass "R2 if the first issuer rolls back, the waiting issuer succeeds" || fail "R2 got R=[$R] S=[$S]"

# ---- R3: attach a load to a draft while another paystub is issuing it ------
L=$(new_load); P1=$(new_draft); P3=$(new_draft); attach "$P1" "$L"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P1'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select tst.attach('$P3', '$L');")
wait
[[ "$R" == load_settled* ]] && pass "R3 attach waits for the in-flight issue, then is rejected ($R)" || fail "R3 got [$R]"

# ---- R4: a line is added to a draft while that draft is being issued -------
L1=$(new_load); L2=$(new_load); P=$(new_draft); attach "$P" "$L1"
( "${PSQL[@]}" -c "$AS_A begin; select tst.attach('$P', '$L2'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P');")
wait
S=$(sup "select status from loads where id = '$L1'")","$(sup "select status from loads where id = '$L2'")
[[ "$R" == OK && "$S" == "settled,settled" ]] \
  && pass "R4 issue waits for the concurrent line insert and settles every line (no escaped load)" \
  || fail "R4 got R=[$R] S=[$S]"

# ---- R5: add a line after issue started → rejected (paystub locked) --------
L1=$(new_load); L2=$(new_load); P=$(new_draft); attach "$P" "$L1"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select tst.attach('$P', '$L2');")
wait
LS=$(sup "select status from loads where id = '$L2'")
[[ "$R" == paystub_locked* && "$LS" == ready_for_settlement ]] \
  && pass "R5 line added during issue is rejected; that load stays unpaid ($R)" || fail "R5 got R=[$R] L2=[$LS]"

# ---- R6: numbering under concurrency --------------------------------------
P1=$(new_draft); P2=$(new_draft)
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P1'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P2');")
wait
N=$(sup "select count(distinct paystub_number) from paystubs where id in ('$P1','$P2')")
D=$(sup "select count(*) from (select paystub_number from paystubs where paystub_number is not null and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001' group by 1 having count(*) > 1) x")
[[ "$R" == OK && "$N" == 2 && "$D" == 0 ]] \
  && pass "R6 concurrent issues get distinct paystub numbers (no duplicates for the carrier)" || fail "R6 got R=[$R] N=[$N] D=[$D]"

# ---- R7: double-click (same paystub issued twice concurrently) ------------
L=$(new_load); P=$(new_draft); attach "$P" "$L"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P');")
wait
[[ "$R" == paystub_not_draft* ]] && pass "R7 double-submit of Issue: second call rejected ($R)" || fail "R7 got [$R]"

# ---- R8: void racing an issue of another draft holding the same load ------
L=$(new_load); P1=$(new_draft); P2=$(new_draft); attach "$P1" "$L"; attach "$P2" "$L"
q "select public.issue_paystub('$P1');" >/dev/null
( "${PSQL[@]}" -c "$AS_A begin; select public.void_paystub('$P1'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P2');")
wait
S=$(sup "select string_agg(status, ',' order by id = '$P1' desc) from paystubs where id in ('$P1','$P2');")
LS=$(sup "select status from loads where id = '$L'")
[[ "$R" == OK && "$S" == "voided,issued" && "$LS" == settled ]] \
  && pass "R8 issue waits for the void, then pays the released load exactly once" || fail "R8 got R=[$R] S=[$S] L=[$LS]"

# ---- R9 (informational): iPhone approval racing a web issue ----------------
# The iPhone app does not consult web paystubs; its plain UPDATE waits on the
# row lock and then succeeds. Documented as a remaining cross-system gap.
L=$(new_load); P=$(new_draft); attach "$P" "$L"
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select tst.ios_settlement('$L', 'approved'); update loads set status = 'settled' where id = '$L';")
wait
echo "INFO R9 iPhone approval concurrent with web issue: iPhone write result=[$R] (gap: not blocked server-side)"
