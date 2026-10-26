-- =============================================================================
--  Fixture for 20261002120000_document_automation.sql. Loaded AFTER
--  ../paystub_payment_integrity/00_fixture.sql and the two payment-integrity
--  migrations (so sph_load_paid_elsewhere exists exactly as in production).
--  documents / expenses / compliance_documents mirror the production columns,
--  FKs, CHECKs and RLS policies captured read-only on 2026-10-01.
--  Never run this against a real Supabase project.
-- =============================================================================

\set ON_ERROR_STOP on

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  load_id uuid references public.loads(id),
  document_type text,
  storage_path text not null,
  extracted_data jsonb,
  confidence text,
  processed boolean,
  created_at timestamptz default now(),
  raw_text text,
  status text not null default 'pending'
    check (status = any (array['pending','processing','processed','failed','manual'])),
  error_message text,
  is_manual boolean not null default false,
  provider text not null default 'openai',
  model text,
  file_mime_type text,
  file_size integer,
  retry_count integer not null default 0,
  updated_at timestamptz default now(),
  settlement_id uuid references public.settlements(id) on delete set null
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  load_id uuid references public.loads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  amount numeric not null,
  vendor_name text,
  description text,
  receipt_date date,
  created_at timestamptz default now()
);

create table public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category = any (array['company','truck','trailer','driver'])),
  title text not null,
  storage_path text,
  issue_date date,
  expiration_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.documents enable row level security;
alter table public.expenses enable row level security;
alter table public.compliance_documents enable row level security;

create policy "Users manage own documents" on public.documents for all using (profile_id = auth.uid());
create policy "document settlement belongs to owner" on public.documents as restrictive for all using (true)
  with check (settlement_id is null or exists (select 1 from public.settlements s
    where s.id = documents.settlement_id and s.profile_id = documents.profile_id));
create policy "Users manage own expenses" on public.expenses for all using (profile_id = auth.uid());
create policy "own compliance docs" on public.compliance_documents for all
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

grant all on public.documents, public.expenses, public.compliance_documents
  to anon, authenticated, service_role;

-- Legacy rows (like production): must be unchanged by the migration.
insert into public.documents (id, profile_id, document_type, storage_path, status, provider) values
  ('aaaaaaaa-0000-0000-0000-0000000d0c01', 'aaaaaaaa-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001/legacy.jpg', 'pending', 'openai'),
  ('aaaaaaaa-0000-0000-0000-0000000d0c02', 'aaaaaaaa-0000-0000-0000-000000000001', 'paystub',
   'aaaaaaaa-0000-0000-0000-000000000001/paystub.pdf', 'processed', 'manual');
insert into public.expenses (id, profile_id, load_id, category, amount, vendor_name, receipt_date) values
  ('aaaaaaaa-0000-0000-0000-0000000ee001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e0001', 'fuel', 412.18, 'Legacy Fuel', '2026-09-01');

create table public.fixture_docs_snapshot as
  select 'documents' t, id, to_jsonb(d) row from public.documents d
  union all select 'expenses', id, to_jsonb(e) from public.expenses e;
