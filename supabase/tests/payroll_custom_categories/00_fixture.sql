-- Local fixture for 20261024011809_payroll_custom_categories.sql.
-- Mirrors the production pieces the migration touches: Supabase roles,
-- auth.uid(), profiles, settlements and the settlement_additions /
-- settlement_deductions tables with their production CHECKs + RLS
-- (20260912120000_driver_pay_and_settlements.sql). Never run against Supabase.
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade);
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text default 'draft'
);
create table public.settlement_additions (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  profile_id uuid not null,
  category text not null,
  description text not null,
  amount numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint settlement_additions_category_check check (category in (
    'bonus','detention','layover','tonu','lumper_reimbursement','reimbursement',
    'fuel_credit','maintenance_credit','safety_bonus','referral_bonus','manual_credit','other'))
);
create table public.settlement_deductions (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  profile_id uuid not null,
  category text not null,
  description text not null,
  amount numeric(14,2) not null default 0,
  responsibility text not null default 'driver',
  driver_share_percent numeric(6,3) not null default 100,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint settlement_deductions_category_check check (category in (
    'truck_lease','insurance','fuel','fuel_advance','cash_advance','maintenance',
    'repair','escrow','maintenance_reserve','tolls','scale_tickets','permits',
    'violation','damage','trailer_charge','equipment_charge','dispatcher_fee',
    'factoring_fee','authority_fee','other'))
);
alter table public.settlements enable row level security;
alter table public.settlement_additions enable row level security;
alter table public.settlement_deductions enable row level security;
create policy "own settlements" on public.settlements for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "own settlement additions" on public.settlement_additions for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and exists (select 1 from public.settlements s where s.id = settlement_id and s.profile_id = auth.uid()));
create policy "own settlement deductions" on public.settlement_deductions for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and exists (select 1 from public.settlements s where s.id = settlement_id and s.profile_id = auth.uid()));
grant all on all tables in schema public to anon, authenticated;

insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.profiles values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.settlements (id, profile_id, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'paid'),
  ('b0000000-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'draft');
-- A pre-existing PAID line that must be untouched by the migration.
insert into public.settlement_deductions (id, settlement_id, profile_id, category, description, amount)
  values ('d0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'other', 'Old line', 12.34);
