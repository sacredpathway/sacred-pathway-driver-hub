-- ROLLBACK for PROPOSED_20261105120000_smart_payroll_upload.sql — NOT APPLIED.
-- R1: keeps public.document_payroll_claims_archive (claim history). Dropping
-- that archive is a separate, explicitly approved data-retention decision.
-- Removes only what that migration added. Data in the 4 new columns is lost
-- (they are new, so nothing existing depends on them).
begin;
set local lock_timeout = '15s';
-- Phase 3 objects. R1: claims are audit history, so they are ARCHIVED, never
-- dropped: every row is copied into public.document_payroll_claims_archive
-- (owner read-only, no API writes) before the live table is removed. Running
-- the rollback again (after a re-apply) appends to the same archive.
drop function if exists public.sph_payroll_claim_recover(jsonb);
drop function if exists public.sph_payroll_claim_finalize(jsonb);
drop function if exists public.sph_payroll_claim_release(jsonb);
drop function if exists public.sph_payroll_claim(jsonb);
do $$
begin
  if to_regclass('public.document_payroll_claims') is null then
    return;
  end if;
  if to_regclass('public.document_payroll_claims_archive') is null then
    create table public.document_payroll_claims_archive as
      select c.*, now() as archived_at from public.document_payroll_claims c;
  else
    insert into public.document_payroll_claims_archive
      select (jsonb_populate_record(null::public.document_payroll_claims_archive,
                                    to_jsonb(c) || jsonb_build_object('archived_at', now()))).*
        from public.document_payroll_claims c;
  end if;
  if (select count(*) from public.document_payroll_claims) >
     (select count(*) from public.document_payroll_claims_archive a
       where a.id in (select id from public.document_payroll_claims)) then
    raise exception 'rollback refused: claims archive incomplete';
  end if;
  drop table public.document_payroll_claims;
end $$;
do $$
begin
  if to_regclass('public.document_payroll_claims_archive') is null then
    return;
  end if;
  alter table public.document_payroll_claims_archive enable row level security;
  drop policy if exists "payroll claims archive: owner reads" on public.document_payroll_claims_archive;
  create policy "payroll claims archive: owner reads" on public.document_payroll_claims_archive
    for select using (profile_id = auth.uid());
  revoke all on public.document_payroll_claims_archive from public, anon, authenticated, service_role;
  grant select on public.document_payroll_claims_archive to authenticated, service_role;
  comment on table public.document_payroll_claims_archive is
    'Smart Payroll Upload claim history preserved by the rollback of PROPOSED_20261105120000. Read-only.';
end $$;
drop function if exists public.sph_payroll_claims_guard();
drop function if exists public.sph_payroll_fail(text, text);
drop trigger if exists sph_documents_payroll_guard on public.documents;
drop function if exists public.sph_documents_payroll_guard();
drop index if exists public.documents_profile_identity_idx;
drop index if exists public.documents_profile_sha256_live_uidx;
alter table public.documents
  drop constraint if exists documents_corrections_is_array,
  drop constraint if exists documents_payroll_status_check,
  drop constraint if exists documents_identity_format,
  drop constraint if exists documents_extraction_profile_check;
alter table public.documents
  drop column if exists corrections,
  drop column if exists payroll_status,
  drop column if exists document_identity,
  drop column if exists extraction_profile;
commit;
