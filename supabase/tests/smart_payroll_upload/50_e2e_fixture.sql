-- =============================================================================
--  End-to-end fixture additions (throwaway cluster only). The shared fixture
--  (tests/web_settlements/00_fixture.sql) trims documents/profiles to what the
--  settlement suites need; the upload / extraction / review code also reads
--  and writes these production columns, so they are added here, unchanged in
--  meaning. No function, trigger or policy is created or changed.
-- =============================================================================
\set ON_ERROR_STOP on
alter table public.documents
  add column if not exists processed       boolean default false,
  add column if not exists file_mime_type  text,
  add column if not exists file_size       bigint,
  add column if not exists extracted_data  jsonb,
  add column if not exists raw_text        text,
  add column if not exists confidence      text,
  add column if not exists provider        text,
  add column if not exists model           text,
  add column if not exists retry_count     integer default 0,
  add column if not exists error_message   text,
  add column if not exists updated_at      timestamptz default now();
alter table public.profiles
  add column if not exists account_type text,
  add column if not exists account_role text;
alter table public.drivers
  add column if not exists cdl_number text,
  add column if not exists cdl_state  text,
  add column if not exists active     boolean default true;
