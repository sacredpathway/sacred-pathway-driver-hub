-- =============================================================================
--  PROPOSED — NOT APPLIED ANYWHERE. Requires owner approval, then local PG 17.6
--  rehearsal, then staging (aatkirzwuuegurdlmcpl), then production.
--  Smart Payroll Upload (migration #4 candidate) — Sacred Pathway Driver Hub
-- -----------------------------------------------------------------------------
--  Additive only:
--    * 4 nullable columns on public.documents (no default, no backfill);
--    * 2 indexes (1 unique partial, see PRECONDITION);
--    * 1 NEW guard function + trigger (existing guard untouched);
--    * Phase 3: NEW table public.document_payroll_claims (RLS, owner only)
--      + guard trigger + 4 SECURITY INVOKER functions:
--        sph_payroll_claim / _finalize / _release / _recover.
--      R1 (2026-10-24): claim history survives document deletion (document_id
--      -> NULL + snapshot), only the 4 functions may write claims (the guard
--      refuses direct REST writes), least-privilege grants, and the rollback
--      ARCHIVES claims instead of dropping them.
--      The claim table has NO foreign key to settlements, settlement_loads or
--      loads, and none of the 4 functions lock those tables, so the lock graph
--      of sph_web_save_settlement / sph_web_transition_settlement (migration
--      #3) is unchanged.
--  NOT touched: sph_web_save_settlement, sph_web_transition_settlement
--  (migration #3 lock order), settlement tables, payroll calculations, RLS
--  policies, storage, existing triggers/functions.
--
--  Per-field evidence is stored inside documents.extracted_data (jsonb) by the
--  v3 extractor, so no evidence column is needed.
--
--  PRECONDITION for the unique index: the web upload path must set
--  duplicate_of (or not insert) when the same file is uploaded again by the
--  same account. Verify web-app/lib/documents/upload.ts + pipeline.ts first;
--  production today has 0 duplicate sha groups (1 of 174 rows has a sha).
-- =============================================================================

begin;
set local lock_timeout = '15s';

alter table public.documents
  add column if not exists extraction_profile text,
  add column if not exists document_identity  text,
  add column if not exists payroll_status     text,
  add column if not exists corrections        jsonb;

-- Re-runnable: drop-then-add (the constraints only cover the new columns).
alter table public.documents
  drop constraint if exists documents_extraction_profile_check,
  drop constraint if exists documents_identity_format,
  drop constraint if exists documents_payroll_status_check,
  drop constraint if exists documents_corrections_is_array;

alter table public.documents
  add constraint documents_extraction_profile_check
    check (extraction_profile is null or extraction_profile in ('payroll')),
  add constraint documents_identity_format
    check (document_identity is null or (length(document_identity) between 3 and 300)),
  add constraint documents_payroll_status_check
    check (payroll_status is null or payroll_status in ('reference_only', 'proposed', 'confirmed', 'rejected')),
  add constraint documents_corrections_is_array
    check (corrections is null or jsonb_typeof(corrections) = 'array');

-- Same FILE, same account, live rows only (duplicates point at the original
-- via duplicate_of; dismissed rows are history).
create unique index if not exists documents_profile_sha256_live_uidx
  on public.documents (profile_id, content_sha256)
  where content_sha256 is not null
    and duplicate_of is null
    and review_status is distinct from 'dismissed';

-- Same DOCUMENT (different file): lookup only, never unique.
create index if not exists documents_profile_identity_idx
  on public.documents (profile_id, document_identity)
  where document_identity is not null;

-- Finalized payroll stays put: once a document is attached to an approved /
-- paid / voided settlement (or its lines), those links and its confirmed
-- payroll record cannot be changed. Reopening the settlement (audited, via
-- sph_web_transition_settlement) releases it.
create or replace function public.sph_documents_payroll_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if old.settlement_id is not null then
    select s.status into v_status from public.settlements s where s.id = old.settlement_id;
    if coalesce(v_status, '') in ('approved', 'paid', 'voided') and (
         new.settlement_id is distinct from old.settlement_id
      or new.addition_id   is distinct from old.addition_id
      or new.deduction_id  is distinct from old.deduction_id
      or new.load_id       is distinct from old.load_id
      or new.payroll_status is distinct from old.payroll_status
      or new.corrections   is distinct from old.corrections) then
      raise exception 'document_payroll_locked'
        using errcode = 'P0001',
              hint = 'This document belongs to a finalized settlement. Reopen the settlement first.';
    end if;
  end if;
  -- A document confirmed through Smart Payroll Upload can't be moved to a
  -- different settlement (unlinking from a draft, or the draft's deletion, is
  -- still allowed). Phase 3.
  if old.settlement_id is not null and new.settlement_id is not null
     and new.settlement_id is distinct from old.settlement_id
     and to_regclass('public.document_payroll_claims') is not null
     and exists (select 1 from public.document_payroll_claims c
                  where c.document_id = old.id and c.status = 'confirmed' and c.settlement_id = old.settlement_id) then
    raise exception 'document_payroll_relink'
      using errcode = 'P0001', hint = 'This document was confirmed onto another settlement.';
  end if;
  -- A settlement link must stay inside the same carrier account.
  if new.settlement_id is not null and new.settlement_id is distinct from old.settlement_id
     and not exists (select 1 from public.settlements s
                      where s.id = new.settlement_id and s.profile_id = new.profile_id) then
    raise exception 'document_payroll_cross_account' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.sph_documents_payroll_guard() from public, anon;

drop trigger if exists sph_documents_payroll_guard on public.documents;
create trigger sph_documents_payroll_guard
  before update of settlement_id, addition_id, deduction_id, load_id, payroll_status, corrections
  on public.documents
  for each row execute function public.sph_documents_payroll_guard();

comment on column public.documents.extraction_profile is 'Smart Payroll Upload: "payroll" when extracted with profile v3.';
comment on column public.documents.document_identity  is 'Normalized printed identity (type|identifiers) for duplicate detection.';
comment on column public.documents.payroll_status     is 'reference_only | proposed | confirmed | rejected. Never set automatically to confirmed.';
comment on column public.documents.corrections        is 'Audit: [{field, extracted, saved, source, at, by}] recorded when a human confirms.';

-- =============================================================================
--  Phase 3 — confirmation claims (database-enforced idempotency)
-- -----------------------------------------------------------------------------
--  Flow (web server action, each step its own short transaction):
--    1. sph_payroll_claim     -> one PENDING claim per document AND per load
--                                (unique partial indexes); refuses linked /
--                                dismissed / duplicate documents, foreign or
--                                unpayable loads, finalized target drafts.
--    2. existing createSettlementAction / saveSettlementAction
--                                -> sph_web_save_settlement (UNCHANGED)
--    3a. success: sph_payroll_claim_finalize -> verifies the draft line for
--                                the claimed load, links the document once,
--                                records the settlement line id (traceability)
--    3b. failure: sph_payroll_claim_release  -> claim freed immediately
--    crash between 1 and 3: the claim EXPIRES (default 120 s); a crash after
--    step 2 is healed by sph_payroll_claim_recover on the next attempt.
-- =============================================================================

create table if not exists public.document_payroll_claims (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  document_id           uuid,                   -- FK below: on delete SET NULL (R1)
  load_id               uuid not null,          -- no FK on purpose (lock graph)
  claim_token           uuid not null,
  plan                  text not null,
  target_settlement_id  uuid,                   -- add_to_draft only; no FK
  status                text not null default 'pending',
  settlement_id         uuid,                   -- no FK on purpose (lock graph)
  settlement_load_id    uuid,                   -- the exact draft line created
  confirmation          jsonb,
  recovered             boolean not null default false,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  confirmed_at          timestamptz,
  released_at           timestamptz,
  released_reason       text,
  document_snapshot     jsonb,                  -- R1: document facts at claim time
  document_deleted_at   timestamptz             -- R1: set when the document is deleted
);

-- R1: re-runnable upgrade of a table created by an earlier draft.
alter table public.document_payroll_claims
  add column if not exists document_snapshot   jsonb,
  add column if not exists document_deleted_at timestamptz;
alter table public.document_payroll_claims alter column document_id drop not null;
alter table public.document_payroll_claims drop constraint if exists document_payroll_claims_document_id_fkey;
alter table public.document_payroll_claims
  add constraint document_payroll_claims_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete set null;

alter table public.document_payroll_claims
  drop constraint if exists document_payroll_claims_status_check,
  drop constraint if exists document_payroll_claims_plan_check,
  drop constraint if exists document_payroll_claims_shape_check;
alter table public.document_payroll_claims
  add constraint document_payroll_claims_status_check check (status in ('pending', 'confirmed', 'released')),
  add constraint document_payroll_claims_plan_check   check (plan in ('create', 'add_to_draft')),
  add constraint document_payroll_claims_shape_check  check (
        (status = 'pending'   and confirmed_at is null and released_at is null and settlement_id is null and (document_id is not null or document_deleted_at is not null))
     or (status = 'confirmed' and confirmed_at is not null and settlement_id is not null and settlement_load_id is not null and released_at is null)
     or (status = 'released'  and released_at is not null and released_reason is not null));

-- One live claim per DOCUMENT (pending or confirmed) and one pending claim
-- per LOAD. These two indexes are the idempotency guarantee.
create unique index if not exists document_payroll_claims_document_live_uidx
  on public.document_payroll_claims (document_id) where status in ('pending', 'confirmed');
create unique index if not exists document_payroll_claims_load_pending_uidx
  on public.document_payroll_claims (load_id) where status = 'pending';
create index if not exists document_payroll_claims_profile_idx
  on public.document_payroll_claims (profile_id, created_at desc);
create index if not exists document_payroll_claims_settlement_idx
  on public.document_payroll_claims (settlement_id) where settlement_id is not null;

alter table public.document_payroll_claims enable row level security;
drop policy if exists "payroll claims: owner reads"   on public.document_payroll_claims;
drop policy if exists "payroll claims: owner inserts" on public.document_payroll_claims;
drop policy if exists "payroll claims: owner updates" on public.document_payroll_claims;
create policy "payroll claims: owner reads"   on public.document_payroll_claims for select using (profile_id = auth.uid());
create policy "payroll claims: owner inserts" on public.document_payroll_claims for insert with check (profile_id = auth.uid());
create policy "payroll claims: owner updates" on public.document_payroll_claims for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
-- No delete policy: claims are the audit trail.
-- R1 least privilege: no DELETE / TRUNCATE / REFERENCES / TRIGGER for any API
-- role. INSERT / UPDATE stay granted only because the 4 SECURITY INVOKER
-- functions run as the caller; the guard refuses any write that does not come
-- from them.
revoke all on public.document_payroll_claims from public, anon, authenticated, service_role;
grant select, insert, update on public.document_payroll_claims to authenticated, service_role;

-- Guard: even a direct REST write must follow the state machine.
create or replace function public.sph_payroll_claims_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- R1: the document was deleted (foreign key ON DELETE SET NULL). Keep the
  -- claim; record when. Nothing else may change in this update.
  if tg_op = 'UPDATE' and old.document_id is not null and new.document_id is null
     and (to_jsonb(new) - 'document_id' - 'document_deleted_at') = (to_jsonb(old) - 'document_id' - 'document_deleted_at')
     and not exists (select 1 from public.documents d where d.id = old.document_id) then
    new.document_deleted_at := coalesce(old.document_deleted_at, now());
    return new;
  end if;

  -- R1: only sph_payroll_claim / _release / _finalize / _recover may write.
  if coalesce(current_setting('sph.payroll_claim_write', true), '') <> 'on' then
    raise exception 'payroll_claim_direct_write' using errcode = '42501', hint = 'sph:claim_direct_write';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'pending' or new.settlement_id is not null or new.settlement_load_id is not null or new.recovered
       or new.document_id is null or new.document_deleted_at is not null then
      raise exception 'payroll_claim_invalid' using errcode = 'P0001', hint = 'sph:claim_invalid';
    end if;
    if new.expires_at <= now() or new.expires_at > now() + interval '10 minutes' then
      raise exception 'payroll_claim_invalid' using errcode = 'P0001', hint = 'sph:claim_invalid';
    end if;
    if not exists (select 1 from public.documents d where d.id = new.document_id and d.profile_id = new.profile_id)
       or not exists (select 1 from public.loads l where l.id = new.load_id and l.profile_id = new.profile_id) then
      raise exception 'payroll_claim_cross_account' using errcode = '42501', hint = 'sph:cross_account';
    end if;
    return new;
  end if;

  if new.id <> old.id or new.profile_id <> old.profile_id or new.document_id is distinct from old.document_id
     or new.load_id <> old.load_id or new.claim_token <> old.claim_token or new.plan <> old.plan
     or new.target_settlement_id is distinct from old.target_settlement_id
     or new.created_at <> old.created_at or new.expires_at <> old.expires_at
     or new.document_snapshot is distinct from old.document_snapshot
     or new.document_deleted_at is distinct from old.document_deleted_at then
    raise exception 'payroll_claim_immutable' using errcode = 'P0001', hint = 'sph:claim_immutable';
  end if;

  if old.status = 'released' then
    raise exception 'payroll_claim_immutable' using errcode = 'P0001', hint = 'sph:claim_immutable';
  end if;

  if old.status = 'confirmed' then
    -- Only allowed change: retire a confirmation whose draft no longer holds
    -- the document (draft deleted, or document unlinked while still a draft).
    if new.status <> 'released'
       or new.confirmation is distinct from old.confirmation or new.recovered <> old.recovered
       or new.settlement_id is distinct from old.settlement_id or new.settlement_load_id is distinct from old.settlement_load_id
       or new.confirmed_at is distinct from old.confirmed_at
       or exists (select 1 from public.documents d where d.id = old.document_id and d.settlement_id = old.settlement_id) then
      raise exception 'payroll_claim_immutable' using errcode = 'P0001', hint = 'sph:claim_immutable';
    end if;
    return new;
  end if;

  -- old.status = 'pending'
  -- R1: the confirmation record may only change together with the move to
  -- 'confirmed' (finalize writes it once); a pending claim's record is frozen.
  if new.status = 'pending' and (new.confirmation is distinct from old.confirmation or new.recovered <> old.recovered) then
    raise exception 'payroll_claim_immutable' using errcode = 'P0001', hint = 'sph:claim_immutable';
  end if;
  if new.status = 'released' and (new.confirmation is distinct from old.confirmation or new.recovered <> old.recovered) then
    raise exception 'payroll_claim_immutable' using errcode = 'P0001', hint = 'sph:claim_immutable';
  end if;
  if new.status = 'confirmed' then
    if not exists (
         select 1 from public.settlement_loads sl
           join public.settlements s on s.id = sl.settlement_id
          where sl.id = new.settlement_load_id and sl.settlement_id = new.settlement_id
            and sl.load_id = new.load_id and sl.is_adjustment = false
            and s.profile_id = new.profile_id
            and coalesce(s.status, 'draft') in ('draft', 'ready_for_review'))
       or not exists (select 1 from public.documents d where d.id = new.document_id and d.settlement_id = new.settlement_id) then
      raise exception 'payroll_claim_unverified' using errcode = 'P0001', hint = 'sph:claim_unverified';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.sph_payroll_claims_guard() from public, anon, authenticated;
drop trigger if exists sph_payroll_claims_guard on public.document_payroll_claims;
create trigger sph_payroll_claims_guard
  before insert or update on public.document_payroll_claims
  for each row execute function public.sph_payroll_claims_guard();

create or replace function public.sph_payroll_fail(p_code text, p_message text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '%', p_message using errcode = 'P0001', hint = 'sph:' || p_code;
end $$;

-- 1. CLAIM ---------------------------------------------------------------------
--  p: {document_id, load_id, plan: create|add_to_draft, target_settlement_id?,
--      ttl_seconds? (30..600, default 120), confirmation? (jsonb)}
create or replace function public.sph_payroll_claim(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents%rowtype;
  v_load_id uuid;
  v_plan text := p->>'plan';
  v_target uuid;
  v_ttl int := least(greatest(coalesce((p->>'ttl_seconds')::int, 120), 30), 600);
  v_token uuid := gen_random_uuid();
  v_claim public.document_payroll_claims%rowtype;
  v_conflict text;
  v_target_status text;
begin
  if v_uid is null then perform public.sph_payroll_fail('not_authenticated', 'Sign in again.'); end if;
  perform set_config('sph.payroll_claim_write', 'on', true);
  begin
    v_load_id := (p->>'load_id')::uuid;
    v_target  := nullif(p->>'target_settlement_id', '')::uuid;
  exception when invalid_text_representation then
    perform public.sph_payroll_fail('bad_request', 'Invalid request.');
  end;
  if v_plan is null or v_plan not in ('create', 'add_to_draft') or v_load_id is null
     or (v_plan = 'add_to_draft') <> (v_target is not null) then
    perform public.sph_payroll_fail('bad_request', 'Invalid request.');
  end if;

  -- Serialize claims for one document. NO KEY UPDATE does not conflict with the
  -- KEY SHARE an iPhone settlement save takes through its document FKs.
  select * into v_doc from public.documents d
   where d.id = nullif(p->>'document_id', '')::uuid and d.profile_id = v_uid
   for no key update;
  if not found then perform public.sph_payroll_fail('document_not_found', 'Document not found.'); end if;
  if v_doc.settlement_id is not null then
    perform public.sph_payroll_fail('document_already_linked', 'This document is already linked to a settlement.');
  end if;
  if v_doc.duplicate_of is not null or v_doc.review_status = 'dismissed' then
    perform public.sph_payroll_fail('document_unavailable', 'This document was dismissed or is a duplicate.');
  end if;

  -- Free what is provably stale: expired pending claims for this document or
  -- load, and confirmations whose draft no longer holds this document.
  update public.document_payroll_claims c
     set status = 'released', released_at = now(), released_reason = 'expired'
   where c.status = 'pending' and c.expires_at < now()
     and (c.document_id = v_doc.id or c.load_id = v_load_id);
  update public.document_payroll_claims c
     set status = 'released', released_at = now(), released_reason = 'draft_no_longer_linked'
   where c.status = 'confirmed' and c.document_id = v_doc.id;   -- doc is unlinked (checked above)

  begin
    insert into public.document_payroll_claims (profile_id, document_id, load_id, claim_token, plan, target_settlement_id, expires_at, confirmation, document_snapshot)
    values (v_uid, v_doc.id, v_load_id, v_token, v_plan, v_target, now() + make_interval(secs => v_ttl),
            case when jsonb_typeof(p->'confirmation') = 'object' then p->'confirmation' end,
            jsonb_build_object('document_id', v_doc.id, 'document_type', v_doc.document_type, 'storage_path', v_doc.storage_path,
                               'content_sha256', v_doc.content_sha256, 'extraction_version', v_doc.extraction_version,
                               'uploaded_at', v_doc.created_at))
    returning * into v_claim;
  exception when unique_violation then
    perform public.sph_payroll_fail('claim_conflict',
      'This document or load is being confirmed in another tab or request. Wait a moment, then reload.');
  end;

  -- Checks run AFTER the insert: a competing confirmation that just committed
  -- its draft is visible here (READ COMMITTED, new snapshot per statement).
  select c.conflict into v_conflict from public.sph_loads_payment_conflicts(array[v_load_id]) c limit 1;
  if v_conflict is not null then
    perform public.sph_payroll_fail(v_conflict, 'This load can''t be paid: ' || replace(v_conflict, '_', ' ') || '.');
  end if;
  if exists (select 1 from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id
              where sl.load_id = v_load_id and sl.is_adjustment = false and s.profile_id = v_uid
                and coalesce(s.status, 'draft') <> 'voided' and coalesce(s.is_estimate, false) = false) then
    perform public.sph_payroll_fail('load_on_settlement', 'This load is already on a settlement.');
  end if;
  if v_plan = 'add_to_draft' then
    select coalesce(s.status, 'draft') into v_target_status from public.settlements s
     where s.id = v_target and s.profile_id = v_uid;
    if not found then perform public.sph_payroll_fail('settlement_not_found', 'Settlement not found.'); end if;
    if v_target_status not in ('draft', 'ready_for_review') then
      perform public.sph_payroll_fail('settlement_finalized', 'That settlement is finalized and can''t be changed here.');
    end if;
  end if;

  perform set_config('sph.payroll_claim_write', 'off', true);
  return jsonb_build_object('claim_id', v_claim.id, 'claim_token', v_claim.claim_token, 'expires_at', v_claim.expires_at);
end $$;

-- 2. RELEASE -------------------------------------------------------------------
--  p: {claim_id, claim_token, reason}
create or replace function public.sph_payroll_claim_release(p jsonb)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare n int;
begin
  perform set_config('sph.payroll_claim_write', 'on', true);
  update public.document_payroll_claims c
     set status = 'released', released_at = now(),
         released_reason = left(coalesce(nullif(p->>'reason', ''), 'released'), 200)
   where c.id = (p->>'claim_id')::uuid and c.claim_token = (p->>'claim_token')::uuid
     and c.profile_id = auth.uid() and c.status = 'pending';
  get diagnostics n = row_count;
  perform set_config('sph.payroll_claim_write', 'off', true);
  return n = 1;
end $$;

-- 3. FINALIZE ------------------------------------------------------------------
--  p: {claim_id, claim_token, settlement_id, confirmation?}
--  Idempotent: finalizing an already-confirmed claim with the same draft
--  returns the same answer.
create or replace function public.sph_payroll_claim_finalize(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.document_payroll_claims%rowtype;
  v_sid uuid := (p->>'settlement_id')::uuid;
  v_line uuid;
  v_conf jsonb;
  v_recovered boolean := coalesce((p->>'_recovered')::boolean, false);
  n int;
begin
  perform set_config('sph.payroll_claim_write', 'on', true);
  select * into v_claim from public.document_payroll_claims c
   where c.id = (p->>'claim_id')::uuid and c.claim_token = (p->>'claim_token')::uuid and c.profile_id = v_uid
   for update;
  if not found then perform public.sph_payroll_fail('claim_not_found', 'Confirmation not found.'); end if;
  if v_claim.status = 'confirmed' and v_claim.settlement_id = v_sid then
    perform set_config('sph.payroll_claim_write', 'off', true);
    return jsonb_build_object('settlement_id', v_claim.settlement_id, 'settlement_load_id', v_claim.settlement_load_id, 'already', true);
  end if;
  if v_claim.status <> 'pending' then
    perform public.sph_payroll_fail('claim_released', 'This confirmation was released. Reload and review again.');
  end if;
  if v_claim.plan = 'add_to_draft' and v_sid is distinct from v_claim.target_settlement_id then
    perform public.sph_payroll_fail('claim_target_mismatch', 'That is not the draft that was confirmed.');
  end if;

  select sl.id into v_line
    from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id
   where sl.settlement_id = v_sid and sl.load_id = v_claim.load_id and sl.is_adjustment = false
     and s.profile_id = v_uid and coalesce(s.status, 'draft') in ('draft', 'ready_for_review');
  if v_line is null then
    perform public.sph_payroll_fail('settlement_line_not_found', 'The draft does not contain the confirmed load.');
  end if;

  v_conf := coalesce(case when jsonb_typeof(p->'confirmation') = 'object' then p->'confirmation' end, v_claim.confirmation, '{}'::jsonb)
            || jsonb_build_object('settlement_id', v_sid, 'settlement_load_id', v_line, 'claim_id', v_claim.id,
                                  'load_id', v_claim.load_id, 'plan', v_claim.plan,
                                  'confirmed_at', now(), 'confirmed_by', v_uid, 'recovered', v_recovered);

  update public.documents d
     set settlement_id = v_sid,
         review_status = 'approved',
         reviewed_at = now(),
         payroll_status = 'confirmed',
         corrections = case when jsonb_typeof(v_conf->'corrections') = 'array' then v_conf->'corrections' else d.corrections end,
         routing = jsonb_set(coalesce(d.routing, '{}'::jsonb), '{payroll}', v_conf)
                   || jsonb_build_object('history',
                        coalesce(case when jsonb_typeof(d.routing->'history') = 'array' then d.routing->'history' end, '[]'::jsonb)
                        || jsonb_build_array(jsonb_build_object(
                             'at', now(), 'by', 'user',
                             'event', case when v_recovered then 'payroll_draft_recovered' else 'payroll_draft_confirmed' end,
                             'detail', case when v_claim.plan = 'create' then 'New draft ' else 'Added to draft ' end
                                       || v_sid || ' · load ' || v_claim.load_id || ' · line ' || v_line)))
   where d.id = v_claim.document_id and d.profile_id = v_uid and d.settlement_id is null;
  get diagnostics n = row_count;
  if n <> 1 then
    perform public.sph_payroll_fail('document_already_linked', 'This document is already linked to a settlement.');
  end if;

  update public.document_payroll_claims c
     set status = 'confirmed', settlement_id = v_sid, settlement_load_id = v_line,
         confirmed_at = now(), confirmation = v_conf, recovered = v_recovered
   where c.id = v_claim.id;

  perform set_config('sph.payroll_claim_write', 'off', true);
  return jsonb_build_object('settlement_id', v_sid, 'settlement_load_id', v_line, 'already', false, 'recovered', v_recovered);
end $$;

-- 4. RECOVER -------------------------------------------------------------------
--  p: {document_id}. Heals a request that died AFTER its draft was saved but
--  BEFORE finalize: an EXPIRED pending claim whose load appears on exactly one
--  of this account's open drafts on a line created after the claim.
--  Returns {state: linked | recovered | released | ambiguous | none}.
create or replace function public.sph_payroll_claim_recover(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_doc public.documents%rowtype;
  v_claim public.document_payroll_claims%rowtype;
  v_sids uuid[];
begin
  perform set_config('sph.payroll_claim_write', 'on', true);
  select * into v_doc from public.documents d
   where d.id = nullif(p->>'document_id', '')::uuid and d.profile_id = v_uid
   for no key update;
  if not found then perform public.sph_payroll_fail('document_not_found', 'Document not found.'); end if;
  if v_doc.settlement_id is not null then
    perform set_config('sph.payroll_claim_write', 'off', true);
    return jsonb_build_object('state', 'linked', 'settlement_id', v_doc.settlement_id);
  end if;
  select * into v_claim from public.document_payroll_claims c
   where c.document_id = v_doc.id and c.profile_id = v_uid and c.status = 'pending' and c.expires_at < now()
   order by c.created_at desc limit 1
   for update;
  if not found then
    perform set_config('sph.payroll_claim_write', 'off', true);
    return jsonb_build_object('state', 'none');
  end if;

  select array_agg(distinct s.id) into v_sids
    from public.settlement_loads sl join public.settlements s on s.id = sl.settlement_id
   where sl.load_id = v_claim.load_id and sl.is_adjustment = false and sl.created_at >= v_claim.created_at
     and s.profile_id = v_uid and coalesce(s.status, 'draft') in ('draft', 'ready_for_review')
     and (v_claim.plan = 'create' or s.id = v_claim.target_settlement_id);

  if coalesce(cardinality(v_sids), 0) = 1 then
    -- finalize switches the write flag off before it returns.
    return public.sph_payroll_claim_finalize(jsonb_build_object(
      'claim_id', v_claim.id, 'claim_token', v_claim.claim_token, 'settlement_id', v_sids[1], '_recovered', true))
      || jsonb_build_object('state', 'recovered');
  end if;
  update public.document_payroll_claims c
     set status = 'released', released_at = now(),
         released_reason = case when coalesce(cardinality(v_sids), 0) = 0 then 'expired_no_draft' else 'expired_ambiguous' end
   where c.id = v_claim.id;
  perform set_config('sph.payroll_claim_write', 'off', true);
  return jsonb_build_object('state', case when coalesce(cardinality(v_sids), 0) = 0 then 'released' else 'ambiguous' end);
end $$;

revoke all on function public.sph_payroll_fail(text, text) from public, anon;
revoke all on function public.sph_payroll_claim(jsonb)          from public, anon;
revoke all on function public.sph_payroll_claim_release(jsonb)  from public, anon;
revoke all on function public.sph_payroll_claim_finalize(jsonb) from public, anon;
revoke all on function public.sph_payroll_claim_recover(jsonb)  from public, anon;
grant execute on function public.sph_payroll_fail(text, text)    to authenticated, service_role;
grant execute on function public.sph_payroll_claim(jsonb)          to authenticated, service_role;
grant execute on function public.sph_payroll_claim_release(jsonb)  to authenticated, service_role;
grant execute on function public.sph_payroll_claim_finalize(jsonb) to authenticated, service_role;
grant execute on function public.sph_payroll_claim_recover(jsonb)  to authenticated, service_role;

comment on table public.document_payroll_claims is
  'Smart Payroll Upload: one row per confirmation attempt. Links document -> user confirmation -> settlement draft line. Append/transition only; written only by sph_payroll_claim*; survives document deletion (document_id NULL, document_snapshot kept); archived (not dropped) by the rollback.';

commit;
