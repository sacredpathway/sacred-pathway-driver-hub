\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- Executes the EXACT payload the web app builds (generated/web_payload.json,
-- kept in sync by web-app/lib/settlements/contract.test.ts) against the real
-- save function, as carrier A, and checks what was stored.
\set payload `cat generated/web_payload.json`
reset role; set role authenticated; set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select public.sph_web_save_settlement(:'payload'::jsonb) is not null as saved \gset
reset role;
do $$
declare s public.settlements%rowtype;
begin
  select * into s from public.settlements where id = '5e000000-0000-4000-8000-0000000000ff';
  if s.net_pay <> 804.33 then raise exception 'FAIL web payload: net_pay %', s.net_pay; end if;
  if s.status <> 'draft' or s.engine_version <> 'settlement-engine/1.0' then raise exception 'FAIL web payload: header %/%', s.status, s.engine_version; end if;
  if (s.pay_rule->'components'->0->>'percent') <> '27.5' or (s.pay_rule->'fee_terms'->>'factoring_fee_percent') <> '2.5' then
    raise exception 'FAIL web payload: pay_rule %', s.pay_rule;
  end if;
  if (select driver_earnings::text || '|' || pay_basis_description from public.settlement_loads where settlement_id = s.id) <> '890.44|27.5% of $3,237.95' then
    raise exception 'FAIL web payload: load line %', (select driver_earnings::text || '|' || pay_basis_description from public.settlement_loads where settlement_id = s.id);
  end if;
  if (select driver_share_percent::text || '|' || amount::text from public.settlement_deductions where settlement_id = s.id) <> '33.333|333.33' then
    raise exception 'FAIL web payload: deduction';
  end if;
  if (select count(*) from public.settlement_audit_events where settlement_id = s.id and action = 'created' and actor_name = 'owner@example.com') <> 1 then
    raise exception 'FAIL web payload: audit';
  end if;
  raise notice 'PASS web payload: the app''s real save JSON is accepted and stored exactly (net 804.33, frozen line 890.44, split 33.333%%, rule + fee terms, audit)';
end $$;
