\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- =============================================================================
--  Smart Payroll Upload — the app's REAL draft-create JSON against the REAL
--  save function. generated/spu_create_payload.json is captured from the real
--  confirmPayrollDraftAction -> createSettlementAction path by
--  web-app/lib/payrollUpload/writePath.test.ts.
--  Everything runs in ONE transaction that is rolled back at the end, so the
--  script can run before and after the proposed migration.
-- =============================================================================
\set payload `cat generated/spu_create_payload.json`
begin;
reset role;
-- The synthetic load + document the payload refers to (carrier A).
insert into public.loads (id, profile_id, driver_id, load_number, pickup_date, delivery_date, total_revenue, line_haul_rate, status)
values ('aaaaaaaa-0000-0000-0000-0000000a3001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
        'SYN-30001', '2026-10-13', '2026-10-14', 1850.00, 1850.00, 'ready_for_settlement');
insert into public.documents (id, profile_id, document_type, storage_path, status, extraction_version, review_status, content_sha256)
values ('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation',
        'aaaaaaaa-0000-0000-0000-000000000001/dddddddd-0000-4000-8000-0000000000c1.pdf', 'processed', 'v3', 'needs_review', repeat('c1', 32));
create temp table spu_ctx (k text primary key, v text) on commit drop;
grant all on spu_ctx to authenticated;
insert into spu_ctx values ('sid', (:'payload'::jsonb)->>'settlement_id'), ('payload', :'payload');

-- 1. Carrier A saves the draft exactly as the app would.
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.sph_web_save_settlement((select v from spu_ctx where k = 'payload')::jsonb) is not null;
reset role;
do $$
declare s public.settlements%rowtype; sid uuid := (select v::uuid from spu_ctx where k = 'sid');
begin
  select * into s from public.settlements where id = sid;
  if not found then raise exception 'FAIL write: draft not created'; end if;
  if s.status <> 'draft' or s.approved_at is not null or s.paid_at is not null or s.voided_at is not null then
    raise exception 'FAIL write: not a plain draft (% / % / %)', s.status, s.approved_at, s.paid_at;
  end if;
  if s.net_pay <> 1295.00 or s.gross_load_revenue <> 1850.00 then raise exception 'FAIL write: totals % / %', s.net_pay, s.gross_load_revenue; end if;
  if (select count(*) from public.settlement_loads where settlement_id = sid) <> 1
     or (select load_id from public.settlement_loads where settlement_id = sid) <> 'aaaaaaaa-0000-0000-0000-0000000a3001'
     or (select driver_earnings from public.settlement_loads where settlement_id = sid) <> 1295.00 then
    raise exception 'FAIL write: load line';
  end if;
  if (select status from public.loads where id = 'aaaaaaaa-0000-0000-0000-0000000a3001') <> 'ready_for_settlement' then
    raise exception 'FAIL write: a DRAFT must not settle the load';
  end if;
  if (select string_agg(action, ',' order by timestamp) from public.settlement_audit_events where settlement_id = sid) <> 'created,load_added' then
    raise exception 'FAIL write: audit %', (select string_agg(action, ',' order by timestamp) from public.settlement_audit_events where settlement_id = sid);
  end if;
  if exists (select 1 from public.driver_advance_repayments where settlement_id = sid) then raise exception 'FAIL write: repayments on a draft'; end if;
  raise notice 'PASS write: the app''s real create JSON makes one DRAFT (net 1295.00 = 70%% of 1850.00), load stays payable-unsettled, audit created+load_added, nothing approved/paid';
end $$;

-- 2. The same create again is refused (no duplicate draft from a double click).
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  perform public.sph_web_save_settlement((select v from spu_ctx where k = 'payload')::jsonb);
  raise exception 'FAIL write: second create accepted';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'PASS write: re-sending the same create is refused (%)', sqlerrm;
end $$;
reset role;

-- 3. Carrier B can neither replay the payload nor see / link A's draft or document.
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  begin
    perform public.sph_web_save_settlement((select v from spu_ctx where k = 'payload')::jsonb);
    raise exception 'FAIL isolation: B replayed A''s draft';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.settlements where id = (select v::uuid from spu_ctx where k = 'sid');
  if n <> 0 then raise exception 'FAIL isolation: B sees A''s draft'; end if;
  update public.documents set settlement_id = (select v::uuid from spu_ctx where k = 'sid') where id = 'dddddddd-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL isolation: B linked A''s document'; end if;
  raise notice 'PASS isolation: carrier B cannot replay, see, or link carrier A''s draft/document';
end $$;
reset role;

-- 4. The document link is one-time (recordConfirmationVia's conditional update).
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare n int; sid uuid := (select v::uuid from spu_ctx where k = 'sid');
begin
  update public.documents set settlement_id = sid, review_status = 'approved', reviewed_at = now(),
         routing = jsonb_build_object('payroll', jsonb_build_object('settlement_id', sid))
   where id = 'dddddddd-0000-4000-8000-0000000000c1' and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001' and settlement_id is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL link: first link affected % rows', n; end if;
  update public.documents set settlement_id = sid
   where id = 'dddddddd-0000-4000-8000-0000000000c1' and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001' and settlement_id is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL link: second link affected % rows', n; end if;
  raise notice 'PASS link: document links to its draft once; a second confirm finds it already linked';
end $$;
reset role;

-- 5. The draft is still an ordinary draft: the existing approval guards apply
--    unchanged (approving would go through sph_web_transition_settlement,
--    which Smart Payroll Upload never calls).
do $$
begin
  if (select status from public.settlements where id = (select v::uuid from spu_ctx where k = 'sid')) <> 'draft' then
    raise exception 'FAIL: draft changed';
  end if;
  raise notice 'PASS: settlement remains a draft; approval / payment stay with the existing settlement screen';
end $$;
rollback;
