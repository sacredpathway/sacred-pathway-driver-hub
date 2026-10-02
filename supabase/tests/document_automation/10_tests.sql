-- =============================================================================
--  Functional tests — 20261002120000_document_automation.sql
--  Every assertion raises on failure (ON_ERROR_STOP) and prints PASS <label>.
--  Web calls are simulated as PostgREST runs them: role `authenticated` with
--  request.jwt.claim.sub = the signed-in user.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set asB 'reset role; set role authenticated; set request.jwt.claim.sub = ''bbbbbbbb-0000-0000-0000-000000000001'';'
\set asSuper 'reset role; set request.jwt.claim.sub = '''';'

create schema dtst;
grant usage on schema dtst to anon, authenticated;
create function dtst.ok(p boolean, l text) returns void language plpgsql as $$
begin if p is not true then raise exception 'FAIL %', l; end if; raise notice 'PASS %', l; end $$;
create function dtst.err(p_sql text, p_pattern text, l text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm !~ p_pattern then raise exception 'FAIL %: expected ~[%] got [%]', l, p_pattern, sqlerrm; end if;
    raise notice 'PASS % (%)', l, sqlerrm; return;
  end;
  raise exception 'FAIL %: expected error ~[%] but it succeeded', l, p_pattern;
end $$;
grant execute on all functions in schema dtst to anon, authenticated;

-- ------------------------------------------------------------ legacy rows ---
:asSuper
select dtst.ok(not exists (
  select 1 from public.fixture_docs_snapshot s
   where s.t = 'documents' and s.row is distinct from (
     select to_jsonb(d) - array['content_sha256','source','extraction_version','duplicate_of',
                                 'review_status','routing','reviewed_at']
       from public.documents d where d.id = s.id)
), 'legacy documents unchanged (only new NULL columns added)');
select dtst.ok(not exists (
  select 1 from public.fixture_docs_snapshot s
   where s.t = 'expenses' and s.row is distinct from (
     select to_jsonb(e) - 'source_document_id' from public.expenses e where e.id = s.id)
), 'legacy expenses unchanged');
select dtst.ok((select count(*) from public.documents where review_status is not null or source is not null) = 0,
  'no backfill: existing documents keep NULL review/source');

-- ---------------------------------------------------- RLS stays as before ---
select dtst.ok((select permissive from pg_policies where tablename = 'documents'
                 and policyname = 'document settlement belongs to owner') = 'RESTRICTIVE',
  'restrictive settlement policy still RESTRICTIVE');
select dtst.ok((select count(*) from pg_policies where tablename = 'documents') = 2,
  'no new documents policies');

-- ------------------------------------------------------- documents columns ---
:asA
insert into public.documents (id, profile_id, storage_path, content_sha256, source, status)
values ('aaaaaaaa-0000-0000-0000-0000000d0a01', auth.uid(), 'a/1.pdf', repeat('a', 64), 'web', 'pending');
select dtst.ok(true, 'web document insert with sha256 + source');
select dtst.err($$insert into public.documents (profile_id, storage_path, content_sha256)
                 values (auth.uid(), 'a/x.pdf', 'NOT-A-HASH')$$, 'documents_content_sha256_format', 'bad sha256 rejected');
select dtst.err($$insert into public.documents (profile_id, storage_path, source)
                 values (auth.uid(), 'a/x.pdf', 'email')$$, 'documents_source_check', 'unknown source rejected');
select dtst.err($$update public.documents set review_status = 'done'
                 where id = 'aaaaaaaa-0000-0000-0000-0000000d0a01'$$, 'documents_review_status_check', 'unknown review_status rejected');
update public.documents set review_status = 'needs_review', routing = '{"reasons":["x"]}'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d0a01';
select dtst.ok(true, 'review_status + routing writable by owner');

insert into public.documents (id, profile_id, storage_path, content_sha256, source, duplicate_of)
values ('aaaaaaaa-0000-0000-0000-0000000d0a02', auth.uid(), 'a/2.pdf', repeat('a', 64), 'web',
        'aaaaaaaa-0000-0000-0000-0000000d0a01');
select dtst.ok(true, 'duplicate_of own document allowed (same hash twice is NOT refused)');
select dtst.err($$update public.documents set duplicate_of = id where id = 'aaaaaaaa-0000-0000-0000-0000000d0a02'$$,
  'documents_duplicate_not_self', 'duplicate_of self rejected');

:asB
insert into public.documents (id, profile_id, storage_path, source)
values ('bbbbbbbb-0000-0000-0000-0000000d0b01', auth.uid(), 'b/1.pdf', 'web');
select dtst.err($$insert into public.documents (profile_id, storage_path, duplicate_of)
                 values (auth.uid(), 'b/2.pdf', 'aaaaaaaa-0000-0000-0000-0000000d0a01')$$,
  'document_automation_cross_account_duplicate', 'duplicate_of another account rejected');
select dtst.ok((select count(*) from public.documents where profile_id <> auth.uid()) = 0,
  'B cannot see A documents (RLS unchanged)');

-- ------------------------------------------------------------- expenses ---
:asA
select dtst.ok(true, 'setup');
insert into public.loads (id, profile_id, load_number, total_revenue, status) values
  ('aaaaaaaa-0000-0000-0000-0000000f0001', auth.uid(), 'RC-1001', 1500, 'pending'),
  ('aaaaaaaa-0000-0000-0000-0000000f0002', auth.uid(), 'RC-1002', 1500, 'pending');

insert into public.expenses (profile_id, load_id, category, amount, vendor_name, receipt_date, source_document_id)
values (auth.uid(), 'aaaaaaaa-0000-0000-0000-0000000f0001', 'fuel', 100.00, 'Pilot', '2026-09-30',
        'aaaaaaaa-0000-0000-0000-0000000d0a01');
select dtst.ok(true, 'automation expense on open load allowed');
select dtst.err($$insert into public.expenses (profile_id, category, amount, source_document_id)
                 values (auth.uid(), 'fuel', 100.00, 'aaaaaaaa-0000-0000-0000-0000000d0a01')$$,
  'expenses_source_document_unique', 'second expense for the same document rejected (idempotent)');
select dtst.err($$insert into public.expenses (profile_id, load_id, category, amount, source_document_id)
                 values (auth.uid(), 'aaaaaaaa-0000-0000-0000-0000000e0001', 'fuel', 50, 'aaaaaaaa-0000-0000-0000-0000000d0a02')$$,
  'document_automation_load_protected', 'automation expense on SETTLED load rejected');
select dtst.err($$insert into public.expenses (profile_id, category, amount, source_document_id)
                 values (auth.uid(), 'fuel', 50, 'bbbbbbbb-0000-0000-0000-0000000d0b01')$$,
  'document_automation_cross_account_document', 'automation expense citing another account''s document rejected');
insert into public.expenses (profile_id, load_id, category, amount, vendor_name)
values (auth.uid(), 'aaaaaaaa-0000-0000-0000-0000000e0001', 'fuel', 25, 'Manual');
select dtst.ok(true, 'human expense on settled load still allowed (behaviour unchanged)');

-- Paid elsewhere: approved iPhone settlement carries RC-1002.
:asSuper
insert into public.settlements (id, profile_id, driver_id, status)
values ('aaaaaaaa-0000-0000-0000-0000000a5e01', 'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d001', 'draft');
insert into public.settlement_loads (settlement_id, profile_id, load_id, driver_earnings)
values ('aaaaaaaa-0000-0000-0000-0000000a5e01', 'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000f0002', 500);
update public.settlements set status = 'approved', approved_at = now()
 where id = 'aaaaaaaa-0000-0000-0000-0000000a5e01';
:asA
select dtst.ok(public.sph_load_paid_elsewhere('aaaaaaaa-0000-0000-0000-0000000f0002', null), 'setup: RC-1002 paid by approved settlement');
select dtst.err($$insert into public.expenses (profile_id, load_id, category, amount, source_document_id)
                 values (auth.uid(), 'aaaaaaaa-0000-0000-0000-0000000f0002', 'fuel', 50, 'aaaaaaaa-0000-0000-0000-0000000d0a02')$$,
  'document_automation_load_protected', 'automation expense on load in APPROVED settlement rejected');
select dtst.err($$update public.expenses set load_id = 'aaaaaaaa-0000-0000-0000-0000000f0002'
                 where source_document_id = 'aaaaaaaa-0000-0000-0000-0000000d0a01'$$,
  'document_automation_load_protected', 'moving an automation expense onto a paid load rejected');

:asB
insert into public.documents (id, profile_id, storage_path, source)
values ('bbbbbbbb-0000-0000-0000-0000000d0b02', auth.uid(), 'b/3.pdf', 'web');
select dtst.err($$insert into public.expenses (profile_id, load_id, category, amount, source_document_id)
                 values (auth.uid(), 'aaaaaaaa-0000-0000-0000-0000000f0001', 'fuel', 50, 'bbbbbbbb-0000-0000-0000-0000000d0b02')$$,
  'document_automation_cross_account_load|violates row-level security|foreign key', 'automation expense on another account''s load rejected');

-- --------------------------------------------------- compliance_documents ---
:asA
insert into public.documents (id, profile_id, storage_path, source)
values ('aaaaaaaa-0000-0000-0000-0000000d0a03', auth.uid(), 'a/cdl.jpg', 'web');
insert into public.compliance_documents (profile_id, category, title, driver_id, document_kind, expiration_date, source_document_id)
values (auth.uid(), 'driver', 'CDL', 'aaaaaaaa-0000-0000-0000-00000000d001', 'cdl', '2028-01-31',
        'aaaaaaaa-0000-0000-0000-0000000d0a03');
select dtst.ok(true, 'driver document linked to own driver');
select dtst.err($$insert into public.compliance_documents (profile_id, category, title, driver_id, document_kind, source_document_id)
                 values (auth.uid(), 'driver', 'CDL', 'aaaaaaaa-0000-0000-0000-00000000d001', 'cdl', 'aaaaaaaa-0000-0000-0000-0000000d0a03')$$,
  'compliance_documents_source_document_unique', 'second driver document for the same source rejected');
select dtst.err($$insert into public.compliance_documents (profile_id, category, title, driver_id, document_kind)
                 values (auth.uid(), 'driver', 'CDL', 'bbbbbbbb-0000-0000-0000-00000000d001', 'cdl')$$,
  'document_automation_cross_account_driver', 'driver of another account rejected');
select dtst.err($$insert into public.compliance_documents (profile_id, category, title, document_kind)
                 values (auth.uid(), 'driver', 'X', 'passport')$$,
  'compliance_documents_kind_check', 'unknown document_kind rejected');

:asSuper
select dtst.ok(true, 'all document automation database tests passed');
