\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
-- After every functional + concurrency test: legacy web paystubs, their
-- earnings and the pre-itemized legacy iPhone settlement are byte-identical
-- to the snapshot taken right after the migrations.
do $$
declare v_changed int; v_missing int;
begin
  select count(*) into v_changed
    from public.fixture_history h
    left join lateral (
      select to_jsonb(p) as row from public.paystubs p where h.t = 'paystubs' and p.id = h.id
      union all select to_jsonb(e) from public.paystub_earnings e where h.t = 'paystub_earnings' and e.id = h.id
      union all select to_jsonb(s) from public.settlements s where h.t = 'settlements' and s.id = h.id
    ) cur on true
   where cur.row is distinct from h.row;
  select count(*) into v_missing from public.fixture_history;
  if v_changed <> 0 then raise exception 'FAIL history: % historical row(s) changed or deleted', v_changed; end if;
  raise notice 'PASS history: all % legacy paystub / earnings / legacy-settlement rows unchanged', v_missing;
  if (select status from public.loads where id = 'aaaaaaaa-0000-0000-0000-0000000a0009') <> 'settled' then
    raise exception 'FAIL history: load paid by a legacy paystub was released';
  end if;
  raise notice 'PASS history: the load paid by the legacy paystub is still settled';
end $$;
