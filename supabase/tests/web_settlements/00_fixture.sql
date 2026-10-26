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

-- =============================================================================
--  Production-shaped base tables (base_schema + later web/iOS columns the
--  settlement code reads). The iPhone settlement migrations, the web payment
--  guards and the two new web migrations are then applied VERBATIM by run.sh.
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text, mc_number text, dot_number text, phone text,
  dispatcher_fee_percentage numeric(5,2) default 0,
  factoring_fee_percentage numeric(5,2) default 0,
  authority_fee numeric(10,2) default 0,
  maintenance_reserve numeric(10,2) default 0,
  pay_basis text
);

create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  name text not null,
  truck_number text,
  pay_percentage numeric(5,2),
  pay_type text default 'percent',
  flat_rate numeric(10,2),
  active boolean default true,
  worker_type text not null default '1099',
  created_at timestamptz default now()
);

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  driver_id uuid references public.drivers(id),
  load_number text, broker_name text, broker_mc_number text,
  pickup_date date, delivery_date date, origin text, destination text,
  total_miles numeric, empty_miles numeric,
  line_haul_rate numeric(10,2), fuel_surcharge numeric(10,2), accessorial_charges numeric(10,2),
  total_revenue numeric(10,2),
  status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  load_id uuid references public.loads(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  category text, amount numeric(10,2),
  created_at timestamptz default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  load_id uuid references public.loads(id),
  document_type text, storage_path text, status text default 'pending',
  created_at timestamptz default now()
);

create table public.carrier_members (
  id uuid primary key default gen_random_uuid(),
  carrier_profile_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null, status text not null default 'active',
  linked_driver_id uuid references public.drivers(id) on delete set null
);

create table public.paystubs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  worker_type text not null check (worker_type = any (array['1099','W2'])),
  paystub_number text,
  pay_period_start date not null, pay_period_end date not null, check_date date,
  status text not null default 'draft' check (status = any (array['draft','issued','paid','voided'])),
  payment_method text, check_number text,
  gross_earnings numeric default 0, total_pretax_deductions numeric default 0, taxable_wages numeric,
  total_taxes_withheld numeric default 0, total_posttax_deductions numeric default 0,
  total_reimbursements numeric default 0, total_settlement_deductions numeric default 0,
  net_pay numeric not null default 0,
  ytd_gross_earnings numeric default 0, ytd_taxable_wages numeric default 0,
  ytd_taxes_withheld numeric default 0, ytd_net_pay numeric default 0,
  notes text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table public.paystub_earnings (
  id uuid primary key default gen_random_uuid(),
  paystub_id uuid not null references public.paystubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null, label text, hours numeric, units numeric, rate numeric,
  amount numeric not null default 0, is_taxable boolean default true,
  load_id uuid references public.loads(id) on delete set null,
  ytd_amount numeric, notes text, created_at timestamptz default now()
);

-- base_schema settlements + web paystub link.
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade not null,
  driver_id uuid references public.drivers(id),
  settlement_period_start date, settlement_period_end date,
  total_revenue decimal(10,2), total_expenses decimal(10,2), gross_profit decimal(10,2),
  driver_pay_percentage decimal(5,2), driver_pay_amount decimal(10,2),
  dispatcher_fee_percentage decimal(5,2) default 0, dispatcher_fee_amount decimal(10,2) default 0,
  factoring_fee_percentage decimal(5,2) default 0, factoring_fee_amount decimal(10,2) default 0,
  authority_fee decimal(10,2) default 0, maintenance_reserve decimal(10,2) default 0,
  net_pay decimal(10,2), pdf_storage_path text,
  status text default 'draft',
  created_at timestamptz default now(),
  paystub_id uuid references public.paystubs(id) on delete set null
);

alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.loads enable row level security;
alter table public.expenses enable row level security;
alter table public.documents enable row level security;
alter table public.carrier_members enable row level security;
alter table public.paystubs enable row level security;
alter table public.paystub_earnings enable row level security;
alter table public.settlements enable row level security;
create policy "Users manage own profile" on public.profiles for all using (id = auth.uid());
create policy "Users manage own drivers" on public.drivers for all using (profile_id = auth.uid());
create policy "Users manage own loads" on public.loads for all using (profile_id = auth.uid());
create policy "Users manage own expenses" on public.expenses for all using (profile_id = auth.uid());
create policy "Users manage own documents" on public.documents for all using (profile_id = auth.uid());
create policy "members read own" on public.carrier_members for select using (user_id = auth.uid() or carrier_profile_id = auth.uid());
create policy "own paystubs" on public.paystubs for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "own paystub_earnings" on public.paystub_earnings for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "Users manage own settlements" on public.settlements for all using (profile_id = auth.uid());
grant all on all tables in schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
--  Seed: carriers A, B; a driver-portal user D linked to A's driver.
-- -----------------------------------------------------------------------------
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000001');
insert into public.profiles (id, company_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Carrier A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Carrier B'),
  ('dddddddd-0000-0000-0000-000000000001', null);
insert into public.drivers (id, profile_id, name, pay_percentage) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Driver A1', 70),
  ('bbbbbbbb-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Driver B1', 70);
insert into public.carrier_members (carrier_profile_id, user_id, role, status, linked_driver_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'driver', 'active', 'aaaaaaaa-0000-0000-0000-00000000d001');

-- Loads (A). L3 has a NULL status (old rows); L9 is on a legacy web paystub.
insert into public.loads (id, profile_id, driver_id, load_number, delivery_date, total_revenue, line_haul_rate, status) values
  ('aaaaaaaa-0000-0000-0000-0000000a0001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'L1', '2026-10-14', 3237.95, 3237.95, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a0002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'L2', '2026-10-15', 2000.00, 2000.00, 'ready_for_settlement'),
  ('aaaaaaaa-0000-0000-0000-0000000a0003', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'L3', '2026-10-16', 1500.00, 1500.00, null),
  ('aaaaaaaa-0000-0000-0000-0000000a0009', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'L9', '2026-09-03', 900.00, 900.00, 'settled');
insert into public.loads (id, profile_id, driver_id, load_number, total_revenue, status) values
  ('bbbbbbbb-0000-0000-0000-0000000b0001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000d001', 'B-L1', 1000, 'ready_for_settlement');

-- HISTORY that must survive untouched: an issued web paystub paying L9, and a
-- pre-itemized legacy iPhone settlement.
insert into public.paystubs (id, profile_id, driver_id, worker_type, paystub_number, pay_period_start, pay_period_end, status, gross_earnings, net_pay)
values ('aaaaaaaa-0000-0000-0000-0000000f0001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', '1099', 'PS-0001', '2026-09-01', '2026-09-07', 'issued', 900, 630);
insert into public.paystub_earnings (paystub_id, profile_id, kind, label, amount, load_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0001', 'aaaaaaaa-0000-0000-0000-000000000001', 'load', 'L9', 630, 'aaaaaaaa-0000-0000-0000-0000000a0009');
insert into public.settlements (id, profile_id, driver_id, settlement_period_start, settlement_period_end, total_revenue, net_pay, driver_pay_percentage, status)
values ('aaaaaaaa-0000-0000-0000-00000000e0e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', '2026-08-01', '2026-08-07', 5000, 3500, 70, 'paid');
