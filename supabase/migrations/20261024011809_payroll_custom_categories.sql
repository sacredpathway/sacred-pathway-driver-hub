-- =============================================================================
--  Payroll custom categories (web settlement editor)
--  Sacred Pathway Driver Hub — 2026-10-23
-- -----------------------------------------------------------------------------
--  NOT APPLIED. Requires owner approval before it touches the live project.
--
--  ADDITIVE ONLY:
--    * one new table, payroll_custom_categories (RLS: own rows only)
--    * one new NULLABLE column on settlement_additions and settlement_deductions
--  No existing column, constraint, policy, trigger or row is changed.
--
--  iPhone compatibility (Driver Hub 2.3.5):
--    The iPhone decodes settlement_additions.category / settlement_deductions.
--    category as strict enums (one unknown value breaks the whole ledger), and
--    the existing CHECK constraints already enforce that list. So a custom
--    category NEVER writes a new category string: the line stores a standard
--    `base_category` (default 'other') plus `custom_category_id`. The iPhone
--    ignores the extra column (Codable skips unknown keys), shows the line's
--    description, and its upserts don't send the column, so they leave it
--    untouched. Settlement math is unaffected — a category is a label; the
--    driver/company split lives on the line itself.
--
--  Idempotent. Rollback at the bottom.
-- =============================================================================

begin;

create table if not exists public.payroll_custom_categories (
  id                           uuid primary key default gen_random_uuid(),
  profile_id                   uuid not null default auth.uid()
                                 references public.profiles(id) on delete cascade,
  kind                         text not null,
  name                         text not null,
  base_category                text not null default 'other',
  default_responsibility       text not null default 'driver',
  default_driver_share_percent numeric(6,3) not null default 100,
  is_archived                  boolean not null default false,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),

  constraint payroll_custom_categories_kind_check
    check (kind in ('addition', 'deduction')),
  constraint payroll_custom_categories_name_check
    check (char_length(btrim(name)) between 1 and 60),
  constraint payroll_custom_categories_responsibility_check
    check (default_responsibility in ('driver', 'company', 'split')),
  constraint payroll_custom_categories_share_range
    check (default_driver_share_percent >= 0 and default_driver_share_percent <= 100),
  -- base_category must be a value the iPhone (and the line CHECKs) accept.
  constraint payroll_custom_categories_base_check check (
    (kind = 'addition' and base_category in (
      'bonus','detention','layover','tonu','lumper_reimbursement','reimbursement',
      'fuel_credit','maintenance_credit','safety_bonus','referral_bonus',
      'manual_credit','other'))
    or
    (kind = 'deduction' and base_category in (
      'truck_lease','insurance','fuel','fuel_advance','cash_advance','maintenance',
      'repair','escrow','maintenance_reserve','tolls','scale_tickets','permits',
      'violation','damage','trailer_charge','equipment_charge','dispatcher_fee',
      'factoring_fee','authority_fee','other'))
  )
);

comment on table public.payroll_custom_categories is
  'Carrier-defined payroll categories for the web settlement editor. Lines store base_category (an iPhone-safe value) plus custom_category_id.';

-- One live name per kind per account (case-insensitive).
create unique index if not exists payroll_custom_categories_unique_name
  on public.payroll_custom_categories (profile_id, kind, lower(btrim(name)));

create index if not exists payroll_custom_categories_profile_idx
  on public.payroll_custom_categories (profile_id, kind, is_archived);

alter table public.payroll_custom_categories enable row level security;

drop policy if exists "own payroll custom categories" on public.payroll_custom_categories;
create policy "own payroll custom categories" on public.payroll_custom_categories
  for all using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- Own trigger function (no dependency on functions defined in the iOS repo's
-- migration directory).
create or replace function public.sph_payroll_categories_touch()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.sph_payroll_categories_touch() from public, anon, authenticated;

drop trigger if exists payroll_custom_categories_touch_updated_at on public.payroll_custom_categories;
create trigger payroll_custom_categories_touch_updated_at
  before update on public.payroll_custom_categories
  for each row execute function public.sph_payroll_categories_touch();

-- Line pointers. ON DELETE SET NULL: deleting a category never deletes or
-- changes a paid line (the line keeps its description and base category).
alter table public.settlement_additions
  add column if not exists custom_category_id uuid;
alter table public.settlement_deductions
  add column if not exists custom_category_id uuid;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'settlement_additions_custom_category_fkey'
                   and table_schema = 'public') then
    alter table public.settlement_additions
      add constraint settlement_additions_custom_category_fkey
      foreign key (custom_category_id)
      references public.payroll_custom_categories(id) on delete set null;
  end if;
  if not exists (select 1 from information_schema.table_constraints
                 where constraint_name = 'settlement_deductions_custom_category_fkey'
                   and table_schema = 'public') then
    alter table public.settlement_deductions
      add constraint settlement_deductions_custom_category_fkey
      foreign key (custom_category_id)
      references public.payroll_custom_categories(id) on delete set null;
  end if;
end $$;

create index if not exists settlement_additions_custom_category_idx
  on public.settlement_additions (custom_category_id) where custom_category_id is not null;
create index if not exists settlement_deductions_custom_category_idx
  on public.settlement_deductions (custom_category_id) where custom_category_id is not null;

commit;

-- =============================================================================
--  ROLLBACK (manual)
-- -----------------------------------------------------------------------------
--  alter table public.settlement_additions  drop column if exists custom_category_id;
--  alter table public.settlement_deductions drop column if exists custom_category_id;
--  drop table if exists public.payroll_custom_categories;
--  drop function if exists public.sph_payroll_categories_touch();
-- =============================================================================
