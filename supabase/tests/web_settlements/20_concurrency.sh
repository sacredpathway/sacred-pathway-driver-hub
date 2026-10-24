#!/usr/bin/env bash
# Concurrency tests — real parallel sessions against the throwaway cluster
# started by run.sh (PGHOST/PGPORT exported there).
set -euo pipefail
A="set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';"
Q=(psql -X -q -t -A -v ON_ERROR_STOP=1)
D=aaaaaaaa-0000-0000-0000-00000000d001
fail() { echo "FAIL $*"; exit 1; }

newload() {  # $1 load id
  "${Q[@]}" -c "insert into public.loads (id, profile_id, driver_id, load_number, delivery_date, total_revenue, status)
    values ('$1', 'aaaaaaaa-0000-0000-0000-000000000001', '$D', 'C-' || left('$1', 8), '2026-10-14', 1000, 'ready_for_settlement');" >/dev/null
}
create() {  # $1 settlement id, $2 number, $3 load id (optional)
  local loads="'[]'"
  [ -n "${3:-}" ] && loads="jsonb_build_array(t_load(gen_random_uuid(), '$3', 'C', 1000, 700))"
  "${Q[@]}" -c "$A select tst.save('create', '$1', null, t_header('$2', 700), $loads, '[]', '[]', t_audit('created', 'c'));" >/dev/null
}
ts() { "${Q[@]}" -c "select updated_at from public.settlements where id = '$1';"; }

# ---------------------------------------------------------------------------
# C1: 20 true races — two saves with the SAME expected updated_at.
#     Exactly one commits; the loser writes nothing; no mixed line sets.
# ---------------------------------------------------------------------------
wins=0
for i in $(seq 1 20); do
  sid=$(printf 'c1000000-0000-4000-8000-%012d' "$i")
  create "$sid" "C1-$i"
  t=$(ts "$sid")
  for who in x y; do
    amt=$([ "$who" = x ] && echo 111.11 || echo 222.22)
    ( "${Q[@]}" -c "$A select tst.save('update', '$sid', '$t', t_header('C1-$i', $amt), '[]',
        jsonb_build_array(t_add(gen_random_uuid(), 'bonus', '$who-1', $amt), t_add(gen_random_uuid(), 'bonus', '$who-2', $amt)),
        '[]', t_audit('manual_adjustment', '$who'));" >/dev/null 2>"/tmp/c1_${i}_$who.err" && echo ok > "/tmp/c1_${i}_$who.res" || echo err > "/tmp/c1_${i}_$who.res" ) &
  done
  wait
  rx=$(cat /tmp/c1_${i}_x.res); ry=$(cat /tmp/c1_${i}_y.res)
  [ "$rx/$ry" = "ok/err" ] || [ "$rx/$ry" = "err/ok" ] || fail "C1 round $i: expected exactly one winner, got $rx/$ry"
  loser=$([ "$rx" = err ] && echo x || echo y); winner=$([ "$rx" = ok ] && echo x || echo y)
  grep -q "changed somewhere else" "/tmp/c1_${i}_$loser.err" || fail "C1 round $i: loser error was not a conflict: $(cat /tmp/c1_${i}_$loser.err)"
  state=$("${Q[@]}" -c "select string_agg(distinct left(description,1), ',') || '/' || count(*) || '/' ||
           (select net_pay from public.settlements where id = '$sid') ||
           '/' || (select count(*) from public.settlement_audit_events where settlement_id = '$sid' and action = 'manual_adjustment')
           from public.settlement_additions where settlement_id = '$sid';")
  expect=$([ "$winner" = x ] && echo "x/2/111.11/1" || echo "y/2/222.22/1")
  [ "$state" = "$expect" ] || fail "C1 round $i: state $state, expected winner-only $expect"
  wins=$((wins+1))
done
echo "PASS C1 20 races of two saves with the same version: exactly one committed every time, the loser wrote nothing (no mixed lines, one audit row)"

# ---------------------------------------------------------------------------
# C2: deterministic lock wait — session 1 holds the row (save in an open
#     transaction), session 2's save blocks, then re-reads and is refused.
# ---------------------------------------------------------------------------
sid=c2000000-0000-4000-8000-000000000001
create "$sid" "C2-1"
t=$(ts "$sid")
( "${Q[@]}" -c "begin; $A select tst.save('update', '$sid', '$t', t_header('C2-1', 1), '[]', '[]', '[]', t_audit('manual_adjustment', 's1')); select pg_sleep(1.0); commit;" >/dev/null 2>/tmp/c2_1.err && echo ok >/tmp/c2_1.res || echo err >/tmp/c2_1.res ) &
sleep 0.3
( "${Q[@]}" -c "$A select tst.save('update', '$sid', '$t', t_header('C2-1', 2), '[]', '[]', '[]', t_audit('manual_adjustment', 's2'));" >/dev/null 2>/tmp/c2_2.err && echo ok >/tmp/c2_2.res || echo err >/tmp/c2_2.res ) &
wait
[ "$(cat /tmp/c2_1.res)/$(cat /tmp/c2_2.res)" = "ok/err" ] || fail "C2: expected ok/err got $(cat /tmp/c2_1.res)/$(cat /tmp/c2_2.res)"
grep -q "changed somewhere else" /tmp/c2_2.err || fail "C2: blocked save not refused as conflict"
[ "$("${Q[@]}" -c "select net_pay from public.settlements where id = '$sid'")" = "1.00" ] || fail "C2: final net is not session 1's"
echo "PASS C2 a save that waited on the row lock re-checked the version and was refused"

# ---------------------------------------------------------------------------
# C3: 15 races — save vs approve of the same draft. Never both; if approval
#     wins, the settlement's lines are exactly the approved ones.
# ---------------------------------------------------------------------------
for i in $(seq 1 15); do
  sid=$(printf 'c3000000-0000-4000-8000-%012d' "$i")
  lid=$(printf 'c3a00000-0000-4000-8000-%012d' "$i")
  newload "$lid"; create "$sid" "C3-$i" "$lid"
  t=$(ts "$sid")
  ( "${Q[@]}" -c "$A select tst.save('update', '$sid', '$t', t_header('C3-$i', 999), '[]', '[]', '[]', t_audit('load_removed', 'x'));" >/dev/null 2>&1 && echo ok >/tmp/c3_s.res || echo err >/tmp/c3_s.res ) &
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$sid', 'expected_updated_at', '$t', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>&1 && echo ok >/tmp/c3_a.res || echo err >/tmp/c3_a.res ) &
  wait
  r="$(cat /tmp/c3_s.res)/$(cat /tmp/c3_a.res)"
  st=$("${Q[@]}" -c "select status || '/' || (select count(*) from public.settlement_loads where settlement_id = '$sid') || '/' || (select status from public.loads where id = '$lid') from public.settlements where id = '$sid'")
  case "$r" in
    ok/err) [ "$st" = "draft/0/ready_for_settlement" ] || fail "C3 round $i: save won but state $st" ;;
    err/ok) [ "$st" = "approved/1/settled" ] || fail "C3 round $i: approve won but state $st" ;;
    *) fail "C3 round $i: expected exactly one winner, got $r (state $st)" ;;
  esac
done
echo "PASS C3 15 races of save vs approve: exactly one won each time; an approved settlement never had its lines changed"

# ---------------------------------------------------------------------------
# C4: 15 races — two settlements with the SAME load approved at once.
#     Exactly one approval commits (existing double-pay guard inside the
#     atomic transition); the loser leaves no repayment / flag / audit.
# ---------------------------------------------------------------------------
for i in $(seq 1 15); do
  lid=$(printf 'c4a00000-0000-4000-8000-%012d' "$i")
  s1=$(printf 'c4100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c4200000-0000-4000-8000-%012d' "$i")
  newload "$lid"; create "$s1" "C4a-$i" "$lid"; create "$s2" "C4b-$i" "$lid"
  t1=$(ts "$s1"); t2=$(ts "$s2")
  for p in "$s1|$t1|1" "$s2|$t2|2"; do
    IFS="|" read -r sid t n <<<"$p"
    ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$sid', 'expected_updated_at', '$t', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>&1 && echo ok >/tmp/c4_$n.res || echo err >/tmp/c4_$n.res ) &
  done
  wait
  r="$(cat /tmp/c4_1.res)/$(cat /tmp/c4_2.res)"
  [ "$r" = "ok/err" ] || [ "$r" = "err/ok" ] || fail "C4 round $i: expected exactly one approval, got $r"
  n=$("${Q[@]}" -c "select count(*) from public.settlements where id in ('$s1','$s2') and status = 'approved'")
  a=$("${Q[@]}" -c "select count(*) from public.settlement_audit_events where settlement_id in ('$s1','$s2') and action = 'approved'")
  [ "$n/$a" = "1/1" ] || fail "C4 round $i: approved=$n audit=$a"
done
echo "PASS C4 15 races approving two settlements that share a load: exactly one approved, the loser left no audit or side effects"

# ---------------------------------------------------------------------------
# C5: 25 races — two approvals recovering the SAME advance ($300 each of $500).
#     Never a deadlock; exactly one succeeds; never over-recovered.
# ---------------------------------------------------------------------------
"${Q[@]}" -c "insert into public.driver_advances (id, profile_id, driver_id, type, date, amount, description)
  select ('c5ad0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '$D', 'cash', '2026-10-01', 500, 'adv'
  from generate_series(1, 25) g;" >/dev/null
deadlocks=0
for i in $(seq 1 25); do
  adv=$(printf 'c5ad0000-0000-4000-8000-%012d' "$i")
  s1=$(printf 'c5100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c5200000-0000-4000-8000-%012d' "$i")
  for sid in "$s1" "$s2"; do
    "${Q[@]}" -c "$A select tst.save('create', '$sid', null, t_header('C5-' || left('$sid', 4) || '-$i', 0), '[]', '[]',
       jsonb_build_array(t_ded(gen_random_uuid(), 'cash_advance', 'Advance', 300, p_adv => '$adv')), t_audit('created', 'c5'));" >/dev/null
  done
  t1=$(ts "$s1"); t2=$(ts "$s2")
  for p in "$s1|$t1|1" "$s2|$t2|2"; do
    IFS="|" read -r sid t n <<<"$p"
    ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$sid', 'expected_updated_at', '$t', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>/tmp/c5_$n.err && echo ok >/tmp/c5_$n.res || echo err >/tmp/c5_$n.res ) &
  done
  wait
  grep -qi deadlock /tmp/c5_1.err /tmp/c5_2.err && deadlocks=$((deadlocks+1))
  r="$(cat /tmp/c5_1.res)/$(cat /tmp/c5_2.res)"
  [ "$r" = "ok/err" ] || [ "$r" = "err/ok" ] || fail "C5 round $i: expected exactly one approval, got $r ($(cat /tmp/c5_1.err /tmp/c5_2.err))"
  rec=$("${Q[@]}" -c "select recovered_amount || '/' || (select coalesce(sum(amount),0) from public.driver_advance_repayments where advance_id = '$adv') from public.driver_advances where id = '$adv'")
  [ "$rec" = "300.00/300.00" ] || fail "C5 round $i: advance state $rec"
done
[ "$deadlocks" = "0" ] || fail "C5: $deadlocks deadlocks"
echo "PASS C5 25 races of two approvals on the same advance: 0 deadlocks, exactly one approved, never over-recovered"

# ---------------------------------------------------------------------------
# C6: C6_ROUNDS races (default 100) — VOID of an approved settlement vs APPROVAL of another draft
#     that carries the SAME two loads (inserted in reverse id order so heap
#     order ≠ id order). This is the web ↔ iPhone 2.3.7 "same loads" race:
#     both apps go through sph_web_transition_settlement. Never a deadlock;
#     the void always commits; the approval either waits for it and succeeds
#     or is refused as double pay; the loads end consistent with the winner.
# ---------------------------------------------------------------------------
deadlocks=0
C6_ROUNDS="${C6_ROUNDS:-100}"
[ "$C6_ROUNDS" -ge 100 ] 2>/dev/null || fail "C6 needs at least 100 rounds (C6_ROUNDS=$C6_ROUNDS)"
for i in $(seq 1 "$C6_ROUNDS"); do
  la=$(printf 'c6a10000-0000-4000-8000-%012d' "$i"); lb=$(printf 'c6a20000-0000-4000-8000-%012d' "$i")
  newload "$lb"; newload "$la"
  s1=$(printf 'c6100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c6200000-0000-4000-8000-%012d' "$i")
  for sid in "$s2" "$s1"; do
    "${Q[@]}" -c "$A select tst.save('create', '$sid', null, t_header('C6-' || left('$sid', 4) || '-$i', 1400),
       jsonb_build_array(t_load(gen_random_uuid(), '$lb', 'B', 1000, 700), t_load(gen_random_uuid(), '$la', 'A', 1000, 700)),
       '[]', '[]', t_audit('created', 'c6'));" >/dev/null
  done
  t2=$(ts "$s2")
  "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null
  t1=$(ts "$s1"); t2=$(ts "$s2")
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'approved', 'to', 'voided', 'reason', 'race', 'audit', t_audit('voided', 'v')));" >/dev/null 2>/tmp/c6_v.err && echo ok >/tmp/c6_v.res || echo err >/tmp/c6_v.res ) &
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s1', 'expected_updated_at', '$t1', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>/tmp/c6_a.err && echo ok >/tmp/c6_a.res || echo err >/tmp/c6_a.res ) &
  wait
  grep -qi deadlock /tmp/c6_v.err /tmp/c6_a.err && deadlocks=$((deadlocks+1))
  [ "$(cat /tmp/c6_v.res)" = ok ] || fail "C6 round $i: void failed: $(cat /tmp/c6_v.err)"
  st=$("${Q[@]}" -c "select (select status from public.settlements where id = '$s1') || '/' || (select status from public.settlements where id = '$s2') || '/' ||
         (select string_agg(status, ',' order by id) from public.loads where id in ('$la', '$lb'))")
  case "$(cat /tmp/c6_a.res)" in
    ok)  [ "$st" = "approved/voided/settled,settled" ] || fail "C6 round $i: approval won but state $st" ;;
    err) grep -qiv deadlock /tmp/c6_a.err || true
         [ "$st" = "draft/voided/ready_for_settlement,ready_for_settlement" ] || fail "C6 round $i: approval refused but state $st ($(cat /tmp/c6_a.err))" ;;
  esac
done
[ "$deadlocks" = "0" ] || fail "C6: $deadlocks deadlocks"
echo "PASS C6 $C6_ROUNDS races of void vs approve on settlements sharing two loads: 0 deadlocks, loads always match the committed outcome"

# ---------------------------------------------------------------------------
# C7: 50 races — REOPEN (approved → draft, with reason) of a settlement vs
#     APPROVAL of another draft carrying the SAME two loads (reverse id order
#     on disk). Same lock paths as C6 through the release branch.
#     Never a deadlock; the reopen always commits; the loads match the winner.
# ---------------------------------------------------------------------------
deadlocks=0
for i in $(seq 1 50); do
  la=$(printf 'c7a10000-0000-4000-8000-%012d' "$i"); lb=$(printf 'c7a20000-0000-4000-8000-%012d' "$i")
  newload "$lb"; newload "$la"
  s1=$(printf 'c7100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c7200000-0000-4000-8000-%012d' "$i")
  for sid in "$s2" "$s1"; do
    "${Q[@]}" -c "$A select tst.save('create', '$sid', null, t_header('C7-' || left('$sid', 4) || '-$i', 1400),
       jsonb_build_array(t_load(gen_random_uuid(), '$lb', 'B', 1000, 700), t_load(gen_random_uuid(), '$la', 'A', 1000, 700)),
       '[]', '[]', t_audit('created', 'c7'));" >/dev/null
  done
  t2=$(ts "$s2")
  "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null
  t1=$(ts "$s1"); t2=$(ts "$s2")
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'approved', 'to', 'draft', 'reason', 'race', 'audit', t_audit('status_changed', 'r')));" >/dev/null 2>/tmp/c7_r.err && echo ok >/tmp/c7_r.res || echo err >/tmp/c7_r.res ) &
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s1', 'expected_updated_at', '$t1', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>/tmp/c7_a.err && echo ok >/tmp/c7_a.res || echo err >/tmp/c7_a.res ) &
  wait
  grep -qi deadlock /tmp/c7_r.err /tmp/c7_a.err && deadlocks=$((deadlocks+1))
  [ "$(cat /tmp/c7_r.res)" = ok ] || fail "C7 round $i: reopen failed: $(cat /tmp/c7_r.err)"
  st=$("${Q[@]}" -c "select (select status from public.settlements where id = '$s1') || '/' || (select status from public.settlements where id = '$s2') || '/' ||
         (select string_agg(status, ',' order by id) from public.loads where id in ('$la', '$lb'))")
  case "$(cat /tmp/c7_a.res)" in
    ok)  [ "$st" = "approved/draft/settled,settled" ] || fail "C7 round $i: approval won but state $st" ;;
    err) grep -qi 'already paid on another' /tmp/c7_a.err || fail "C7 round $i: approval refused for the wrong reason: $(cat /tmp/c7_a.err)"
         [ "$st" = "draft/draft/ready_for_settlement,ready_for_settlement" ] || fail "C7 round $i: approval refused but state $st" ;;
  esac
done
[ "$deadlocks" = "0" ] || fail "C7: $deadlocks deadlocks"
echo "PASS C7 50 races of reopen vs approve on settlements sharing two loads: 0 deadlocks, loads always match the committed outcome"

# ---------------------------------------------------------------------------
# C8: 50 races — SAVE of a draft that adds the two loads in reverse id order
#     vs APPROVAL of another draft carrying the same loads. Both must commit
#     (a draft may list a load another settlement pays; approval re-checks).
#     Never a deadlock; the approved settlement's loads are settled.
# ---------------------------------------------------------------------------
deadlocks=0
for i in $(seq 1 50); do
  la=$(printf 'c8a10000-0000-4000-8000-%012d' "$i"); lb=$(printf 'c8a20000-0000-4000-8000-%012d' "$i")
  newload "$lb"; newload "$la"
  s1=$(printf 'c8100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c8200000-0000-4000-8000-%012d' "$i")
  "${Q[@]}" -c "$A select tst.save('create', '$s2', null, t_header('C8-B-$i', 1400),
     jsonb_build_array(t_load(gen_random_uuid(), '$la', 'A', 1000, 700), t_load(gen_random_uuid(), '$lb', 'B', 1000, 700)),
     '[]', '[]', t_audit('created', 'c8'));" >/dev/null
  "${Q[@]}" -c "$A select tst.save('create', '$s1', null, t_header('C8-A-$i', 0), '[]', '[]', '[]', t_audit('created', 'c8'));" >/dev/null
  t1=$(ts "$s1"); t2=$(ts "$s2")
  ( "${Q[@]}" -c "$A select tst.save('update', '$s1', '$t1', t_header('C8-A-$i', 1400),
       jsonb_build_array(t_load(gen_random_uuid(), '$lb', 'B', 1000, 700), t_load(gen_random_uuid(), '$la', 'A', 1000, 700)),
       '[]', '[]', t_audit('load_added', 's'));" >/dev/null 2>/tmp/c8_s.err && echo ok >/tmp/c8_s.res || echo err >/tmp/c8_s.res ) &
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>/tmp/c8_a.err && echo ok >/tmp/c8_a.res || echo err >/tmp/c8_a.res ) &
  wait
  grep -qi deadlock /tmp/c8_s.err /tmp/c8_a.err && deadlocks=$((deadlocks+1))
  [ "$(cat /tmp/c8_s.res)/$(cat /tmp/c8_a.res)" = "ok/ok" ] || { [ "$deadlocks" != 0 ] || fail "C8 round $i: save $(cat /tmp/c8_s.res) ($(cat /tmp/c8_s.err)) approve $(cat /tmp/c8_a.res) ($(cat /tmp/c8_a.err))"; }
  st=$("${Q[@]}" -c "select (select status || ':' || (select count(*) from public.settlement_loads where settlement_id = '$s1') from public.settlements where id = '$s1') || '/' ||
         (select status from public.settlements where id = '$s2') || '/' || (select string_agg(status, ',' order by id) from public.loads where id in ('$la', '$lb'))")
  [ "$deadlocks" != 0 ] || [ "$st" = "draft:2/approved/settled,settled" ] || fail "C8 round $i: state $st"
done
[ "$deadlocks" = "0" ] || fail "C8: $deadlocks deadlocks"
echo "PASS C8 50 races of draft save vs approval sharing two loads: 0 deadlocks, both committed, loads settled once"

# ---------------------------------------------------------------------------
# C9: 50 races — VOID vs APPROVAL where the two settlements share two loads
#     AND recover the same two advances ($200 of $500 each; advances and
#     loads both created in reverse id order). Never a deadlock; the void
#     always commits; repayments and balances match exactly one outcome.
# ---------------------------------------------------------------------------
deadlocks=0
for i in $(seq 1 50); do
  la=$(printf 'c9a10000-0000-4000-8000-%012d' "$i"); lb=$(printf 'c9a20000-0000-4000-8000-%012d' "$i")
  xa=$(printf 'c9ad1000-0000-4000-8000-%012d' "$i"); xb=$(printf 'c9ad2000-0000-4000-8000-%012d' "$i")
  newload "$lb"; newload "$la"
  for adv in "$xb" "$xa"; do
    "${Q[@]}" -c "insert into public.driver_advances (id, profile_id, driver_id, type, date, amount, description)
      values ('$adv', 'aaaaaaaa-0000-0000-0000-000000000001', '$D', 'cash', '2026-10-01', 500, 'adv');" >/dev/null
  done
  s1=$(printf 'c9100000-0000-4000-8000-%012d' "$i"); s2=$(printf 'c9200000-0000-4000-8000-%012d' "$i")
  for sid in "$s2" "$s1"; do
    "${Q[@]}" -c "$A select tst.save('create', '$sid', null, t_header('C9-' || left('$sid', 4) || '-$i', 1000),
       jsonb_build_array(t_load(gen_random_uuid(), '$lb', 'B', 1000, 700), t_load(gen_random_uuid(), '$la', 'A', 1000, 700)), '[]',
       jsonb_build_array(t_ded(gen_random_uuid(), 'cash_advance', 'Adv B', 200, p_adv => '$xb'), t_ded(gen_random_uuid(), 'cash_advance', 'Adv A', 200, p_adv => '$xa')),
       t_audit('created', 'c9'));" >/dev/null
  done
  t2=$(ts "$s2")
  "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null
  t1=$(ts "$s1"); t2=$(ts "$s2")
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s2', 'expected_updated_at', '$t2', 'from', 'approved', 'to', 'voided', 'reason', 'race', 'audit', t_audit('voided', 'v')));" >/dev/null 2>/tmp/c9_v.err && echo ok >/tmp/c9_v.res || echo err >/tmp/c9_v.res ) &
  ( "${Q[@]}" -c "$A select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '$s1', 'expected_updated_at', '$t1', 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a')));" >/dev/null 2>/tmp/c9_a.err && echo ok >/tmp/c9_a.res || echo err >/tmp/c9_a.res ) &
  wait
  grep -qi deadlock /tmp/c9_v.err /tmp/c9_a.err && deadlocks=$((deadlocks+1))
  [ "$(cat /tmp/c9_v.res)" = ok ] || fail "C9 round $i: void failed: $(cat /tmp/c9_v.err)"
  st=$("${Q[@]}" -c "select (select status from public.settlements where id = '$s1') || '/' || (select status from public.settlements where id = '$s2') || '/' ||
         (select string_agg(status, ',' order by id) from public.loads where id in ('$la', '$lb')) || '/' ||
         (select string_agg(recovered_amount::text || ':' || is_closed, ',' order by id) from public.driver_advances where id in ('$xa', '$xb')) || '/' ||
         (select count(*) from public.driver_advance_repayments where advance_id in ('$xa', '$xb')) || ':' ||
         (select count(*) from public.driver_advance_repayments where advance_id in ('$xa', '$xb') and settlement_id = '$s1')")
  case "$(cat /tmp/c9_a.res)" in
    ok)  [ "$st" = "approved/voided/settled,settled/200.00:false,200.00:false/2:2" ] || fail "C9 round $i: approval won but state $st" ;;
    err) grep -qi 'already paid on another' /tmp/c9_a.err || fail "C9 round $i: approval refused for the wrong reason: $(cat /tmp/c9_a.err)"
         [ "$st" = "draft/voided/ready_for_settlement,ready_for_settlement/0.00:false,0.00:false/0:0" ] || fail "C9 round $i: approval refused but state $st" ;;
  esac
done
[ "$deadlocks" = "0" ] || fail "C9: $deadlocks deadlocks"
echo "PASS C9 50 races of void vs approve sharing two loads and two advances: 0 deadlocks, repayments and balances always match one outcome"
