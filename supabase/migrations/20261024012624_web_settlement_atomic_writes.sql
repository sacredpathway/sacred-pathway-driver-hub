-- =============================================================================
--  Web settlements: atomic save + status change
--  Sacred Pathway Driver Hub — 2026-10-23
-- -----------------------------------------------------------------------------
--  NOT APPLIED. Requires owner approval. Depends on
--  20261023120000_payroll_custom_categories.sql (custom_category_id columns).
--
--  Two functions, each ONE transaction (all or nothing):
--
--   sph_web_save_settlement(p jsonb)
--     create  : insert header (always 'draft') + lines + audit
--     update  : row-locks the settlement (FOR UPDATE), then refuses unless
--               • it belongs to auth.uid()            (sph:not_owner)
--               • it is not an estimate               (sph:estimate)
--               • status is draft / ready_for_review  (sph:locked)
--               • updated_at equals what the editor loaded (sph:conflict)
--               • no line id belongs to another settlement (sph:foreign_row)
--             then writes header + lines (prune → upsert) + audit together.
--
--   sph_web_transition_settlement(p jsonb)
--     row-locks, checks owner / updated_at / expected current status, the
--     iPhone transition table, reopen/void reasons, then in the SAME
--     transaction: status + timestamps, advance repayments (computed here
--     from the stored deductions, never from the browser), advance balances,
--     load settled/released flags, audit. The existing approval double-pay
--     trigger (20261001120100) fires inside, so a rejected approval leaves
--     nothing behind.
--
--  SECURITY INVOKER: RLS applies exactly as for direct table writes; these
--  functions add checks, they never widen access. iPhone 2.3.5/2.3.6 is not
--  affected: it keeps writing the tables directly, as today. iPhone 2.3.7+
--  calls both functions (and falls back to direct writes only while they are
--  not deployed). Document-link ids on lines are written on insert only, so a
--  web save (which never sends them) cannot clear them.
--  Additive: two helpers + two functions. No table, column, policy, trigger
--  or row changes. Rollback at the bottom.
-- =============================================================================

begin;

create or replace function public.sph_web_fail(p_code text, p_message text)
returns void
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = 'sph:' || p_code;
end;
$$;

-- Optimistic-concurrency check. iPhone (2.3.7+) clients round-trip
-- timestamps at millisecond precision (Swift Date / ISO-8601 fractional), the
-- web at full microsecond precision; both must match the stored version.
-- 1.5 ms tolerance absorbs Double/ISO-8601 rounding at a millisecond
-- boundary; two genuine versions are never that close in practice.
create or replace function public.sph_same_version(p_stored timestamptz, p_expected timestamptz)
returns boolean
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select p_stored is not null and p_expected is not null
     and abs(extract(epoch from (p_stored - p_expected))) <= 0.0015;
$$;

-- -----------------------------------------------------------------------------
--  Save / create
-- -----------------------------------------------------------------------------
create or replace function public.sph_web_save_settlement(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(p->>'settlement_id', '')::uuid;
  v_mode     text := coalesce(p->>'mode', 'update');
  v_expected timestamptz := nullif(p->>'expected_updated_at', '')::timestamptz;
  v_hj       jsonb := coalesce(p->'header', '{}'::jsonb);
  v_h        public.settlements%rowtype;
  v_row      public.settlements%rowtype;
  v_bad      uuid;
  v_updated  timestamptz;
begin
  if v_uid is null then
    perform public.sph_web_fail('not_signed_in', 'Sign in again to save.');
  end if;
  if v_id is null then
    perform public.sph_web_fail('bad_request', 'Missing settlement id.');
  end if;
  v_h := jsonb_populate_record(null::public.settlements, v_hj);

  if v_mode = 'create' then
    if exists (select 1 from public.settlements s where s.id = v_id) then
      perform public.sph_web_fail('exists', 'That settlement already exists.');
    end if;
    if v_h.driver_id is null then
      perform public.sph_web_fail('bad_request', 'Choose a driver.');
    end if;
    -- Minimal insert so every column default applies (fee columns = 0 …);
    -- the header values are then written by the same keyed UPDATE as a save.
    insert into public.settlements (id, profile_id, driver_id, status, is_estimate, created_by)
    values (v_id, v_uid, v_h.driver_id, 'draft', false, v_uid);
  elsif v_mode = 'update' then
    select * into v_row from public.settlements s where s.id = v_id for update;
    if not found then
      perform public.sph_web_fail('not_found', 'Settlement not found.');
    end if;
    if v_row.profile_id is distinct from v_uid then
      perform public.sph_web_fail('not_owner', 'Only the carrier account can edit this settlement.');
    end if;
    if coalesce(v_row.is_estimate, false) then
      perform public.sph_web_fail('estimate', 'Estimates are projections and can''t be edited here.');
    end if;
    if coalesce(v_row.status, 'draft') in ('approved', 'paid', 'voided') then
      perform public.sph_web_fail('locked', 'This settlement is ' || v_row.status || ' and locked. Reopen it first — the reason is recorded in the audit trail.');
    end if;
    if not public.sph_same_version(v_row.updated_at, v_expected) then
      perform public.sph_web_fail('conflict', 'This settlement was changed somewhere else (iPhone or another tab) after you opened it. Nothing was saved. Reload to see the latest version.');
    end if;
  else
    perform public.sph_web_fail('bad_request', 'Unknown save mode.');
  end if;

  -- Header (keys present in the payload only; absent keys keep the stored /
  -- default value).
  update public.settlements s set
           settlement_period_start = case when v_hj ? 'settlement_period_start' then v_h.settlement_period_start else s.settlement_period_start end,
           settlement_period_end = case when v_hj ? 'settlement_period_end' then v_h.settlement_period_end else s.settlement_period_end end,
           settlement_number = case when v_hj ? 'settlement_number' then v_h.settlement_number else s.settlement_number end,
           settlement_type = case when v_hj ? 'settlement_type' then v_h.settlement_type else s.settlement_type end,
           truck_number = case when v_hj ? 'truck_number' then v_h.truck_number else s.truck_number end,
           truck_id = case when v_hj ? 'truck_id' then v_h.truck_id else s.truck_id end,
           pdf_storage_path = case when v_hj ? 'pdf_storage_path' then v_h.pdf_storage_path else s.pdf_storage_path end,
           pay_rule = case when v_hj ? 'pay_rule' then v_h.pay_rule else s.pay_rule end,
           pay_on_gross_revenue = case when v_hj ? 'pay_on_gross_revenue' then v_h.pay_on_gross_revenue else s.pay_on_gross_revenue end,
           hours_worked = case when v_hj ? 'hours_worked' then v_h.hours_worked else s.hours_worked end,
           notes = case when v_hj ? 'notes' then v_h.notes else s.notes end,
           gross_load_revenue = case when v_hj ? 'gross_load_revenue' then v_h.gross_load_revenue else s.gross_load_revenue end,
           total_driver_earnings = case when v_hj ? 'total_driver_earnings' then v_h.total_driver_earnings else s.total_driver_earnings end,
           total_additions = case when v_hj ? 'total_additions' then v_h.total_additions else s.total_additions end,
           total_deductions = case when v_hj ? 'total_deductions' then v_h.total_deductions else s.total_deductions end,
           company_retained = case when v_hj ? 'company_retained' then v_h.company_retained else s.company_retained end,
           company_expenses = case when v_hj ? 'company_expenses' then v_h.company_expenses else s.company_expenses end,
           loaded_miles = case when v_hj ? 'loaded_miles' then v_h.loaded_miles else s.loaded_miles end,
           deadhead_miles = case when v_hj ? 'deadhead_miles' then v_h.deadhead_miles else s.deadhead_miles end,
           total_miles = case when v_hj ? 'total_miles' then v_h.total_miles else s.total_miles end,
           total_revenue = case when v_hj ? 'total_revenue' then v_h.total_revenue else s.total_revenue end,
           total_expenses = case when v_hj ? 'total_expenses' then v_h.total_expenses else s.total_expenses end,
           gross_profit = case when v_hj ? 'gross_profit' then v_h.gross_profit else s.gross_profit end,
           driver_pay_amount = case when v_hj ? 'driver_pay_amount' then v_h.driver_pay_amount else s.driver_pay_amount end,
           net_pay = case when v_hj ? 'net_pay' then v_h.net_pay else s.net_pay end,
           engine_version = case when v_hj ? 'engine_version' then v_h.engine_version else s.engine_version end,
           driver_pay_percentage = case when v_hj ? 'driver_pay_percentage' then v_h.driver_pay_percentage else s.driver_pay_percentage end,
           dispatcher_fee_percentage = case when v_hj ? 'dispatcher_fee_percentage' then v_h.dispatcher_fee_percentage else s.dispatcher_fee_percentage end,
           factoring_fee_percentage = case when v_hj ? 'factoring_fee_percentage' then v_h.factoring_fee_percentage else s.factoring_fee_percentage end,
           dispatcher_fee_amount = case when v_hj ? 'dispatcher_fee_amount' then v_h.dispatcher_fee_amount else s.dispatcher_fee_amount end,
           factoring_fee_amount = case when v_hj ? 'factoring_fee_amount' then v_h.factoring_fee_amount else s.factoring_fee_amount end,
           authority_fee = case when v_hj ? 'authority_fee' then v_h.authority_fee else s.authority_fee end,
           maintenance_reserve = case when v_hj ? 'maintenance_reserve' then v_h.maintenance_reserve else s.maintenance_reserve end
     where s.id = v_id;

  -- A line id that already belongs to ANOTHER settlement is never moved.
  select x.id into v_bad
    from jsonb_to_recordset(coalesce(p->'loads', '[]'::jsonb)) as x(id uuid)
    join public.settlement_loads t on t.id = x.id
   where t.settlement_id <> v_id
   limit 1;
  if v_bad is not null then
    perform public.sph_web_fail('foreign_row', 'A line on this save belongs to another settlement. Nothing was saved. Reload and try again.');
  end if;
  select x.id into v_bad
    from jsonb_to_recordset(coalesce(p->'additions', '[]'::jsonb)) as x(id uuid)
    join public.settlement_additions t on t.id = x.id
   where t.settlement_id <> v_id
   limit 1;
  if v_bad is not null then
    perform public.sph_web_fail('foreign_row', 'A line on this save belongs to another settlement. Nothing was saved. Reload and try again.');
  end if;
  select x.id into v_bad
    from jsonb_to_recordset(coalesce(p->'deductions', '[]'::jsonb)) as x(id uuid)
    join public.settlement_deductions t on t.id = x.id
   where t.settlement_id <> v_id
   limit 1;
  if v_bad is not null then
    perform public.sph_web_fail('foreign_row', 'A line on this save belongs to another settlement. Nothing was saved. Reload and try again.');
  end if;

  -- Prune first (so a load removed and re-added can't trip the one-load-per-
  -- settlement index), then upsert. Only rows of THIS settlement are touched.
  delete from public.settlement_loads
   where settlement_id = v_id
     and id not in (select (e->>'id')::uuid from jsonb_array_elements(coalesce(p->'loads', '[]'::jsonb)) e);
  delete from public.settlement_additions
   where settlement_id = v_id
     and id not in (select (e->>'id')::uuid from jsonb_array_elements(coalesce(p->'additions', '[]'::jsonb)) e);
  delete from public.settlement_deductions
   where settlement_id = v_id
     and id not in (select (e->>'id')::uuid from jsonb_array_elements(coalesce(p->'deductions', '[]'::jsonb)) e);

  insert into public.settlement_loads (id, settlement_id, profile_id, load_id, load_number, broker_name, broker_mc_number, pickup_date, delivery_date, origin, destination, loaded_miles, deadhead_miles, linehaul, fuel_surcharge, accessorials, detention, layover, tonu, lumper_reimbursement, gross_rate_override, pay_rule_override, hours_worked, driver_earnings, pay_basis_description, notes, is_adjustment, corrects_settlement_id, sort_order, rate_confirmation_document_id, proof_of_delivery_document_id)
    select r.id, v_id, v_uid, r.load_id, r.load_number, r.broker_name, r.broker_mc_number, r.pickup_date, r.delivery_date, r.origin, r.destination, r.loaded_miles, r.deadhead_miles, r.linehaul, r.fuel_surcharge, r.accessorials, r.detention, r.layover, r.tonu, r.lumper_reimbursement, r.gross_rate_override, r.pay_rule_override, r.hours_worked, r.driver_earnings, r.pay_basis_description, r.notes, r.is_adjustment, r.corrects_settlement_id, r.sort_order, r.rate_confirmation_document_id, r.proof_of_delivery_document_id
      from jsonb_populate_recordset(null::public.settlement_loads, coalesce(p->'loads', '[]'::jsonb)) r
  on conflict (id) do update set
           load_id = excluded.load_id,
           load_number = excluded.load_number,
           broker_name = excluded.broker_name,
           broker_mc_number = excluded.broker_mc_number,
           pickup_date = excluded.pickup_date,
           delivery_date = excluded.delivery_date,
           origin = excluded.origin,
           destination = excluded.destination,
           loaded_miles = excluded.loaded_miles,
           deadhead_miles = excluded.deadhead_miles,
           linehaul = excluded.linehaul,
           fuel_surcharge = excluded.fuel_surcharge,
           accessorials = excluded.accessorials,
           detention = excluded.detention,
           layover = excluded.layover,
           tonu = excluded.tonu,
           lumper_reimbursement = excluded.lumper_reimbursement,
           gross_rate_override = excluded.gross_rate_override,
           pay_rule_override = excluded.pay_rule_override,
           hours_worked = excluded.hours_worked,
           driver_earnings = excluded.driver_earnings,
           pay_basis_description = excluded.pay_basis_description,
           notes = excluded.notes,
           is_adjustment = excluded.is_adjustment,
           corrects_settlement_id = excluded.corrects_settlement_id,
           sort_order = excluded.sort_order
     where public.settlement_loads.settlement_id = v_id;
  insert into public.settlement_additions (id, settlement_id, profile_id, category, custom_category_id, description, amount, date, related_load_id, notes, sort_order, document_id)
    select r.id, v_id, v_uid, r.category, r.custom_category_id, r.description, r.amount, r.date, r.related_load_id, r.notes, r.sort_order, r.document_id
      from jsonb_populate_recordset(null::public.settlement_additions, coalesce(p->'additions', '[]'::jsonb)) r
  on conflict (id) do update set
           category = excluded.category,
           custom_category_id = excluded.custom_category_id,
           description = excluded.description,
           amount = excluded.amount,
           date = excluded.date,
           related_load_id = excluded.related_load_id,
           notes = excluded.notes,
           sort_order = excluded.sort_order
     where public.settlement_additions.settlement_id = v_id;
  insert into public.settlement_deductions (id, settlement_id, profile_id, category, custom_category_id, description, amount, date, related_load_id, related_expense_id, notes, responsibility, driver_share_percent, recurring_deduction_id, advance_id, sort_order, document_id)
    select r.id, v_id, v_uid, r.category, r.custom_category_id, r.description, r.amount, r.date, r.related_load_id, r.related_expense_id, r.notes, r.responsibility, r.driver_share_percent, r.recurring_deduction_id, r.advance_id, r.sort_order, r.document_id
      from jsonb_populate_recordset(null::public.settlement_deductions, coalesce(p->'deductions', '[]'::jsonb)) r
  on conflict (id) do update set
           category = excluded.category,
           custom_category_id = excluded.custom_category_id,
           description = excluded.description,
           amount = excluded.amount,
           date = excluded.date,
           related_load_id = excluded.related_load_id,
           related_expense_id = excluded.related_expense_id,
           notes = excluded.notes,
           responsibility = excluded.responsibility,
           driver_share_percent = excluded.driver_share_percent,
           recurring_deduction_id = excluded.recurring_deduction_id,
           advance_id = excluded.advance_id,
           sort_order = excluded.sort_order
     where public.settlement_deductions.settlement_id = v_id;

  -- Every submitted line must now be on THIS settlement. A conflicting id the
  -- caller can't see (another account's row) is skipped by the upsert's WHERE;
  -- that must fail loudly, not drop a line.
  if (select count(*) from public.settlement_loads x where x.settlement_id = v_id) <> jsonb_array_length(coalesce(p->'loads', '[]'::jsonb))
     or (select count(*) from public.settlement_additions x where x.settlement_id = v_id) <> jsonb_array_length(coalesce(p->'additions', '[]'::jsonb))
     or (select count(*) from public.settlement_deductions x where x.settlement_id = v_id) <> jsonb_array_length(coalesce(p->'deductions', '[]'::jsonb)) then
    perform public.sph_web_fail('foreign_row', 'A line on this save belongs to another settlement. Nothing was saved. Reload and try again.');
  end if;

  if jsonb_typeof(p->'audit') is distinct from 'array' or jsonb_array_length(p->'audit') = 0 then
    perform public.sph_web_fail('audit_required', 'Every payroll change needs an audit entry. Nothing was saved.');
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p->'audit', '[]'::jsonb)) as a(action text)
              where a.action is null or a.action not in ('created','load_added','load_removed','pay_rate_changed','addition_added','addition_removed','deduction_added','deduction_removed','recurring_applied','advance_repayment_applied','status_changed','approved','marked_paid','reopened','voided','manual_adjustment','recalculated')) then
    perform public.sph_web_fail('bad_audit_action', 'Audit action is not one the iPhone app understands. Nothing was saved.');
  end if;
  insert into public.settlement_audit_events
         (profile_id, settlement_id, action, summary, field_name, previous_value, new_value, actor_user_id, actor_name, timestamp)
  select v_uid, v_id, e->>'action', left(coalesce(e->>'summary', ''), 1000), e->>'field_name',
         left(e->>'previous_value', 500), left(e->>'new_value', 500),
         v_uid, left(e->>'actor_name', 200), clock_timestamp() + (a.ord * interval '1 microsecond')
    from jsonb_array_elements(coalesce(p->'audit', '[]'::jsonb)) with ordinality as a(e, ord);

  select s.updated_at into v_updated from public.settlements s where s.id = v_id;
  return jsonb_build_object('settlement_id', v_id, 'updated_at', v_updated);
end;
$$;

comment on function public.sph_web_save_settlement(jsonb) is
  'Web settlement editor save/create: header + lines + audit in one transaction, with lock, ownership, optimistic-concurrency and foreign-row guards.';

-- -----------------------------------------------------------------------------
--  Status change
-- -----------------------------------------------------------------------------
create or replace function public.sph_web_transition_settlement(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_id       uuid := nullif(p->>'settlement_id', '')::uuid;
  v_expected timestamptz := nullif(p->>'expected_updated_at', '')::timestamptz;
  v_from     text := p->>'from';
  v_to       text := p->>'to';
  v_reason   text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_number   text := nullif(btrim(coalesce(p->>'settlement_number', '')), '');
  v_method   text := nullif(btrim(coalesce(p->>'payment_method', '')), '');
  v_ref      text := nullif(btrim(coalesce(p->>'payment_reference', '')), '');
  v_row      public.settlements%rowtype;
  v_cur      text;
  v_loads    uuid[];
  v_adv      uuid[];
  v_updated  timestamptz;
  v_over     record;
begin
  if v_uid is null then perform public.sph_web_fail('not_signed_in', 'Sign in again.'); end if;
  -- Optional refresh of stale totals (a full save payload). Same transaction:
  -- if the move is then refused, the refresh is rolled back too.
  if p ? 'refresh' and jsonb_typeof(p->'refresh') = 'object' then
    if (p->'refresh'->>'settlement_id') is distinct from (p->>'settlement_id') or coalesce(p->'refresh'->>'mode', 'update') <> 'update' then
      perform public.sph_web_fail('bad_request', 'Refresh payload does not match this settlement.');
    end if;
    v_expected := (public.sph_web_save_settlement(p->'refresh')->>'updated_at')::timestamptz;
  end if;
  select * into v_row from public.settlements s where s.id = v_id for update;
  if not found then perform public.sph_web_fail('not_found', 'Settlement not found.'); end if;
  if v_row.profile_id is distinct from v_uid then
    perform public.sph_web_fail('not_owner', 'Only the carrier account can change this settlement.');
  end if;
  if coalesce(v_row.is_estimate, false) then
    perform public.sph_web_fail('estimate', 'Estimates cannot be approved or paid.');
  end if;
  v_cur := coalesce(nullif(v_row.status, ''), 'draft');
  if not public.sph_same_version(v_row.updated_at, v_expected) or v_cur is distinct from v_from then
    perform public.sph_web_fail('conflict', 'This settlement was changed somewhere else after you opened it. Nothing was changed. Reload and try again.');
  end if;
  if v_to is null or v_to not in ('draft', 'ready_for_review', 'approved', 'paid', 'voided') then
    perform public.sph_web_fail('bad_request', 'Unknown target status.');
  end if;
  if v_from = v_to then
    perform public.sph_web_fail('same_status', 'This settlement is already ' || v_to || '.');
  end if;
  -- iPhone SettlementStatus.allowedTransitions
  if (
       (v_from = 'draft'            and v_to in ('ready_for_review', 'approved', 'voided'))
    or (v_from = 'ready_for_review' and v_to in ('draft', 'approved', 'voided'))
    or (v_from = 'approved'         and v_to in ('paid', 'draft', 'voided'))
    or (v_from = 'paid'             and v_to in ('approved', 'voided'))
    or (v_from = 'voided'           and v_to = 'draft')
  ) is not true then
    perform public.sph_web_fail('bad_transition', 'A ' || v_from || ' settlement cannot move straight to ' || v_to || '.');
  end if;
  if v_reason is null and (
       (v_from = 'approved' and v_to = 'draft') or (v_from = 'paid' and v_to = 'approved')
    or v_from = 'voided' or (v_to = 'voided' and v_from in ('approved', 'paid'))
  ) then
    perform public.sph_web_fail('reason_required', 'Give a reason — it is recorded in the audit trail.');
  end if;

  -- The move's own audit row must be present (iPhone statusChanged mapping).
  if not exists (
    select 1 from jsonb_array_elements(coalesce(p->'audit', '[]'::jsonb)) e
     where e->>'action' = case
             when v_to = 'approved' then 'approved'
             when v_to = 'paid' then 'marked_paid'
             when v_to = 'voided' then 'voided'
             when v_to = 'draft' and v_from in ('paid', 'voided') then 'reopened'
             else 'status_changed' end
  ) then
    perform public.sph_web_fail('audit_required', 'The status change needs its audit entry. Nothing was changed.');
  end if;

  -- Status + timestamps (the approval double-pay trigger fires here).
  -- sph.in_transition marks this as the audited status move, for the
  -- finalized-settlement lock (REVIEW_BEFORE_APPLYING_20261024120000).
  perform set_config('sph.in_transition', 'on', true);
  update public.settlements s set
         status            = v_to,
         settlement_number = case when v_to = 'approved' and nullif(btrim(s.settlement_number), '') is null then v_number else s.settlement_number end,
         approved_at       = case when v_to = 'approved' and v_from <> 'paid' then now()
                                  when v_to in ('draft', 'ready_for_review') and v_from in ('approved', 'paid', 'voided') then null
                                  else s.approved_at end,
         approved_by       = case when v_to = 'approved' and v_from <> 'paid' then v_uid
                                  when v_to in ('draft', 'ready_for_review') and v_from in ('approved', 'paid', 'voided') then null
                                  else s.approved_by end,
         paid_at           = case when v_to = 'paid' then now()
                                  when v_to = 'approved' and v_from = 'paid' then null
                                  when v_to in ('draft', 'ready_for_review') and v_from in ('approved', 'paid', 'voided') then null
                                  else s.paid_at end,
         payment_reference = case when v_to = 'paid' and v_ref is not null then v_ref
                                  when v_to = 'approved' and v_from = 'paid' then null
                                  else s.payment_reference end,
         payment_method    = case when v_to = 'paid' and v_method is not null then v_method else s.payment_method end,
         voided_at         = case when v_to = 'voided' then now()
                                  when v_to in ('draft', 'ready_for_review') and v_from in ('approved', 'paid', 'voided') then null
                                  else s.voided_at end
   where s.id = v_id;

  perform set_config('sph.in_transition', 'off', true);
  if v_to = 'approved' and (select nullif(btrim(s.settlement_number), '') from public.settlements s where s.id = v_id) is null then
    perform public.sph_web_fail('no_number', 'A settlement number is required to approve.');
  end if;

  -- Lock every advance this move can touch, in id order, before any
  -- repayment row is written (prevents a KEY SHARE → FOR UPDATE deadlock
  -- between two approvals recovering the same advance).
  perform 1 from public.driver_advances a
   where a.id in (select d.advance_id from public.settlement_deductions d where d.settlement_id = v_id and d.advance_id is not null
                  union select r.advance_id from public.driver_advance_repayments r where r.settlement_id = v_id)
   order by a.id
     for update;

  v_loads := array(select sl.load_id from public.settlement_loads sl
                    where sl.settlement_id = v_id and sl.is_adjustment = false and sl.load_id is not null);
  v_adv := array(select distinct r.advance_id from public.driver_advance_repayments r where r.settlement_id = v_id);

  if v_to = 'approved' and v_from <> 'paid' then
    -- iPhone transition(.approved): repayments = DRIVER share of each advance
    -- recovery line, dated the period end. Computed from stored rows here.
    delete from public.driver_advance_repayments r where r.settlement_id = v_id;
    insert into public.driver_advance_repayments (profile_id, advance_id, settlement_id, deduction_id, amount, date)
    select v_uid, d.advance_id, v_id, d.id,
           round(d.amount * (case d.responsibility when 'driver' then 100 when 'company' then 0
                                   else least(100, greatest(0, d.driver_share_percent)) end) / 100, 2),
           coalesce(v_row.settlement_period_end, current_date)
      from public.settlement_deductions d
     where d.settlement_id = v_id and d.advance_id is not null
       and round(d.amount * (case d.responsibility when 'driver' then 100 when 'company' then 0
                                  else least(100, greatest(0, d.driver_share_percent)) end) / 100, 2) > 0;
    v_adv := v_adv || array(select distinct d.advance_id from public.settlement_deductions d
                             where d.settlement_id = v_id and d.advance_id is not null);
    update public.loads l set status = 'settled'
     where l.id = any (v_loads)
       and (l.status is null or lower(btrim(l.status)) not in ('cancelled', 'canceled'));
  elsif v_to = 'voided' or (v_to in ('draft', 'ready_for_review') and v_from in ('approved', 'paid', 'voided')) then
    delete from public.driver_advance_repayments r where r.settlement_id = v_id;
    if v_from in ('approved', 'paid') then
      -- Release only loads no other approved/paid settlement still pays
      -- (sph_loads_keep_paid_settled also enforces this).
      update public.loads l set status = 'ready_for_settlement'
       where l.id = any (v_loads) and l.status = 'settled'
         and not exists (select 1 from public.settlement_loads o join public.settlements os on os.id = o.settlement_id
                          where o.load_id = l.id and o.settlement_id <> v_id and o.is_adjustment = false
                            and os.status in ('approved', 'paid') and coalesce(os.is_estimate, false) = false);
    end if;
  end if;

  -- Advance balances = sum of their repayments; never over-recovered.
  for v_over in
    select a.id, a.amount, coalesce((select sum(r.amount) from public.driver_advance_repayments r where r.advance_id = a.id), 0) as rec
      from public.driver_advances a where a.id = any (v_adv)
     order by a.id
       for update
  loop
    if v_over.rec > v_over.amount then
      perform public.sph_web_fail('advance_over_recovery',
        'This would recover $' || to_char(v_over.rec, 'FM999999990.00') || ' on an advance of $' || to_char(v_over.amount, 'FM999999990.00') || '. Nothing was changed.');
    end if;
    update public.driver_advances a set recovered_amount = v_over.rec, is_closed = (v_over.rec >= v_over.amount)
     where a.id = v_over.id;
  end loop;

  if jsonb_typeof(p->'audit') is distinct from 'array' or jsonb_array_length(p->'audit') = 0 then
    perform public.sph_web_fail('audit_required', 'Every payroll change needs an audit entry. Nothing was saved.');
  end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p->'audit', '[]'::jsonb)) as a(action text)
              where a.action is null or a.action not in ('created','load_added','load_removed','pay_rate_changed','addition_added','addition_removed','deduction_added','deduction_removed','recurring_applied','advance_repayment_applied','status_changed','approved','marked_paid','reopened','voided','manual_adjustment','recalculated')) then
    perform public.sph_web_fail('bad_audit_action', 'Audit action is not one the iPhone app understands. Nothing was saved.');
  end if;
  insert into public.settlement_audit_events
         (profile_id, settlement_id, action, summary, field_name, previous_value, new_value, actor_user_id, actor_name, timestamp)
  select v_uid, v_id, e->>'action', left(coalesce(e->>'summary', ''), 1000), e->>'field_name',
         left(e->>'previous_value', 500), left(e->>'new_value', 500),
         v_uid, left(e->>'actor_name', 200), clock_timestamp() + (a.ord * interval '1 microsecond')
    from jsonb_array_elements(coalesce(p->'audit', '[]'::jsonb)) with ordinality as a(e, ord);

  select s.updated_at into v_updated from public.settlements s where s.id = v_id;
  return jsonb_build_object('settlement_id', v_id, 'updated_at', v_updated, 'status', v_to);
end;
$$;

comment on function public.sph_web_transition_settlement(jsonb) is
  'Web settlement status change: status, advance repayments/balances, load flags and audit in one transaction.';

revoke all on function public.sph_same_version(timestamptz, timestamptz) from public, anon;
revoke all on function public.sph_web_fail(text, text) from public, anon;
revoke all on function public.sph_web_save_settlement(jsonb) from public, anon;
revoke all on function public.sph_web_transition_settlement(jsonb) from public, anon;
grant execute on function public.sph_same_version(timestamptz, timestamptz) to authenticated;
grant execute on function public.sph_web_fail(text, text) to authenticated;
grant execute on function public.sph_web_save_settlement(jsonb) to authenticated;
grant execute on function public.sph_web_transition_settlement(jsonb) to authenticated;

commit;

-- =============================================================================
--  ROLLBACK (manual)
-- -----------------------------------------------------------------------------
--  drop function if exists public.sph_web_transition_settlement(jsonb);
--  drop function if exists public.sph_web_save_settlement(jsonb);
--  drop function if exists public.sph_web_fail(text, text);
--  drop function if exists public.sph_same_version(timestamptz, timestamptz);
-- =============================================================================
