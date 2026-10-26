#!/usr/bin/env bash
# =============================================================================
#  Web paystub Issue vs iPhone settlement approval — real concurrent sessions
#  against the throwaway cluster from run.sh. iPhone writes use the same
#  statements as Driver Hub 2.3.5 (tst.ios_* helpers from 30_cross_platform.sql).
# =============================================================================
set -euo pipefail

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -At)
AS_A="set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';"
DA="aaaaaaaa-0000-0000-0000-00000000d001"

q()   { "${PSQL[@]}" -c "$AS_A $1"; }
sup() { "${PSQL[@]}" -c "$1"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; exit 1; }
TMPE="$(mktemp)"; TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPE" "$TMPD"' EXIT
try() { "${PSQL[@]}" -c "$AS_A $1" >/dev/null 2>"$TMPE" && echo OK || sed -n 's/^ERROR:  //p' "$TMPE" | head -1; }

new_load()  { q "select tst.new_load('ready_for_settlement');" | tail -1; }
new_draft() { q "select tst.new_draft('$DA');" | tail -1; }
attach()    { q "select tst.attach('$1', '$2');" >/dev/null; }
ios_save()  { q "select tst.ios_save(array[$1]::uuid[]);" | tail -1; }   # $1 = quoted uuid list

state() {  # paystub status, settlement status, load status
  sup "select (select status from paystubs where id = '$1') || ',' || (select status from settlements where id = '$2') || ',' || (select status from loads where id = '$3');"
}

# ---- C1: web first (web holds its transaction open) ------------------------
L=$(new_load); P=$(new_draft); attach "$P" "$L"; S=$(ios_save "'$L'")
( "${PSQL[@]}" -c "$AS_A begin; select public.issue_paystub('$P'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select tst.ios_transition('$S', 'approved');")
wait
ST=$(state "$P" "$S" "$L")
[[ "$R" == *"is already paid on web paystub"* && "$ST" == "issued,draft,settled" ]] \
  && pass "C1 web Issue first: concurrent iPhone approval waits, then is rejected cleanly" || fail "C1 R=[$R] state=[$ST]"

# ---- C2: iPhone first (approval transaction held open) ---------------------
L=$(new_load); P=$(new_draft); attach "$P" "$L"; S=$(ios_save "'$L'")
( "${PSQL[@]}" -c "$AS_A begin; select tst.ios_transition('$S', 'approved'); select pg_sleep(2); commit;" >/dev/null ) &
sleep 0.5
R=$(try "select public.issue_paystub('$P');")
wait
ST=$(state "$P" "$S" "$L")
[[ "$R" == load_on_settlement* && "$ST" == "draft,approved,ready_for_settlement" ]] \
  && pass "C2 iPhone approval first: concurrent web Issue waits, then is rejected cleanly ($R)" || fail "C2 R=[$R] state=[$ST]"

# ---- C3: iPhone approval then its best-effort settle, racing web -----------
L=$(new_load); P=$(new_draft); attach "$P" "$L"; S=$(ios_save "'$L'")
( "${PSQL[@]}" -c "$AS_A begin; select tst.ios_transition('$S', 'approved'); select pg_sleep(1); commit;" >/dev/null
  "${PSQL[@]}" -c "$AS_A select tst.ios_mark_settled('$S');" >/dev/null ) &
sleep 0.3
R=$(try "select public.issue_paystub('$P');")
wait
ST=$(state "$P" "$S" "$L")
[[ "$R" != OK && "$ST" == "draft,approved,settled" ]] \
  && pass "C3 iPhone approve + settle flag vs web Issue: web refused ($R)" || fail "C3 R=[$R] state=[$ST]"

# ---- C4: true race, no sleeps, repeated -----------------------------------
N=25; BOTH=0; NONE=0; DEAD=0
for i in $(seq 1 $N); do
  L=$(new_load); P=$(new_draft); attach "$P" "$L"; S=$(ios_save "'$L'")
  ( if "${PSQL[@]}" -c "$AS_A select public.issue_paystub('$P');" >/dev/null 2>"$TMPD/w$i"; then echo 0; else echo 1; fi > "$TMPD/wc$i" ) &
  ( if "${PSQL[@]}" -c "$AS_A select tst.ios_transition('$S', 'approved');" >/dev/null 2>"$TMPD/i$i"; then echo 0; else echo 1; fi > "$TMPD/ic$i" ) &
  wait
  W=$(cat "$TMPD/wc$i"); I=$(cat "$TMPD/ic$i")
  ST=$(state "$P" "$S" "$L")
  grep -qi deadlock "$TMPD/w$i" "$TMPD/i$i" && DEAD=$((DEAD+1))
  if [[ "$W" == 0 && "$I" == 0 ]]; then BOTH=$((BOTH+1)); fi
  if [[ "$W" != 0 && "$I" != 0 ]]; then NONE=$((NONE+1)); fi
  # the loser's record must be fully unchanged
  if [[ "$W" == 0 && "$ST" != "issued,draft,settled" ]]; then fail "C4 iteration $i web won but state=[$ST]"; fi
  if [[ "$I" == 0 && "$ST" != "draft,approved,ready_for_settlement" ]]; then fail "C4 iteration $i iPhone won but state=[$ST]"; fi
done
[[ $BOTH == 0 && $NONE == 0 && $DEAD == 0 ]] \
  && pass "C4 $N true races web Issue vs iPhone approval: exactly one committed every time, loser left no partial state, 0 deadlocks" \
  || fail "C4 both=$BOTH none=$NONE deadlocks=$DEAD"

# ---- C5: opposite lock order across two loads, repeated (deadlock check) ---
N=15; BOTH=0; DEAD=0
for i in $(seq 1 $N); do
  L1=$(new_load); L2=$(new_load); P=$(new_draft); attach "$P" "$L2"; attach "$P" "$L1"
  S=$(ios_save "'$L1','$L2'")
  ( if "${PSQL[@]}" -c "$AS_A select public.issue_paystub('$P');" >/dev/null 2>"$TMPD/w$i"; then echo 0; else echo 1; fi > "$TMPD/wc$i" ) &
  ( if "${PSQL[@]}" -c "$AS_A select tst.ios_transition('$S', 'approved');" >/dev/null 2>"$TMPD/i$i"; then echo 0; else echo 1; fi > "$TMPD/ic$i" ) &
  wait
  grep -qi deadlock "$TMPD/w$i" "$TMPD/i$i" && DEAD=$((DEAD+1))
  [[ "$(cat "$TMPD/wc$i")" == 0 && "$(cat "$TMPD/ic$i")" == 0 ]] && BOTH=$((BOTH+1))
  S1=$(sup "select status from loads where id = '$L1'"); S2=$(sup "select status from loads where id = '$L2'")
  [[ "$S1" == "$S2" ]] || fail "C5 iteration $i partial load state [$S1/$S2]"
done
[[ $BOTH == 0 && $DEAD == 0 ]] && pass "C5 $N multi-load races (lines in opposite order): one winner, both loads consistent, 0 deadlocks" \
  || fail "C5 both=$BOTH deadlocks=$DEAD"

# ---- C6: two iPhone devices approving different settlements, same load ----
N=10; BOTH=0
for i in $(seq 1 $N); do
  L=$(new_load); S1=$(ios_save "'$L'"); S2=$(ios_save "'$L'")
  ( if "${PSQL[@]}" -c "$AS_A select tst.ios_transition('$S1', 'approved');" >/dev/null 2>&1; then echo 0; else echo 1; fi > "$TMPD/a$i" ) &
  ( if "${PSQL[@]}" -c "$AS_A select tst.ios_transition('$S2', 'approved');" >/dev/null 2>&1; then echo 0; else echo 1; fi > "$TMPD/b$i" ) &
  wait
  [[ "$(cat "$TMPD/a$i")" == 0 && "$(cat "$TMPD/b$i")" == 0 ]] && BOTH=$((BOTH+1))
  A=$(sup "select count(*) from settlements where id in ('$S1','$S2') and status = 'approved'")
  [[ "$A" == 1 ]] || fail "C6 iteration $i approved count=$A"
done
[[ $BOTH == 0 ]] && pass "C6 $N concurrent iPhone approvals of one load on two settlements: exactly one approved" || fail "C6 both=$BOTH"

# ---- C7: line attached to an approved settlement vs web Issue -------------
N=10; BOTH=0
for i in $(seq 1 $N); do
  L=$(new_load); P=$(new_draft); attach "$P" "$L"; S=$(ios_save ""); q "select tst.ios_transition('$S', 'approved');" >/dev/null
  ( if "${PSQL[@]}" -c "$AS_A select public.issue_paystub('$P');" >/dev/null 2>&1; then echo 0; else echo 1; fi > "$TMPD/w$i" ) &
  ( if "${PSQL[@]}" -c "$AS_A select tst.ios_save(array['$L']::uuid[], '{}', false, '$S');" >/dev/null 2>&1; then echo 0; else echo 1; fi > "$TMPD/i$i" ) &
  wait
  [[ "$(cat "$TMPD/w$i")" == 0 && "$(cat "$TMPD/i$i")" == 0 ]] && BOTH=$((BOTH+1))
done
[[ $BOTH == 0 ]] && pass "C7 $N races: load added to an approved settlement vs web Issue — never both" || fail "C7 both=$BOTH"
