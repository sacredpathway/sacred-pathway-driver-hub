\set ON_ERROR_STOP on
\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set asB 'reset role; set role authenticated; set request.jwt.claim.sub = ''bbbbbbbb-0000-0000-0000-000000000001'';'
\set asSuper 'reset role; set request.jwt.claim.sub = '''';'

create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(lower(needle) in lower(sqlerrm)) > 0 or position(lower(needle) in lower(sqlstate)) > 0 then
      raise notice 'PASS (rejected): %', needle; return;
    end if;
    raise exception 'wrong error for %: % (%)', needle, sqlerrm, sqlstate;
  end;
  raise exception 'expected rejection (%), statement succeeded: %', needle, sql;
end $$;

-- 1. existing data untouched
:asSuper
do $$ begin
  if (select amount from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d1') <> 12.34
     or (select custom_category_id from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d1') is not null
  then raise exception 'existing row changed'; end if;
  raise notice 'PASS: existing paid line unchanged, custom_category_id NULL';
end $$;

-- 2. owner can create; profile_id defaults to auth.uid()
:asA
insert into public.payroll_custom_categories (id, kind, name, base_category, default_responsibility)
  values ('c0000000-0000-0000-0000-0000000000c1', 'deduction', 'ELD subscription', 'equipment_charge', 'driver');
do $$ begin
  if (select profile_id from public.payroll_custom_categories where id = 'c0000000-0000-0000-0000-0000000000c1') <> 'aaaaaaaa-0000-0000-0000-000000000001'
  then raise exception 'profile default wrong'; end if;
  raise notice 'PASS: owner creates category, profile_id = auth.uid()';
end $$;

-- 3. case-insensitive unique name per kind
select pg_temp.expect_error($$insert into public.payroll_custom_categories (kind, name) values ('deduction', '  eld SUBSCRIPTION ')$$, 'unique');
-- same name allowed as the other kind
insert into public.payroll_custom_categories (kind, name) values ('addition', 'ELD subscription');
do $$ begin raise notice 'PASS: same name allowed for the other kind'; end $$;

-- 4. base_category must be an iPhone-safe value for its kind
select pg_temp.expect_error($$insert into public.payroll_custom_categories (kind, name, base_category) values ('addition', 'X', 'fuel')$$, 'payroll_custom_categories_base_check');
select pg_temp.expect_error($$insert into public.payroll_custom_categories (kind, name, base_category) values ('deduction', 'Y', 'eld_fee')$$, 'payroll_custom_categories_base_check');
select pg_temp.expect_error($$insert into public.payroll_custom_categories (kind, name) values ('deduction', '   ')$$, 'payroll_custom_categories_name_check');

-- 5. lines still can't carry a new category string (iPhone enum guard intact)
select pg_temp.expect_error($$insert into public.settlement_deductions (settlement_id, profile_id, category, description) values ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'eld_subscription', 'x')$$, 'settlement_deductions_category_check');

-- 6. RLS: B can't see or use A's category; can't forge profile_id
:asB
do $$ begin
  if exists (select 1 from public.payroll_custom_categories) then raise exception 'B sees A categories'; end if;
  raise notice 'PASS: RLS hides other carriers'' categories';
end $$;
select pg_temp.expect_error($$insert into public.payroll_custom_categories (profile_id, kind, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'deduction', 'Forged')$$, 'row-level security');
update public.payroll_custom_categories set name = 'hijack' where id = 'c0000000-0000-0000-0000-0000000000c1';
:asSuper
do $$ begin
  if (select name from public.payroll_custom_categories where id = 'c0000000-0000-0000-0000-0000000000c1') <> 'ELD subscription' then raise exception 'B renamed A category'; end if;
  raise notice 'PASS: other carrier cannot rename';
end $$;

-- 7. a line points at a category; an iPhone-style upsert (no custom column) preserves it
:asA
insert into public.settlements (id, profile_id) values ('a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.settlement_deductions (id, settlement_id, profile_id, category, description, amount, custom_category_id)
  values ('d0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment_charge', 'ELD subscription', 25.00, 'c0000000-0000-0000-0000-0000000000c1');
insert into public.settlement_deductions (id, settlement_id, profile_id, category, description, amount)
  values ('d0000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'equipment_charge', 'ELD subscription', 26.50)
  on conflict (id) do update set category = excluded.category, description = excluded.description, amount = excluded.amount;
do $$ begin
  if (select custom_category_id from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d2') is distinct from 'c0000000-0000-0000-0000-0000000000c1'
     or (select amount from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d2') <> 26.50
  then raise exception 'iPhone-style upsert lost custom_category_id'; end if;
  raise notice 'PASS: iPhone-style upsert keeps custom_category_id, updates amount';
end $$;

-- 8. deleting a category never deletes or changes the paid line
delete from public.payroll_custom_categories where id = 'c0000000-0000-0000-0000-0000000000c1';
do $$ begin
  if (select amount from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d2') <> 26.50
     or (select custom_category_id from public.settlement_deductions where id = 'd0000000-0000-0000-0000-0000000000d2') is not null
  then raise exception 'category delete damaged line'; end if;
  raise notice 'PASS: deleting a category keeps the line (pointer set NULL)';
end $$;

-- 9. updated_at trigger
insert into public.payroll_custom_categories (id, kind, name) values ('c0000000-0000-0000-0000-0000000000c3', 'addition', 'Phone stipend');
update public.payroll_custom_categories set updated_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-0000000000c3';
do $$ begin
  if (select updated_at from public.payroll_custom_categories where id = 'c0000000-0000-0000-0000-0000000000c3') < now() - interval '1 minute'
  then raise exception 'updated_at not touched'; end if;
  raise notice 'PASS: updated_at maintained by trigger';
end $$;
