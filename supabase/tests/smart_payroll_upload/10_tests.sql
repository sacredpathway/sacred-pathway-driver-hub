-- =============================================================================
--  Tests for PROPOSED_20261105120000_smart_payroll_upload.sql
--  Throwaway local cluster only (see run.sh). Each check raises NOTICE 'PASS …'
--  or an exception (ON_ERROR_STOP aborts the run).
-- =============================================================================
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000001'''

-- ---- schema --------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'documents'
     and column_name in ('extraction_profile','document_identity','payroll_status','corrections')
     and is_nullable = 'YES' and column_default is null;
  if n <> 4 then raise exception 'FAIL columns: %', n; end if;
  raise notice 'PASS schema: 4 new nullable columns, no defaults';
  if (select count(*) from public.documents where extraction_profile is not null or document_identity is not null
        or payroll_status is not null or corrections is not null) <> 0 then
    raise exception 'FAIL existing rows were changed';
  end if;
  raise notice 'PASS data: no existing document row was written';
end $$;

-- ---- check constraints ---------------------------------------------------
do $$
begin
  begin
    insert into public.documents (profile_id, payroll_status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'approved');
    raise exception 'FAIL payroll_status accepted a bad value';
  exception when check_violation then raise notice 'PASS check: payroll_status rejects unknown values (incl. "approved")';
  end;
  begin
    insert into public.documents (profile_id, extraction_profile) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x');
    raise exception 'FAIL extraction_profile';
  exception when check_violation then raise notice 'PASS check: extraction_profile';
  end;
  begin
    insert into public.documents (profile_id, corrections) values ('aaaaaaaa-0000-0000-0000-000000000001', '{"a":1}');
    raise exception 'FAIL corrections object accepted';
  exception when check_violation then raise notice 'PASS check: corrections must be an array';
  end;
  begin
    insert into public.documents (profile_id, document_identity) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x');
    raise exception 'FAIL identity length';
  exception when check_violation then raise notice 'PASS check: identity length';
  end;
end $$;

-- ---- unique live sha per account ----------------------------------------
do $$
declare
  sha text := repeat('a', 64);
  d1 uuid;
begin
  insert into public.documents (profile_id, content_sha256, review_status) values ('aaaaaaaa-0000-0000-0000-000000000001', sha, 'needs_review') returning id into d1;
  begin
    insert into public.documents (profile_id, content_sha256) values ('aaaaaaaa-0000-0000-0000-000000000001', sha);
    raise exception 'FAIL second live copy accepted';
  exception when unique_violation then raise notice 'PASS dup: second live upload of the same file is refused';
  end;
  insert into public.documents (profile_id, content_sha256, duplicate_of) values ('aaaaaaaa-0000-0000-0000-000000000001', sha, d1);
  raise notice 'PASS dup: a copy marked duplicate_of the original is allowed';
  insert into public.documents (profile_id, content_sha256, review_status) values ('aaaaaaaa-0000-0000-0000-000000000001', sha, 'dismissed');
  raise notice 'PASS dup: a dismissed copy is allowed (history)';
  insert into public.documents (profile_id, content_sha256) values ('bbbbbbbb-0000-0000-0000-000000000001', sha);
  raise notice 'PASS dup: another carrier may hold the same file (isolation)';
  insert into public.documents (profile_id, content_sha256) values ('aaaaaaaa-0000-0000-0000-000000000001', null), ('aaaaaaaa-0000-0000-0000-000000000001', null);
  raise notice 'PASS dup: legacy rows without a fingerprint are unaffected';
end $$;

-- ---- finalized-settlement document guard --------------------------------
do $$
declare
  paid uuid := 'aaaaaaaa-0000-0000-0000-00000000e0e1';  -- fixture: legacy PAID settlement
  draft uuid := gen_random_uuid();
  doc uuid;
  doc2 uuid;
begin
  insert into public.settlements (id, profile_id, driver_id, settlement_period_start, settlement_period_end, status)
  values (draft, 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', '2026-10-12', '2026-10-18', 'draft');

  insert into public.documents (profile_id, settlement_id) values ('aaaaaaaa-0000-0000-0000-000000000001', paid) returning id into doc;
  begin
    update public.documents set settlement_id = draft where id = doc;
    raise exception 'FAIL moved a document off a paid settlement';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'document_payroll_locked' then raise; end if;
    raise notice 'PASS guard: document on a PAID settlement cannot be re-linked';
  end;
  begin
    update public.documents set payroll_status = 'rejected' where id = doc;
    raise exception 'FAIL changed payroll_status on a paid settlement document';
  exception when sqlstate 'P0001' then raise notice 'PASS guard: payroll record of a finalized settlement is frozen';
  end;
  update public.documents set review_status = 'approved' where id = doc;
  raise notice 'PASS guard: unrelated columns (review_status) still update';

  insert into public.documents (profile_id, settlement_id) values ('aaaaaaaa-0000-0000-0000-000000000001', draft) returning id into doc2;
  update public.documents set settlement_id = null, payroll_status = 'proposed', corrections = '[]' where id = doc2;
  raise notice 'PASS guard: documents on a DRAFT settlement stay editable';
end $$;

-- ---- cross-account link refused (also as the signed-in user) -------------
do $$
declare
  bset uuid := gen_random_uuid();
  doc uuid;
begin
  insert into public.settlements (id, profile_id, driver_id, settlement_period_start, settlement_period_end, status)
  values (bset, 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000d001', '2026-10-12', '2026-10-18', 'draft');
  insert into public.documents (profile_id) values ('aaaaaaaa-0000-0000-0000-000000000001') returning id into doc;
  begin
    update public.documents set settlement_id = bset where id = doc;
    raise exception 'FAIL linked A''s document to B''s settlement';
  exception when insufficient_privilege then raise notice 'PASS guard: cross-account settlement link refused';
  end;
end $$;

-- ---- iPhone / existing writers: unaffected --------------------------------
do $$
declare doc uuid;
begin
  -- iPhone-style insert (no new columns) and status update keep working
  insert into public.documents (profile_id, document_type, storage_path, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'rate_confirmation', 'aaaaaaaa-0000-0000-0000-000000000001/x.jpg', 'pending') returning id into doc;
  update public.documents set status = 'processed', load_id = 'aaaaaaaa-0000-0000-0000-0000000a0001' where id = doc;
  raise notice 'PASS compat: existing iPhone/web document writes unaffected';
end $$;

-- ---- guard function is SECURITY INVOKER, search_path pinned, anon no exec --
do $$
declare r record;
begin
  select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') anon_x
    into r from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'sph_documents_payroll_guard';
  if r.prosecdef or r.proconfig is distinct from array['search_path=public, pg_temp'] or r.anon_x then
    raise exception 'FAIL guard function security: %', r;
  end if;
  raise notice 'PASS security: guard is SECURITY INVOKER, search_path pinned, anon cannot execute';
end $$;
