-- =============================================================================
--  Local fixture mirroring the production pieces the paystub-integrity
--  migration touches (verified read-only against production 2026-09-30):
--    • Supabase roles + auth.uid() definition
--    • default privileges (EXECUTE on new public functions → anon/authenticated)
--    • profiles / drivers / loads / paystubs / paystub_earnings / settlements /
--      settlement_loads with production FKs, CHECKs, RLS policies and grants
--  Columns are trimmed to those the migration or tests read. Never run this
--  against a real Supabase project.
-- =============================================================================

\set ON_ERROR_STOP on

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table auth.users (id uuid primary key);

-- Production definition (pg_get_functiondef, 2026-09-30).
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase default privileges in schema public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  name text not null,
  worker_type text not null default '1099'
);

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id),
  load_number text,
  origin text,
  destination text,
  total_miles numeric,
  total_revenue numeric,
  status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.paystubs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  worker_type text not null check (worker_type = any (array['1099','W2'])),
  paystub_number text,
  pay_period_start date not null,
  pay_period_end date not null,
  check_date date,
  status text not null default 'draft' check (status = any (array['draft','issued','paid','voided'])),
  payment_method text,
  check_number text,
  gross_earnings numeric default 0,
  total_pretax_deductions numeric default 0,
  taxable_wages numeric,
  total_taxes_withheld numeric default 0,
  total_posttax_deductions numeric default 0,
  total_reimbursements numeric default 0,
  total_settlement_deductions numeric default 0,
  net_pay numeric not null default 0,
  ytd_gross_earnings numeric default 0,
  ytd_taxable_wages numeric default 0,
  ytd_taxes_withheld numeric default 0,
  ytd_net_pay numeric default 0,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.fixture_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger paystubs_set_updated_at before update on public.paystubs
  for each row execute function public.fixture_set_updated_at();

create table public.paystub_earnings (
  id uuid primary key default gen_random_uuid(),
  paystub_id uuid not null references public.paystubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  label text,
  hours numeric,
  units numeric,
  rate numeric,
  amount numeric not null default 0,
  is_taxable boolean default true,
  load_id uuid references public.loads(id) on delete set null,
  ytd_amount numeric,
  notes text,
  created_at timestamptz default now()
);
create index on public.paystub_earnings (load_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id),
  status text default 'draft' check (status is null or status = any (array['draft','ready_for_review','approved','paid','voided'])),
  paystub_id uuid references public.paystubs(id) on delete set null,
  engine_version text,
  is_estimate boolean default false,
  settlement_number text,
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Production: settlements_touch_updated_at → sph_touch_updated_at (SECURITY DEFINER).
create or replace function public.sph_touch_updated_at() returns trigger
language plpgsql security definer set search_path to 'public' as $$ begin new.updated_at = now(); return new; end $$;
create trigger settlements_touch_updated_at before update on public.settlements
  for each row execute function public.sph_touch_updated_at();

create table public.settlement_loads (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  profile_id uuid not null,
  load_id uuid references public.loads(id) on delete set null,
  is_adjustment boolean not null default false,
  corrects_settlement_id uuid references public.settlements(id) on delete set null,
  driver_earnings numeric not null default 0,
  constraint settlement_loads_adjustment_needs_origin check (is_adjustment = false or corrects_settlement_id is not null)
);
create unique index settlement_loads_one_per_load on public.settlement_loads (settlement_id, load_id) where is_adjustment = false;

-- RLS exactly as production.
alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.loads enable row level security;
alter table public.paystubs enable row level security;
alter table public.paystub_earnings enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_loads enable row level security;

create policy "Users manage own profile" on public.profiles for all using (id = auth.uid());
create policy "Users manage own drivers" on public.drivers for all using (profile_id = auth.uid());
create policy "Users manage own loads" on public.loads for all using (profile_id = auth.uid());
create policy "own paystubs" on public.paystubs for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "own paystub_earnings" on public.paystub_earnings for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "Users manage own settlements" on public.settlements for all using (profile_id = auth.uid());
create policy "settlement driver belongs to owner" on public.settlements as restrictive for all using (true)
  with check (driver_id is null or exists (select 1 from public.drivers d where d.id = settlements.driver_id and d.profile_id = settlements.profile_id));
create policy "own settlement loads" on public.settlement_loads for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid()
    and exists (select 1 from public.settlements s where s.id = settlement_loads.settlement_id and s.profile_id = auth.uid())
    and (corrects_settlement_id is null or exists (select 1 from public.settlements c where c.id = settlement_loads.corrects_settlement_id and c.profile_id = auth.uid())));

-- Production grants on these tables (anon/authenticated full; RLS protects).
grant all on all tables in schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
--  Seed: two carriers (A, B), one driver each.
-- -----------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001');
insert into public.profiles (id, company_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Carrier A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Carrier B');
insert into public.drivers (id, profile_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Driver A1'),
  ('bbbbbbbb-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Driver B1');

-- Pre-existing rows (like production's legacy data). The migration must leave
-- them byte-for-byte unchanged.
insert into public.loads (id, profile_id, load_number, total_revenue, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e0001', 'aaaaaaaa-0000-0000-0000-000000000001', 'LEGACY-SETTLED', 1000, 'settled'),
  ('aaaaaaaa-0000-0000-0000-0000000e0002', 'aaaaaaaa-0000-0000-0000-000000000001', 'LEGACY-PENDING', 2000, 'pending');
insert into public.paystubs (id, profile_id, driver_id, worker_type, pay_period_start, pay_period_end, status, gross_earnings, net_pay)
values ('aaaaaaaa-0000-0000-0000-0000000e00f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
        '1099', '2026-09-01', '2026-09-07', 'draft', 0, 0);

create table public.fixture_snapshot as
  select 'loads' as t, id, to_jsonb(l) - 'updated_at' as row from public.loads l
  union all
  select 'paystubs', id, to_jsonb(p) - 'updated_at' from public.paystubs p;
revoke all on public.fixture_snapshot from anon, authenticated;

create table public.fixture_policies as
  select schemaname, tablename, policyname, permissive, cmd, roles::text as roles, qual, with_check
    from pg_policies where schemaname = 'public';
revoke all on public.fixture_policies from anon, authenticated;
