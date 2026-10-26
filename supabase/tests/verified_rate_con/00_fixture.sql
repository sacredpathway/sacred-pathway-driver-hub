-- =============================================================================
--  Migration #6 test fixture (throwaway cluster only). Two carriers, drivers,
--  and rate-confirmation documents in every verification state. "Server"
--  writes run as postgres with no end-user JWT (= trusted, like migrations /
--  the SQL editor); user writes run as role authenticated with a JWT.
-- =============================================================================
\set ON_ERROR_STOP on
insert into auth.users (id) values
  ('aaaaaaaa-0000-4000-8000-00000000000a'), ('bbbbbbbb-0000-4000-8000-00000000000b')
on conflict do nothing;
insert into public.profiles (id, company_name, mc_number, account_type, account_role) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'Alpha Haulers LLC', 'MC-123456', 'carrier', 'carrier'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'Bravo Freight Inc', 'MC 654321', 'carrier', 'carrier')
on conflict (id) do update set company_name = excluded.company_name, mc_number = excluded.mc_number,
  account_type = excluded.account_type, account_role = excluded.account_role;
insert into public.drivers (id, profile_id, name, active) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Marcus Reed', true),
  ('aaaaaaaa-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Old Timer', false),
  ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-00000000000b', 'Bob Stone', true)
on conflict (id) do nothing;

-- A v3 payroll extraction shaped like sanitizePayrollExtraction() output.
create or replace function pg_temp.rc(load_no text, total numeric, driver text default 'Marcus Reed',
                                      conf text default 'high', carrier_mc text default 'MC 123456',
                                      carrier text default 'Alpha Haulers', missing jsonb default '[]',
                                      evidence text default 'value_in_source', hint text default null)
returns jsonb language sql as $$
  select jsonb_build_object(
    'extraction_version', 'v3', 'profile', 'payroll', 'document_type', 'rate_confirmation',
    'stored_document_type', 'rate_confirmation', 'model_confidence', conf, 'page_count', 1,
    'values', jsonb_strip_nulls(jsonb_build_object(
       'load_number', load_no, 'broker_name', 'Echo Brokerage', 'origin', 'Dallas, TX', 'destination', 'Tulsa, OK',
       'pickup_date', to_char(current_date - 3, 'YYYY-MM-DD'), 'delivery_date', to_char(current_date - 1, 'YYYY-MM-DD'),
       'total_revenue', total, 'line_haul_rate', case when total is null then null else total - 100 end,
       'fuel_surcharge', case when total is null then null else 100 end,
       'total_miles', 512, 'driver_name', driver, 'carrier_name', carrier, 'carrier_mc_number', carrier_mc)),
    'fields', jsonb_build_object(
       'load_number', jsonb_build_object('value', load_no, 'evidence_check', evidence),
       'total_revenue', jsonb_build_object('value', total, 'evidence_check', 'value_in_source')),
    'line_items', '[]'::jsonb, 'issuer', null, 'notes', '', 'rejected_keys', '[]'::jsonb,
    'missing_required', missing, 'parse_stage', 'strict', 'type_hint', hint)
$$;

-- Documents (id suffix = scenario). All belong to carrier A unless noted.
insert into public.documents (id, profile_id, storage_path, status, document_type) values
  ('aaaaaaaa-0000-4000-8000-00000000d001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/1.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d003', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/3.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d004', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/4.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d005', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/5.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d006', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/6.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d007', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/7.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d008', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/8.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d009', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/9.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d010', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/10.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d011', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/11.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d012', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/12.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d013', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/13.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d014', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/14.pdf', 'pending', 'rate_confirmation'),
  ('aaaaaaaa-0000-4000-8000-00000000d015', 'aaaaaaaa-0000-4000-8000-00000000000a', 'a/15.pdf', 'pending', 'rate_confirmation'),
  ('bbbbbbbb-0000-4000-8000-00000000d001', 'bbbbbbbb-0000-4000-8000-00000000000b', 'b/1.pdf', 'pending', 'rate_confirmation');

-- SERVER writes (postgres, no JWT => trusted => attested).
update public.documents set extraction_version = 'v3', status = 'processed', extracted_data = pg_temp.rc('LN-1001', 2500)
 where id = 'aaaaaaaa-0000-4000-8000-00000000d001';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1003', 1800) where id = 'aaaaaaaa-0000-4000-8000-00000000d003';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1004', 1800, conf => 'medium') where id = 'aaaaaaaa-0000-4000-8000-00000000d004';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1005', null, missing => '["total_revenue"]') where id = 'aaaaaaaa-0000-4000-8000-00000000d005';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1006', 1800), payroll_status = 'rejected' where id = 'aaaaaaaa-0000-4000-8000-00000000d006';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1007', 1800) where id = 'aaaaaaaa-0000-4000-8000-00000000d007';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1008', 1800, carrier_mc => 'MC 999999', carrier => 'Charlie Lines') where id = 'aaaaaaaa-0000-4000-8000-00000000d008';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1009', 1800, driver => 'Jane Doe') where id = 'aaaaaaaa-0000-4000-8000-00000000d009';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1010', 1800) where id = 'aaaaaaaa-0000-4000-8000-00000000d010';
update public.documents set duplicate_of = 'aaaaaaaa-0000-4000-8000-00000000d001' where id = 'aaaaaaaa-0000-4000-8000-00000000d010';
update public.documents set extraction_version = 'v2', extracted_data = pg_temp.rc('LN-1011', 1800) where id = 'aaaaaaaa-0000-4000-8000-00000000d011';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-RACE', 900) where id = 'aaaaaaaa-0000-4000-8000-00000000d012';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('MAN-0001', 700) where id = 'aaaaaaaa-0000-4000-8000-00000000d013';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1014', 1800, evidence => 'value_not_in_source') where id = 'aaaaaaaa-0000-4000-8000-00000000d014';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-1015', 1800, hint => 'fuel_receipt') where id = 'aaaaaaaa-0000-4000-8000-00000000d015';
update public.documents set extraction_version = 'v3', extracted_data = pg_temp.rc('LN-B001', 3100, driver => 'Bob Stone', carrier_mc => 'MC 654321', carrier => 'Bravo Freight')
 where id = 'bbbbbbbb-0000-4000-8000-00000000d001';
