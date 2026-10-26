-- =============================================================================
--  PROPOSED migration #6 — database-level verified rate-confirmation safeguard
--  (NOT APPLIED to production. Staging + local only until the owner approves.)
-- -----------------------------------------------------------------------------
--  Problem (found in staging test D2, 2026-10-26): sph_load_create_verified
--  (#5) trusted the request body. Any signed-in carrier could call it directly
--  with arbitrary values and get a load, with no document at all. And the
--  documents table cannot prove verification on its own: a carrier may update
--  their own documents (RLS), including extracted_data / extraction_version /
--  confidence.
--
--  Design
--  1. TRUSTED FACT: public.document_extraction_attestations. One row per
--     document holding a snapshot of extracted_data exactly as the SERVER wrote
--     it (Edge Function = service_role; or a database admin with no end-user
--     JWT). Written only by the trigger below; signed-in users can only SELECT
--     their own rows; no INSERT/UPDATE/DELETE grant for anon/authenticated.
--  2. A signed-in user's own write to extracted_data does NOT refresh the
--     snapshot, so any later edit makes documents.extracted_data differ from
--     the attestation and automatic creation is refused ("edited").
--  3. AUTOMATIC creation = sph_load_create_verified(p). It now REQUIRES
--     p.document_id, re-checks every verification rule in SQL against the
--     attested snapshot, and builds the load ONLY from attested values. The
--     only caller-chosen input is driver_id, and that must be this carrier's
--     single active driver whose name matches the printed driver.
--     Request values such as load_number / total_revenue are IGNORED.
--  4. MANUAL creation is unchanged: a person's direct insert into loads under
--     the existing RLS policy ("Users manage own loads"). The database cannot
--     (and does not try to) label a load "manual" vs "automatic" after the
--     fact; the guarantee is about the automatic path: it can only produce a
--     load that a verified, unedited, server-read rate confirmation supports.
--  Unchanged: carrier isolation (auth.uid() + RLS), driver ownership, duplicate
--  prevention (advisory lock per carrier + normalised number), revenue > 0.
--  SECURITY INVOKER everywhere: no RLS bypass, no new definer functions.
--  Additive + idempotent. Nothing existing is updated or deleted.
--  Rollback: ROLLBACK_PROPOSED_20261107120000_verified_rate_con_safeguard.sql
-- =============================================================================
begin;
set local lock_timeout = '15s';

-- 1. Attestations ---------------------------------------------------------------
create table if not exists public.document_extraction_attestations (
  document_id        uuid primary key references public.documents(id) on delete cascade,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  extraction_version text not null,
  snapshot           jsonb not null,
  attested_at        timestamptz not null default now(),
  attested_role      text not null
);
create index if not exists document_extraction_attestations_profile_idx
  on public.document_extraction_attestations (profile_id);
alter table public.document_extraction_attestations enable row level security;
drop policy if exists "attestations: owner reads" on public.document_extraction_attestations;
create policy "attestations: owner reads" on public.document_extraction_attestations
  for select using (profile_id = auth.uid());
revoke all on public.document_extraction_attestations from public, anon, authenticated, service_role;
grant select on public.document_extraction_attestations to authenticated;
grant select, insert, update, delete on public.document_extraction_attestations to service_role;
comment on table public.document_extraction_attestations is
  'Server-written snapshot of a document''s extraction (Edge Function / admin only). The trusted basis for automatic load creation. Users can read their own rows, never write.';

-- 2. Who counts as the server -------------------------------------------------
--  Trusted: a request whose JWT role is service_role (the Edge Function), or a
--  direct database session with NO end-user JWT as postgres/supabase_admin
--  (migrations, SQL editor). A signed-in user is never trusted, including
--  inside any SECURITY DEFINER function (JWT role stays "authenticated").
create or replace function public.sph_extraction_writer_trusted()
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb;
  v_role text;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  v_role := v_claims->>'role';
  if v_role is not null then
    return v_role = 'service_role';
  end if;
  return current_user in ('service_role', 'postgres', 'supabase_admin');
end $$;
revoke all on function public.sph_extraction_writer_trusted() from public, anon;
grant execute on function public.sph_extraction_writer_trusted() to authenticated, service_role;

-- 3. Snapshot trigger ----------------------------------------------------------
create or replace function public.sph_documents_attest_extraction()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.sph_extraction_writer_trusted() then
    return null;  -- a user's write never creates or refreshes an attestation
  end if;
  if new.extraction_version = 'v3' and new.extracted_data is not null
     and jsonb_typeof(new.extracted_data) = 'object' then
    insert into public.document_extraction_attestations
      (document_id, profile_id, extraction_version, snapshot, attested_at, attested_role)
    values (new.id, new.profile_id, new.extraction_version, new.extracted_data, now(), current_user)
    on conflict (document_id) do update
      set profile_id = excluded.profile_id, extraction_version = excluded.extraction_version,
          snapshot = excluded.snapshot, attested_at = excluded.attested_at, attested_role = excluded.attested_role;
  else
    delete from public.document_extraction_attestations a where a.document_id = new.id;
  end if;
  return null;
end $$;
revoke all on function public.sph_documents_attest_extraction() from public, anon, authenticated;

drop trigger if exists sph_documents_attest_extraction on public.documents;
create trigger sph_documents_attest_extraction
  after insert or update of extracted_data, extraction_version on public.documents
  for each row execute function public.sph_documents_attest_extraction();

-- 4. Pure helpers (mirror web-app/lib/documents/matching.ts) --------------------
create or replace function public.sph_norm_id(v text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when length(x) >= 3 then x end
    from (select upper(regexp_replace(coalesce(v, ''), '[^A-Za-z0-9]', '', 'g')) as x) s
$$;
create or replace function public.sph_mc_key(v text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when length(x) >= 3 then x end
    from (select regexp_replace(coalesce(public.sph_norm_id(v), ''), '^MC', '') as x) s
$$;
-- "HINTON, DEMARQUIS L." -> "demarquis hinton" (sorted distinct tokens, >= 2).
-- No accent folding (stricter than the app: an accented name simply won't match).
create or replace function public.sph_person_key(v text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when count(*) >= 2 then string_agg(t, ' ' order by t) end
    from (select distinct t
            from regexp_split_to_table(
                   replace(replace(regexp_replace(lower(coalesce(v, '')), '[^a-z\s''-]', ' ', 'g'), '''', ''), '-', ''),
                   '\s+') as t
           where length(t) > 1 and t not in ('jr', 'sr', 'ii', 'iii', 'iv')) s
$$;
create or replace function public.sph_company_tokens(v text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(t), '{}')
    from regexp_split_to_table(regexp_replace(lower(coalesce(v, '')), '[^a-z0-9\s]', ' ', 'g'), '\s+') as t
   where length(t) > 1 and t not in ('llc','inc','co','corp','corporation','company','ltd','the','and',
                                     'logistics','transport','transportation','freight','services','group')
$$;
create or replace function public.sph_companies_corroborate(a text, b text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select case
    when cardinality(ta) = 0 or cardinality(tb) = 0 then false
    when cardinality(ta) <= cardinality(tb) then ta <@ tb
    else tb <@ ta end
  from (select public.sph_company_tokens(a) as ta, public.sph_company_tokens(b) as tb) s
$$;
revoke all on function public.sph_norm_id(text), public.sph_mc_key(text), public.sph_person_key(text),
  public.sph_company_tokens(text), public.sph_companies_corroborate(text, text) from public, anon;
grant execute on function public.sph_norm_id(text), public.sph_mc_key(text), public.sph_person_key(text),
  public.sph_company_tokens(text), public.sph_companies_corroborate(text, text) to authenticated, service_role;

-- 5. Automatic load creation: document required, attested values only ------------
--  p: {document_id, driver_id}. Every other key is ignored.
--  Returns {id, created, document_id}. Errors carry hint 'sph:<code>'.
create or replace function public.sph_load_create_verified(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_doc_id uuid;
  v_driver_id uuid;
  v_doc public.documents%rowtype;
  v_att public.document_extraction_attestations%rowtype;
  v_prof record;
  s jsonb; v jsonb; f jsonb;
  r text[] := '{}';
  v_key text;
  v_existing uuid;
  v_id uuid;
  v_pu date; v_del date;
  v_total numeric; v_lh numeric; v_fs numeric; v_acc numeric;
  v_driver_key text;
  v_hint text;
  v_mc text; v_ours boolean;
  k text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501', hint = 'sph:not_authenticated';
  end if;
  begin
    v_doc_id    := nullif(p->>'document_id', '')::uuid;
    v_driver_id := nullif(p->>'driver_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid request.' using errcode = 'P0001', hint = 'sph:bad_request';
  end;
  if v_doc_id is null then
    raise exception 'Automatic load creation needs a verified rate confirmation. Create the load manually instead.'
      using errcode = '42501', hint = 'sph:document_required';
  end if;

  select * into v_doc from public.documents d where d.id = v_doc_id and d.profile_id = v_uid;
  if not found then
    raise exception 'Document not found.' using errcode = '42501', hint = 'sph:document_not_found';
  end if;
  select * into v_att from public.document_extraction_attestations a
   where a.document_id = v_doc_id and a.profile_id = v_uid;
  if not found then
    raise exception 'This document was not read and verified by the server.' using errcode = 'P0001', hint = 'sph:not_attested';
  end if;
  if v_doc.extracted_data is distinct from v_att.snapshot then
    raise exception 'This document was changed after it was read, so a load can''t be created automatically.'
      using errcode = 'P0001', hint = 'sph:edited_after_extraction';
  end if;

  s := v_att.snapshot; v := coalesce(s->'values', '{}'::jsonb); f := coalesce(s->'fields', '{}'::jsonb);

  -- Extraction quality (mirrors decideAutoCreateLoad).
  if v_doc.extraction_version is distinct from 'v3' or s->>'extraction_version' is distinct from 'v3' then r := r || 'not_v3'; end if;
  if s->>'document_type' is distinct from 'rate_confirmation' then r := r || 'not_rate_confirmation'; end if;
  if s->>'model_confidence' is distinct from 'high' then r := r || 'not_high_confidence'; end if;
  if coalesce(s->>'parse_stage', 'strict') = 'fallback' then r := r || 'parse_failed'; end if;
  if jsonb_typeof(s->'missing_required') = 'array' and jsonb_array_length(s->'missing_required') > 0 then r := r || 'missing_fields'; end if;
  if coalesce(s->>'type_hint', 'rate_confirmation') not in ('rate_confirmation', 'other') then r := r || 'type_hint_mismatch'; end if;
  for k in select jsonb_object_keys(f) loop
    if f->k->>'evidence_check' = 'value_not_in_source' then r := r || ('evidence_mismatch:' || k); end if;
  end loop;

  -- Document state.
  if v_doc.duplicate_of is not null then r := r || 'duplicate_upload'; end if;
  if v_doc.review_status = 'dismissed' then r := r || 'dismissed'; end if;
  if v_doc.payroll_status = 'rejected' then r := r || 'rejected'; end if;
  if v_doc.load_id is not null then r := r || 'already_filed'; end if;
  if v_doc.corrections is not null and v_doc.corrections <> '[]'::jsonb then r := r || 'human_corrected'; end if;
  if jsonb_typeof(v_doc.routing->'corrections') = 'object' and v_doc.routing->'corrections' <> '{}'::jsonb then r := r || 'human_corrected'; end if;

  -- Carrier = this account (profile identity).
  select pr.company_name, pr.mc_number, pr.account_type into v_prof from public.profiles pr where pr.id = v_uid;
  if not found or lower(coalesce(v_prof.account_type, '')) = 'driver'
     or (cardinality(public.sph_company_tokens(v_prof.company_name)) = 0 and public.sph_mc_key(v_prof.mc_number) is null) then
    r := r || 'identity_unverified';
  else
    v_mc := public.sph_mc_key(v->>'carrier_mc_number');
    v_ours := (v_mc is not null and v_mc = public.sph_mc_key(v_prof.mc_number))
           or (nullif(v->>'carrier_name', '') is not null and public.sph_companies_corroborate(v_prof.company_name, v->>'carrier_name'));
    if not v_ours then
      r := r || case when v_mc is null and nullif(v->>'carrier_name', '') is null then 'carrier_not_printed' else 'carrier_not_ours' end;
    end if;
  end if;

  -- Load identity, required fields, dates, money.
  v_key := public.sph_norm_id(v->>'load_number');
  if v_key is null then r := r || 'no_load_number'; end if;
  if nullif(btrim(v->>'broker_name'), '') is null or nullif(btrim(v->>'origin'), '') is null
     or nullif(btrim(v->>'destination'), '') is null then r := r || 'missing_fields'; end if;
  begin
    v_pu := (v->>'pickup_date')::date; v_del := (v->>'delivery_date')::date;
  exception when others then v_pu := null; v_del := null; end;
  if v_pu is null or v_del is null then r := r || 'missing_fields';
  elsif v_del < v_pu or v_del - v_pu > 30 or v_pu > current_date + 7 or v_del > current_date + 7
        or v_del < current_date - 365 then r := r || 'dates_invalid'; end if;
  begin
    v_total := (v->>'total_revenue')::numeric; v_lh := (v->>'line_haul_rate')::numeric;
    v_fs := (v->>'fuel_surcharge')::numeric; v_acc := (v->>'accessorial_charges')::numeric;
  exception when others then v_total := null; end;
  if v_total is null or v_total <= 0 then r := r || 'no_revenue';
  elsif v_lh is not null and abs((v_lh + coalesce(v_fs, 0) + coalesce(v_acc, 0)) - v_total) > 0.01 then
    r := r || 'rate_components_mismatch';
  end if;

  -- Driver: required, this carrier's, active, the ONE whose name matches the printed driver.
  v_driver_key := public.sph_person_key(v->>'driver_name');
  if v_driver_id is null or v_driver_key is null then r := r || 'driver_not_verified';
  elsif not exists (select 1 from public.drivers d where d.id = v_driver_id and d.profile_id = v_uid) then
    raise exception 'That driver is not in your account.' using errcode = '42501', hint = 'sph:cross_account';
  elsif not exists (select 1 from public.drivers d where d.id = v_driver_id and d.profile_id = v_uid
                      and d.active is distinct from false and public.sph_person_key(d.name) = v_driver_key)
     or (select count(*) from public.drivers d where d.profile_id = v_uid and d.active is distinct from false
           and public.sph_person_key(d.name) = v_driver_key) <> 1 then
    r := r || 'driver_not_verified';
  end if;

  if cardinality(r) > 0 then
    select string_agg(distinct x, ',') into v_hint from unnest(r) x;
    raise exception 'This rate confirmation is not fully verified, so the load must be reviewed: %', v_hint
      using errcode = 'P0001', hint = 'sph:not_verified:' || v_hint;
  end if;

  -- Duplicate prevention (unchanged from #5): one transaction per carrier + number.
  perform pg_advisory_xact_lock(hashtextextended('sph_load:' || v_uid::text || ':' || v_key, 0));
  select l.id into v_existing
    from public.loads l
   where l.profile_id = v_uid and public.sph_norm_id(l.load_number) = v_key
   order by l.created_at, l.id
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'created', false, 'document_id', v_doc_id);
  end if;

  insert into public.loads (profile_id, driver_id, load_number, broker_name, broker_mc_number, origin, destination,
                            pickup_date, delivery_date, total_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue)
  values (v_uid, v_driver_id, btrim(v->>'load_number'), btrim(v->>'broker_name'), nullif(btrim(v->>'broker_mc_number'), ''),
          btrim(v->>'origin'), btrim(v->>'destination'), v_pu, v_del,
          case when jsonb_typeof(v->'total_miles') = 'number' then (v->>'total_miles')::numeric end,
          v_lh, v_fs, v_acc, v_total)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true, 'document_id', v_doc_id);
end $$;

revoke all on function public.sph_load_create_verified(jsonb) from public, anon;
grant execute on function public.sph_load_create_verified(jsonb) to authenticated, service_role;

commit;
