-- =============================================================================
--  PROPOSED migration #5 — verified automatic load creation (NOT APPLIED)
-- -----------------------------------------------------------------------------
--  sph_load_create_verified(p jsonb) -> {id, created}
--  Creates a load for the signed-in carrier ONLY if no load of that carrier
--  already carries the same load number (normalised: upper-case A–Z/0–9, the
--  same rule as the web app's normalizeIdentifier). A transaction-scoped
--  advisory lock per (carrier, number) serialises concurrent uploads of the
--  same rate confirmation, so two documents can never create two loads.
--  When the number exists it returns that load with created = false.
--
--  SECURITY INVOKER: RLS on loads/drivers still decides everything. Additive,
--  idempotent; nothing existing is changed. Rollback: drop the function.
-- =============================================================================
begin;

create or replace function public.sph_load_create_verified(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_existing uuid;
  v_id uuid;
  v_driver uuid := nullif(p->>'driver_id', '')::uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501', hint = 'sph:not_authenticated';
  end if;
  v_key := upper(regexp_replace(coalesce(p->>'load_number', ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_key) < 3 then
    raise exception 'A load number is required.' using errcode = 'P0001', hint = 'sph:load_number_required';
  end if;
  if coalesce((p->>'total_revenue')::numeric, 0) <= 0 then
    raise exception 'Total carrier pay must be above $0.00.' using errcode = 'P0001', hint = 'sph:no_revenue';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sph_load:' || v_uid::text || ':' || v_key, 0));

  select l.id into v_existing
    from public.loads l
   where l.profile_id = v_uid
     and upper(regexp_replace(coalesce(l.load_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_key
   order by l.created_at, l.id
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('id', v_existing, 'created', false);
  end if;

  if v_driver is not null and not exists (select 1 from public.drivers d where d.id = v_driver and d.profile_id = v_uid) then
    raise exception 'That driver is not in your account.' using errcode = '42501', hint = 'sph:cross_account';
  end if;

  insert into public.loads (profile_id, driver_id, load_number, broker_name, broker_mc_number, origin, destination,
                            pickup_date, delivery_date, total_miles, line_haul_rate, fuel_surcharge, accessorial_charges, total_revenue)
  values (v_uid, v_driver, p->>'load_number', p->>'broker_name', nullif(p->>'broker_mc_number', ''), p->>'origin', p->>'destination',
          (p->>'pickup_date')::date, (p->>'delivery_date')::date, nullif(p->>'total_miles', '')::numeric,
          nullif(p->>'line_haul_rate', '')::numeric, nullif(p->>'fuel_surcharge', '')::numeric,
          nullif(p->>'accessorial_charges', '')::numeric, (p->>'total_revenue')::numeric)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'created', true);
end $$;

revoke all on function public.sph_load_create_verified(jsonb) from public, anon;
grant execute on function public.sph_load_create_verified(jsonb) to authenticated, service_role;

commit;
