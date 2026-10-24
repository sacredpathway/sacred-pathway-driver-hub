\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- =============================================================================
--  Smart Payroll Upload — Phase 3 confirmation claims (single session).
--  Requires the proposed migration. Everything runs in ONE transaction that is
--  rolled back. Uses the app's REAL create JSON (generated/spu_create_payload
--  .json) against the REAL sph_web_save_settlement for the main path.
-- =============================================================================
\set payload `cat generated/spu_create_payload.json`
begin;
reset role;

-- ---- fixture (carrier A = aaaaaaaa…0001, carrier B = bbbbbbbb…0001) ---------
insert into public.loads (id, profile_id, driver_id, load_number, pickup_date, delivery_date, total_revenue, line_haul_rate, status) values
  ('aaaaaaaa-0000-0000-0000-0000000a3001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30001', '2026-10-13', '2026-10-14', 1850, 1850, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a3002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30002', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a3003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30003', '2026-10-13', '2026-10-14', 900, 900, 'cancelled'),
  ('aaaaaaaa-0000-0000-0000-0000000a3004', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30004', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a3005', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30005', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a3006', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30006', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a3007', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'SYN-30007', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement'),
  ('bbbbbbbb-0000-0000-0000-0000000b3001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000d001', 'SYN-B3001', '2026-10-13', '2026-10-14', 900, 900, 'ready_for_settlement');
insert into public.documents (id, profile_id, document_type, storage_path, status, extraction_version, review_status, content_sha256, duplicate_of) values
  ('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c1.pdf', 'processed', 'v3', 'needs_review', repeat('c1', 32), null),
  ('dddddddd-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c2.pdf', 'processed', 'v3', 'needs_review', repeat('c2', 32), null),
  ('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c3.pdf', 'processed', 'v3', 'needs_review', repeat('c3', 32), null),
  ('dddddddd-0000-4000-8000-0000000000c4', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c4.pdf', 'processed', 'v3', 'dismissed',    repeat('c4', 32), null),
  ('dddddddd-0000-4000-8000-0000000000c5', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c5.pdf', 'processed', 'v3', 'needs_review', null, 'dddddddd-0000-4000-8000-0000000000c2'),
  ('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c6.pdf', 'processed', 'v3', 'needs_review', repeat('c6', 32), null),
  ('dddddddd-0000-4000-8000-0000000000c7', 'aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'a/c7.pdf', 'processed', 'v3', 'needs_review', repeat('c7', 32), null),
  ('dddddddd-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'rate_confirmation', 'b/b1.pdf', 'processed', 'v3', 'needs_review', repeat('b1', 32), null);
-- Finalized + open settlements for carrier A, one draft for carrier B.
insert into public.settlements (id, profile_id, driver_id, status, settlement_period_start, settlement_period_end) values
  ('5e000000-0000-4000-8000-0000000a0d01', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'draft', '2026-10-12', '2026-10-18'),
  ('5e000000-0000-4000-8000-0000000b0d01', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000d001', 'draft', '2026-10-12', '2026-10-18');
insert into public.settlements (id, profile_id, driver_id, status, settlement_period_start, settlement_period_end, approved_at, paid_at) values
  ('5e000000-0000-4000-8000-0000000a0f01', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'paid', '2026-10-05', '2026-10-11', now(), now());
insert into public.settlement_loads (settlement_id, profile_id, load_id, load_number) values
  ('5e000000-0000-4000-8000-0000000a0f01', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a3004', 'SYN-30004');

create temp table t (k text primary key, v text) on commit drop;
grant all on t to authenticated;
insert into t values ('payload', :'payload'), ('sid', (:'payload'::jsonb)->>'settlement_id');

-- expect(sql, code): sql must fail with hint sph:<code> (or the message, for
-- built-in errors). Returns nothing; raises FAIL otherwise.
create function pg_temp.expect_fail(p_sql text, p_code text) returns void language plpgsql as $f$
declare v_hint text; v_msg text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
    if coalesce(v_hint, '') = 'sph:' || p_code or v_msg like '%' || p_code || '%' then return; end if;
    raise exception 'FAIL expected % from [%], got % / %', p_code, p_sql, v_hint, v_msg;
  end;
  raise exception 'FAIL expected % from [%], but it succeeded', p_code, p_sql;
end $f$;
create function pg_temp.claim(p_doc text, p_load text, p_plan text default 'create', p_target text default null, p_ttl int default 120)
returns jsonb language sql as $f$
  select public.sph_payroll_claim(jsonb_build_object('document_id', p_doc, 'load_id', p_load, 'plan', p_plan,
    'target_settlement_id', p_target, 'ttl_seconds', p_ttl,
    'confirmation', jsonb_build_object('corrections', '[]'::jsonb, 'acknowledged', jsonb_build_array('driver:unmatched'))))
$f$;
grant execute on all functions in schema pg_temp to authenticated;

set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

-- 1. main path: claim -> real save -> finalize ---------------------------------
do $$
declare c jsonb; f jsonb; n int; sid uuid := (select v::uuid from t where k = 'sid'); line uuid; d public.documents%rowtype;
begin
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000a3001');
  insert into t values ('c1_id', c->>'claim_id'), ('c1_tok', c->>'claim_token');
  if (select status from public.document_payroll_claims where id = (c->>'claim_id')::uuid) <> 'pending'
     or (select expires_at - created_at from public.document_payroll_claims where id = (c->>'claim_id')::uuid) <> interval '120 seconds' then
    raise exception 'FAIL claim: not a 120 s pending claim';
  end if;
  raise notice 'PASS claim: one pending claim (120 s) for document c1 / load SYN-30001';

  -- second tab, same document / another document for the same load
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000a3001')$q$, 'claim_conflict');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000a3002')$q$, 'claim_conflict');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000a3001')$q$, 'claim_conflict');
  raise notice 'PASS idempotency: a second claim for the same document (any load) or the same load (any document) is refused while pending';

  -- finalize before any draft exists: refused, claim stays pending
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"%s"}')$q$, c->>'claim_id', c->>'claim_token', sid), 'settlement_line_not_found');
  raise notice 'PASS finalize: refused when the draft does not contain the claimed load';

  -- the app's real create JSON through the real save function
  perform public.sph_web_save_settlement((select v from t where k = 'payload')::jsonb);
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"%s"}')$q$, c->>'claim_id', gen_random_uuid(), sid), 'claim_not_found');
  f := public.sph_payroll_claim_finalize(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'settlement_id', sid,
         'confirmation', jsonb_build_object('corrections', jsonb_build_array(jsonb_build_object('field', 'total_revenue', 'extracted', 1580, 'saved', 1850, 'source', 'manual')), 'acknowledged', jsonb_build_array('driver:unmatched'))));
  select id into line from public.settlement_loads where settlement_id = sid and load_id = 'aaaaaaaa-0000-0000-0000-0000000a3001';
  select * into d from public.documents where id = 'dddddddd-0000-4000-8000-0000000000c1';
  if (f->>'settlement_load_id')::uuid <> line or d.settlement_id <> sid or d.review_status <> 'approved' or d.payroll_status <> 'confirmed'
     or (d.routing->'payroll'->>'settlement_load_id')::uuid <> line or (d.routing->'payroll'->>'claim_id') <> c->>'claim_id'
     or d.routing->'history'->-1->>'event' <> 'payroll_draft_confirmed'
     or jsonb_array_length(d.corrections) <> 1 or d.corrections->0->>'field' <> 'total_revenue' then
    raise exception 'FAIL trace: document link/audit wrong: % / %', f, d.routing;
  end if;
  if (select status || ':' || settlement_id || ':' || settlement_load_id from public.document_payroll_claims where id = (c->>'claim_id')::uuid)
     <> 'confirmed:' || sid || ':' || line then
    raise exception 'FAIL trace: claim not confirmed with the line';
  end if;
  raise notice 'PASS trace: document -> claim -> settlement % -> line % (corrections + acknowledgements recorded, review_status approved, payroll_status confirmed)', sid, line;

  f := public.sph_payroll_claim_finalize(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'settlement_id', sid));
  if not (f->>'already')::boolean then raise exception 'FAIL finalize not idempotent'; end if;
  raise notice 'PASS retry: finalizing again returns the same draft (idempotent), nothing duplicated';

  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000a3001')$q$, 'document_already_linked');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000a3001')$q$, 'load_on_settlement');
  if (select count(*) from public.document_payroll_claims where document_id = 'dddddddd-0000-4000-8000-0000000000c2') <> 0 then
    raise exception 'FAIL a refused claim left a row';
  end if;
  raise notice 'PASS reuse: a linked document can''t be claimed again; a second document for a load already on a draft is refused and leaves no claim';

  if (select status from public.settlements where id = sid) <> 'draft'
     or (select status from public.loads where id = 'aaaaaaaa-0000-0000-0000-0000000a3001') <> 'ready_for_settlement'
     or (select net_pay from public.settlements where id = sid) <> 1295.00 then
    raise exception 'FAIL: the draft or its calculation changed';
  end if;
  raise notice 'PASS calc: draft net 1295.00 from the existing engine (extracted amounts never used); still a draft, load not settled';
end $$;

-- 2. failure / release / retry --------------------------------------------------
do $$
declare c jsonb; c2 jsonb;
begin
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000a3002');
  if public.sph_payroll_claim_release(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', gen_random_uuid(), 'reason', 'x')) then
    raise exception 'FAIL release with a wrong token';
  end if;
  if not public.sph_payroll_claim_release(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'reason', 'save_refused')) then
    raise exception 'FAIL release';
  end if;
  c2 := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-0000-0000-0000000a3002');
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"5e000000-0000-4000-8000-0000000a0d01"}')$q$, c->>'claim_id', c->>'claim_token'), 'claim_released');
  perform public.sph_payroll_claim_release(jsonb_build_object('claim_id', c2->>'claim_id', 'claim_token', c2->>'claim_token', 'reason', 'test'));
  raise notice 'PASS failure: a refused save releases the claim at once (token required); the retry claims again; the released claim can never be finalized';
end $$;

-- 3. validation at claim time ----------------------------------------------------
do $$
begin
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3003')$q$, 'load_cancelled');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3004')$q$, 'load_on_settlement');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a0009')$q$, 'load_settled');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c4', 'aaaaaaaa-0000-0000-0000-0000000a3005')$q$, 'document_unavailable');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c5', 'aaaaaaaa-0000-0000-0000-0000000a3005')$q$, 'document_unavailable');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005', 'add_to_draft', '5e000000-0000-4000-8000-0000000a0f01')$q$, 'settlement_finalized');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005', 'add_to_draft', null)$q$, 'bad_request');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005', 'approve')$q$, 'bad_request');
  if exists (select 1 from public.document_payroll_claims where document_id in ('dddddddd-0000-4000-8000-0000000000c3', 'dddddddd-0000-4000-8000-0000000000c4', 'dddddddd-0000-4000-8000-0000000000c5')) then
    raise exception 'FAIL a refused claim left a row';
  end if;
  raise notice 'PASS validation: cancelled / settled / paid-settlement loads, dismissed / duplicate documents, finalized target drafts and unknown plans are refused, and leave no claim';
end $$;

-- 4. cross-carrier isolation -----------------------------------------------------
reset role;
set local role authenticated; set local request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
do $$
declare n int; c jsonb;
begin
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005')$q$, 'document_not_found');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000a3005')$q$, 'payroll_claim_cross_account');
  perform pg_temp.expect_fail($q$select pg_temp.claim('dddddddd-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000b3001', 'add_to_draft', '5e000000-0000-4000-8000-0000000a0d01')$q$, 'settlement_not_found');
  select count(*) into n from public.document_payroll_claims;
  if n <> 0 then raise exception 'FAIL isolation: B sees % of A''s claims', n; end if;
  update public.document_payroll_claims set status = 'released', released_at = now(), released_reason = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL isolation: B updated A''s claims'; end if;
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"%s"}')$q$,
    (select v from t where k = 'c1_id'), (select v from t where k = 'c1_tok'), (select v from t where k = 'sid')), 'claim_not_found');
  -- B's own claim can't be finalized onto A's draft
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000b3001');
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"%s"}')$q$,
    c->>'claim_id', c->>'claim_token', (select v from t where k = 'sid')), 'settlement_line_not_found');
  perform public.sph_payroll_claim_release(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'reason', 'test'));
  raise notice 'PASS isolation: carrier B can''t claim A''s document or load, target A''s draft, see / update / finalize A''s claims, or finalize onto A''s draft';
end $$;
reset role;

-- 5a. R1: NO direct writes at all — only the 4 claim functions may write ------
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb;
begin
  -- a perfectly shaped pending claim, inserted over REST, is still refused
  perform pg_temp.expect_fail($q$insert into public.document_payroll_claims (document_id, load_id, claim_token, plan, expires_at)
     values ('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005', gen_random_uuid(), 'create', now() + interval '1 minute')$q$, 'claim_direct_write');
  perform pg_temp.expect_fail($q$insert into public.document_payroll_claims (profile_id, document_id, load_id, claim_token, plan, expires_at)
     values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000b3001', gen_random_uuid(), 'create', now() + interval '1 minute')$q$, 'claim_direct_write');
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005');
  insert into t values ('c3p_id', c->>'claim_id'), ('c3p_tok', c->>'claim_token');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set confirmation = '{"acknowledged":["forged"]}' where id = '%s'$q$, c->>'claim_id'), 'claim_direct_write');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'released', released_at = now(), released_reason = 'forged' where id = '%s'$q$, c->>'claim_id'), 'claim_direct_write');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set released_reason = 'forged' where id = '%s'$q$, (select v from t where k = 'c1_id')), 'claim_direct_write');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set confirmation = '{}' where id = '%s'$q$, (select v from t where k = 'c1_id')), 'claim_direct_write');
  perform pg_temp.expect_fail(format($q$delete from public.document_payroll_claims where id = '%s'$q$, c->>'claim_id'), 'permission denied');
  perform pg_temp.expect_fail($q$truncate public.document_payroll_claims$q$, 'permission denied');
  if (select confirmation->'acknowledged'->>0 from public.document_payroll_claims where id = (c->>'claim_id')::uuid) <> 'driver:unmatched' then
    raise exception 'FAIL pending confirmation record changed';
  end if;
  raise notice 'PASS R1 write path: REST inserts / updates / deletes / truncate of claims are refused for every account; pending and confirmed confirmation records can''t be edited directly';
end $$;
reset role;

-- 5b. defence in depth: even a write that carries the function flag (only
--     reachable from inside the database, never over REST) must follow the
--     state machine.
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb := jsonb_build_object('claim_id', (select v from t where k = 'c3p_id'), 'claim_token', (select v from t where k = 'c3p_tok'));
begin
  perform set_config('sph.payroll_claim_write', 'on', true);
  perform pg_temp.expect_fail($q$insert into public.document_payroll_claims (document_id, load_id, claim_token, plan, status, expires_at, confirmed_at, settlement_id, settlement_load_id)
     values ('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006', gen_random_uuid(), 'create', 'confirmed', now() + interval '1 minute', now(), '5e000000-0000-4000-8000-0000000a0d01', gen_random_uuid())$q$, 'claim_invalid');
  perform pg_temp.expect_fail($q$insert into public.document_payroll_claims (profile_id, document_id, load_id, claim_token, plan, expires_at)
     values ('bbbbbbbb-0000-0000-0000-000000000001', 'dddddddd-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000b3001', gen_random_uuid(), 'create', now() + interval '1 minute')$q$, 'cross_account');
  perform pg_temp.expect_fail($q$insert into public.document_payroll_claims (document_id, load_id, claim_token, plan, expires_at)
     values ('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006', gen_random_uuid(), 'create', now() + interval '1 day')$q$, 'claim_invalid');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'confirmed', confirmed_at = now(), settlement_id = '5e000000-0000-4000-8000-0000000a0d01', settlement_load_id = gen_random_uuid() where id = '%s'$q$, c->>'claim_id'), 'claim_unverified');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set load_id = 'aaaaaaaa-0000-0000-0000-0000000a3006' where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set expires_at = now() + interval '9 minutes' where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set confirmation = '{"acknowledged":["forged"]}' where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set document_snapshot = '{}' where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'released', released_at = now(), released_reason = 'x', confirmation = '{}' where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'released', released_at = now(), released_reason = 'x' where id = '%s'$q$, (select v from t where k = 'c1_id')), 'claim_immutable');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set confirmation = '{}' where id = '%s'$q$, (select v from t where k = 'c1_id')), 'claim_immutable');
  perform set_config('sph.payroll_claim_write', 'off', true);
  perform public.sph_payroll_claim_release(c || '{"reason":"test"}');
  perform set_config('sph.payroll_claim_write', 'on', true);
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'pending', released_at = null, released_reason = null where id = '%s'$q$, c->>'claim_id'), 'claim_immutable');
  perform set_config('sph.payroll_claim_write', 'off', true);
  if current_setting('sph.payroll_claim_write', true) <> 'off' then raise exception 'FAIL flag left on'; end if;
  raise notice 'PASS state machine (flagged writes): no forged confirmed claim, no cross-account claim, no long expiry, no load / expiry / snapshot change, confirmation frozen while pending and after confirmation, no revived release, no retired live confirmation';
end $$;
reset role;

-- 6. expiry, crash recovery ------------------------------------------------------
--  Ageing a claim needs the trigger bypassed (test-only, superuser).
create function pg_temp.age_claims(p_doc uuid) returns void language plpgsql as $f$
begin
  set local session_replication_role = replica;
  update public.document_payroll_claims set created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes'
   where document_id = p_doc and status = 'pending';
  set local session_replication_role = origin;
end $f$;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb; r jsonb;
begin
  -- 6a. crash BEFORE the save: claim expires, nothing to recover, retry works
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006');
  insert into t values ('c6', c->>'claim_id');
end $$;
reset role;
select pg_temp.age_claims('dddddddd-0000-4000-8000-0000000000c6');
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare r jsonb; c jsonb;
begin
  r := public.sph_payroll_claim_recover('{"document_id":"dddddddd-0000-4000-8000-0000000000c6"}');
  if r->>'state' <> 'released' then raise exception 'FAIL recover none: %', r; end if;
  if (select released_reason from public.document_payroll_claims where id = (select v::uuid from t where k = 'c6')) <> 'expired_no_draft' then raise exception 'FAIL reason'; end if;
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006');
  perform public.sph_payroll_claim_release(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'reason', 'test'));
  raise notice 'PASS crash before save: the stale claim is released (expired_no_draft) and the retry claims normally';

  -- an expired claim does not block a different document / tab either
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006');
  insert into t values ('c6b_id', c->>'claim_id'), ('c6b_tok', c->>'claim_token');
end $$;
reset role;
select pg_temp.age_claims('dddddddd-0000-4000-8000-0000000000c6');
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb;
begin
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c7', 'aaaaaaaa-0000-0000-0000-0000000a3006');
  if (select released_reason from public.document_payroll_claims where id = (select v::uuid from t where k = 'c6b_id')) <> 'expired' then raise exception 'FAIL expiry takeover'; end if;
  perform pg_temp.expect_fail(format($q$select public.sph_payroll_claim_finalize('{"claim_id":"%s","claim_token":"%s","settlement_id":"5e000000-0000-4000-8000-0000000a0d01"}')$q$,
    (select v from t where k = 'c6b_id'), (select v from t where k = 'c6b_tok')), 'claim_released');
  perform public.sph_payroll_claim_release(jsonb_build_object('claim_id', c->>'claim_id', 'claim_token', c->>'claim_token', 'reason', 'test'));
  raise notice 'PASS expiry: an expired claim is taken over by the next attempt and can no longer be finalized';

  -- 6b. crash AFTER the save (add_to_draft): the draft line exists, link missing
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c7', 'aaaaaaaa-0000-0000-0000-0000000a3007', 'add_to_draft', '5e000000-0000-4000-8000-0000000a0d01');
  insert into t values ('c7', c->>'claim_id');
  insert into public.settlement_loads (settlement_id, profile_id, load_id, load_number)
  values ('5e000000-0000-4000-8000-0000000a0d01', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a3007', 'SYN-30007');
end $$;
reset role;
select pg_temp.age_claims('dddddddd-0000-4000-8000-0000000000c7');
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare r jsonb; d public.documents%rowtype;
begin
  r := public.sph_payroll_claim_recover('{"document_id":"dddddddd-0000-4000-8000-0000000000c7"}');
  select * into d from public.documents where id = 'dddddddd-0000-4000-8000-0000000000c7';
  if r->>'state' <> 'recovered' or d.settlement_id <> '5e000000-0000-4000-8000-0000000a0d01'
     or d.routing->'history'->-1->>'event' <> 'payroll_draft_recovered'
     or not (select recovered from public.document_payroll_claims where id = (select v::uuid from t where k = 'c7')) then
    raise exception 'FAIL recover: % / %', r, d.routing;
  end if;
  if (select count(*) from public.settlement_loads where load_id = 'aaaaaaaa-0000-0000-0000-0000000a3007') <> 1 then raise exception 'FAIL recover duplicated'; end if;
  r := public.sph_payroll_claim_recover('{"document_id":"dddddddd-0000-4000-8000-0000000000c7"}');
  if r->>'state' <> 'linked' then raise exception 'FAIL recover twice: %', r; end if;
  raise notice 'PASS crash after save: recover links the document to the one draft line created after the claim (audited as recovered); no second draft; recover is idempotent';

  -- 7. relink / unlink rules
  perform pg_temp.expect_fail($q$update public.documents set settlement_id = (select v::uuid from t where k = 'sid') where id = 'dddddddd-0000-4000-8000-0000000000c7'$q$, 'document_payroll_relink');
  raise notice 'PASS reuse: a confirmed document can''t be moved onto another settlement';
end $$;
reset role;

-- 6c. ambiguous recovery: the load landed on two open drafts
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb;
begin
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c3', 'aaaaaaaa-0000-0000-0000-0000000a3005');
  insert into t values ('c3', c->>'claim_id');
end $$;
reset role;
insert into public.settlements (id, profile_id, driver_id, status, settlement_period_start, settlement_period_end) values
  ('5e000000-0000-4000-8000-0000000a0d02', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'draft', '2026-10-12', '2026-10-18'),
  ('5e000000-0000-4000-8000-0000000a0d03', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'draft', '2026-10-12', '2026-10-18');
insert into public.settlement_loads (settlement_id, profile_id, load_id, load_number) values
  ('5e000000-0000-4000-8000-0000000a0d02', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a3005', 'SYN-30005'),
  ('5e000000-0000-4000-8000-0000000a0d03', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a3005', 'SYN-30005');
select pg_temp.age_claims('dddddddd-0000-4000-8000-0000000000c3');
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare r jsonb;
begin
  r := public.sph_payroll_claim_recover('{"document_id":"dddddddd-0000-4000-8000-0000000000c3"}');
  if r->>'state' <> 'ambiguous' or (select settlement_id from public.documents where id = 'dddddddd-0000-4000-8000-0000000000c3') is not null then
    raise exception 'FAIL ambiguous: %', r;
  end if;
  raise notice 'PASS ambiguous recovery: nothing is linked automatically when the load is on two drafts; the claim is released for a human decision';
end $$;
reset role;

-- 8. finalized settlements stay untouchable -------------------------------------
--  Approve c1's draft through the database (as the settlement screen would),
--  then try every Smart Payroll path against it.
set local session_replication_role = replica;
update public.settlements set status = 'approved', approved_at = now() where id = (select v::uuid from t where k = 'sid');
set local session_replication_role = origin;
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb;
begin
  perform pg_temp.expect_fail($q$update public.documents set settlement_id = null where id = 'dddddddd-0000-4000-8000-0000000000c1'$q$, 'document_payroll_locked');
  perform pg_temp.expect_fail($q$update public.documents set corrections = '[]' where id = 'dddddddd-0000-4000-8000-0000000000c1'$q$, 'document_payroll_locked');
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set status = 'released', released_at = now(), released_reason = 'x' where id = '%s'$q$, (select v from t where k = 'c1_id')), 'claim_direct_write');
  c := pg_temp.claim('dddddddd-0000-4000-8000-0000000000c6', 'aaaaaaaa-0000-0000-0000-0000000a3006', 'add_to_draft', (select v from t where k = 'sid'));
  raise exception 'FAIL finalized target accepted';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  if sqlerrm not like '%finalized%' then raise exception 'FAIL finalized target: %', sqlerrm; end if;
  raise notice 'PASS finalized: an approved settlement''s document link, corrections and claim are frozen, and Smart Payroll can''t add to it';
end $$;
reset role;

-- 9. R1: deleting a document keeps its claim history -----------------------------
set local role authenticated; set local request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
declare c jsonb; r record; n int;
begin
  -- c7: confirmed (recovered) onto the open draft 0d01
  select count(*) into n from public.document_payroll_claims where document_id = 'dddddddd-0000-4000-8000-0000000000c7';
  delete from public.documents where id = 'dddddddd-0000-4000-8000-0000000000c7';
  select * into r from public.document_payroll_claims where id = (select v::uuid from t where k = 'c7');
  if r.id is null or r.document_id is not null or r.document_deleted_at is null or r.status <> 'confirmed'
     or r.settlement_id <> '5e000000-0000-4000-8000-0000000a0d01' or r.settlement_load_id is null
     or r.document_snapshot->>'storage_path' <> 'a/c7.pdf' or r.document_snapshot->>'document_id' <> 'dddddddd-0000-4000-8000-0000000000c7'
     or r.confirmation->>'claim_id' is null then
    raise exception 'FAIL R1 confirmed claim lost on document delete: %', to_jsonb(r);
  end if;
  if (select count(*) from public.document_payroll_claims where document_snapshot->>'document_id' = 'dddddddd-0000-4000-8000-0000000000c7') <> n then
    raise exception 'FAIL R1 claim rows erased by document delete';
  end if;
  if (select count(*) from public.settlement_loads where load_id = 'aaaaaaaa-0000-0000-0000-0000000a3007') <> 1 then
    raise exception 'FAIL R1 document delete touched the draft';
  end if;
  -- c2: has released claims only
  delete from public.documents where id = 'dddddddd-0000-4000-8000-0000000000c2';
  if exists (select 1 from public.document_payroll_claims where document_id = 'dddddddd-0000-4000-8000-0000000000c2')
     or (select count(*) from public.document_payroll_claims where document_snapshot->>'document_id' = 'dddddddd-0000-4000-8000-0000000000c2' and document_deleted_at is not null) < 2 then
    raise exception 'FAIL R1 released history for c2';
  end if;
  -- the detached history can't be re-attached or edited afterwards
  perform pg_temp.expect_fail(format($q$update public.document_payroll_claims set document_id = 'dddddddd-0000-4000-8000-0000000000c3' where id = '%s'$q$, (select v from t where k = 'c7')), 'claim_direct_write');
  raise notice 'PASS R1 retention: deleting a document keeps every claim (confirmed and released) with document_id NULL, document_deleted_at set and the snapshot (path, hash, type) intact; the draft is untouched; history can''t be re-attached';
end $$;
reset role;

-- 10. R1: least-privilege grants --------------------------------------------------
do $$
declare r text;
begin
  for r in select x from unnest(array['anon', 'authenticated', 'service_role']) x loop
    if has_table_privilege(r, 'public.document_payroll_claims', 'DELETE')
       or has_table_privilege(r, 'public.document_payroll_claims', 'TRUNCATE')
       or has_table_privilege(r, 'public.document_payroll_claims', 'REFERENCES')
       or has_table_privilege(r, 'public.document_payroll_claims', 'TRIGGER') then
      raise exception 'FAIL R1 grants: % has delete/truncate/references/trigger', r;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.document_payroll_claims', 'SELECT') or has_table_privilege('anon', 'public.document_payroll_claims', 'INSERT') then
    raise exception 'FAIL R1 grants: anon can read or write claims';
  end if;
  if not has_table_privilege('authenticated', 'public.document_payroll_claims', 'SELECT') then
    raise exception 'FAIL R1 grants: owner can no longer read claims';
  end if;
  if exists (select 1 from information_schema.table_privileges where table_schema = 'public' and table_name = 'document_payroll_claims' and grantee = 'PUBLIC') then
    raise exception 'FAIL R1 grants: PUBLIC has privileges';
  end if;
  raise notice 'PASS R1 grants: anon none; authenticated / service_role only select, insert, update (writes still gated by the guard); no delete, truncate, references or trigger anywhere';
end $$;

rollback;
