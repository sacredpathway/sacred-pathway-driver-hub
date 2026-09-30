-- =============================================================================
--  Cross-platform tests — web paystubs vs iPhone settlements
--  (20261001120100_cross_platform_payment_integrity.sql)
--
--  The iPhone writes are reproduced statement-for-statement from Driver Hub
--  2.3.5 (SettlementCloudStore / SettlementRepository / SupabaseService):
--    save       → upsert settlements, upsert settlement_loads (on_conflict=id)
--    transition → upsert settlements with the new status (first write)
--    approve    → then markLoadsAsSettled: UPDATE loads SET status='settled' per id
--    void/reopen→ then releaseSettledLoads: UPDATE loads SET status='ready_for_settlement'
--                 WHERE id IN (...) AND status='settled'
--    legacy     → markLoadsAsUnsettled (2.3.3 re-bill): status='assigned'
--  Runs after 10_tests.sql in the same database (reuses the tst helpers).
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set A  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set DA '''aaaaaaaa-0000-0000-0000-00000000d001'''
\set DB '''bbbbbbbb-0000-0000-0000-00000000d001'''
\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set asB 'reset role; set role authenticated; set request.jwt.claim.sub = ''bbbbbbbb-0000-0000-0000-000000000001'';'
\set asAnon 'reset role; set role anon; set request.jwt.claim.sub = '''';'
\set asSuper 'reset role; set request.jwt.claim.sub = '''';'

-- --------------------------------------------------------- iPhone helpers ---
-- save(): header upsert, then line upserts. p_adjust = loads added as
-- adjustment lines (corrections of an earlier paid settlement).
create function tst.ios_save(p_loads uuid[], p_adjust uuid[] default '{}', p_estimate boolean default false,
                             p_sid uuid default null)
returns uuid language plpgsql as $$
declare v_sid uuid := coalesce(p_sid, gen_random_uuid()); v_orig uuid; v_driver uuid; i int := 0; l uuid;
begin
  select d.id into v_driver from public.drivers d where d.profile_id = auth.uid() limit 1;
  insert into public.settlements (id, profile_id, driver_id, status, engine_version, is_estimate)
  values (v_sid, auth.uid(), v_driver, 'draft', 'v1', p_estimate)
  on conflict (id) do update set driver_id = excluded.driver_id, engine_version = excluded.engine_version,
                                 is_estimate = excluded.is_estimate;
  foreach l in array coalesce(p_loads, '{}') loop
    insert into public.settlement_loads (id, settlement_id, profile_id, load_id, is_adjustment, driver_earnings)
    values (gen_random_uuid(), v_sid, auth.uid(), l, false, 100)
    on conflict (id) do update set load_id = excluded.load_id, driver_earnings = excluded.driver_earnings;
  end loop;
  if array_length(p_adjust, 1) is not null then
    insert into public.settlements (id, profile_id, driver_id, status, engine_version)
    values (gen_random_uuid(), auth.uid(), v_driver, 'draft', 'v1') returning id into v_orig;
    foreach l in array p_adjust loop
      insert into public.settlement_loads (id, settlement_id, profile_id, load_id, is_adjustment, corrects_settlement_id)
      values (gen_random_uuid(), v_sid, auth.uid(), l, true, v_orig)
      on conflict (id) do update set load_id = excluded.load_id;
    end loop;
  end if;
  return v_sid;
end $$;

-- transition(): the header upsert that carries the new status.
create function tst.ios_transition(p_sid uuid, p_status text) returns void language sql as $$
  insert into public.settlements (id, profile_id, driver_id, status, engine_version, is_estimate, approved_at, settlement_number)
  select s.id, s.profile_id, s.driver_id, p_status, s.engine_version, s.is_estimate,
         case when p_status in ('approved', 'paid') then now() end,
         coalesce(s.settlement_number, 'SET-' || substr(s.id::text, 1, 8))
    from public.settlements s where s.id = p_sid
  on conflict (id) do update set status = excluded.status, approved_at = excluded.approved_at,
                                 settlement_number = excluded.settlement_number, is_estimate = excluded.is_estimate
$$;

-- updateLoadStatuses(): the best-effort follow-up writes.
create function tst.ios_mark_settled(p_sid uuid) returns void language plpgsql as $$
declare l uuid;
begin
  for l in select load_id from public.settlement_loads where settlement_id = p_sid and not is_adjustment and load_id is not null loop
    update public.loads set status = 'settled' where id = l;
  end loop;
end $$;
create function tst.ios_release(p_sid uuid) returns void language sql as $$
  update public.loads set status = 'ready_for_settlement'
   where id in (select load_id from public.settlement_loads where settlement_id = p_sid and not is_adjustment)
     and status = 'settled'
$$;

create function tst.s_status(p_sid uuid) returns text language sql security definer set search_path = public as $$
  select status from public.settlements where id = p_sid
$$;

-- Like tst.err, and also checks the HINT carries the machine code.
create function tst.err_hint(p_sql text, p_msg text, p_hint text, p_label text) returns void language plpgsql as $$
declare v_msg text; v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    if v_msg !~ p_msg or coalesce(v_hint, '') <> p_hint then
      raise exception 'FAIL %: expected [~%] hint [%], got [%] hint [%]', p_label, p_msg, p_hint, v_msg, v_hint;
    end if;
    if v_msg ~* 'does not exist|schema cache|pgrst20[45]|42p01|42703' then
      raise exception 'FAIL %: message would be misreported by the iPhone app as a missing database update: %', p_label, v_msg;
    end if;
    raise notice 'PASS % (%)', p_label, v_msg;
    return;
  end;
  raise exception 'FAIL %: expected an error but it succeeded', p_label;
end $$;

grant execute on all functions in schema tst to anon, authenticated;

-- ====================================================================== X01 ==
:asA
select tst.new_load('ready_for_settlement', 1200, '5001') as x1a \gset
select tst.new_load('ready_for_settlement', 1300, '5002') as x1b \gset
select tst.new_draft(:DA) as wx1 \gset
select tst.attach(:'wx1', :'x1a') is not null as x \gset
select tst.ios_save(array[:'x1a', :'x1b']::uuid[]) as s1 \gset
select tst.ios_transition(:'s1', 'ready_for_review');
select tst.ios_transition(:'s1', 'approved');
select tst.eq(tst.s_status(:'s1'), 'approved', 'X01 a valid iPhone settlement approves normally');
select tst.eq(tst.status_of(:'x1a') || ',' || tst.status_of(:'x1b'), 'ready_for_settlement,ready_for_settlement',
              'X01 approval itself does not rewrite load status (iPhone flags it next, as today)');
-- iPhone flag write failed/not yet sent → the record alone still blocks web.
select tst.err(format('select public.issue_paystub(%L)', :'wx1'), '^load_on_settlement',
               'X01 iPhone-approved load cannot be issued on a web paystub (record check)');
select tst.ios_mark_settled(:'s1');
select tst.eq(tst.status_of(:'x1a') || ',' || tst.status_of(:'x1b'), 'settled,settled', 'X01 iPhone follow-up marks loads settled');
select tst.err(format('select public.issue_paystub(%L)', :'wx1'), '^load_settled',
               'X01 … and with the flag set, still refused');
select tst.eq(tst.ps_status(:'wx1'), 'draft', 'X01 web paystub left as draft');
select tst.ios_transition(:'s1', 'paid');
select tst.eq(tst.s_status(:'s1'), 'paid', 'X01 approved → paid unchanged');

-- ====================================================================== X02 ==
select tst.new_load('ready_for_settlement', 900, '5010') as x2 \gset
select tst.new_draft(:DA) as wx2 \gset
select tst.attach(:'wx2', :'x2') is not null as x \gset
select public.issue_paystub(:'wx2') ->> 'paystub_number' as wx2n \gset
select tst.ios_save(array[:'x2']::uuid[]) as s2 \gset
select tst.ok(tst.s_status(:'s2') = 'draft', 'X02 a draft iPhone settlement may still include the load (drafts never pay)');
select tst.ios_transition(:'s2', 'ready_for_review');
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'s2', 'approved'),
                    '^Load #5010 is already paid on web paystub ' || :'wx2n' || '\. This settlement was not approved',
                    'sph:load_on_issued_paystub', 'X02 web-paid load cannot be approved in an iPhone settlement');
select tst.eq(tst.s_status(:'s2') || ',' || tst.status_of(:'x2') || ',' || tst.ps_status(:'wx2'),
              'ready_for_review,settled,issued', 'X02 rollback: settlement status unchanged, load + paystub untouched');
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'s2', 'paid'),
                    'already paid on web paystub', 'sph:load_on_issued_paystub', 'X02 … nor marked paid directly');

-- ====================================================================== X03 ==
select tst.new_load('ready_for_settlement', 100, '5020') as x3a \gset
select tst.new_load('ready_for_settlement', 100, '5021') as x3b \gset
select tst.new_load('ready_for_settlement', 100, '5022') as x3c \gset
select tst.new_draft(:DA) as wx3 \gset
select tst.attach(:'wx3', :'x3b') is not null as x \gset
select public.issue_paystub(:'wx3') is not null as x \gset
select tst.ios_save(array[:'x3a', :'x3b', :'x3c']::uuid[]) as s3 \gset
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'s3', 'approved'),
                    '^Load #5021 is already paid', 'sph:load_on_issued_paystub',
                    'X03 multi-load iPhone settlement fails if one load is web-paid');
select tst.eq(tst.s_status(:'s3') || ',' || tst.status_of(:'x3a') || ',' || tst.status_of(:'x3c'),
              'draft,ready_for_settlement,ready_for_settlement', 'X03 atomic: nothing approved, other loads untouched');
-- Remove the web-paid line (iPhone save) → approval succeeds.
delete from public.settlement_loads where settlement_id = :'s3' and load_id = :'x3b';
select tst.ios_transition(:'s3', 'approved');
select tst.eq(tst.s_status(:'s3'), 'approved', 'X03 after removing the conflicting line the settlement approves');

-- ====================================================================== X04 ==
-- iPhone first → web draft attach and web issue both refused (symmetry).
select tst.new_load('ready_for_settlement', 700, '5030') as x4 \gset
select tst.new_draft(:DA) as wx4 \gset
select tst.attach(:'wx4', :'x4') is not null as x \gset
select tst.ios_save(array[:'x4']::uuid[]) as s4 \gset
select tst.ios_transition(:'s4', 'approved');
select tst.new_draft(:DA) as wx4b \gset
select tst.err(format('select tst.attach(%L, %L)', :'wx4b', :'x4'), '^load_on_settlement',
               'X04 iPhone-approved load cannot be attached to a web draft');
select tst.err(format('select public.issue_paystub(%L)', :'wx4'), '^load_on_settlement',
               'X04 iPhone-approved load cannot be issued on web');

-- ====================================================================== X05 ==
-- Estimates: never authoritative on either side (unchanged).
select tst.new_load('ready_for_settlement', 800, '5040') as x5 \gset
select tst.new_draft(:DA) as wx5 \gset
select tst.attach(:'wx5', :'x5') is not null as x \gset
select public.issue_paystub(:'wx5') is not null as x \gset
select tst.ios_save(array[:'x5']::uuid[], '{}', true) as s5 \gset
select tst.ios_transition(:'s5', 'approved');
select tst.eq(tst.s_status(:'s5'), 'approved', 'X05 estimate settlements are not blocked (not a payment)');
select tst.new_load('ready_for_settlement', 800, '5041') as x5b \gset
select tst.ios_save(array[:'x5b']::uuid[], '{}', true) as s5b \gset
select tst.ios_transition(:'s5b', 'approved');
select tst.new_draft(:DA) as wx5b \gset
select tst.attach(:'wx5b', :'x5b') is not null as x \gset
select tst.ok(public.issue_paystub(:'wx5b') is not null, 'X05 a load on an approved estimate can still be paid on web');
-- An estimate flipped to a real record IS an entry into the paid state.
select tst.err_hint(format('update public.settlements set is_estimate = false where id = %L', :'s5'),
                    'already paid on web paystub', 'sph:load_on_issued_paystub',
                    'X05 turning an approved estimate into a real settlement is checked');

-- ====================================================================== X06 ==
-- Adjustment lines: excluded exactly like the iPhone ledger.
select tst.new_load('ready_for_settlement', 600, '5050') as x6 \gset
select tst.new_load('ready_for_settlement', 600, '5051') as x6b \gset
select tst.new_draft(:DA) as wx6 \gset
select tst.attach(:'wx6', :'x6') is not null as x \gset
select public.issue_paystub(:'wx6') is not null as x \gset
select tst.ios_save(array[:'x6b']::uuid[], array[:'x6']::uuid[]) as s6 \gset
select tst.ios_transition(:'s6', 'approved');
select tst.eq(tst.s_status(:'s6'), 'approved', 'X06 an adjustment line on a web-paid load does not block approval');
select tst.new_load('ready_for_settlement', 600, '5052') as x6c \gset
select tst.ios_save('{}'::uuid[], array[:'x6c']::uuid[]) as s6c \gset
select tst.ios_transition(:'s6c', 'approved');
select tst.new_draft(:DA) as wx6c \gset
select tst.attach(:'wx6c', :'x6c') is not null as x \gset
select tst.ok(public.issue_paystub(:'wx6c') is not null, 'X06 a load only on an adjustment line can still be paid on web');

-- ====================================================================== X07 ==
select tst.new_load('ready_for_settlement', 100, '5060') as x7 \gset
select tst.new_draft(:DA) as wx7 \gset
select tst.attach(:'wx7', :'x7') is not null as x \gset
select public.issue_paystub(:'wx7') is not null as x \gset
select tst.ios_save(array[:'x7']::uuid[]) as s7 \gset
select tst.ios_transition(:'s7', 'ready_for_review');
select tst.ios_transition(:'s7', 'voided');
select tst.ios_transition(:'s7', 'draft');
select tst.eq(tst.s_status(:'s7'), 'draft', 'X07 draft / review / void / reopen-to-draft are never blocked');

-- ====================================================================== X08 ==
-- paid → approved (reopen of money already sent) is not re-checked, as in the app.
select tst.new_load('ready_for_settlement', 100, '5070') as x8 \gset
select tst.ios_save(array[:'x8']::uuid[]) as s8 \gset
select tst.ios_transition(:'s8', 'approved');
select tst.ios_transition(:'s8', 'paid');
update public.loads set status = 'cancelled' where id = :'x8';
select tst.ios_transition(:'s8', 'approved');
select tst.eq(tst.s_status(:'s8'), 'approved', 'X08 paid → approved reopen is not re-validated');

-- ====================================================================== X09 ==
select tst.new_load('ready_for_settlement', 100, '5080') as x9 \gset
select tst.ios_save(array[:'x9']::uuid[]) as s9 \gset
update public.loads set status = 'Canceled' where id = :'x9';
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'s9', 'approved'),
                    '^Load #5080 is cancelled and can''t be paid', 'sph:load_cancelled',
                    'X09 a cancelled load cannot be approved in an iPhone settlement');

-- ====================================================================== X10 ==
-- Two iPhone settlements (two devices) with the same load.
select tst.new_load('ready_for_settlement', 100, '5090') as x10 \gset
select tst.ios_save(array[:'x10']::uuid[]) as s10a \gset
select tst.ios_save(array[:'x10']::uuid[]) as s10b \gset
select tst.ios_transition(:'s10a', 'approved');
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'s10b', 'approved'),
                    'already paid on another approved or paid settlement', 'sph:load_on_settlement',
                    'X10 a second settlement cannot also approve the same load');

-- ====================================================================== X11 ==
-- Line attached to an already-approved settlement (edit that keeps approval).
select tst.new_load('ready_for_settlement', 100, '5100') as x11ok \gset
select tst.new_load('ready_for_settlement', 100, '5101') as x11web \gset
select tst.new_draft(:DA) as wx11 \gset
select tst.attach(:'wx11', :'x11web') is not null as x \gset
select public.issue_paystub(:'wx11') is not null as x \gset
select tst.ios_save('{}'::uuid[]) as s11 \gset
select tst.ios_transition(:'s11', 'approved');
select tst.ok(tst.ios_save(array[:'x11ok']::uuid[], '{}', false, :'s11') is not null,
              'X11 a clean load can be added to an approved settlement (unchanged)');
select tst.err_hint(format('select tst.ios_save(array[%L]::uuid[], %L, false, %L)', :'x11web', '{}', :'s11'),
                    'already paid on web paystub', 'sph:load_on_issued_paystub',
                    'X11 a web-paid load cannot be added to an approved settlement');
select tst.eq((select count(*)::text from public.settlement_loads where settlement_id = :'s11'), '1',
              'X11 rejected line not stored');

-- ====================================================================== X12 ==
select tst.new_load('ready_for_settlement', 100, '5110') as x12 \gset
select tst.ios_save(array[:'x12']::uuid[]) as s12 \gset
select tst.ios_transition(:'s12', 'approved');
select tst.ios_mark_settled(:'s12');
select tst.ios_transition(:'s12', 'voided');
select tst.ios_release(:'s12');
select tst.eq(tst.status_of(:'x12'), 'ready_for_settlement', 'X12 iPhone void still releases a load nothing else pays');
select tst.new_draft(:DA) as wx12 \gset
select tst.attach(:'wx12', :'x12') is not null as x \gset
select tst.ok(public.issue_paystub(:'wx12') is not null, 'X12 … and that load can then be paid on web once');

-- ====================================================================== X13 ==
-- iPhone void / reopen must not release a load a web paystub still pays.
-- (Double record constructed with the guards bypassed — the app can no
-- longer create it; production has 0 settlements, so none exist today.)
select tst.new_load('ready_for_settlement', 100, '5120') as x13 \gset
select tst.new_draft(:DA) as wx13 \gset
select tst.attach(:'wx13', :'x13') is not null as x \gset
select public.issue_paystub(:'wx13') is not null as x \gset
select tst.ios_save(array[:'x13']::uuid[]) as s13 \gset
:asSuper
alter table public.settlements disable trigger sph_settlements_guard_approval;
:asA
select tst.ios_transition(:'s13', 'approved');
:asSuper
alter table public.settlements enable trigger sph_settlements_guard_approval;
:asA
select tst.ios_transition(:'s13', 'voided');
select tst.ios_release(:'s13');
select tst.eq(tst.status_of(:'x13'), 'settled', 'X13 iPhone void does not release a load still on an issued web paystub');
select tst.ios_transition(:'s13', 'draft');
select tst.ios_release(:'s13');
select tst.eq(tst.status_of(:'x13'), 'settled', 'X13 iPhone reopen does not release it either');
update public.loads set status = 'assigned' where id = :'x13';
select tst.eq(tst.status_of(:'x13'), 'settled', 'X13 legacy re-bill (markLoadsAsUnsettled → assigned) is neutralised');
update public.loads set status = 'ready_for_settlement', origin = 'Tulsa, OK' where id = :'x13';
select tst.eq(tst.status_of(:'x13') || '|' || (select origin from public.loads where id = :'x13'), 'settled|Tulsa, OK',
              'X13 other fields in the same update still save');
select public.void_paystub(:'wx13') is not null as x \gset
select tst.eq(tst.status_of(:'x13'), 'ready_for_settlement', 'X13 once the web paystub is voided the load is released');

-- ====================================================================== X14 ==
-- Web void must not release a load an approved iPhone settlement still pays.
select tst.new_load('ready_for_settlement', 100, '5130') as x14 \gset
select tst.new_draft(:DA) as wx14 \gset
select tst.attach(:'wx14', :'x14') is not null as x \gset
select public.issue_paystub(:'wx14') is not null as x \gset
select tst.ios_save(array[:'x14']::uuid[]) as s14 \gset
:asSuper
alter table public.settlements disable trigger sph_settlements_guard_approval;
:asA
select tst.ios_transition(:'s14', 'approved');
:asSuper
alter table public.settlements enable trigger sph_settlements_guard_approval;
:asA
select public.void_paystub(:'wx14') is not null as x \gset
select tst.eq(tst.status_of(:'x14'), 'settled', 'X14 web void keeps a load an approved iPhone settlement pays');
-- A plain status write can't release it either.
update public.loads set status = 'ready_for_settlement' where id = :'x14';
select tst.eq(tst.status_of(:'x14'), 'settled', 'X14 direct status write cannot make it payable');
update public.loads set status = 'cancelled' where id = :'x14';
select tst.eq(tst.status_of(:'x14'), 'cancelled', 'X14 cancelling is still allowed (not payable)');

-- ====================================================================== X15 ==
-- Direct deletion.
select tst.new_draft(:DA) as d_issued \gset
select public.issue_paystub(:'d_issued') is not null as x \gset
select tst.err(format('delete from public.paystubs where id = %L', :'d_issued'), '^paystub_not_deletable',
               'X15 an issued web paystub cannot be deleted');
select tst.new_draft(:DA) as d_paid \gset
select public.issue_paystub(:'d_paid') is not null as x \gset
update public.paystubs set status = 'paid' where id = :'d_paid' and status = 'issued';
select tst.err(format('delete from public.paystubs where id = %L', :'d_paid'), '^paystub_not_deletable',
               'X15 a paid web paystub cannot be deleted');
select public.void_paystub(:'d_paid') is not null as x \gset
select tst.err(format('delete from public.paystubs where id = %L', :'d_paid'), '^paystub_not_deletable',
               'X15 a voided web paystub cannot be deleted');
select tst.new_draft(:DA) as d_draft \gset
select tst.new_load('ready_for_settlement') as d_load \gset
select tst.attach(:'d_draft', :'d_load') is not null as x \gset
delete from public.paystubs where id = :'d_draft';
select tst.ok(not exists (select 1 from public.paystubs where id = :'d_draft'), 'X15 a draft web paystub can still be deleted');
select tst.eq(tst.status_of(:'d_load'), 'ready_for_settlement', 'X15 … and its load is untouched');
-- Account deletion cascade still works (throwaway carrier C).
:asSuper
insert into auth.users (id) values ('cccccccc-0000-0000-0000-000000000001');
insert into public.profiles (id, company_name) values ('cccccccc-0000-0000-0000-000000000001', 'Carrier C');
insert into public.drivers (id, profile_id, name) values ('cccccccc-0000-0000-0000-00000000d001', 'cccccccc-0000-0000-0000-000000000001', 'Driver C1');
reset role; set role authenticated; set request.jwt.claim.sub = 'cccccccc-0000-0000-0000-000000000001';
select tst.new_load('ready_for_settlement') as c_load \gset
select tst.new_draft('cccccccc-0000-0000-0000-00000000d001') as c_ps \gset
select tst.attach(:'c_ps', :'c_load') is not null as x \gset
select public.issue_paystub(:'c_ps') is not null as x \gset
:asSuper
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000001';
select tst.ok(not exists (select 1 from public.paystubs where profile_id = 'cccccccc-0000-0000-0000-000000000001')
          and not exists (select 1 from public.loads where profile_id = 'cccccccc-0000-0000-0000-000000000001'),
              'X15 account deletion still cascades through issued paystubs');

-- ====================================================================== X16 ==
-- Tenant isolation.
:asA
select tst.new_load('ready_for_settlement', 100, '5140') as x16 \gset
select tst.ios_save(array[:'x16']::uuid[]) as s16 \gset
:asB
select tst.err(format('insert into public.settlements (id, profile_id, status, engine_version) values (%L, %L, %L, %L) '
                      'on conflict (id) do update set status = excluded.status', :'s16', :B, 'approved', 'v1'),
               'row-level security', 'X16 B cannot approve A''s settlement (raw upsert with A''s id)');
select tst.eq(public.sph_settlement_load_conflict(:'x16', gen_random_uuid(), :B), 'load_not_found',
              'X16 B cannot probe A''s load through the settlement check');
-- A line on B's settlement pointing at A's load (the line policy does not check the load).
select tst.ios_save('{}'::uuid[]) as sb \gset
insert into public.settlement_loads (settlement_id, profile_id, load_id) values (:'sb', :B, :'x16');
select tst.err_hint(format('select tst.ios_transition(%L, %L)', :'sb', 'approved'),
                    'isn''t in your account', 'sph:load_not_found', 'X16 B cannot approve a settlement carrying A''s load');
:asA
select tst.eq(tst.s_status(:'s16') || ',' || tst.status_of(:'x16'), 'draft,ready_for_settlement',
              'X16 A''s settlement and load untouched');
:asAnon
select tst.err(format('select public.sph_settlement_load_conflict(%L, %L, %L)', :'x16', :'s16', :A),
               'permission denied', 'X16 anon cannot execute the settlement check');
:asSuper
select tst.ok(not has_function_privilege('anon', 'public.sph_settlement_load_conflict(uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.sph_raise_settlement_conflict(text, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_settlements_guard_approval()', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_settlement_loads_guard()', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_loads_keep_paid_settled()', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_paystubs_guard_delete()', 'execute'),
              'X16 privileges: anon none; trigger functions not callable');
select tst.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.prosecdef
                             and p.proname in ('sph_settlement_load_conflict','sph_raise_settlement_conflict',
                                               'sph_settlements_guard_approval','sph_settlement_loads_guard',
                                               'sph_loads_keep_paid_settled','sph_paystubs_guard_delete'))
          and (select bool_and(p.proconfig @> array['search_path=public, pg_temp'])
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('sph_settlement_load_conflict','sph_raise_settlement_conflict',
                                    'sph_settlements_guard_approval','sph_settlement_loads_guard',
                                    'sph_loads_keep_paid_settled','sph_paystubs_guard_delete')),
              'X16 no SECURITY DEFINER added; search_path pinned');
select tst.ok(not exists (
                 (select schemaname, tablename, policyname, permissive, cmd, roles::text, qual, with_check
                    from pg_policies where schemaname = 'public' except select * from public.fixture_policies)
                 union all
                 (select * from public.fixture_policies
                  except select schemaname, tablename, policyname, permissive, cmd, roles::text, qual, with_check
                    from pg_policies where schemaname = 'public')),
              'X16 RLS policies identical before/after both migrations');

-- ====================================================================== X17 ==
-- New Load / Edit Load unchanged; the keep-settled guard only watches status.
:asA
select tst.new_load('ready_for_settlement') as x17 \gset
select tst.eq(tst.status_of(:'x17'), 'ready_for_settlement', 'X17 New Load still saves ready_for_settlement');
update public.loads set destination = 'Amarillo, TX' where id = :'x17';
select tst.eq(tst.status_of(:'x17'), 'ready_for_settlement', 'X17 Edit Load (no status in payload) never changes status');
update public.loads set destination = 'Amarillo, TX' where id = 'aaaaaaaa-0000-0000-0000-0000000e0001';
select tst.eq(tst.status_of('aaaaaaaa-0000-0000-0000-0000000e0001'), 'settled', 'X17 editing a legacy settled load keeps it settled');
update public.loads set status = 'ready_for_settlement' where id = 'aaaaaaaa-0000-0000-0000-0000000e0001';
select tst.eq(tst.status_of('aaaaaaaa-0000-0000-0000-0000000e0001'), 'ready_for_settlement',
              'X17 a legacy-settled load with no payment record can still be released (unchanged behavior)');

:asSuper
select tst.ok(true, 'ALL CROSS-PLATFORM TESTS PASSED');
