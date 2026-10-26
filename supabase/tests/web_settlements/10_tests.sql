-- =============================================================================
--  Functional tests — web settlement atomic writes + safety rules
--  Calls are made exactly like PostgREST: role `authenticated`,
--  request.jwt.claim.sub = the signed-in user. Every assertion raises on
--  failure (ON_ERROR_STOP) and prints "PASS <label>".
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set asB 'reset role; set role authenticated; set request.jwt.claim.sub = ''bbbbbbbb-0000-0000-0000-000000000001'';'
\set asD 'reset role; set role authenticated; set request.jwt.claim.sub = ''dddddddd-0000-0000-0000-000000000001'';'
\set asSuper 'reset role; set request.jwt.claim.sub = '''';'

\set S1 '''5e000000-0000-4000-8000-000000000001'''
\set S2 '''5e000000-0000-4000-8000-000000000002'''
\set S3 '''5e000000-0000-4000-8000-000000000003'''
\set L1 '''aaaaaaaa-0000-0000-0000-0000000a0001'''
\set L2 '''aaaaaaaa-0000-0000-0000-0000000a0002'''
\set L3 '''aaaaaaaa-0000-0000-0000-0000000a0003'''
\set ADV '''aaaaaaaa-0000-0000-0000-0000000ad001'''
\set REC '''aaaaaaaa-0000-0000-0000-0000000ec001'''
\set CAT '''aaaaaaaa-0000-0000-0000-0000000cc001'''

-- ---------------------------------------------------------------- helpers ---
create schema tst;
grant usage on schema tst to anon, authenticated;
create function tst.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'FAIL %', p_label; end if; raise notice 'PASS %', p_label; end $$;
create function tst.eq(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then raise exception 'FAIL %: expected [%] got [%]', p_label, p_expected, p_actual; end if;
  raise notice 'PASS %', p_label;
end $$;
-- Passes only if p_sql raises AND (hint = 'sph:<code>' OR message ~ pattern).
create function tst.rejects(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
declare v_hint text; v_msg text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if coalesce(v_hint, '') = 'sph:' || p_code or coalesce(v_hint, '') ~* ('^sph:(' || p_code || ')$') or v_msg ~* p_code then
      raise notice 'PASS % (%)', p_label, v_msg; return;
    end if;
    raise exception 'FAIL %: expected [%] got hint [%] msg [%]', p_label, p_code, v_hint, v_msg;
  end;
  raise exception 'FAIL %: expected rejection [%] but it succeeded', p_label, p_code;
end $$;
-- Fingerprint of everything a settlement owns (header + lines + audit + repayments).
create function tst.fp(p_id uuid) returns text language sql security definer set search_path = public as $$
  select md5(coalesce((select to_jsonb(s)::text from public.settlements s where s.id = p_id), '')
    || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.settlement_loads x where x.settlement_id = p_id), '')
    || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.settlement_additions x where x.settlement_id = p_id), '')
    || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.settlement_deductions x where x.settlement_id = p_id), '')
    || coalesce((select count(*)::text from public.settlement_audit_events x where x.settlement_id = p_id), '')
    || coalesce((select string_agg(to_jsonb(x)::text, '|' order by x.id) from public.driver_advance_repayments x where x.settlement_id = p_id), ''))
$$;
create function tst.ts(p_id uuid) returns text language sql security definer set search_path = public as $$
  select updated_at::text from public.settlements where id = p_id $$;
grant execute on all functions in schema tst to authenticated;

create function tst.save(p_mode text, p_id uuid, p_expected text, p_header jsonb, p_loads jsonb, p_adds jsonb, p_deds jsonb, p_audit jsonb)
returns jsonb language sql as $$
  select public.sph_web_save_settlement(jsonb_build_object('mode', p_mode, 'settlement_id', p_id,
    'expected_updated_at', p_expected, 'header', p_header, 'loads', p_loads, 'additions', p_adds,
    'deductions', p_deds, 'audit', p_audit)) $$;
create function tst.move(p_id uuid, p_from text, p_to text, p_reason text default null, p_number text default null, p_method text default null, p_ref text default null)
returns jsonb language sql as $$
  select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', p_id,
    'expected_updated_at', tst.ts(p_id), 'from', p_from, 'to', p_to, 'reason', p_reason,
    'settlement_number', p_number, 'payment_method', p_method, 'payment_reference', p_ref,
    'audit', t_audit(case p_to when 'approved' then 'approved' when 'paid' then 'marked_paid' when 'voided' then 'voided' else 'status_changed' end, p_from || ' → ' || p_to))) $$;
grant execute on all functions in schema tst to authenticated;

-- =============================================================================
--  1. Create is atomic and complete
-- =============================================================================
:asA
select tst.save('create', :S1, null, t_header('SP-2026-0101', 2266.57),
  jsonb_build_array(t_load('11111111-0000-4000-8000-000000000001', :L1, 'L1', 3237.95, 2266.57)),
  jsonb_build_array(t_add('11111111-0000-4000-8000-0000000000a1', 'bonus', 'Safety bonus', 100)),
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'equipment_charge', 'ELD subscription', 19.99, p_custom => :CAT)),
  t_audit('created', 'Settlement created'));
select tst.eq((select status from settlements where id = :S1), 'draft', 'create: status forced to draft');
select tst.eq((select created_by::text from settlements where id = :S1), 'aaaaaaaa-0000-0000-0000-000000000001', 'create: created_by = signed-in user');
select tst.eq((select count(*)::text from settlement_loads where settlement_id = :S1) || '/' || (select count(*)::text from settlement_additions where settlement_id = :S1) || '/' || (select count(*)::text from settlement_deductions where settlement_id = :S1), '1/1/1', 'create: header + lines in one call');
select tst.eq((select net_pay::text from settlements where id = :S1), '2266.57', 'create: exact cents stored');
select tst.eq((select custom_category_id::text from settlement_deductions where id = '11111111-0000-4000-8000-0000000000d1'), 'aaaaaaaa-0000-0000-0000-0000000cc001', 'custom category persisted on the line');
select tst.eq((select category from settlement_deductions where id = '11111111-0000-4000-8000-0000000000d1'), 'equipment_charge', 'custom line stores an iPhone category value');
select tst.eq((select count(*)::text from settlement_audit_events where settlement_id = :S1), '1', 'create: audit row written in the same transaction');
select tst.rejects($$select tst.save('create', '5e000000-0000-4000-8000-000000000001', null, t_header('SP-X', 0), '[]', '[]', '[]', '[]')$$, 'exists', 'create: existing id refused');

-- =============================================================================
--  2. Atomicity: any failure leaves NOTHING behind
-- =============================================================================
select tst.fp(:S1) as fp1 \gset
-- (a) invalid category on the LAST statement of the save (after header + loads were written)
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0101', 1.00),
  jsonb_build_array(t_load('11111111-0000-4000-8000-000000000001', %L, 'L1', 9999.99, 1.00)), '[]',
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d9', 'eld_fee', 'bad', 5)), t_audit('manual_adjustment', 'x'))$$,
  :S1, tst.ts(:S1), :L1), 'settlement_deductions_category_check', 'atomic: bad category rejected');
select tst.eq(tst.fp(:S1), :'fp1', 'atomic: header, lines, audit all unchanged after a failed save');
-- (b) unknown audit action (would break the iPhone audit list)
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0101', 1.00), '[]', '[]', '[]', t_audit('my_new_action', 'x'))$$, :S1, tst.ts(:S1)), 'bad_audit_action', 'atomic: non-iPhone audit action refused');
select tst.eq(tst.fp(:S1), :'fp1', 'atomic: nothing written when the audit row is invalid');
-- (c) duplicate settlement number (unique index) at header write
:asA
select tst.save('create', :S3, null, t_header('SP-2026-0103', 0), '[]', '[]', '[]', t_audit('created', 'S3'));
select tst.fp(:S3) as fp3 \gset
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('sp-2026-0101', 0), '[]', '[]', '[]', '[]')$$, :S3, tst.ts(:S3)), 'settlements_profile_number_uidx|duplicate key', 'atomic: duplicate settlement number (case-insensitive) refused');
select tst.eq(tst.fp(:S3), :'fp3', 'atomic: nothing written on duplicate number');

-- =============================================================================
--  3. Concurrent-edit guard (optimistic concurrency)
-- =============================================================================
select tst.ts(:S1) as ts1 \gset
select tst.save('update', :S1, :'ts1', t_header('SP-2026-0101', 2266.57),
  jsonb_build_array(t_load('11111111-0000-4000-8000-000000000001', :L1, 'L1', 3237.95, 2266.57)),
  jsonb_build_array(t_add('11111111-0000-4000-8000-0000000000a1', 'bonus', 'Safety bonus', 150)),
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'equipment_charge', 'ELD subscription', 19.99, p_custom => :CAT)),
  t_audit('manual_adjustment', 'Addition changed'));
select tst.eq((select amount::text from settlement_additions where id = '11111111-0000-4000-8000-0000000000a1'), '150.00', 'update: change saved');
select tst.fp(:S1) as fp1b \gset
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0101', 5), '[]', '[]', '[]', '[]')$$, :S1, :'ts1'), 'conflict', 'concurrency: stale updated_at (edit made elsewhere) refused');
select tst.rejects(format($$select tst.save('update', %L, null, t_header('SP-2026-0101', 5), '[]', '[]', '[]', '[]')$$, :S1), 'conflict', 'concurrency: missing updated_at refused');
select tst.eq(tst.fp(:S1), :'fp1b', 'concurrency: losing save wrote nothing');

-- =============================================================================
--  4. Rows are never moved between settlements / accounts
-- =============================================================================
-- S2 (draft) tries to claim S1's deduction id.
select tst.save('create', :S2, null, t_header('SP-2026-0102', 0), '[]', '[]', '[]', t_audit('created', 'S2'));
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0102', 0), '[]', '[]',
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'other', 'stolen', 1)), '[]')$$, :S2, tst.ts(:S2)), 'foreign_row', 'rows: a line id from another settlement is refused');
select tst.eq((select settlement_id::text from settlement_deductions where id = '11111111-0000-4000-8000-0000000000d1'), '5e000000-0000-4000-8000-000000000001', 'rows: the line stays on its settlement');
-- Carrier B: can't see/edit A's settlement, can't claim A's line ids.
:asB
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('X', 0), '[]', '[]', '[]', '[]')$$, :S1, '2026-01-01'), 'not_found', 'accounts: other carrier cannot save A''s settlement');
select tst.save('create', '5e000000-0000-4000-8000-0000000000b1', null, t_header('B-1', 0, 'bbbbbbbb-0000-0000-0000-00000000d001'), '[]', '[]', '[]', t_audit('created', 'B'));
select tst.rejects(format($$select tst.save('update', '5e000000-0000-4000-8000-0000000000b1', %L, t_header('B-1', 0, 'bbbbbbbb-0000-0000-0000-00000000d001'), '[]', '[]',
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'other', 'stolen', 1)), '[]')$$, tst.ts('5e000000-0000-4000-8000-0000000000b1')), 'row-level security|duplicate key|foreign_row', 'accounts: other carrier cannot claim A''s line id');
select tst.rejects($$select tst.move('5e000000-0000-4000-8000-000000000001', 'draft', 'approved')$$, 'not_found|conflict', 'accounts: other carrier cannot change A''s status');
-- Driver-portal user linked to A's driver: read-only.
:asD
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('X', 0), '[]', '[]', '[]', '[]')$$, :S1, '2026-01-01'), 'not_found|not_owner', 'driver portal: linked driver cannot save the carrier''s settlement');
:asSuper
select tst.eq(tst.fp(:S1), :'fp1b', 'accounts: A''s settlement untouched by B and the driver');

-- =============================================================================
--  5. Duplicates
-- =============================================================================
:asA
select tst.fp(:S2) as fp2 \gset
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0102', 0), '[]', '[]',
  jsonb_build_array(t_ded('22222222-0000-4000-8000-0000000000d1', 'insurance', 'Occ/Acc', 45, p_rec => %L),
                    t_ded('22222222-0000-4000-8000-0000000000d2', 'insurance', 'Occ/Acc', 45, p_rec => %L)), '[]')$$,
  :S2, tst.ts(:S2), :REC, :REC), 'settlement_deductions_unique_recurring|duplicate key', 'duplicates: same recurring rule twice on one settlement refused');
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0102', 0),
  jsonb_build_array(t_load('22222222-0000-4000-8000-000000000001', %L, 'L2', 2000, 0), t_load('22222222-0000-4000-8000-000000000002', %L, 'L2', 2000, 0)),
  '[]', '[]', '[]')$$, :S2, tst.ts(:S2), :L2, :L2), 'settlement_loads_unique_load_per_settlement|duplicate key', 'duplicates: same load twice on one settlement refused');
select tst.eq(tst.fp(:S2), :'fp2', 'duplicates: nothing written');
-- Re-adding a removed load in the same save (prune runs before upsert) works.
select tst.save('update', :S2, tst.ts(:S2), t_header('SP-2026-0102', 1400),
  jsonb_build_array(t_load('22222222-0000-4000-8000-000000000001', :L2, 'L2', 2000, 1400)), '[]', '[]', t_audit('load_added', 'L2'));
select tst.save('update', :S2, tst.ts(:S2), t_header('SP-2026-0102', 1400),
  jsonb_build_array(t_load('22222222-0000-4000-8000-000000000003', :L2, 'L2', 2000, 1400)), '[]', '[]', t_audit('manual_adjustment', 'L2 re-added'));
select tst.eq((select string_agg(id::text, ',') from settlement_loads where settlement_id = :S2), '22222222-0000-4000-8000-000000000003', 'duplicates: remove + re-add a load in one save is clean');

-- =============================================================================
--  6. Advance recovery limits
-- =============================================================================
-- S2 recovers $600 on a $500 advance → approval refused, NOTHING changes.
select tst.save('update', :S2, tst.ts(:S2), t_header('SP-2026-0102', 800),
  jsonb_build_array(t_load('22222222-0000-4000-8000-000000000003', :L2, 'L2', 2000, 1400)), '[]',
  jsonb_build_array(t_ded('22222222-0000-4000-8000-0000000000a6', 'cash_advance', 'Advance recovery', 600, p_adv => :ADV)), t_audit('deduction_added', 'adv'));
select tst.fp(:S2) as fp2b \gset
select tst.rejects(format($$select tst.move(%L, 'draft', 'approved')$$, :S2), 'advance_over_recovery|driver_advances_no_over_recovery', 'advances: over-recovery blocks approval');
select tst.eq(tst.fp(:S2), :'fp2b', 'advances: settlement unchanged after refused approval');
select tst.eq((select status || '/' || recovered_amount from driver_advances a cross join (select status from settlements where id = :S2) s where a.id = :ADV), 'draft/0.00', 'advances: balance and status untouched');
select tst.eq((select coalesce(status,'') from loads where id = :L2), 'ready_for_settlement', 'advances: load flag untouched');
-- Split 50%: recovers only the DRIVER share ($250 of $500 line).
select tst.save('update', :S2, tst.ts(:S2), t_header('SP-2026-0102', 1150),
  jsonb_build_array(t_load('22222222-0000-4000-8000-000000000003', :L2, 'L2', 2000, 1400)), '[]',
  jsonb_build_array(t_ded('22222222-0000-4000-8000-0000000000a6', 'cash_advance', 'Advance recovery', 500, 'split', 50, p_adv => :ADV)), t_audit('manual_adjustment', 'adv'));
select tst.move(:S2, 'draft', 'approved');
select tst.eq((select amount::text from driver_advance_repayments where settlement_id = :S2), '250.00', 'advances: repayment = driver share only');
select tst.eq((select recovered_amount::text || '/' || is_closed from driver_advances where id = :ADV), '250.00/false', 'advances: balance updated in the same transaction');

-- =============================================================================
--  7. Approve → loads flagged; double pay blocked atomically
-- =============================================================================
select tst.eq((select status from loads where id = :L2), 'settled', 'approve: load flagged settled');
select tst.eq((select count(*)::text from settlement_audit_events where settlement_id = :S2 and action = 'approved'), '1', 'approve: audit written with the status change');
-- S1 now also gets L2 (+ NULL-status L3); approving it must fail and leave nothing.
select tst.save('update', :S1, tst.ts(:S1), t_header('SP-2026-0101', 3316.57),
  jsonb_build_array(t_load('11111111-0000-4000-8000-000000000001', :L1, 'L1', 3237.95, 2266.57),
                    t_load('11111111-0000-4000-8000-000000000002', :L2, 'L2', 2000, 1400),
                    t_load('11111111-0000-4000-8000-000000000003', :L3, 'L3', 1500, 1050)),
  jsonb_build_array(t_add('11111111-0000-4000-8000-0000000000a1', 'bonus', 'Safety bonus', 150)),
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'equipment_charge', 'ELD subscription', 19.99, p_custom => :CAT)),
  t_audit('load_added', 'L2, L3'));
select tst.fp(:S1) as fp1c \gset
select tst.rejects(format($$select tst.move(%L, 'draft', 'approved')$$, :S1), 'already paid on another approved', 'double pay: approval refused by the database guard');
select tst.eq(tst.fp(:S1), :'fp1c', 'double pay: settlement unchanged');
select tst.eq((select coalesce(status, 'NULL') from loads where id = :L1) || '/' || (select coalesce(status, 'NULL') from loads where id = :L3), 'ready_for_settlement/NULL', 'double pay: no load flags changed');
-- Drop L2 and approve: L1 and the NULL-status L3 both get flagged.
select tst.save('update', :S1, tst.ts(:S1), t_header('SP-2026-0101', 3316.57),
  jsonb_build_array(t_load('11111111-0000-4000-8000-000000000001', :L1, 'L1', 3237.95, 2266.57),
                    t_load('11111111-0000-4000-8000-000000000003', :L3, 'L3', 1500, 1050)),
  jsonb_build_array(t_add('11111111-0000-4000-8000-0000000000a1', 'bonus', 'Safety bonus', 150)),
  jsonb_build_array(t_ded('11111111-0000-4000-8000-0000000000d1', 'equipment_charge', 'ELD subscription', 19.99, p_custom => :CAT)),
  t_audit('load_removed', 'L2'));
select tst.move(:S1, 'draft', 'approved');
select tst.eq((select status from loads where id = :L1) || '/' || (select status from loads where id = :L3), 'settled/settled', 'approve: NULL-status load flagged too');

-- =============================================================================
--  8. Paid-settlement protection + reopen rules
-- =============================================================================
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0101', 1), '[]', '[]', '[]', '[]')$$, :S1, tst.ts(:S1)), 'locked', 'lock: approved settlement cannot be edited');
select tst.move(:S1, 'approved', 'paid', null, null, 'ACH', 'TRX-778');
select tst.fp(:S1) as fp1p \gset
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0101', 1), '[]', '[]', '[]', '[]')$$, :S1, tst.ts(:S1)), 'locked', 'lock: paid settlement cannot be edited');
select tst.rejects(format($$select tst.move(%L, 'paid', 'paid', null, null, 'Cash', 'NEW')$$, :S1), 'same_status', 'lock: paid → paid refused (no overwriting payment details)');
select tst.rejects(format($$select tst.move(%L, 'paid', 'draft', 'x')$$, :S1), 'bad_transition', 'lock: paid cannot jump to draft');
select tst.rejects(format($$select tst.move(%L, 'paid', 'approved')$$, :S1), 'reason_required', 'reopen: paid → approved needs a reason');
select tst.rejects(format($$select tst.move(%L, 'paid', 'voided')$$, :S1), 'reason_required', 'void: paid → voided needs a reason');
select tst.eq(tst.fp(:S1), :'fp1p', 'lock: paid settlement unchanged by every refused attempt');
select tst.eq((select payment_method || '/' || payment_reference from settlements where id = :S1), 'ACH/TRX-778', 'paid: payment details kept');
-- Wrong expected status (stale screen) is refused.
select tst.rejects(format($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', %L, 'expected_updated_at', tst.ts(%L), 'from', 'approved', 'to', 'paid', 'audit', '[]'::jsonb))$$, :S1, :S1), 'conflict', 'reopen: a stale screen (wrong current status) is refused');
-- Reopen paid → approved with reason, then approved → draft with reason.
select tst.move(:S1, 'paid', 'approved', 'Wrong fuel amount');
select tst.eq((select coalesce(paid_at::text, 'null') || '/' || coalesce(payment_reference, 'null') from settlements where id = :S1), 'null/null', 'reopen: paid_at + reference cleared on paid → approved');
select tst.rejects(format($$select tst.move(%L, 'approved', 'draft')$$, :S1), 'reason_required', 'reopen: approved → draft needs a reason');
select tst.move(:S1, 'approved', 'draft', 'Fix fuel');
select tst.eq((select status || '/' || coalesce(approved_at::text, 'null') from settlements where id = :S1), 'draft/null', 'reopen: back to draft, approval cleared');
select tst.eq((select status from loads where id = :L1) || '/' || (select status from loads where id = :L3), 'ready_for_settlement/ready_for_settlement', 'reopen: loads released for re-payment');
select tst.eq((select count(*)::text from settlement_audit_events where settlement_id = :S1 and action in ('approved','marked_paid','status_changed')), '4', 'reopen: every status change audited');
-- Reopen S2 (has an advance repayment): repayment removed, balance restored.
select tst.move(:S2, 'approved', 'draft', 'Recount advance');
select tst.eq((select count(*)::text from driver_advance_repayments where settlement_id = :S2) || '/' || (select recovered_amount::text from driver_advances where id = :ADV), '0/0.00', 'reopen: advance repayment reversed atomically');
select tst.eq((select status from loads where id = :L2), 'ready_for_settlement', 'reopen: S2 load released');
-- Void from draft needs no reason; voided → draft needs one.
select tst.move(:S3, 'draft', 'voided');
select tst.rejects(format($$select tst.move(%L, 'voided', 'draft')$$, :S3), 'reason_required', 'void: reopening a voided settlement needs a reason');
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0103', 0), '[]', '[]', '[]', '[]')$$, :S3, tst.ts(:S3)), 'locked', 'lock: voided settlement cannot be edited');

-- =============================================================================
--  9. iPhone compatibility on web-written rows
-- =============================================================================
-- iPhone 2.3.5 save: header upsert + child upsert WITHOUT custom_category_id + prune.
select tst.ts(:S1) as tsx \gset
insert into settlement_deductions (id, settlement_id, profile_id, category, description, amount, responsibility, driver_share_percent, sort_order)
values ('11111111-0000-4000-8000-0000000000d1', :S1, 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment_charge', 'ELD subscription', 24.99, 'driver', 100, 2000)
on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount,
  responsibility = excluded.responsibility, driver_share_percent = excluded.driver_share_percent, sort_order = excluded.sort_order;
select tst.eq((select amount::text || '/' || custom_category_id::text from settlement_deductions where id = '11111111-0000-4000-8000-0000000000d1'), '24.99/aaaaaaaa-0000-0000-0000-0000000cc001', 'iPhone upsert: amount updated, custom category kept');
-- Every value the web wrote is in the iPhone's decode vocabulary.
:asSuper
select tst.eq((select count(*)::text from settlement_additions where category not in ('bonus','detention','layover','tonu','lumper_reimbursement','reimbursement','fuel_credit','maintenance_credit','safety_bonus','referral_bonus','manual_credit','other')), '0', 'iPhone decode: addition categories');
select tst.eq((select count(*)::text from settlement_deductions where category not in ('truck_lease','insurance','fuel','fuel_advance','cash_advance','maintenance','repair','escrow','maintenance_reserve','tolls','scale_tickets','permits','violation','damage','trailer_charge','equipment_charge','dispatcher_fee','factoring_fee','authority_fee','other') or responsibility not in ('driver','company','split')), '0', 'iPhone decode: deduction categories + responsibility');
select tst.eq((select count(*)::text from settlement_audit_events where action not in ('created','load_added','load_removed','pay_rate_changed','addition_added','addition_removed','deduction_added','deduction_removed','recurring_applied','advance_repayment_applied','status_changed','approved','marked_paid','reopened','voided','manual_adjustment','recalculated')), '0', 'iPhone decode: audit actions');
select tst.eq((select count(*)::text from settlements where status is not null and status not in ('draft','ready_for_review','approved','paid','voided')), '0', 'iPhone decode: statuses');
-- Deleting a custom category never touches the paid/approved line.
delete from payroll_custom_categories where id = :CAT;
select tst.eq((select amount::text || '/' || coalesce(custom_category_id::text, 'null') || '/' || category from settlement_deductions where id = '11111111-0000-4000-8000-0000000000d1'), '24.99/null/equipment_charge', 'custom category delete: line kept, pointer cleared');
-- =============================================================================
--  10. Review round 2 regressions
-- =============================================================================
:asA
select tst.save('create', '5e000000-0000-4000-8000-0000000000c1', null, jsonb_build_object('driver_id', 'aaaaaaaa-0000-0000-0000-00000000d001', 'settlement_number', 'SP-2026-0201'), '[]', '[]', '[]', t_audit('created', 'minimal'));
select tst.eq((select dispatcher_fee_percentage::text || '/' || authority_fee::text || '/' || is_estimate from settlements where id = '5e000000-0000-4000-8000-0000000000c1'), '0.00/0.00/false', 'create: column defaults apply for keys not sent');
-- (1) missing / null / unknown target status never passes a guard
select tst.move('5e000000-0000-4000-8000-0000000000c1', 'draft', 'approved');
select tst.move('5e000000-0000-4000-8000-0000000000c1', 'approved', 'paid');
select tst.fp('5e000000-0000-4000-8000-0000000000c1') as fpc \gset
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'from', 'paid', 'audit', t_audit('status_changed', 'x')))$$, 'bad_request', 'status: missing target refused');
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'from', 'paid', 'to', null, 'audit', t_audit('status_changed', 'x')))$$, 'bad_request', 'status: null target refused');
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'from', 'paid', 'to', 'pending', 'audit', t_audit('status_changed', 'x')))$$, 'bad_request', 'status: unknown target refused');
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'to', 'voided', 'reason', 'x', 'audit', t_audit('voided', 'x')))$$, 'conflict', 'status: missing current status refused');
select tst.eq(tst.fp('5e000000-0000-4000-8000-0000000000c1'), :'fpc', 'status: paid settlement untouched by malformed calls');
-- (3) audit is mandatory and must match the move
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'from', 'paid', 'to', 'voided', 'reason', 'x'))$$, 'audit_required', 'audit: status change without audit refused');
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c1', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c1'), 'from', 'paid', 'to', 'voided', 'reason', 'x', 'audit', t_audit('status_changed', 'wrong action')))$$, 'audit_required', 'audit: status change with a mismatched audit action refused');
select tst.rejects(format($$select tst.save('update', %L, %L, t_header('SP-2026-0102', 1), '[]', '[]', '[]', '[]')$$, :S2, tst.ts(:S2)), 'audit_required', 'audit: save without audit refused');
select tst.eq(tst.fp('5e000000-0000-4000-8000-0000000000c1'), :'fpc', 'audit: nothing changed by refused calls');
-- (5) a blank settlement number is not a number
select tst.save('create', '5e000000-0000-4000-8000-0000000000c2', null, jsonb_build_object('driver_id', 'aaaaaaaa-0000-0000-0000-00000000d001', 'settlement_number', '  '), '[]', '[]', '[]', t_audit('created', 'blank'));
select tst.rejects($$select tst.move('5e000000-0000-4000-8000-0000000000c2', 'draft', 'approved', null, '')$$, 'no_number', 'number: blank number can''t be approved');
select tst.move('5e000000-0000-4000-8000-0000000000c2', 'draft', 'approved', null, 'SP-2026-0202');
select tst.eq((select settlement_number from settlements where id = '5e000000-0000-4000-8000-0000000000c2'), 'SP-2026-0202', 'number: blank replaced by the assigned number on approval');
-- (4) stale-total refresh is part of the transition transaction
select tst.save('create', '5e000000-0000-4000-8000-0000000000c3', null, t_header('SP-2026-0203', 700),
  jsonb_build_array(t_load('33333333-0000-4000-8000-000000000001', :L2, 'L2', 2000, 1400)), '[]', '[]', t_audit('created', 'c3'));
select tst.move(:S2, 'draft', 'approved');  -- S2 pays L2 again (approved)
select tst.fp('5e000000-0000-4000-8000-0000000000c3') as fpr \gset
select tst.rejects($$select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', '5e000000-0000-4000-8000-0000000000c3',
  'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c3'), 'from', 'draft', 'to', 'approved', 'audit', t_audit('approved', 'a'),
  'refresh', jsonb_build_object('mode', 'update', 'settlement_id', '5e000000-0000-4000-8000-0000000000c3', 'expected_updated_at', tst.ts('5e000000-0000-4000-8000-0000000000c3'),
     'header', t_header('SP-2026-0203', 1400), 'loads', jsonb_build_array(t_load('33333333-0000-4000-8000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a0002', 'L2', 2000, 1400)),
     'additions', '[]'::jsonb, 'deductions', '[]'::jsonb, 'audit', t_audit('recalculated', 'r')))) $$, 'already paid on another approved', 'refresh: refused approval…');
select tst.eq(tst.fp('5e000000-0000-4000-8000-0000000000c3'), :'fpr', 'refresh: …rolls back the refresh too (no partial save, no audit row)');
select tst.move(:S2, 'approved', 'draft', 'test cleanup');

-- Functions are not callable anonymously.
reset role; set role anon;
select tst.rejects($$select public.sph_web_save_settlement('{}'::jsonb)$$, 'permission denied', 'grants: anon cannot call the save function');
select tst.rejects($$select public.sph_web_transition_settlement('{}'::jsonb)$$, 'permission denied', 'grants: anon cannot call the status function');
