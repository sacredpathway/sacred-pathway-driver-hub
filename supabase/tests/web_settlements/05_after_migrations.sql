\set ON_ERROR_STOP on
-- Snapshot of history right after the migrations (compared at the very end).
create table public.fixture_history as
  select 'paystubs' as t, id, to_jsonb(p) as row from public.paystubs p
  union all select 'paystub_earnings', id, to_jsonb(e) from public.paystub_earnings e
  union all select 'settlements', id, to_jsonb(s) from public.settlements s;
revoke all on public.fixture_history from anon, authenticated;

-- Advance for A1: $500.
insert into public.driver_advances (id, profile_id, driver_id, type, date, amount, description)
values ('aaaaaaaa-0000-0000-0000-0000000ad001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'cash', '2026-10-01', 500, 'Cash advance');
-- A recurring rule (for the duplicate-recurring test).
insert into public.recurring_deductions (id, profile_id, driver_id, category, description, amount, effective_start_date)
values ('aaaaaaaa-0000-0000-0000-0000000ec001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001', 'insurance', 'Occ/Acc', 45, '2026-01-01');
-- A custom category (A).
insert into public.payroll_custom_categories (id, profile_id, kind, name, base_category, default_responsibility)
values ('aaaaaaaa-0000-0000-0000-0000000cc001', 'aaaaaaaa-0000-0000-0000-000000000001', 'deduction', 'ELD subscription', 'equipment_charge', 'driver');

-- -----------------------------------------------------------------------------
--  Test helpers (built exactly like web-app/lib/settlements/rows.ts output)
-- -----------------------------------------------------------------------------
create or replace function public.t_load(p_id uuid, p_load uuid, p_number text, p_linehaul numeric, p_earn numeric default 0)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_id, 'load_id', p_load, 'load_number', p_number, 'broker_name', null, 'broker_mc_number', null,
    'pickup_date', null, 'delivery_date', '2026-10-15', 'origin', 'Dallas, TX', 'destination', 'Phoenix, AZ',
    'loaded_miles', '1000.00', 'deadhead_miles', '0.00', 'linehaul', p_linehaul::text, 'fuel_surcharge', '0.00',
    'accessorials', '0.00', 'detention', '0.00', 'layover', '0.00', 'tonu', '0.00', 'lumper_reimbursement', '0.00',
    'gross_rate_override', null, 'pay_rule_override', null, 'hours_worked', null,
    'driver_earnings', p_earn::text, 'pay_basis_description', '70% of gross', 'notes', null,
    'is_adjustment', false, 'corrects_settlement_id', null, 'sort_order', 0)
$$;
create or replace function public.t_ded(p_id uuid, p_cat text, p_desc text, p_amount numeric,
  p_resp text default 'driver', p_share numeric default 100, p_adv uuid default null, p_rec uuid default null, p_custom uuid default null, p_exp uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'category', p_cat, 'custom_category_id', p_custom, 'description', p_desc,
    'amount', p_amount::text, 'date', null, 'related_load_id', null, 'related_expense_id', p_exp, 'notes', null,
    'responsibility', p_resp, 'driver_share_percent', p_share::text, 'recurring_deduction_id', p_rec,
    'advance_id', p_adv, 'sort_order', 2000)
$$;
create or replace function public.t_add(p_id uuid, p_cat text, p_desc text, p_amount numeric, p_custom uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'category', p_cat, 'custom_category_id', p_custom, 'description', p_desc,
    'amount', p_amount::text, 'date', null, 'related_load_id', null, 'notes', null, 'sort_order', 0)
$$;
create or replace function public.t_header(p_number text, p_net numeric, p_driver uuid default 'aaaaaaaa-0000-0000-0000-00000000d001')
returns jsonb language sql immutable as $$
  select jsonb_build_object('driver_id', p_driver, 'settlement_period_start', '2026-10-12', 'settlement_period_end', '2026-10-18',
    'settlement_number', p_number, 'settlement_type', 'company_driver', 'truck_number', '12',
    'pay_rule', '{"components":[{"id":"00000000-0000-4000-8000-000000000001","kind":"percent_of_gross","label":"Percentage of Gross","percent":70,"mile_basis":"loaded"}]}'::jsonb,
    'pay_on_gross_revenue', true, 'hours_worked', null, 'notes', null,
    'gross_load_revenue', '0', 'total_driver_earnings', p_net::text, 'total_additions', '0', 'total_deductions', '0',
    'company_retained', '0', 'company_expenses', '0', 'loaded_miles', '0', 'deadhead_miles', '0', 'total_miles', '0',
    'total_revenue', '0', 'total_expenses', '0', 'gross_profit', '0', 'driver_pay_amount', p_net::text,
    'net_pay', p_net::text, 'engine_version', 'settlement-engine/1.0', 'driver_pay_percentage', '70')
$$;
create or replace function public.t_audit(p_action text, p_summary text)
returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('action', p_action, 'summary', p_summary, 'field_name', null,
    'previous_value', null, 'new_value', null, 'actor_name', 'owner@example.com'))
$$;
grant execute on function public.t_load(uuid, uuid, text, numeric, numeric), public.t_ded(uuid, text, text, numeric, text, numeric, uuid, uuid, uuid, uuid), public.t_add(uuid, text, text, numeric, uuid), public.t_header(text, numeric, uuid), public.t_audit(text, text) to authenticated;
