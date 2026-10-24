\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- Executes the EXACT payloads iPhone 2.3.7 builds (generated/ios_*.json,
-- written by SettlementWorkflowTests.testAtomicPayloadsMatchTheDatabaseContract
-- in the iPhone repo with SPH_IOS_CONTRACT_DIR set) against the real atomic
-- functions, as carrier A: create → millisecond-precision version → web-style
-- save keeps iPhone document links → approve → locked → reopen.
\set save `cat generated/ios_save_payload.json`
\set approve `cat generated/ios_approve_payload.json`
\set reopen `cat generated/ios_reopen_payload.json`
\set expected `cat generated/ios_expected.json`

reset role;
insert into public.loads (id, profile_id, driver_id, load_number, delivery_date, total_revenue, line_haul_rate, status)
values ('aaaaaaaa-0000-0000-0000-0000000a0017', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
        'TEST-17', '2026-09-09', 2345.67, 2345.67, 'ready_for_settlement');
insert into public.documents (id, profile_id, document_type, status)
values ('aaaaaaaa-0000-0000-0000-0000000d0c17', 'aaaaaaaa-0000-0000-0000-000000000001', 'receipt', 'processed');
insert into public.driver_advances (id, profile_id, driver_id, type, date, amount, description)
values ('aaaaaaaa-0000-0000-0000-0000000ad017', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
        'cash', '2026-09-01', 1000, 'Test Cash advance 17');
insert into public.payroll_custom_categories (id, profile_id, kind, name, base_category, default_responsibility)
values ('aaaaaaaa-0000-0000-0000-0000000cc017', 'aaaaaaaa-0000-0000-0000-000000000001', 'deduction', 'ELD (iPhone contract)', 'equipment_charge', 'driver');
create temp table ios_ctx as select (:'save'::jsonb ->> 'settlement_id')::uuid as sid, :'expected'::jsonb as expected;
grant select on ios_ctx to authenticated;

-- 1. Create exactly as the iPhone sends it.
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.sph_web_save_settlement(:'save'::jsonb) is not null as ios_created \gset
reset role;
do $$
declare s public.settlements%rowtype; c ios_ctx%rowtype; want numeric;
begin
  select * into c from ios_ctx;
  select * into s from public.settlements where id = c.sid;
  want := replace(replace(c.expected->>'net_pay', '$', ''), ',', '')::numeric;
  if s.id is null or s.status <> 'draft' or s.profile_id <> 'aaaaaaaa-0000-0000-0000-000000000001' then
    raise exception 'FAIL ios payload: create header %', row_to_json(s);
  end if;
  if s.net_pay <> want or s.settlement_number <> 'IOS-2026-0017' or s.pay_rule is null then
    raise exception 'FAIL ios payload: stored net % (iPhone computed %), number %', s.net_pay, want, s.settlement_number;
  end if;
  if (select count(*) from public.settlement_loads where settlement_id = c.sid) <> (c.expected->'lines'->>'loads')::int
     or (select count(*) from public.settlement_additions where settlement_id = c.sid) <> (c.expected->'lines'->>'additions')::int
     or (select count(*) from public.settlement_deductions where settlement_id = c.sid) <> (c.expected->'lines'->>'deductions')::int then
    raise exception 'FAIL ios payload: line counts';
  end if;
  if (select custom_category_id from public.settlement_deductions where settlement_id = c.sid and category = 'equipment_charge')
       is distinct from 'aaaaaaaa-0000-0000-0000-0000000cc017' then
    raise exception 'FAIL ios payload: custom category pointer not stored';
  end if;
  if (select document_id from public.settlement_additions where settlement_id = c.sid)
       is distinct from 'aaaaaaaa-0000-0000-0000-0000000d0c17' then
    raise exception 'FAIL ios payload: addition document link not stored on insert';
  end if;
  if (select count(*) from public.settlement_audit_events where settlement_id = c.sid) <> 3
     or exists (select 1 from public.settlement_audit_events where settlement_id = c.sid and actor_user_id <> 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAIL ios payload: audit rows / actor';
  end if;
  raise notice 'PASS ios payload: the iPhone''s real create JSON is stored exactly (net %, custom category, document link, 3 audit rows)', s.net_pay;
end $$;

-- 2. Version at millisecond precision (what a Swift Date round-trips).
select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v_ms,
       to_char((updated_at + interval '5 milliseconds') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v_off
  from public.settlements where id = (select sid from ios_ctx) \gset
select set_config('ios.save', :'save', false) as c1, set_config('ios.approve', :'approve', false) as c2,
       set_config('ios.reopen', :'reopen', false) as c3, set_config('ios.v_ms', :'v_ms', false) as c4,
       set_config('ios.v_off', :'v_off', false) as c5 \gset
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  perform public.sph_web_save_settlement(jsonb_set(jsonb_set(current_setting('ios.save')::jsonb, '{mode}', '"update"'),
                                                   '{expected_updated_at}', to_jsonb(current_setting('ios.v_off'))));
  raise exception 'FAIL ios version: a version 5 ms off was accepted';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%changed somewhere else%' then raise exception 'FAIL ios version: wrong refusal %', sqlerrm; end if;
  raise notice 'PASS ios version: a version 5 ms off is refused as an edit conflict (nothing written)';
end $$;

-- A web-style save (no document_id keys, as the web editor sends) at the
-- millisecond version is accepted and keeps the iPhone's document link.
do $$
declare p jsonb := jsonb_set(jsonb_set(current_setting('ios.save')::jsonb, '{mode}', '"update"'),
                             '{expected_updated_at}', to_jsonb(current_setting('ios.v_ms')));
begin
  p := jsonb_set(p, '{additions}', (select jsonb_agg(a - 'document_id') from jsonb_array_elements(p->'additions') a));
  p := jsonb_set(p, '{audit}', '[{"action":"manual_adjustment","summary":"Settlement details edited","actor_name":"web"}]');
  perform public.sph_web_save_settlement(p);
  if (select document_id from public.settlement_additions where settlement_id = (select sid from ios_ctx))
       is distinct from 'aaaaaaaa-0000-0000-0000-0000000d0c17' then
    raise exception 'FAIL ios links: a save without document_id cleared the iPhone document link';
  end if;
  raise notice 'PASS ios version: the millisecond version the iPhone sends is accepted; a save without document keys keeps the link';
end $$;

-- 3. Approve exactly as the iPhone sends it (version = current, ms precision).
reset role;
select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v_ms
  from public.settlements where id = (select sid from ios_ctx) \gset
select set_config('ios.v_ms', :'v_ms', false) as c4 \gset
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  perform public.sph_web_transition_settlement(jsonb_set(current_setting('ios.approve')::jsonb,
                                               '{expected_updated_at}', to_jsonb(current_setting('ios.v_ms'))));
end $$;
reset role;
do $$
declare c ios_ctx%rowtype; s public.settlements%rowtype; want numeric;
begin
  select * into c from ios_ctx;
  select * into s from public.settlements where id = c.sid;
  want := replace(replace(c.expected->>'repayment', '$', ''), ',', '')::numeric;
  if s.status <> 'approved' or s.approved_at is null then raise exception 'FAIL ios approve: status %', s.status; end if;
  if (select sum(amount) from public.driver_advance_repayments where settlement_id = c.sid) is distinct from want
     or (select recovered_amount from public.driver_advances where id = 'aaaaaaaa-0000-0000-0000-0000000ad017') <> want then
    raise exception 'FAIL ios approve: repayment (iPhone computed %)', want;
  end if;
  if (select status from public.loads where id = 'aaaaaaaa-0000-0000-0000-0000000a0017') <> 'settled' then
    raise exception 'FAIL ios approve: load not flagged settled';
  end if;
  if (select count(*) from public.settlement_audit_events where settlement_id = c.sid and action = 'approved') <> 1 then
    raise exception 'FAIL ios approve: audit';
  end if;
  raise notice 'PASS ios approve: the iPhone''s approve JSON approves in one step (repayment % = iPhone''s figure, advance balance, load settled, audit)', want;
end $$;

-- 4. Finalized lock: the iPhone's save payload is refused once approved.
select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v_ms
  from public.settlements where id = (select sid from ios_ctx) \gset
select set_config('ios.v_ms', :'v_ms', false) as c4 \gset
set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  perform public.sph_web_save_settlement(jsonb_set(jsonb_set(current_setting('ios.save')::jsonb, '{mode}', '"update"'),
                                                   '{expected_updated_at}', to_jsonb(current_setting('ios.v_ms'))));
  raise exception 'FAIL ios lock: an approved settlement was edited';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%locked%' then raise exception 'FAIL ios lock: wrong refusal %', sqlerrm; end if;
  raise notice 'PASS ios lock: an approved settlement refuses the iPhone save (reopen first)';
end $$;

-- 5. Reopen: no reason → refused; with the iPhone's reason → draft, balances
--    and load released, status_changed audit row with the reason.
do $$
begin
  perform public.sph_web_transition_settlement(jsonb_set(jsonb_set(current_setting('ios.reopen')::jsonb,
                                               '{expected_updated_at}', to_jsonb(current_setting('ios.v_ms'))), '{reason}', 'null'));
  raise exception 'FAIL ios reopen: reopened without a reason';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%reason%' then raise exception 'FAIL ios reopen: wrong refusal %', sqlerrm; end if;
end $$;
do $$
begin
  perform public.sph_web_transition_settlement(jsonb_set(current_setting('ios.reopen')::jsonb,
                                               '{expected_updated_at}', to_jsonb(current_setting('ios.v_ms'))));
end $$;
reset role;
do $$
declare c ios_ctx%rowtype; s public.settlements%rowtype;
begin
  select * into c from ios_ctx;
  select * into s from public.settlements where id = c.sid;
  if s.status <> 'draft' or s.approved_at is not null then raise exception 'FAIL ios reopen: status %', s.status; end if;
  if exists (select 1 from public.driver_advance_repayments where settlement_id = c.sid)
     or (select recovered_amount from public.driver_advances where id = 'aaaaaaaa-0000-0000-0000-0000000ad017') <> 0 then
    raise exception 'FAIL ios reopen: advance not released';
  end if;
  if (select status from public.loads where id = 'aaaaaaaa-0000-0000-0000-0000000a0017') <> 'ready_for_settlement' then
    raise exception 'FAIL ios reopen: load not released';
  end if;
  if not exists (select 1 from public.settlement_audit_events where settlement_id = c.sid and action = 'status_changed'
                  and previous_value = 'approved' and new_value = 'draft' and summary like '%Missed detention%') then
    raise exception 'FAIL ios reopen: audit row';
  end if;
  raise notice 'PASS ios reopen: approved → draft needs a reason; with the iPhone''s reason it reopens, releases the advance and load, and audits it';
end $$;
