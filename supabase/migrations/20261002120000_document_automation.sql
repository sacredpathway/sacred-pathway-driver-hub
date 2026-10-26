-- =============================================================================
--  Document automation (web) — PREPARED, NOT APPLIED
-- -----------------------------------------------------------------------------
--  Supports: duplicate detection, review queue state, routing/audit metadata,
--  driver-document links (CDL / medical card / MVR) and downstream
--  idempotency. Additive only: no rename, no data rewrite, no dropped column,
--  no change to existing RLS policies (the restrictive
--  "document settlement belongs to owner" policy is untouched).
--
--  documents
--    content_sha256      SHA-256 of the uploaded bytes (duplicate detection)
--    source              'web' | 'ios' | 'backfill' (who created the row)
--    extraction_version  'v2' when the canonical v2 extractor produced it
--    duplicate_of        earlier document with the same bytes (same owner)
--    review_status       NULL (not routed yet) | needs_review | auto_routed |
--                        approved | dismissed
--    routing             decision + applied actions + undo snapshots (JSONB)
--    reviewed_at         last human review action
--
--  expenses.source_document_id           unique: one expense per document
--  compliance_documents.driver_id        driver the document belongs to
--  compliance_documents.document_kind    cdl | medical_card | mvr
--  compliance_documents.source_document_id  unique: one row per document
--
--  Guards (BEFORE triggers, only for automation-created rows so every
--  existing human/iOS flow behaves exactly as before):
--    * a linked document / driver must belong to the same profile
--    * an automation expense may never be attached to a settled, cancelled
--      or already-paid load (issued/paid paystub or approved/paid settlement,
--      via the existing public.sph_load_paid_elsewhere)
--
--  Requires 20261001120000_paystub_payment_integrity.sql (sph_load_paid_elsewhere).
--  Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------- documents --
alter table public.documents
  add column if not exists content_sha256     text,
  add column if not exists source             text,
  add column if not exists extraction_version text,
  add column if not exists duplicate_of       uuid,
  add column if not exists review_status      text,
  add column if not exists routing            jsonb,
  add column if not exists reviewed_at        timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_content_sha256_format') then
    alter table public.documents add constraint documents_content_sha256_format
      check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_source_check') then
    alter table public.documents add constraint documents_source_check
      check (source is null or source in ('web', 'ios', 'backfill'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_review_status_check') then
    alter table public.documents add constraint documents_review_status_check
      check (review_status is null
             or review_status in ('needs_review', 'auto_routed', 'approved', 'dismissed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_duplicate_of_fkey') then
    alter table public.documents add constraint documents_duplicate_of_fkey
      foreign key (duplicate_of) references public.documents(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_duplicate_not_self') then
    alter table public.documents add constraint documents_duplicate_not_self
      check (duplicate_of is null or duplicate_of <> id);
  end if;
end $$;

-- Not unique on purpose: a re-upload is recorded and surfaced, never refused
-- or deleted.
create index if not exists documents_profile_sha256_idx
  on public.documents (profile_id, content_sha256)
  where content_sha256 is not null;

create index if not exists documents_profile_review_idx
  on public.documents (profile_id, review_status, created_at desc)
  where review_status is not null;

-- ----------------------------------------------------------------- expenses --
alter table public.expenses
  add column if not exists source_document_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_source_document_fkey') then
    alter table public.expenses add constraint expenses_source_document_fkey
      foreign key (source_document_id) references public.documents(id) on delete set null;
  end if;
end $$;

-- One expense per source document: a retried or concurrent route can never
-- create a second expense for the same receipt.
create unique index if not exists expenses_source_document_unique
  on public.expenses (source_document_id)
  where source_document_id is not null;

-- ----------------------------------------------------- compliance_documents --
alter table public.compliance_documents
  add column if not exists driver_id          uuid,
  add column if not exists document_kind      text,
  add column if not exists source_document_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_documents_driver_fkey') then
    alter table public.compliance_documents add constraint compliance_documents_driver_fkey
      foreign key (driver_id) references public.drivers(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_documents_source_document_fkey') then
    alter table public.compliance_documents add constraint compliance_documents_source_document_fkey
      foreign key (source_document_id) references public.documents(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_documents_kind_check') then
    alter table public.compliance_documents add constraint compliance_documents_kind_check
      check (document_kind is null or document_kind in ('cdl', 'medical_card', 'mvr'));
  end if;
end $$;

create unique index if not exists compliance_documents_source_document_unique
  on public.compliance_documents (source_document_id)
  where source_document_id is not null;

create index if not exists compliance_documents_driver_idx
  on public.compliance_documents (driver_id)
  where driver_id is not null;

-- ------------------------------------------------------------------- guards --

-- documents.duplicate_of must reference a document of the same owner.
-- (A trigger, not a policy: a policy on documents that reads documents would
-- recurse.)
create or replace function public.sph_documents_automation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.duplicate_of is not null
     and (tg_op = 'INSERT' or new.duplicate_of is distinct from old.duplicate_of) then
    if not exists (
      select 1 from public.documents d
       where d.id = new.duplicate_of and d.profile_id = new.profile_id
    ) then
      raise exception 'document_automation_cross_account_duplicate'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sph_documents_automation_guard on public.documents;
create trigger sph_documents_automation_guard
  before insert or update of duplicate_of on public.documents
  for each row execute function public.sph_documents_automation_guard();

-- Automation expenses: same-owner document + load, never on a protected load.
create or replace function public.sph_expenses_automation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if new.source_document_id is null then
    return new;  -- human / iOS expenses: unchanged behaviour
  end if;

  if not exists (
    select 1 from public.documents d
     where d.id = new.source_document_id and d.profile_id = new.profile_id
  ) then
    raise exception 'document_automation_cross_account_document' using errcode = '42501';
  end if;

  if new.load_id is not null then
    select l.status into v_status
      from public.loads l
     where l.id = new.load_id and l.profile_id = new.profile_id;
    if not found then
      raise exception 'document_automation_cross_account_load' using errcode = '42501';
    end if;
    if coalesce(v_status, '') in ('settled', 'cancelled', 'canceled')
       or public.sph_load_paid_elsewhere(new.load_id, null) then
      raise exception 'document_automation_load_protected'
        using errcode = 'P0001',
              hint = 'The load is settled, cancelled or already paid; review the receipt manually.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sph_expenses_automation_guard on public.expenses;
create trigger sph_expenses_automation_guard
  before insert or update of source_document_id, load_id on public.expenses
  for each row execute function public.sph_expenses_automation_guard();

-- Driver documents: driver and source document must belong to the same owner.
create or replace function public.sph_compliance_documents_automation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.driver_id is not null and not exists (
    select 1 from public.drivers dr
     where dr.id = new.driver_id and dr.profile_id = new.profile_id
  ) then
    raise exception 'document_automation_cross_account_driver' using errcode = '42501';
  end if;
  if new.source_document_id is not null and not exists (
    select 1 from public.documents d
     where d.id = new.source_document_id and d.profile_id = new.profile_id
  ) then
    raise exception 'document_automation_cross_account_document' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists sph_compliance_documents_automation_guard on public.compliance_documents;
create trigger sph_compliance_documents_automation_guard
  before insert or update of driver_id, source_document_id on public.compliance_documents
  for each row execute function public.sph_compliance_documents_automation_guard();

revoke all on function public.sph_documents_automation_guard()            from public, anon;
revoke all on function public.sph_expenses_automation_guard()             from public, anon;
revoke all on function public.sph_compliance_documents_automation_guard() from public, anon;
