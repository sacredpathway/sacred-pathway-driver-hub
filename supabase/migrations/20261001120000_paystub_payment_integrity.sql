-- =============================================================================
--  Paystub payment integrity (Option A, owner-approved 2026-09-30)
-- -----------------------------------------------------------------------------
--  Closes the web-paystub double-payment gap at the database layer.
--
--  Model
--    draft   — editable; attaching a load does NOT settle it. A load already
--              paid/finalized elsewhere cannot be attached. The same load MAY
--              sit on two drafts (only one can ever be issued).
--    issued  — public.issue_paystub(): ONE transaction that locks the paystub
--              and its loads, re-verifies every load, assigns the number, snaps
--              YTD, flips draft → issued and marks every load `settled`.
--              Any failure rolls back everything.
--    paid    — issued → paid only (plain UPDATE, guarded by trigger).
--    voided  — public.void_paystub(): ONE transaction that voids an issued/paid
--              paystub and returns each of its loads to `ready_for_settlement`
--              only when it is `settled` and no other issued/paid paystub or
--              approved/paid settlement accounts for it (mirrors iOS
--              SettlementCloudStore.releaseSettledLoads).
--
--  Security
--    • Every function is SECURITY INVOKER: RLS (profile_id = auth.uid()) stays
--      the tenant boundary. No SECURITY DEFINER, no RLS changes.
--    • Ownership is derived from database rows + auth.uid(); callers pass only
--      a paystub id. There is no generic "set status" RPC.
--    • search_path pinned to public, pg_temp on every function.
--    • EXECUTE revoked from PUBLIC/anon; granted to authenticated (and
--      service_role for the RPCs). Trigger functions are not callable.
--
--  Additive only: no table/column changes, no data rewrites. Existing rows
--  (25 settled loads, 112 pending loads, 1 draft paystub) are untouched —
--  triggers only evaluate rows written after this migration.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Eligibility helpers
-- -----------------------------------------------------------------------------

-- True when an issued/paid web paystub (other than p_exclude_paystub_id) or an
-- approved/paid non-estimate iPhone settlement (non-adjustment line) carries
-- the load. Mirrors the iOS ledger rule (alreadySettledLoadIds).
create or replace function public.sph_load_paid_elsewhere(
  p_load_id uuid,
  p_exclude_paystub_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
           select 1
             from public.paystub_earnings e
             join public.paystubs p on p.id = e.paystub_id
            where e.load_id = p_load_id
              and p.status in ('issued', 'paid')
              and (p_exclude_paystub_id is null or p.id <> p_exclude_paystub_id)
         )
      or exists (
           select 1
             from public.settlement_loads sl
             join public.settlements s on s.id = sl.settlement_id
            where sl.load_id = p_load_id
              and sl.is_adjustment = false
              and s.status in ('approved', 'paid')
              and coalesce(s.is_estimate, false) = false
         );
$$;

comment on function public.sph_load_paid_elsewhere(uuid, uuid) is
  'True when an issued/paid paystub (excluding p_exclude_paystub_id) or an approved/paid non-estimate settlement already pays this load.';

-- Returns NULL when the load may be paid on p_paystub_id, else a reason code:
--   load_not_found          not visible to the caller, or a different tenant
--                           than the paystub
--   load_cancelled          cancelled / canceled
--   load_settled            status settled (paid by iOS or an issued paystub)
--   load_on_issued_paystub  on another issued/paid web paystub
--   load_on_settlement      on an approved/paid iPhone settlement
create or replace function public.sph_load_payment_conflict(
  p_load_id uuid,
  p_paystub_id uuid default null
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_load_profile uuid;
  v_status text;
  v_ps_profile uuid;
begin
  select l.profile_id, lower(btrim(coalesce(l.status, '')))
    into v_load_profile, v_status
    from public.loads l
   where l.id = p_load_id;
  if not found then
    return 'load_not_found';
  end if;

  if p_paystub_id is not null then
    select p.profile_id into v_ps_profile from public.paystubs p where p.id = p_paystub_id;
    if v_ps_profile is null or v_ps_profile <> v_load_profile then
      return 'load_not_found';
    end if;
  end if;

  if v_status in ('cancelled', 'canceled') then
    return 'load_cancelled';
  end if;
  if v_status = 'settled' then
    return 'load_settled';
  end if;
  if exists (
    select 1
      from public.paystub_earnings e
      join public.paystubs p on p.id = e.paystub_id
     where e.load_id = p_load_id
       and p.status in ('issued', 'paid')
       and (p_paystub_id is null or p.id <> p_paystub_id)
  ) then
    return 'load_on_issued_paystub';
  end if;
  if exists (
    select 1
      from public.settlement_loads sl
      join public.settlements s on s.id = sl.settlement_id
     where sl.load_id = p_load_id
       and sl.is_adjustment = false
       and s.status in ('approved', 'paid')
       and coalesce(s.is_estimate, false) = false
  ) then
    return 'load_on_settlement';
  end if;
  return null;
end;
$$;

comment on function public.sph_load_payment_conflict(uuid, uuid) is
  'NULL when the load may be paid on the paystub; otherwise a reason code (load_not_found, load_cancelled, load_settled, load_on_issued_paystub, load_on_settlement).';

-- Batch form for app pre-checks (e.g. New Paystub). Only returns conflicts.
create or replace function public.sph_loads_payment_conflicts(
  p_load_ids uuid[],
  p_paystub_id uuid default null
)
returns table (load_id uuid, conflict text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select x.id, c.conflict
    from (select distinct unnest(coalesce(p_load_ids, '{}'::uuid[])) as id) x
    cross join lateral (select public.sph_load_payment_conflict(x.id, p_paystub_id) as conflict) c
   where c.conflict is not null;
$$;

comment on function public.sph_loads_payment_conflicts(uuid[], uuid) is
  'Conflict codes for each load in p_load_ids that cannot be paid (see sph_load_payment_conflict).';


-- -----------------------------------------------------------------------------
--  2. Guard: load lines on paystub_earnings
-- -----------------------------------------------------------------------------
--  • A load line can only be added/changed/removed while its paystub is draft.
--  • Attaching (insert, or changing load_id/paystub_id) re-checks eligibility.
--    Another DRAFT holding the same load is allowed (owner decision).
--  • Cascades (paystub delete, profile delete) and the FK's ON DELETE SET NULL
--    when a load is deleted are allowed through.

create or replace function public.sph_paystub_earnings_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_conflict text;
  v_attach boolean;
begin
  -- Cascaded/RI-driven writes (depth > 1) are never blocked here.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.load_id is null then
      return old;
    end if;
    select p.status into v_status from public.paystubs p where p.id = old.paystub_id for share;
    if found and v_status <> 'draft' then
      raise exception 'paystub_locked: load lines can only be removed from a draft paystub'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.load_id is not null then
    select p.status into v_status from public.paystubs p where p.id = old.paystub_id for share;
    if found and v_status <> 'draft' then
      raise exception 'paystub_locked: load lines can only be changed on a draft paystub'
        using errcode = 'P0001';
    end if;
  end if;

  if new.load_id is null then
    return new;
  end if;

  select p.status into v_status from public.paystubs p where p.id = new.paystub_id for share;
  if not found then
    raise exception 'paystub_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'draft' then
    raise exception 'paystub_locked: loads can only be attached to a draft paystub'
      using errcode = 'P0001';
  end if;

  v_attach := tg_op = 'INSERT'
           or new.load_id is distinct from old.load_id
           or new.paystub_id is distinct from old.paystub_id;
  if v_attach then
    -- Wait for any in-flight issue/void holding this load, then re-check.
    perform 1 from public.loads l where l.id = new.load_id for share;
    v_conflict := public.sph_load_payment_conflict(new.load_id, new.paystub_id);
    if v_conflict is not null then
      raise exception '%', v_conflict using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sph_paystub_earnings_guard on public.paystub_earnings;
create trigger sph_paystub_earnings_guard
  before insert or update or delete on public.paystub_earnings
  for each row execute function public.sph_paystub_earnings_guard();


-- -----------------------------------------------------------------------------
--  3. Guard: paystub status transitions
-- -----------------------------------------------------------------------------
--  insert                 → must be draft
--  draft  → issued        → only inside public.issue_paystub()
--  issued → paid          → allowed (Mark Paid; not a settle event)
--  issued/paid → voided   → only inside public.void_paystub()
--  unchanged status       → allowed (header/total/email/pdf updates)
--  anything else          → rejected

create or replace function public.sph_paystubs_guard_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_op text := coalesce(current_setting('sph.paystub_op', true), '');
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      raise exception 'paystub_invalid_transition: new paystubs must be created as draft'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'issued' and v_op = 'issue:' || old.id::text then
    return new;
  end if;
  if old.status = 'issued' and new.status = 'paid' then
    return new;
  end if;
  if old.status in ('issued', 'paid') and new.status = 'voided' and v_op = 'void:' || old.id::text then
    return new;
  end if;

  raise exception 'paystub_invalid_transition: % -> %', old.status, new.status
    using errcode = 'P0001';
end;
$$;

drop trigger if exists sph_paystubs_guard_status on public.paystubs;
create trigger sph_paystubs_guard_status
  before insert or update of status on public.paystubs
  for each row execute function public.sph_paystubs_guard_status();


-- -----------------------------------------------------------------------------
--  4. issue_paystub — the single authoritative issuance path
-- -----------------------------------------------------------------------------
--  Preserves the previous issuePaystubAction behavior exactly:
--    check_date      = check_date ?? pay_period_end
--    YTD             = this driver's OTHER status='issued' paystubs whose
--                      check_date falls in that calendar year + this one
--                      (gross, taxable ?? 0, taxes, net), rounded to cents
--                      (trim_scale → stored exactly like the old JS r2 value)
--    paystub_number  = PS-YYYY-NNNNN, next after the highest existing number
--                      for this carrier in that year
--  Totals are recomputed by the app (calculatePaystub) immediately before the
--  call; this function never changes pay math.

create or replace function public.issue_paystub(p_paystub_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ps public.paystubs%rowtype;
  v_load record;
  v_conflict text;
  v_check_date date;
  v_year int;
  v_prior record;
  v_max text;
  v_tail text;
  v_seq bigint := 1;
  v_number text;
  v_load_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  -- 1. Lock the paystub; RLS + explicit owner check.
  select * into v_ps from public.paystubs where id = p_paystub_id for update;
  if not found or v_ps.profile_id is distinct from v_uid then
    raise exception 'paystub_not_found' using errcode = 'P0001';
  end if;
  if v_ps.status <> 'draft' then
    raise exception 'paystub_not_draft' using errcode = 'P0001';
  end if;

  -- 2-5. Lock every load-backed line's load (id order → no deadlocks) and
  -- verify eligibility. Any failure aborts the whole transaction.
  for v_load in
    select l.id, l.profile_id
      from public.loads l
     where l.id in (select e.load_id from public.paystub_earnings e
                     where e.paystub_id = p_paystub_id and e.load_id is not null)
     order by l.id
       for update
  loop
    if v_load.profile_id is distinct from v_ps.profile_id then
      raise exception 'load_not_found' using errcode = 'P0001';
    end if;
    v_conflict := public.sph_load_payment_conflict(v_load.id, p_paystub_id);
    if v_conflict is not null then
      raise exception '%', v_conflict using errcode = 'P0001', detail = v_load.id::text;
    end if;
    v_load_ids := v_load_ids || v_load.id;
  end loop;

  -- A load line whose load is not visible (other tenant / missing) fails.
  if exists (
    select 1 from public.paystub_earnings e
     where e.paystub_id = p_paystub_id and e.load_id is not null
       and not (e.load_id = any (v_load_ids))
  ) then
    raise exception 'load_not_found' using errcode = 'P0001';
  end if;

  -- 6. Numbering + YTD (serialized per carrier).
  perform pg_advisory_xact_lock(hashtextextended('sph_paystub_number:' || v_ps.profile_id::text, 0));

  v_check_date := coalesce(v_ps.check_date, v_ps.pay_period_end);
  v_year := extract(year from v_check_date)::int;

  select coalesce(sum(coalesce(p.gross_earnings, 0)), 0)       as gross,
         coalesce(sum(coalesce(p.taxable_wages, 0)), 0)        as taxable,
         coalesce(sum(coalesce(p.total_taxes_withheld, 0)), 0) as taxes,
         coalesce(sum(coalesce(p.net_pay, 0)), 0)              as net
    into v_prior
    from public.paystubs p
   where p.profile_id = v_ps.profile_id
     and p.driver_id = v_ps.driver_id
     and p.status = 'issued'
     and p.id <> v_ps.id
     and p.check_date >= make_date(v_year, 1, 1)
     and p.check_date <= make_date(v_year, 12, 31);

  select p.paystub_number into v_max
    from public.paystubs p
   where p.profile_id = v_ps.profile_id
     and p.paystub_number like 'PS-' || v_year::text || '-%'
   order by p.paystub_number desc
   limit 1;
  if v_max is not null then
    v_tail := btrim(split_part(v_max, '-', 3));
    if v_tail ~ '^[0-9]{1,15}$' then
      v_seq := v_tail::bigint + 1;
    end if;
  end if;
  v_number := 'PS-' || v_year::text || '-' || lpad(v_seq::text, greatest(5, length(v_seq::text)), '0');

  perform set_config('sph.paystub_op', 'issue:' || v_ps.id::text, true);
  update public.paystubs
     set status             = 'issued',
         paystub_number     = v_number,
         check_date         = v_check_date,
         ytd_gross_earnings = trim_scale(round(v_prior.gross + coalesce(v_ps.gross_earnings, 0), 2)),
         ytd_taxable_wages  = trim_scale(round(v_prior.taxable + coalesce(v_ps.taxable_wages, 0), 2)),
         ytd_taxes_withheld = trim_scale(round(v_prior.taxes + coalesce(v_ps.total_taxes_withheld, 0), 2)),
         ytd_net_pay        = trim_scale(round(v_prior.net + coalesce(v_ps.net_pay, 0), 2))
   where id = v_ps.id;
  perform set_config('sph.paystub_op', '', true);

  -- 7. Settle every included load.
  if array_length(v_load_ids, 1) is not null then
    update public.loads set status = 'settled' where id = any (v_load_ids);
  end if;

  return jsonb_build_object(
    'paystub_id', v_ps.id,
    'paystub_number', v_number,
    'check_date', v_check_date,
    'net_pay', v_ps.net_pay,
    'driver_id', v_ps.driver_id,
    'settled_load_ids', to_jsonb(v_load_ids)
  );
end;
$$;

comment on function public.issue_paystub(uuid) is
  'Atomically issues a draft paystub owned by auth.uid(): locks + verifies every load, assigns number/YTD, sets issued, marks loads settled.';


-- -----------------------------------------------------------------------------
--  5. void_paystub — atomic void + safe load release
-- -----------------------------------------------------------------------------

create or replace function public.void_paystub(p_paystub_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_ps public.paystubs%rowtype;
  v_load record;
  v_released uuid[] := '{}';
  v_kept uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select * into v_ps from public.paystubs where id = p_paystub_id for update;
  if not found or v_ps.profile_id is distinct from v_uid then
    raise exception 'paystub_not_found' using errcode = 'P0001';
  end if;
  if v_ps.status not in ('issued', 'paid') then
    raise exception 'paystub_not_voidable' using errcode = 'P0001';
  end if;

  perform set_config('sph.paystub_op', 'void:' || v_ps.id::text, true);
  update public.paystubs set status = 'voided' where id = v_ps.id;
  perform set_config('sph.paystub_op', '', true);

  for v_load in
    select l.id, lower(btrim(coalesce(l.status, ''))) as status
      from public.loads l
     where l.profile_id = v_ps.profile_id
       and l.id in (select e.load_id from public.paystub_earnings e
                     where e.paystub_id = p_paystub_id and e.load_id is not null)
     order by l.id
       for update
  loop
    if v_load.status = 'settled'
       and not public.sph_load_paid_elsewhere(v_load.id, v_ps.id) then
      update public.loads
         set status = 'ready_for_settlement'
       where id = v_load.id and status = 'settled';
      v_released := v_released || v_load.id;
    else
      v_kept := v_kept || v_load.id;
    end if;
  end loop;

  return jsonb_build_object(
    'paystub_id', v_ps.id,
    'released_load_ids', to_jsonb(v_released),
    'kept_load_ids', to_jsonb(v_kept)
  );
end;
$$;

comment on function public.void_paystub(uuid) is
  'Atomically voids an issued/paid paystub owned by auth.uid() and releases its settled loads unless another paystub/settlement still pays them.';


-- -----------------------------------------------------------------------------
--  6. Privileges (Supabase default privileges grant EXECUTE to anon — revoke)
-- -----------------------------------------------------------------------------

revoke all on function public.sph_load_paid_elsewhere(uuid, uuid)        from public, anon;
revoke all on function public.sph_load_payment_conflict(uuid, uuid)      from public, anon;
revoke all on function public.sph_loads_payment_conflicts(uuid[], uuid)  from public, anon;
revoke all on function public.issue_paystub(uuid)                        from public, anon;
revoke all on function public.void_paystub(uuid)                         from public, anon;
revoke all on function public.sph_paystub_earnings_guard()               from public, anon, authenticated;
revoke all on function public.sph_paystubs_guard_status()                from public, anon, authenticated;

grant execute on function public.sph_load_paid_elsewhere(uuid, uuid)       to authenticated, service_role;
grant execute on function public.sph_load_payment_conflict(uuid, uuid)     to authenticated, service_role;
grant execute on function public.sph_loads_payment_conflicts(uuid[], uuid) to authenticated, service_role;
grant execute on function public.issue_paystub(uuid)                       to authenticated, service_role;
grant execute on function public.void_paystub(uuid)                        to authenticated, service_role;
