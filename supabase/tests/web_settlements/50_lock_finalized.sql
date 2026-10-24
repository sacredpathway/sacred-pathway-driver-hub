-- =============================================================================
--  Draft lock for finalized settlements
--  (REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql).
--  Runs LAST: applied (twice) on top of everything above, then checks that
--  every write path refuses to change an approved/paid/voided settlement,
--  that the reopen → edit → approve workflow still works through the atomic
--  functions, and that FK clean-ups and cascades are not blocked.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set K '''5e000000-0000-4000-8000-00000000f0c1'''
\set KL '''aaaaaaaa-0000-0000-0000-0000000a00c1'''
\set KCAT '''aaaaaaaa-0000-0000-0000-0000000cc0c1'''
\set KDOC '''aaaaaaaa-0000-0000-0000-0000000d0cc1'''

reset role;
insert into public.loads (id, profile_id, driver_id, load_number, delivery_date, total_revenue, status)
values (:KL, 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'K-1', '2026-10-14', 1000, 'ready_for_settlement');
insert into public.payroll_custom_categories (id, profile_id, kind, name, base_category)
values (:KCAT, 'aaaaaaaa-0000-0000-0000-000000000001', 'deduction', 'Lock test category', 'other');
insert into public.documents (id, profile_id, document_type) values (:KDOC, 'aaaaaaaa-0000-0000-0000-000000000001', 'receipt');

-- A settlement that is approved BEFORE the lock exists (like production rows).
:asA
select tst.save('create', :K, null, t_header('LOCK-0001', 700),
  jsonb_build_array(t_load('f0c10000-0000-4000-8000-0000000000a1', :KL, 'K-1', 1000, 700)),
  jsonb_build_array(t_add('f0c10000-0000-4000-8000-0000000000b1', 'bonus', 'Bonus', 10)),
  jsonb_build_array(t_ded('f0c10000-0000-4000-8000-0000000000d1', 'other', 'Lock test category', 10, p_custom => :KCAT)),
  t_audit('created', 'c')) is not null;
reset role;
update public.settlement_additions set document_id = :KDOC where id = 'f0c10000-0000-4000-8000-0000000000b1';
:asA
select tst.move(:K, 'draft', 'approved') is not null;

reset role;
set client_min_messages = warning;
\i ../../migrations/REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql
\i ../../migrations/REVIEW_BEFORE_APPLYING_20261024120000_lock_finalized_settlements.sql
reset client_min_messages;
create temp table lock_fp as select tst.fp(:K) as fp;
grant select on lock_fp to authenticated;

-- ---------------------------------------------------- every write refused ---
:asA
select tst.rejects($$update public.settlements set net_pay = 999 where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: a direct header edit of an approved settlement is refused (iPhone ≤ 2.3.6 path)');
select tst.rejects($$update public.settlements set status = 'draft', approved_at = null, net_pay = 999 where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: "edit and drop to draft" in one write (iPhone 2.3.6 behaviour) is refused');
select tst.rejects($$update public.settlements set settlement_number = 'LOCK-9999' where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: the number of an approved settlement can''t be changed');
select tst.rejects($$insert into public.settlement_additions (id, settlement_id, profile_id, category, description, amount)
  values (gen_random_uuid(), '5e000000-0000-4000-8000-00000000f0c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'bonus', 'Sneaky', 500)$$, 'locked',
  'lock: a line can''t be added to an approved settlement');
select tst.rejects($$update public.settlement_loads set driver_earnings = 999 where id = 'f0c10000-0000-4000-8000-0000000000a1'$$, 'locked',
  'lock: a load line of an approved settlement can''t be changed');
select tst.rejects($$delete from public.settlement_deductions where id = 'f0c10000-0000-4000-8000-0000000000d1'$$, 'locked',
  'lock: a deduction can''t be removed from an approved settlement');
select tst.rejects($$update public.settlement_deductions set settlement_id = '5e000000-0000-4000-8000-000000000001' where id = 'f0c10000-0000-4000-8000-0000000000d1'$$, 'locked',
  'lock: a line can''t be moved off an approved settlement');
select tst.rejects($$select tst.save('update', '5e000000-0000-4000-8000-00000000f0c1', tst.ts('5e000000-0000-4000-8000-00000000f0c1'), t_header('LOCK-0001', 1), '[]', '[]', '[]', t_audit('manual_adjustment', 'x'))$$, 'locked',
  'lock: the atomic save still refuses it');
select tst.rejects($$update public.settlements set status = 'draft', approved_at = null, approved_by = null where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: a status-only reopen outside the audited transition is refused (no reason, no audit, repayments kept)');
select tst.rejects($$update public.settlements set status = 'paid', paid_at = now() where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: marking paid outside the audited transition is refused');
select tst.rejects($$update public.settlement_loads set load_id = null where id = 'f0c10000-0000-4000-8000-0000000000a1'$$, 'locked',
  'lock: a direct write can''t null a paid line''s load_id (would bypass the double-pay guard)');
select tst.rejects($$update public.settlement_deductions set custom_category_id = null where id = 'f0c10000-0000-4000-8000-0000000000d1'$$, 'locked',
  'lock: a direct write can''t null other pointers on a finalized line either');
select tst.rejects($$update public.settlements set driver_id = null where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: a direct write can''t null header pointers');
select tst.eq(tst.fp(:K), (select fp from lock_fp), 'lock: after all refusals the settlement is byte-for-byte unchanged');

-- ------------------------------------- the real workflow still works -------
select tst.move(:K, 'approved', 'paid', p_ref => 'ACH-LOCK-1') is not null;
select tst.eq((select status || '|' || payment_reference from public.settlements where id = :K), 'paid|ACH-LOCK-1', 'lock: approve → paid works');
select tst.rejects($$select tst.move('5e000000-0000-4000-8000-00000000f0c1', 'paid', 'approved')$$, 'reason',
  'lock: paid → approved without a reason is refused');
select public.sph_web_transition_settlement(jsonb_build_object('settlement_id', :K, 'expected_updated_at', tst.ts(:K),
  'from', 'paid', 'to', 'approved', 'reason', 'Payment bounced',
  'audit', jsonb_build_array(jsonb_build_object('action', 'reopened', 'summary', 'Reopened from Paid · Payment bounced'),
                             jsonb_build_object('action', 'approved', 'summary', 'Paid → Approved')))) is not null;
select tst.eq((select status || '|' || coalesce(payment_reference, '∅') from public.settlements where id = :K), 'approved|∅', 'lock: paid → approved (reopen with reason) works');
select tst.move(:K, 'approved', 'draft', 'Missed detention') is not null;
select tst.eq((select status from public.settlements where id = :K), 'draft', 'lock: approved → draft (reopen with reason) works');
select tst.save('update', :K, tst.ts(:K), t_header('LOCK-0001', 775),
  jsonb_build_array(t_load('f0c10000-0000-4000-8000-0000000000a1', :KL, 'K-1', 1000, 700)),
  jsonb_build_array(t_add('f0c10000-0000-4000-8000-0000000000b1', 'bonus', 'Bonus', 10), t_add('f0c10000-0000-4000-8000-0000000000b2', 'detention', 'Detention', 75)),
  jsonb_build_array(t_ded('f0c10000-0000-4000-8000-0000000000d1', 'other', 'Lock test category', 10, p_custom => :KCAT)),
  t_audit('addition_added', 'Detention')) is not null;
select tst.move(:K, 'draft', 'approved') is not null;
select tst.eq((select status || '|' || net_pay::text from public.settlements where id = :K), 'approved|775.00', 'lock: edit the reopened draft, approve again → new figures locked in');
select tst.eq((select document_id::text from public.settlement_additions where id = 'f0c10000-0000-4000-8000-0000000000b1'), 'aaaaaaaa-0000-0000-0000-0000000d0cc1', 'lock: document link kept through reopen/edit/approve');

-- -------------------------------- FK clean-ups and cascades still work -----
reset role;
delete from public.payroll_custom_categories where id = :KCAT;
select tst.eq((select coalesce(custom_category_id::text, 'null') from public.settlement_deductions where id = 'f0c10000-0000-4000-8000-0000000000d1'), 'null',
  'lock: deleting a custom category used on an approved settlement still works (pointer set null)');
delete from public.documents where id = :KDOC;
select tst.eq((select coalesce(document_id::text, 'null') from public.settlement_additions where id = 'f0c10000-0000-4000-8000-0000000000b1'), 'null',
  'lock: deleting a linked document still works (link set null)');
select tst.ok((select status from public.settlements where id = :K) = 'approved' and (select net_pay from public.settlements where id = :K) = 775,
  'lock: FK clean-ups changed nothing else');
begin;
set local sph.allow_finalized_edit = 'on';
update public.settlements set notes = 'maintenance' where id = :K;
select tst.eq((select notes from public.settlements where id = :K), 'maintenance', 'lock: a maintenance session can bypass it on purpose (set local sph.allow_finalized_edit)');
rollback;
select tst.rejects($$update public.settlements set notes = 'x' where id = '5e000000-0000-4000-8000-00000000f0c1'$$, 'locked',
  'lock: the bypass ends with its transaction');
begin;
delete from public.settlements where id = :K;
select tst.ok(not exists (select 1 from public.settlement_loads where settlement_id = :K), 'lock: deleting a whole settlement still cascades to its lines');
rollback;
-- Drafts are not affected.
:asA
select tst.save('create', '5e000000-0000-4000-8000-00000000f0c2', null, t_header('LOCK-0002', 0), '[]', '[]', '[]', t_audit('created', 'c')) is not null;
update public.settlements set notes = 'draft note' where id = '5e000000-0000-4000-8000-00000000f0c2';
select tst.eq((select notes from public.settlements where id = '5e000000-0000-4000-8000-00000000f0c2'), 'draft note', 'lock: drafts stay editable on every path');
reset role;
