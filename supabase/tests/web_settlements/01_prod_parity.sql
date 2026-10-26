-- =============================================================================
--  Production parity additions to the fixture (read from production
--  rmzqxsfhjqrshhdjzhze on 2026-10-23, read-only):
--   * the loads columns and BEFORE trigger loads_sync_driver_mode_columns
--     (function body verbatim), which fire on every load status write;
--   * public.compliance_documents, so 20261002120000_document_automation.sql
--     (applied in production) can be applied here in production order.
-- =============================================================================
\set ON_ERROR_STOP on
alter table public.loads
  add column if not exists loaded_miles numeric,
  add column if not exists gross_load_pay numeric,
  add column if not exists pay_type text,
  add column if not exists driver_pay_type text,
  add column if not exists driver_percentage numeric,
  add column if not exists driver_rate_per_mile numeric,
  add column if not exists driver_gross_pay numeric;

CREATE OR REPLACE FUNCTION public.sph_sync_load_driver_mode_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
    pay_inputs_changed boolean := false;
begin
    if tg_op = 'UPDATE' then
        if new.loaded_miles is distinct from old.loaded_miles then
            new.total_miles := new.loaded_miles;
        elsif new.total_miles is distinct from old.total_miles then
            new.loaded_miles := new.total_miles;
        end if;

        if new.gross_load_pay is distinct from old.gross_load_pay then
            new.total_revenue := new.gross_load_pay;
            new.line_haul_rate := new.gross_load_pay;
        elsif new.total_revenue is distinct from old.total_revenue then
            new.gross_load_pay := new.total_revenue;
        end if;

        if new.pay_type is distinct from old.pay_type then
            new.driver_pay_type := new.pay_type;
        elsif new.driver_pay_type is distinct from old.driver_pay_type then
            new.pay_type := new.driver_pay_type;
        end if;

        pay_inputs_changed :=
            new.loaded_miles is distinct from old.loaded_miles
            or new.gross_load_pay is distinct from old.gross_load_pay
            or new.pay_type is distinct from old.pay_type
            or new.driver_percentage is distinct from old.driver_percentage
            or new.driver_rate_per_mile is distinct from old.driver_rate_per_mile;
    end if;

    if new.loaded_miles is null and new.total_miles is not null then
        new.loaded_miles := new.total_miles;
    elsif new.total_miles is null and new.loaded_miles is not null then
        new.total_miles := new.loaded_miles;
    end if;

    if new.gross_load_pay is null then
        new.gross_load_pay := coalesce(new.total_revenue, new.line_haul_rate);
    end if;
    if new.total_revenue is null and new.gross_load_pay is not null then
        new.total_revenue := new.gross_load_pay;
    end if;
    if new.line_haul_rate is null and new.gross_load_pay is not null then
        new.line_haul_rate := new.gross_load_pay;
    end if;

    if new.pay_type is null and new.driver_pay_type is not null then
        new.pay_type := new.driver_pay_type;
    elsif new.driver_pay_type is null and new.pay_type is not null then
        new.driver_pay_type := new.pay_type;
    end if;

    if new.driver_gross_pay is null or pay_inputs_changed then
        if new.pay_type = 'percentage'
           and new.gross_load_pay is not null
           and new.driver_percentage is not null then
            new.driver_gross_pay := new.gross_load_pay * (new.driver_percentage / 100.0);
        elsif new.pay_type = 'rate_per_mile'
           and new.loaded_miles is not null
           and new.driver_rate_per_mile is not null then
            new.driver_gross_pay := new.loaded_miles * new.driver_rate_per_mile;
        end if;
    end if;

    return new;
end;
$function$;
drop trigger if exists loads_sync_driver_mode_columns on public.loads;
CREATE TRIGGER loads_sync_driver_mode_columns BEFORE INSERT OR UPDATE ON public.loads FOR EACH ROW EXECUTE FUNCTION sph_sync_load_driver_mode_columns();

create table if not exists public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  title text not null,
  storage_path text, issue_date date, expiration_date date, notes text,
  file_mime_type text, file_size integer,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.compliance_documents enable row level security;
