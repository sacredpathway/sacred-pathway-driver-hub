-- =============================================================================
--  Cross-platform payment integrity (follows 20261001120000_paystub_payment_integrity)
-- -----------------------------------------------------------------------------
--  One rule, enforced in the database whichever client acts first:
--    a load may be paid through a web paystub OR an iPhone settlement — never both.
--
--  Already in 20261001120000:  approved/paid iPhone settlement → blocks web issue.
--  Added here (inverse + hardening), with NO iPhone code change required:
--
--   1. sph_settlements_guard_approval (settlements, BEFORE INSERT/UPDATE)
--      Fires only on the transition INTO the authoritative state
--      (status approved/paid, is_estimate false) from a non-authoritative one.
--      Locks every real load line's load (non-adjustment, load_id set) in id
--      order and rejects the approval if a load is cancelled, not in the
--      carrier's account, on an issued/paid web paystub, or on another
--      approved/paid settlement. approved→paid and paid→approved (reopen of
--      money already sent) are not re-checked — same as the iPhone workflow.
--   2. sph_settlement_loads_guard (settlement_loads, BEFORE INSERT/UPDATE)
--      The same check when a load line is attached to a settlement that is
--      ALREADY approved/paid (an approved settlement edited without a pay
--      change keeps its status in the iPhone workflow).
--   3. sph_loads_keep_paid_settled (loads, BEFORE UPDATE OF status)
--      A `settled` load that an issued/paid paystub or approved/paid
--      settlement still pays is not moved back to a payable status by any
--      client (iPhone void/reopen release, legacy re-bill, manual edit). The
--      load simply stays `settled` — exactly what void_paystub and the iPhone
--      releasableLoads() rule already intend. Moving to `cancelled` is not
--      intercepted (a cancelled load is not payable).
--   4. sph_paystubs_guard_delete (paystubs, BEFORE DELETE)
--      Only draft paystubs can be deleted directly. Account-deletion
--      cascades (profiles → paystubs) are still allowed.
--
--  iPhone compatibility (Driver Hub 2.3.5, supabase-swift 2.53.0): the
--  approval is a single `settlements` upsert sent BEFORE any other write of
--  that transition; a rejection throws there, nothing else is sent, the local
--  ledger is not replaced, and SettlementAlert shows the exception message
--  verbatim ("Couldn't Complete" + message). Messages below are written for
--  that alert and avoid the phrases the app treats as "database update
--  missing" ("does not exist", "schema cache").
--
--  Load status is NOT changed by the approval guard: the iPhone app keeps
--  flagging loads `settled` after approval (best effort) exactly as today.
--  The payment records — not the flag — are what these guards check.
--
--  Additive: new functions/triggers/one index. No table or column changes,
--  no RLS changes, no data rewrites. SECURITY INVOKER everywhere.
-- =============================================================================


-- Lookups by load_id alone (the existing index leads with profile_id).
create index if not exists settlement_loads_load_id_idx
  on public.settlement_loads (load_id)
  where load_id is not null;


-- -----------------------------------------------------------------------------
--  Shared check for settlement-side payment of one (already locked) load
-- -----------------------------------------------------------------------------
--  Returns NULL when the load may be paid on p_settlement_id, else:
--    load_not_found | load_cancelled | load_on_issued_paystub | load_on_settlement
--  A bare `settled` status is deliberately NOT a blocker here: the shipped
--  iPhone workflow treats settled loads as completed/eligible and relies on
--  its ledger (unchanged). Web paystubs are always visible through the
--  paystub ledger check, whatever the load flag says.
create or replace function public.sph_settlement_load_conflict(
  p_load_id uuid,
  p_settlement_id uuid,
  p_profile_id uuid
)
returns text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_status text;
begin
  select l.profile_id, lower(btrim(coalesce(l.status, '')))
    into v_profile, v_status
    from public.loads l
   where l.id = p_load_id;
  if not found or v_profile is distinct from p_profile_id then
    return 'load_not_found';
  end if;
  if v_status in ('cancelled', 'canceled') then
    return 'load_cancelled';
  end if;
  if exists (
    select 1
      from public.paystub_earnings e
      join public.paystubs p on p.id = e.paystub_id
     where e.load_id = p_load_id
       and p.status in ('issued', 'paid')
  ) then
    return 'load_on_issued_paystub';
  end if;
  if exists (
    select 1
      from public.settlement_loads sl
      join public.settlements s on s.id = sl.settlement_id
     where sl.load_id = p_load_id
       and sl.is_adjustment = false
       and s.id <> p_settlement_id
       and s.status in ('approved', 'paid')
       and coalesce(s.is_estimate, false) = false
  ) then
    return 'load_on_settlement';
  end if;
  return null;
end;
$$;

comment on function public.sph_settlement_load_conflict(uuid, uuid, uuid) is
  'NULL when the load may be paid on the settlement; otherwise load_not_found, load_cancelled, load_on_issued_paystub or load_on_settlement.';

-- Raises the carrier-facing error for a settlement conflict (shown verbatim by
-- the iPhone app). The machine code is in HINT as sph:<code>.
create or replace function public.sph_raise_settlement_conflict(
  p_conflict text,
  p_load_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_paystub text;
  v_msg text;
begin
  select coalesce('Load #' || nullif(btrim(l.load_number), ''), 'A load')
    into v_label from public.loads l where l.id = p_load_id;
  v_label := coalesce(v_label, 'A load');

  if p_conflict = 'load_on_issued_paystub' then
    select coalesce(p.paystub_number, 'a web paystub') into v_paystub
      from public.paystub_earnings e join public.paystubs p on p.id = e.paystub_id
     where e.load_id = p_load_id and p.status in ('issued', 'paid')
     order by p.paystub_number nulls last limit 1;
    v_msg := v_label || ' is already paid on web paystub ' || coalesce(v_paystub, '') ||
             '. This settlement was not approved. Remove the load, or void that paystub on the web first.';
  elsif p_conflict = 'load_on_settlement' then
    v_msg := v_label || ' is already paid on another approved or paid settlement. This settlement was not approved.';
  elsif p_conflict = 'load_cancelled' then
    v_msg := v_label || ' is cancelled and can''t be paid. This settlement was not approved.';
  else
    v_msg := 'A load on this settlement isn''t in your account. This settlement was not approved.';
  end if;

  raise exception using
    errcode = 'P0001',
    message = v_msg,
    hint = 'sph:' || p_conflict,
    detail = coalesce(p_load_id::text, '');
end;
$$;


-- -----------------------------------------------------------------------------
--  1. Settlement approval guard
-- -----------------------------------------------------------------------------

create or replace function public.sph_settlements_guard_approval()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_new_auth boolean := coalesce(new.status, '') in ('approved', 'paid')
                        and coalesce(new.is_estimate, false) = false;
  v_old_auth boolean;
  v_load record;
  v_conflict text;
  v_seen uuid[] := '{}';
begin
  if not v_new_auth then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- An upsert of an existing row (PostgREST on_conflict=id) fires BEFORE
    -- INSERT first and then BEFORE UPDATE; the UPDATE branch decides.
    if exists (select 1 from public.settlements s where s.id = new.id) then
      return new;
    end if;
  else
    v_old_auth := coalesce(old.status, '') in ('approved', 'paid')
                  and coalesce(old.is_estimate, false) = false;
    if v_old_auth and new.id = old.id then
      return new;   -- approved → paid, paid → approved: no new payment
    end if;
  end if;

  for v_load in
    select l.id
      from public.loads l
     where l.id in (select sl.load_id from public.settlement_loads sl
                     where sl.settlement_id = new.id
                       and sl.is_adjustment = false
                       and sl.load_id is not null)
     order by l.id
       for update
  loop
    v_conflict := public.sph_settlement_load_conflict(v_load.id, new.id, new.profile_id);
    if v_conflict is not null then
      perform public.sph_raise_settlement_conflict(v_conflict, v_load.id);
    end if;
    v_seen := v_seen || v_load.id;
  end loop;

  -- A line whose load is not visible to this carrier.
  if exists (
    select 1 from public.settlement_loads sl
     where sl.settlement_id = new.id and sl.is_adjustment = false
       and sl.load_id is not null and not (sl.load_id = any (v_seen))
  ) then
    perform public.sph_raise_settlement_conflict('load_not_found', null);
  end if;

  return new;
end;
$$;

drop trigger if exists sph_settlements_guard_approval on public.settlements;
create trigger sph_settlements_guard_approval
  before insert or update on public.settlements
  for each row execute function public.sph_settlements_guard_approval();


-- -----------------------------------------------------------------------------
--  2. Load line attached to an already-approved/paid settlement
-- -----------------------------------------------------------------------------

create or replace function public.sph_settlement_loads_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_estimate boolean;
  v_profile uuid;
  v_conflict text;
begin
  if new.load_id is null or new.is_adjustment then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if exists (select 1 from public.settlement_loads x where x.id = new.id) then
      return new;   -- upsert of an existing line: the UPDATE branch decides
    end if;
  elsif new.load_id is not distinct from old.load_id
        and new.settlement_id is not distinct from old.settlement_id
        and new.is_adjustment is not distinct from old.is_adjustment then
    return new;
  end if;

  select s.status, coalesce(s.is_estimate, false), s.profile_id
    into v_status, v_estimate, v_profile
    from public.settlements s
   where s.id = new.settlement_id
     for share;
  if not found or v_estimate or coalesce(v_status, '') not in ('approved', 'paid') then
    return new;   -- drafts / review / voided / estimates: unchanged behavior
  end if;

  perform 1 from public.loads l where l.id = new.load_id for update;
  v_conflict := public.sph_settlement_load_conflict(new.load_id, new.settlement_id, v_profile);
  if v_conflict is not null then
    perform public.sph_raise_settlement_conflict(v_conflict, new.load_id);
  end if;
  return new;
end;
$$;

drop trigger if exists sph_settlement_loads_guard on public.settlement_loads;
create trigger sph_settlement_loads_guard
  before insert or update on public.settlement_loads
  for each row execute function public.sph_settlement_loads_guard();


-- -----------------------------------------------------------------------------
--  3. Never make a still-paid load payable again
-- -----------------------------------------------------------------------------

create or replace function public.sph_loads_keep_paid_settled()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if lower(btrim(coalesce(old.status, ''))) = 'settled'
     and lower(btrim(coalesce(new.status, ''))) not in ('settled', 'cancelled', 'canceled')
     and public.sph_load_paid_elsewhere(old.id, null) then
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists sph_loads_keep_paid_settled on public.loads;
create trigger sph_loads_keep_paid_settled
  before update of status on public.loads
  for each row execute function public.sph_loads_keep_paid_settled();


-- -----------------------------------------------------------------------------
--  4. Only drafts can be deleted
-- -----------------------------------------------------------------------------

create or replace function public.sph_paystubs_guard_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Cascades (e.g. account deletion: profiles → paystubs) run deeper.
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.status is distinct from 'draft' then
    raise exception 'paystub_not_deletable: only draft paystubs can be deleted; void an issued or paid paystub instead'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists sph_paystubs_guard_delete on public.paystubs;
create trigger sph_paystubs_guard_delete
  before delete on public.paystubs
  for each row execute function public.sph_paystubs_guard_delete();


-- -----------------------------------------------------------------------------
--  Privileges
-- -----------------------------------------------------------------------------

revoke all on function public.sph_settlement_load_conflict(uuid, uuid, uuid) from public, anon;
revoke all on function public.sph_raise_settlement_conflict(text, uuid)      from public, anon;
revoke all on function public.sph_settlements_guard_approval()               from public, anon, authenticated;
revoke all on function public.sph_settlement_loads_guard()                   from public, anon, authenticated;
revoke all on function public.sph_loads_keep_paid_settled()                  from public, anon, authenticated;
revoke all on function public.sph_paystubs_guard_delete()                    from public, anon, authenticated;

grant execute on function public.sph_settlement_load_conflict(uuid, uuid, uuid) to authenticated, service_role;
-- Called from the guards, which run as the signed-in user; it only raises.
grant execute on function public.sph_raise_settlement_conflict(text, uuid)      to authenticated, service_role;
