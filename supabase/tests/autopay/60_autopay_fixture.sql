-- =============================================================================
--  Automatic upload-to-paystub — end-to-end fixture (THROWAWAY cluster only)
--  Adds the production columns the document pipeline writes, and two fresh
--  synthetic carriers. No function, trigger or policy is created or changed.
-- =============================================================================
\set ON_ERROR_STOP on
alter table public.expenses
  add column if not exists vendor_name  text,
  add column if not exists description  text,
  add column if not exists receipt_date date,
  add column if not exists updated_at   timestamptz default now();
alter table public.compliance_documents
  add column if not exists notes text;
alter table public.documents
  add column if not exists reviewed_at timestamptz;
alter table public.profiles
  add column if not exists logo_storage_path text,
  add column if not exists paystub_theme text,
  add column if not exists paystub_footer_legal text;
create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid, actor_user_id uuid, entity_type text, entity_id uuid, action text, metadata jsonb,
  created_at timestamptz default now()
);
alter table public.activity_log enable row level security;
drop policy if exists "own activity" on public.activity_log;
create policy "own activity" on public.activity_log for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
grant all on public.activity_log to authenticated;

insert into auth.users (id) values
  ('cccccccc-0000-0000-0000-000000000001'),
  ('eeeeeeee-0000-0000-0000-000000000001');
insert into public.profiles (id, company_name, mc_number, account_type, account_role) values
  ('cccccccc-0000-0000-0000-000000000001', 'Sacred Test Carrier LLC', '777001', 'carrier', 'carrier'),
  ('eeeeeeee-0000-0000-0000-000000000001', 'Other Test Carrier LLC', '888002', 'carrier', 'carrier');
-- C1 company driver 70 %; C2 owner-operator 88 % (fuel / tolls / scale are the driver's);
-- C3 has NO pay rule (must never be paid automatically).
insert into public.drivers (id, profile_id, name, pay_percentage, settlement_type) values
  ('cccccccc-0000-0000-0000-00000000d001', 'cccccccc-0000-0000-0000-000000000001', 'Marcus Reed', 70, 'company_driver'),
  ('cccccccc-0000-0000-0000-00000000d002', 'cccccccc-0000-0000-0000-000000000001', 'Tina Alvarez', 88, 'owner_operator'),
  ('cccccccc-0000-0000-0000-00000000d003', 'cccccccc-0000-0000-0000-000000000001', 'Sam Okafor', 0, 'company_driver'),
  ('eeeeeeee-0000-0000-0000-00000000d001', 'eeeeeeee-0000-0000-0000-000000000001', 'Other Driver', 70, 'company_driver');
alter table public.loads
  add column if not exists truck_id   uuid,
  add column if not exists trailer_id uuid;
alter table public.drivers
  add column if not exists pay_frequency text;
