-- =============================================================================
--  Functional tests — paystub payment integrity
--  Run by run.sh after 00_fixture.sql + the migration. Every assertion raises
--  on failure (ON_ERROR_STOP), and prints "PASS <label>" on success.
--  Web calls are simulated exactly as PostgREST runs them: role
--  `authenticated` with request.jwt.claim.sub = the signed-in user.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

\set A  '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set DA '''aaaaaaaa-0000-0000-0000-00000000d001'''
\set DB '''bbbbbbbb-0000-0000-0000-00000000d001'''
\set asA 'reset role; set role authenticated; set request.jwt.claim.sub = ''aaaaaaaa-0000-0000-0000-000000000001'';'
\set asB 'reset role; set role authenticated; set request.jwt.claim.sub = ''bbbbbbbb-0000-0000-0000-000000000001'';'
\set asAnon 'reset role; set role anon; set request.jwt.claim.sub = '''';'
\set asSuper 'reset role; set request.jwt.claim.sub = '''';'

-- ---------------------------------------------------------------- helpers ---
create schema tst;
grant usage on schema tst to anon, authenticated;

create function tst.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create function tst.eq(p_actual text, p_expected text, p_label text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected [%] got [%]', p_label, p_expected, p_actual;
  end if;
  raise notice 'PASS %', p_label;
end $$;

-- Runs p_sql in a subtransaction; passes only if it raises matching p_pattern.
-- (Same semantics as a PostgREST request: the failed statement's effects are
-- rolled back entirely.)
create function tst.err(p_sql text, p_pattern text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~ p_pattern then
      raise exception 'FAIL %: expected error ~ [%] got [%]', p_label, p_pattern, sqlerrm;
    end if;
    raise notice 'PASS % (%)', p_label, sqlerrm;
    return;
  end;
  raise exception 'FAIL %: expected error ~ [%] but it succeeded', p_label, p_pattern;
end $$;

create function tst.new_load(p_status text, p_revenue numeric default 1000, p_number text default null)
returns uuid language sql as $$
  insert into public.loads (profile_id, load_number, total_revenue, total_miles, status)
  values (auth.uid(), coalesce(p_number, 'L-' || substr(gen_random_uuid()::text, 1, 6)), p_revenue, 500, p_status)
  returning id
$$;

create function tst.new_draft(p_driver uuid, p_gross numeric default 1000, p_net numeric default 1000,
                              p_check date default null, p_end date default '2026-09-27')
returns uuid language sql as $$
  insert into public.paystubs (profile_id, driver_id, worker_type, pay_period_start, pay_period_end,
                               check_date, status, gross_earnings, taxable_wages, total_taxes_withheld, net_pay, created_by_user_id)
  values (auth.uid(), p_driver, '1099', p_end - 6, p_end, p_check, 'draft', p_gross, p_gross, 0, p_net, auth.uid())
  returning id
$$;

create function tst.attach(p_paystub uuid, p_load uuid) returns uuid language sql as $$
  insert into public.paystub_earnings (paystub_id, profile_id, kind, label, amount, is_taxable, units, load_id)
  select p_paystub, auth.uid(), 'settlement_gross', 'Load', coalesce(l.total_revenue, 0), true, l.total_miles, p_load
    from (select p_load as id) x left join public.loads l on l.id = x.id
  returning id
$$;

create function tst.status_of(p_load uuid) returns text language sql security definer set search_path = public as $$
  select status from public.loads where id = p_load
$$;
create function tst.ps_status(p_ps uuid) returns text language sql security definer set search_path = public as $$
  select status from public.paystubs where id = p_ps
$$;

-- Simulates the iPhone app approving/paying a new-model settlement for a load.
create function tst.ios_settlement(p_load uuid, p_status text, p_estimate boolean default false,
                                   p_adjustment boolean default false)
returns uuid language plpgsql as $$
declare v_s uuid; v_orig uuid;
begin
  insert into public.settlements (profile_id, driver_id, status, engine_version, is_estimate)
  select auth.uid(), d.id, p_status, 'v1', p_estimate from public.drivers d where d.profile_id = auth.uid() limit 1
  returning id into v_s;
  if p_adjustment then
    insert into public.settlements (profile_id, status, engine_version) values (auth.uid(), 'paid', 'v1') returning id into v_orig;
  end if;
  insert into public.settlement_loads (settlement_id, profile_id, load_id, is_adjustment, corrects_settlement_id)
  values (v_s, auth.uid(), p_load, p_adjustment, v_orig);
  return v_s;
end $$;

grant execute on all functions in schema tst to anon, authenticated;

-- ======================================================= T00 legacy rows ====
select tst.ok(not exists (
  select 1 from public.fixture_snapshot s
   where s.row is distinct from (
     select case s.t when 'loads' then (select to_jsonb(l) - 'updated_at' from public.loads l where l.id = s.id)
                     else (select to_jsonb(p) - 'updated_at' from public.paystubs p where p.id = s.id) end)
), 'T00 migration left existing loads/paystubs unchanged');

-- ============================================================ T01 / T02 =====
:asA
select tst.new_load('ready_for_settlement') as l1 \gset
select tst.new_draft(:DA) as p1 \gset
select tst.attach(:'p1', :'l1') is not null as attached \gset
select tst.ok(:'attached'::boolean, 'T02 adding an eligible load to a draft works');
select tst.eq(tst.status_of(:'l1'), 'ready_for_settlement', 'T01 creating a draft + attaching does not settle the load');
select tst.eq(tst.ps_status(:'p1'), 'draft', 'T01 paystub stays draft');

-- Legacy `pending` loads remain payable (existing rule: only cancelled blocked).
select tst.new_draft(:DA) as p_pend \gset
select tst.ok(tst.attach(:'p_pend', 'aaaaaaaa-0000-0000-0000-0000000e0002') is not null, 'T02b legacy pending load can be attached');
delete from public.paystubs where id = :'p_pend';
select tst.eq(tst.status_of('aaaaaaaa-0000-0000-0000-0000000e0002'), 'pending', 'T02c deleting a draft leaves the pending load untouched');

-- =================================================================== T03 =====
select tst.new_draft(:DA) as p3 \gset
select tst.err(format('select tst.attach(%L, %L)', :'p3', 'aaaaaaaa-0000-0000-0000-0000000e0001'),
               '^load_settled', 'T03a already-settled load cannot be added');

select tst.new_load('ready_for_settlement') as l3c \gset
select tst.err(format('update public.loads set status = %L where id = %L; select tst.attach(%L, %L)', 'Canceled ', :'l3c', :'p3', :'l3c'),
               '^load_cancelled', 'T03b cancelled ("Canceled ") load cannot be added');

select tst.new_load('ready_for_settlement') as l3s \gset
select tst.ios_settlement(:'l3s', 'approved') as s3 \gset
select tst.err(format('select tst.attach(%L, %L)', :'p3', :'l3s'), '^load_on_settlement',
               'T03c load on an approved iPhone settlement cannot be added');
select tst.new_load('ready_for_settlement') as l3p \gset
select tst.ios_settlement(:'l3p', 'paid') as s3p \gset
select tst.err(format('select tst.attach(%L, %L)', :'p3', :'l3p'), '^load_on_settlement',
               'T03d load on a paid iPhone settlement cannot be added');

-- Non-authoritative settlements do NOT block (draft / ready_for_review / voided / estimate / adjustment line).
select tst.new_load('ready_for_settlement') as l3n \gset
select tst.ios_settlement(:'l3n', 'draft') is not null as x \gset
select tst.ios_settlement(:'l3n', 'ready_for_review') is not null as x \gset
select tst.ios_settlement(:'l3n', 'voided') is not null as x \gset
select tst.ios_settlement(:'l3n', 'approved', true) is not null as x \gset
select tst.ios_settlement(:'l3n', 'paid', false, true) is not null as x \gset
select tst.ok(tst.attach(:'p3', :'l3n') is not null, 'T03e draft/review/voided/estimate/adjustment settlements do not block');

-- On another issued web paystub while status is NOT settled (e.g. released by
-- someone else) → still blocked by the paystub ledger.
select tst.new_load('ready_for_settlement') as l3i \gset
select tst.new_draft(:DA) as p3i \gset
select tst.attach(:'p3i', :'l3i') is not null as x \gset
select public.issue_paystub(:'p3i') is not null as x \gset
:asSuper
update public.loads set status = 'ready_for_settlement' where id = :'l3i';
:asA
select tst.err(format('select tst.attach(%L, %L)', :'p3', :'l3i'), '^load_on_issued_paystub',
               'T03f load on another issued paystub cannot be added');

-- =================================================================== T04 =====
select tst.new_load('ready_for_settlement') as l4 \gset
select tst.new_draft(:DA) as p4a \gset
select tst.new_draft(:DA) as p4b \gset
select tst.ok(tst.attach(:'p4a', :'l4') is not null and tst.attach(:'p4b', :'l4') is not null,
              'T04 the same load may sit on two drafts (owner-approved)');

-- ============================================================ T05 / T06 =====
select public.issue_paystub(:'p4a') as r4 \gset
select tst.eq(tst.ps_status(:'p4a'), 'issued', 'T05 issuing an eligible draft → issued');
select tst.eq(tst.status_of(:'l4'), 'settled', 'T05 … and its load → settled (same transaction)');
select tst.ok((:'r4'::jsonb -> 'settled_load_ids') = to_jsonb(array[:'l4'::uuid]), 'T05 RPC reports settled_load_ids');
select tst.eq((select gross_earnings::text || '/' || net_pay::text from public.paystubs where id = :'p4a'),
              '1000/1000', 'T05 pay totals are not changed by issuance');
select tst.eq((select check_date::text from public.paystubs where id = :'p4a'), '2026-09-27',
              'T05 check_date defaults to pay_period_end');
select tst.err(format('select public.issue_paystub(%L)', :'p4b'), '^load_settled',
               'T06 a competing draft cannot also finalize the same load');
select tst.eq(tst.ps_status(:'p4b'), 'draft', 'T06 losing paystub stays draft');
select tst.err(format('select public.issue_paystub(%L)', :'p4a'), '^paystub_not_draft',
               'T06b issuing twice is rejected');

-- =================================================================== T07 =====
select tst.new_load('ready_for_settlement') as l7 \gset
select tst.new_draft(:DA) as p7 \gset
select tst.attach(:'p7', :'l7') is not null as x \gset
:asSuper
update public.loads set status = 'settled' where id = :'l7';   -- e.g. legacy iOS Paystub Maker
:asA
select tst.err(format('select public.issue_paystub(%L)', :'p7'), '^load_settled',
               'T07 a load settled after it was attached prevents issuance');

-- =================================================================== T08 =====
select tst.new_load('ready_for_settlement') as l8 \gset
select tst.new_draft(:DA) as p8 \gset
select tst.attach(:'p8', :'l8') is not null as x \gset
update public.loads set status = 'cancelled' where id = :'l8';
select tst.err(format('select public.issue_paystub(%L)', :'p8'), '^load_cancelled',
               'T08 a cancelled load prevents issuance');

-- =================================================================== T09 =====
select tst.new_load('ready_for_settlement') as l9 \gset
select tst.new_draft(:DA) as p9 \gset
select tst.attach(:'p9', :'l9') is not null as x \gset
select tst.ios_settlement(:'l9', 'approved') is not null as x \gset
select tst.err(format('select public.issue_paystub(%L)', :'p9'), '^load_on_settlement',
               'T09 an approved iPhone settlement prevents web issuance');
select tst.eq(tst.status_of(:'l9'), 'ready_for_settlement', 'T09 load status untouched by the failed issue');

-- ============================================================ T10 / T10b ====
select tst.new_load('ready_for_settlement', 500) as l10a \gset
select tst.new_load('ready_for_settlement', 600) as l10b \gset
select tst.new_load('ready_for_settlement', 700) as l10c \gset
select tst.new_draft(:DA) as p10 \gset
select tst.attach(:'p10', :'l10a') is not null as x \gset
select tst.attach(:'p10', :'l10b') is not null as x \gset
select tst.attach(:'p10', :'l10c') is not null as x \gset
update public.loads set status = 'cancelled' where id = :'l10b';
select tst.err(format('select public.issue_paystub(%L)', :'p10'), '^load_cancelled',
               'T10 one bad load blocks the whole multi-load paystub');
select tst.eq(tst.status_of(:'l10a') || ',' || tst.status_of(:'l10c'), 'ready_for_settlement,ready_for_settlement',
              'T10b no partial load statuses remain after failure');
select tst.eq((select status || ':' || coalesce(paystub_number, 'null') from public.paystubs where id = :'p10'),
              'draft:null', 'T10b paystub not partially issued (no number)');
-- Fix the draft (remove the bad line) → issues cleanly.
delete from public.paystub_earnings where paystub_id = :'p10' and load_id = :'l10b';
select public.issue_paystub(:'p10') is not null as x \gset
select tst.eq(tst.status_of(:'l10a') || ',' || tst.status_of(:'l10c') || ',' || tst.status_of(:'l10b'),
              'settled,settled,cancelled', 'T10c after removing the bad line all remaining loads settle');

-- =================================================================== T11 =====
select tst.new_draft(:DA) as p11 \gset
select tst.err(format('update public.paystubs set status = %L where id = %L', 'paid', :'p11'),
               '^paystub_invalid_transition', 'T11 draft → paid fails');
select tst.err(format('update public.paystubs set status = %L where id = %L', 'issued', :'p11'),
               '^paystub_invalid_transition', 'T11 draft → issued outside issue_paystub fails');
select tst.err(format('update public.paystubs set status = %L where id = %L', 'voided', :'p11'),
               '^paystub_invalid_transition', 'T11 draft → voided fails');
select tst.err(format('insert into public.paystubs (profile_id, driver_id, worker_type, pay_period_start, pay_period_end, status) values (%L, %L, %L, %L, %L, %L)',
                      :A, :DA, '1099', '2026-09-01', '2026-09-07', 'issued'),
               '^paystub_invalid_transition', 'T11 inserting an already-issued paystub fails');
select public.issue_paystub(:'p11') is not null as x \gset
update public.paystubs set status = 'paid' where id = :'p11' and status = 'issued';
select tst.eq(tst.ps_status(:'p11'), 'paid', 'T11 issued → paid works');
select tst.err(format('update public.paystubs set status = %L where id = %L', 'issued', :'p11'),
               '^paystub_invalid_transition', 'T11 paid → issued fails');
select public.void_paystub(:'p11') is not null as x \gset
select tst.err(format('update public.paystubs set status = %L where id = %L', 'paid', :'p11'),
               '^paystub_invalid_transition', 'T11 voided → paid fails');
select tst.err(format('update public.paystubs set status = %L where id = %L', 'draft', :'p11'),
               '^paystub_invalid_transition', 'T11 voided → draft fails');
select tst.ok((select count(*) from public.paystubs where id = :'p11' and status = 'issued') = 0,
              'T11 Mark Paid conditional (status = issued) matches 0 rows on a voided paystub');
-- Header/email updates that keep status still work on issued paystubs.
select tst.new_draft(:DA) as p11b \gset
select public.issue_paystub(:'p11b') is not null as x \gset
update public.paystubs set notes = 'emailed' where id = :'p11b';
select tst.eq((select notes from public.paystubs where id = :'p11b'), 'emailed', 'T11 non-status updates still allowed');

-- =================================================================== T12 =====
select tst.new_load('ready_for_settlement') as l12a \gset
select tst.new_load('ready_for_settlement') as l12b \gset
select tst.new_draft(:DA) as p12 \gset
select tst.attach(:'p12', :'l12a') is not null as x \gset
select tst.attach(:'p12', :'l12b') is not null as x \gset
select public.issue_paystub(:'p12') is not null as x \gset
select public.void_paystub(:'p12') as r12 \gset
select tst.eq(tst.ps_status(:'p12'), 'voided', 'T12 void → voided');
select tst.eq(tst.status_of(:'l12a') || ',' || tst.status_of(:'l12b'), 'ready_for_settlement,ready_for_settlement',
              'T12 void releases eligible loads to ready_for_settlement');
select tst.eq(jsonb_array_length(:'r12'::jsonb -> 'released_load_ids')::text, '2', 'T12 RPC reports released ids');
-- Released loads can be paid again.
select tst.new_draft(:DA) as p12r \gset
select tst.attach(:'p12r', :'l12a') is not null as x \gset
select public.issue_paystub(:'p12r') is not null as x \gset
select tst.eq(tst.status_of(:'l12a'), 'settled', 'T12b released load can be re-issued once');

-- =================================================================== T13 =====
-- (a) also on an approved iPhone settlement (created after the web issue — the
--     cross-system race documented as a remaining gap)
select tst.new_load('ready_for_settlement') as l13 \gset
select tst.new_draft(:DA) as p13 \gset
select tst.attach(:'p13', :'l13') is not null as x \gset
select public.issue_paystub(:'p13') is not null as x \gset
select tst.ios_settlement(:'l13', 'approved') is not null as x \gset
select public.void_paystub(:'p13') as r13 \gset
select tst.eq(tst.status_of(:'l13'), 'settled', 'T13a void keeps a load still paid by an iPhone settlement');
select tst.eq(jsonb_array_length(:'r13'::jsonb -> 'kept_load_ids')::text, '1', 'T13a RPC reports kept ids');
-- (b) also on another issued paystub (constructed; the app can no longer create it)
select tst.new_load('ready_for_settlement') as l13b \gset
select tst.new_draft(:DA) as p13x \gset
select tst.new_draft(:DA) as p13y \gset
select tst.attach(:'p13x', :'l13b') is not null as x \gset
select tst.attach(:'p13y', :'l13b') is not null as x \gset
select public.issue_paystub(:'p13x') is not null as x \gset
:asSuper
alter table public.paystubs disable trigger sph_paystubs_guard_status;
update public.paystubs set status = 'issued' where id = :'p13y';
alter table public.paystubs enable trigger sph_paystubs_guard_status;
:asA
select public.void_paystub(:'p13x') is not null as x \gset
select tst.eq(tst.status_of(:'l13b'), 'settled', 'T13b void keeps a load still on another issued paystub');
-- (c) a load that is not `settled` at void time is left alone
select tst.new_load('ready_for_settlement') as l13c \gset
select tst.new_draft(:DA) as p13c \gset
select tst.attach(:'p13c', :'l13c') is not null as x \gset
select public.issue_paystub(:'p13c') is not null as x \gset
update public.loads set status = 'cancelled' where id = :'l13c';
select public.void_paystub(:'p13c') is not null as x \gset
select tst.eq(tst.status_of(:'l13c'), 'cancelled', 'T13c void never overwrites a non-settled status');

-- =================================================================== T14 =====
select tst.new_draft(:DA) as p14 \gset
select tst.err(format('select public.void_paystub(%L)', :'p14'), '^paystub_not_voidable', 'T14 void a draft fails');
select tst.err(format('select public.void_paystub(%L)', :'p12'), '^paystub_not_voidable', 'T14 void twice fails');
select tst.err(format('select public.issue_paystub(%L)', :'p12'), '^paystub_not_draft', 'T14 re-issue a voided paystub fails');

-- =================================================================== T15 =====
-- Tenant isolation.
select tst.new_load('ready_for_settlement') as la \gset
select tst.new_draft(:DA) as pa \gset
select tst.attach(:'pa', :'la') is not null as x \gset
:asB
select tst.err(format('select public.issue_paystub(%L)', :'pa'), '^paystub_not_found', 'T15 B cannot issue A''s paystub');
select tst.new_draft(:DB) as pb \gset
select tst.err(format('select tst.attach(%L, %L)', :'pb', :'la'), '^load_not_found', 'T15 B cannot attach A''s load');
select tst.err(format('select tst.attach(%L, %L)', :'pa', :'la'), 'row-level security|paystub_not_found',
               'T15 B cannot add lines to A''s paystub');
update public.paystubs set status = 'paid' where id = :'pa';
update public.loads set status = 'settled' where id = :'la';
select tst.eq(public.sph_load_payment_conflict(:'la'), 'load_not_found', 'T15 B cannot probe A''s load');
:asA
select tst.eq(tst.ps_status(:'pa') || ',' || tst.status_of(:'la'), 'draft,ready_for_settlement',
              'T15 B''s direct updates touched nothing of A''s');
select public.issue_paystub(:'pa') is not null as x \gset
:asB
select tst.err(format('select public.void_paystub(%L)', :'pa'), '^paystub_not_found', 'T15 B cannot void A''s paystub');
-- A line on B's draft pointing at A's load (forged past the trigger) blocks B's issue.
:asSuper
alter table public.paystub_earnings disable trigger sph_paystub_earnings_guard;
insert into public.paystub_earnings (paystub_id, profile_id, kind, amount, load_id)
values (:'pb', :B, 'settlement_gross', 1, 'aaaaaaaa-0000-0000-0000-0000000e0002');
alter table public.paystub_earnings enable trigger sph_paystub_earnings_guard;
:asB
select tst.err(format('select public.issue_paystub(%L)', :'pb'), '^load_not_found',
               'T15 issue rejects a line whose load belongs to another carrier');
select tst.eq(tst.status_of('aaaaaaaa-0000-0000-0000-0000000e0002'), 'pending', 'T15 other carrier''s load untouched');
-- anon + unauthenticated.
:asAnon
select tst.err(format('select public.issue_paystub(%L)', :'pb'), 'permission denied', 'T15 anon cannot execute issue_paystub');
select tst.err(format('select public.void_paystub(%L)', :'pb'), 'permission denied', 'T15 anon cannot execute void_paystub');
select tst.err(format('select public.sph_load_payment_conflict(%L)', :'la'), 'permission denied', 'T15 anon cannot execute helpers');
reset role;
set role authenticated;
set request.jwt.claim.sub = '';
select tst.err(format('select public.issue_paystub(%L)', :'pb'), '^not_authenticated', 'T15 no JWT subject → rejected');
:asSuper
select tst.ok(not has_function_privilege('anon', 'public.issue_paystub(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.void_paystub(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.issue_paystub(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_paystubs_guard_status()', 'execute')
          and not has_function_privilege('authenticated', 'public.sph_paystub_earnings_guard()', 'execute'),
          'T15 privileges: anon none, authenticated RPCs only, trigger fns not callable');
select tst.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.prosecdef
                             and p.proname in ('issue_paystub','void_paystub','sph_load_payment_conflict',
                                               'sph_load_paid_elsewhere','sph_loads_payment_conflicts',
                                               'sph_paystub_earnings_guard','sph_paystubs_guard_status')),
              'T15 no SECURITY DEFINER functions added');
select tst.ok((select bool_and(p.proconfig @> array['search_path=public, pg_temp'])
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname in ('issue_paystub','void_paystub','sph_load_payment_conflict',
                                    'sph_load_paid_elsewhere','sph_loads_payment_conflicts',
                                    'sph_paystub_earnings_guard','sph_paystubs_guard_status')),
              'T15 search_path pinned on every new function');
select tst.ok(not exists (
                 (select schemaname, tablename, policyname, permissive, cmd, roles::text, qual, with_check
                    from pg_policies where schemaname = 'public'
                  except select * from public.fixture_policies)
                 union all
                 (select * from public.fixture_policies
                  except select schemaname, tablename, policyname, permissive, cmd, roles::text, qual, with_check
                    from pg_policies where schemaname = 'public'))
              and (select bool_and(c.relrowsecurity) from pg_class c
                    where c.oid in ('public.loads'::regclass, 'public.paystubs'::regclass, 'public.paystub_earnings'::regclass,
                                    'public.settlements'::regclass, 'public.settlement_loads'::regclass)),
              'T15 RLS policies identical before/after migration; RLS still enabled');

-- =================================================================== T16 =====
:asA
select tst.new_load('ready_for_settlement') as l16 \gset
select tst.new_draft(:DA) as p16 \gset
select tst.attach(:'p16', :'l16') as e16 \gset
select public.issue_paystub(:'p16') is not null as x \gset
select tst.err(format('delete from public.paystub_earnings where id = %L', :'e16'), '^paystub_locked',
               'T16 load lines cannot be removed from an issued paystub');
select tst.err(format('update public.paystub_earnings set load_id = null where id = %L', :'e16'), '^paystub_locked',
               'T16 load lines cannot be detached on an issued paystub');
select tst.new_load('ready_for_settlement') as l16b \gset
select tst.err(format('select tst.attach(%L, %L)', :'p16', :'l16b'), '^paystub_locked',
               'T16 loads cannot be attached to an issued paystub');
-- Draft line removal + draft delete (cascade) + load delete (FK set null) still work.
select tst.new_draft(:DA) as p16d \gset
select tst.attach(:'p16d', :'l16b') as e16d \gset
delete from public.paystub_earnings where id = :'e16d';
select tst.ok((select count(*) from public.paystub_earnings where id = :'e16d') = 0, 'T16 draft load line removal works');
select tst.attach(:'p16d', :'l16b') is not null as x \gset
delete from public.paystubs where id = :'p16d';
select tst.ok((select count(*) from public.paystubs where id = :'p16d') = 0, 'T16 deleting a draft (cascade) works');
select tst.new_load('ready_for_settlement') as l16c \gset
select tst.new_draft(:DA) as p16e \gset
select tst.attach(:'p16e', :'l16c') as e16e \gset
delete from public.loads where id = :'l16c';
select tst.ok((select load_id from public.paystub_earnings where id = :'e16e') is null, 'T16 deleting a load nulls the draft line (FK)');

-- =================================================================== T17 =====
-- Numbering + YTD identical to the previous JS issuePaystubAction.
:asB
select tst.new_draft(:DB, 1000, 800, '2026-03-01') as b1 \gset
select tst.new_draft(:DB, 500, 400, '2026-04-01') as b2 \gset
select tst.new_draft(:DB, 200, 150, '2026-05-01') as b3 \gset
select tst.new_draft(:DB, 300, 250, '2025-12-31') as b4 \gset
select public.issue_paystub(:'b1') ->> 'paystub_number' as n1 \gset
select public.issue_paystub(:'b2') ->> 'paystub_number' as n2 \gset
select tst.eq(:'n1' || ' ' || :'n2', 'PS-2026-00001 PS-2026-00002', 'T17 sequential PS-YYYY-NNNNN numbering');
select tst.eq((select ytd_gross_earnings::text || '/' || ytd_net_pay::text || '/' || ytd_taxable_wages::text
                 from public.paystubs where id = :'b2'), '1500/1200/1500', 'T17 YTD = prior issued (same driver/year) + this');
update public.paystubs set status = 'paid' where id = :'b1' and status = 'issued';
select public.issue_paystub(:'b3') ->> 'paystub_number' as n3 \gset
select tst.eq(:'n3' || ' ' || (select ytd_net_pay::text from public.paystubs where id = :'b3'), 'PS-2026-00003 550',
              'T17 preserved rule: YTD sums status=issued only (paid excluded, as before)');
select tst.eq(public.issue_paystub(:'b4') ->> 'paystub_number', 'PS-2025-00001', 'T17 year comes from check_date');
:asA
select tst.ok((select paystub_number from public.paystubs where id = :'p4a') like 'PS-2026-%', 'T17 carriers number independently');

-- =================================================================== T18 =====
select tst.new_draft(:DA) as p18 \gset
select public.issue_paystub(:'p18') as r18 \gset
select tst.eq((:'r18'::jsonb -> 'settled_load_ids')::text, '[]', 'T18 paystub without load lines issues normally');

-- =================================================================== T19 =====
select tst.new_load('ready_for_settlement') as l19 \gset
select tst.eq(tst.status_of(:'l19'), 'ready_for_settlement', 'T19 new loads still save as ready_for_settlement (no trigger interference)');
update public.loads set origin = 'Dallas, TX' where id = :'l19';
select tst.eq(tst.status_of(:'l19'), 'ready_for_settlement', 'T19 editing a load (no status in payload) never changes status');

:asSuper
select tst.ok(true, 'ALL FUNCTIONAL TESTS PASSED');
