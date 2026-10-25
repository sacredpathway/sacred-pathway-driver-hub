-- =============================================================================
--  Lock finalized settlements in the database (iPhone 2.3.7 + web)
--  Sacred Pathway Driver Hub — drafted 2026-10-23
-- -----------------------------------------------------------------------------
--  NOT APPLIED. Named REVIEW_BEFORE_APPLYING_… so `supabase db push` skips it.
--  Apply ONLY after ALL of these are true:
--    1. 20261023120000_payroll_custom_categories.sql and
--       20261023130000_web_settlement_atomic_writes.sql are applied;
--    2. iPhone 2.3.7 is live on the App Store;
--    3. force-update.json has minimumSupportedVersion = 2.3.7, so no 2.3.6-
--       or-older phone can still edit an approved settlement in place
--       (those builds upsert the header + lines of an approved settlement
--       directly; this lock would refuse those saves with an error).
--  Then rename to 20261024120000_lock_finalized_settlements.sql and apply.
--
--  What it enforces (both apps, every write path, RLS unchanged):
--    • An approved / paid / voided settlement's header keeps every pay
--      figure. Only the status move itself may change it: status,
--      approved_at/by, paid_at, voided_at, payment_method, payment_reference,
--      a settlement number that was blank, updated_at, pdf_storage_path.
--    • Its load lines, additions and deductions can't be inserted, changed
--      or deleted.
--    • Status can change only through sph_web_transition_settlement (reason
--      + audit + repayments + load flags in one transaction); a direct
--      PATCH of status is refused.
--    • Foreign keys that clear themselves (a deleted document, load, truck,
--      expense or custom category → NULL) still work, and deleting a whole
--      settlement / account still cascades. A DIRECT write that nulls them
--      (e.g. load_id, which would hide a paid load from the double-pay
--      guard) is refused.
--    • A maintenance session can bypass it on purpose:
--        set local sph.allow_finalized_edit = 'on';
--  To change a finalized settlement: reopen it (audited, with a reason),
--  edit the draft, approve again — exactly what the apps already do.
--
--  Additive: two functions + four triggers. No table, column, policy or row
--  changes. Re-runnable. Rollback at the bottom.
-- =============================================================================

begin;

create or replace function public.sph_finalized_status(p_status text)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(p_status, '') in ('approved', 'paid', 'voided');
$$;

-- Columns whose only allowed change on a finalized row is "set to NULL by a
-- foreign key" (ON DELETE SET NULL on the referenced row).
create or replace function public.sph_only_fk_nulling(p_old jsonb, p_new jsonb, p_fk text[], p_free text[])
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
      from jsonb_object_keys(p_new) k
     where (p_new -> k) is distinct from (p_old -> k)
       and not (k = any (p_free))
       and not (k = any (p_fk) and jsonb_typeof(p_new -> k) = 'null')
  );
$$;

create or replace function public.sph_settlements_lock_finalized()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('sph.allow_finalized_edit', true), '') = 'on' then
    return new;
  end if;
  if not public.sph_finalized_status(old.status) then
    return new;
  end if;
  -- Only the audited status move (sph_web_transition_settlement, which sets
  -- sph.in_transition for its own UPDATE) may change status, its timestamps
  -- and the payment fields. Anything else may touch only updated_at and
  -- pdf_storage_path; FK columns may be nulled only by an ON DELETE SET NULL
  -- cascade (trigger depth > 1), never by a direct write.
  if coalesce(current_setting('sph.in_transition', true), '') = 'on' then
    if public.sph_only_fk_nulling(
         to_jsonb(old) - 'settlement_number', to_jsonb(new) - 'settlement_number',
         array[]::text[],
         array['status', 'approved_at', 'approved_by', 'paid_at', 'voided_at',
               'payment_method', 'payment_reference', 'updated_at', 'pdf_storage_path'])
       and (new.settlement_number is not distinct from old.settlement_number
            or nullif(btrim(old.settlement_number), '') is null) then
      return new;
    end if;
  elsif public.sph_only_fk_nulling(
         to_jsonb(old), to_jsonb(new),
         case when pg_trigger_depth() > 1 then array['truck_id', 'driver_id'] else array[]::text[] end,
         array['updated_at', 'pdf_storage_path']) then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'This settlement is ' || old.status || ' and locked. Reopen it first — the reason is recorded in the audit trail.',
    hint = 'sph:locked';
end;
$$;

create or replace function public.sph_settlement_lines_lock_finalized()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_sid    uuid;
begin
  if coalesce(current_setting('sph.allow_finalized_edit', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  -- FK clean-up from a deleted document / load / category (ON DELETE SET
  -- NULL runs as a nested trigger). A direct write that nulls load_id or
  -- advance_id would hide a paid load from the double-pay guard: refused.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and public.sph_only_fk_nulling(
       to_jsonb(old), to_jsonb(new),
       array['custom_category_id', 'document_id', 'rate_confirmation_document_id',
             'proof_of_delivery_document_id', 'load_id', 'related_load_id',
             'related_expense_id', 'corrects_settlement_id', 'recurring_deduction_id', 'advance_id'],
       array[]::text[]) then
    return new;
  end if;
  for v_sid in select distinct x from unnest(array[case when tg_op <> 'INSERT' then old.settlement_id end,
                                                   case when tg_op <> 'DELETE' then new.settlement_id end]) x
                where x is not null loop
    select s.status into v_status from public.settlements s where s.id = v_sid;
    -- Not found = the settlement itself is being deleted (cascade): allow.
    if found and public.sph_finalized_status(v_status) then
      raise exception using
        errcode = 'P0001',
        message = 'This settlement is ' || v_status || ' and locked. Reopen it first — the reason is recorded in the audit trail.',
        hint = 'sph:locked';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sph_settlements_lock_finalized on public.settlements;
create trigger sph_settlements_lock_finalized
  before update on public.settlements
  for each row execute function public.sph_settlements_lock_finalized();

drop trigger if exists sph_settlement_loads_lock_finalized on public.settlement_loads;
create trigger sph_settlement_loads_lock_finalized
  before insert or update or delete on public.settlement_loads
  for each row execute function public.sph_settlement_lines_lock_finalized();

drop trigger if exists sph_settlement_additions_lock_finalized on public.settlement_additions;
create trigger sph_settlement_additions_lock_finalized
  before insert or update or delete on public.settlement_additions
  for each row execute function public.sph_settlement_lines_lock_finalized();

drop trigger if exists sph_settlement_deductions_lock_finalized on public.settlement_deductions;
create trigger sph_settlement_deductions_lock_finalized
  before insert or update or delete on public.settlement_deductions
  for each row execute function public.sph_settlement_lines_lock_finalized();

revoke all on function public.sph_finalized_status(text) from public, anon;
revoke all on function public.sph_only_fk_nulling(jsonb, jsonb, text[], text[]) from public, anon;
revoke all on function public.sph_settlements_lock_finalized() from public, anon, authenticated;
revoke all on function public.sph_settlement_lines_lock_finalized() from public, anon, authenticated;
grant execute on function public.sph_finalized_status(text) to authenticated;
grant execute on function public.sph_only_fk_nulling(jsonb, jsonb, text[], text[]) to authenticated;

commit;

-- =============================================================================
--  ROLLBACK (manual)
-- -----------------------------------------------------------------------------
--  drop trigger if exists sph_settlement_deductions_lock_finalized on public.settlement_deductions;
--  drop trigger if exists sph_settlement_additions_lock_finalized on public.settlement_additions;
--  drop trigger if exists sph_settlement_loads_lock_finalized on public.settlement_loads;
--  drop trigger if exists sph_settlements_lock_finalized on public.settlements;
--  drop function if exists public.sph_settlement_lines_lock_finalized();
--  drop function if exists public.sph_settlements_lock_finalized();
--  drop function if exists public.sph_only_fk_nulling(jsonb, jsonb, text[], text[]);
--  drop function if exists public.sph_finalized_status(text);
-- =============================================================================
