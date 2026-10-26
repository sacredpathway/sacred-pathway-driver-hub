-- =============================================================================
-- RECONCILED FROM PRODUCTION (read-only) 2026-10-25. ALREADY APPLIED IN PRODUCTION
-- AS VERSION 20260616094021. NEVER RE-RUN: it deletes and recreates the Apple
-- review demo accounts.
--
-- REDACTED: the two plaintext demo passwords passed to extensions.crypt() were
-- replaced with <REDACTED-demo-password-see-owner-vault>. Everything else is
-- byte-identical to supabase_migrations.schema_migrations.statements.
--   original md5 (array_to_string(statements, E';\n\n')||E';\n') = 0312110ca5d03d1c4f3d34bcada91a80
--   redacted body md5 (everything below this header)            = df13bce00fb6a724dc3dfbe017beb64b
-- =============================================================================
do $$
declare
  v_disp uuid := 'aa000000-0000-4000-8000-000000000001';
  v_drv  uuid := 'bb000000-0000-4000-8000-000000000002';
  v_thread uuid := 'cc000000-0000-4000-8000-000000000003';
  v_conn uuid := 'dd000000-0000-4000-8000-000000000004';
  v_dispprof uuid := 'ee000000-0000-4000-8000-000000000005';
  v_offer1 uuid := 'ff000000-0000-4000-8000-000000000006';
  v_offer2 uuid := 'ff000000-0000-4000-8000-000000000007';
begin
  delete from public.dispatch_messages where thread_id = v_thread;
  delete from public.dispatch_load_offers where id in (v_offer1, v_offer2);
  delete from public.dispatch_participants where thread_id = v_thread;
  delete from public.dispatch_threads where id = v_thread;
  delete from public.connection_messages where connection_id = v_conn;
  delete from public.user_connections where id = v_conn;
  delete from public.dispatcher_profiles where id = v_dispprof;
  delete from auth.identities where user_id in (v_disp, v_drv);
  delete from public.profiles where id in (v_disp, v_drv);
  delete from auth.users where id in (v_disp, v_drv);

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
  values
  ('00000000-0000-0000-0000-000000000000', v_disp, 'authenticated', 'authenticated',
   'dispatcher.demo@sacredpathwaydispatch.com',
   extensions.crypt('<REDACTED-demo-password-see-owner-vault>', extensions.gen_salt('bf')), now(),
   now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"account_role":"dispatcher","full_name":"Demo Dispatcher"}'::jsonb, false, false),
  ('00000000-0000-0000-0000-000000000000', v_drv, 'authenticated', 'authenticated',
   'driver.demo@sacredpathwaydispatch.com',
   extensions.crypt('<REDACTED-demo-password-see-owner-vault>', extensions.gen_salt('bf')), now(),
   now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"account_role":"driver","full_name":"Demo Driver"}'::jsonb, false, false);

  insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values
  (v_disp::text, v_disp,
   jsonb_build_object('sub', v_disp::text, 'email','dispatcher.demo@sacredpathwaydispatch.com','email_verified',true),
   'email', now(), now(), now()),
  (v_drv::text, v_drv,
   jsonb_build_object('sub', v_drv::text, 'email','driver.demo@sacredpathwaydispatch.com','email_verified',true),
   'email', now(), now(), now());

  update public.profiles
     set account_role='dispatcher', company_name='Sacred Pathway Dispatch (Demo)', phone='555-0100', updated_at=now()
   where id = v_disp;
  update public.profiles
     set account_role='driver', company_name='Demo Owner-Operator', phone='555-0200',
         truck_number='TRK-204', trailer_number='TRL-553', updated_at=now()
   where id = v_drv;

  insert into public.dispatcher_profiles (
    id, company_id, user_id, display_name, company_name, years_experience,
    equipment_types, service_regions, languages_spoken, services_offered,
    phone, email, contact_info, is_active, is_trusted, rating_average, rating_count, created_at, updated_at)
  values (
    v_dispprof, v_disp, v_disp, 'Demo Dispatcher', 'Sacred Pathway Dispatch (Demo)', 6,
    array['Dry Van','Reefer','Flatbed'], array['Southeast','Midwest','Texas'],
    array['English','Spanish'], array['Load Booking','Rate Negotiation','Invoicing','Compliance'],
    '555-0100', 'dispatcher.demo@sacredpathwaydispatch.com', 'Available 24/7 for demo review',
    true, true, 4.8, 12, now(), now());

  insert into public.user_connections (
    id, requester_id, recipient_id, requester_role, recipient_role, status,
    requester_email, requester_display_name, recipient_email, recipient_display_name, created_at, updated_at)
  values (
    v_conn, v_disp, v_drv, 'dispatcher', 'driver', 'accepted',
    'dispatcher.demo@sacredpathwaydispatch.com', 'Demo Dispatcher',
    'driver.demo@sacredpathwaydispatch.com', 'Demo Driver', now()-interval '6 days', now()-interval '6 days');

  insert into public.connection_messages (connection_id, sender_id, body, created_at, read_at) values
  (v_conn, v_disp, 'Hi! Thanks for connecting. I have steady freight in your lanes - ready to keep you moving.', now()-interval '6 days', now()-interval '6 days'),
  (v_conn, v_drv,  'Appreciate it. I run dry van and reefer out of the Southeast.', now()-interval '6 days' + interval '20 min', now()-interval '6 days' + interval '25 min'),
  (v_conn, v_disp, 'Perfect. Sending you a load offer now - check the Offers tab.', now()-interval '5 days', now()-interval '5 days');

  insert into public.dispatch_threads (
    id, company_id, load_number, driver_profile_id, dispatcher_user_id, dispatcher_name, dispatcher_company,
    subject, last_message_preview, driver_unread_count, dispatcher_unread_count, carrier_unread_count,
    last_message_at, created_at, updated_at)
  values (
    v_thread, v_drv, 'L-10472', v_drv, v_disp, 'Demo Dispatcher', 'Sacred Pathway Dispatch (Demo)',
    'Load L-10472 - Atlanta, GA to Dallas, TX', 'Rolling now, will update at delivery. Thanks!',
    0, 0, 0, now()-interval '2 hours', now()-interval '5 days', now()-interval '2 hours');

  insert into public.dispatch_participants (
    company_id, thread_id, profile_id, role, display_name, email, phone, truck_number, trailer_number,
    current_status, is_active, participant_status, created_at, updated_at)
  values
  (v_drv, v_thread, v_disp, 'dispatcher', 'Demo Dispatcher', 'dispatcher.demo@sacredpathwaydispatch.com', '555-0100', null, null, 'active', true, 'active', now()-interval '5 days', now()),
  (v_drv, v_thread, v_drv, 'driver', 'Demo Driver', 'driver.demo@sacredpathwaydispatch.com', '555-0200', 'TRK-204', 'TRL-553', 'En route to delivery', true, 'active', now()-interval '5 days', now());

  insert into public.dispatch_messages (company_id, thread_id, sender_profile_id, sender_role, sender_name, body, kind, created_at, read_at) values
  (v_drv, v_thread, v_disp, 'dispatcher', 'Demo Dispatcher', 'Booked you on L-10472, Atlanta GA to Dallas TX. Pickup tomorrow 8 AM. Rate looks strong.', 'text', now()-interval '5 days', now()-interval '5 days'),
  (v_drv, v_thread, v_drv,  'driver', 'Demo Driver', 'Got it. I can be at the shipper by 7:45.', 'text', now()-interval '5 days' + interval '12 min', now()-interval '5 days' + interval '15 min'),
  (v_drv, v_thread, v_disp, 'dispatcher', 'Demo Dispatcher', 'Great. Broker is Coyote, ref #CYT-88231. Rate con is attached in the offer.', 'text', now()-interval '5 days' + interval '20 min', now()-interval '5 days' + interval '40 min'),
  (v_drv, v_thread, v_drv,  'driver', 'Demo Driver', 'Loaded and rolling now, will update at delivery. Thanks!', 'text', now()-interval '2 hours', null);

  insert into public.dispatch_load_offers (
    id, company_id, thread_id, dispatcher_profile_id, dispatcher_user_id, driver_profile_id,
    dispatcher_name, dispatcher_company, load_number, broker_name, broker_mc_number, broker_phone, broker_email,
    pickup_date, delivery_date, origin, destination, total_miles, line_haul_rate, fuel_surcharge, accessorial_charges,
    load_gross_amount, fee_type, fee_amount, fee_percentage, invoice_cadence, notes, status, accepted_at, created_at, updated_at)
  values
  (v_offer1, v_drv, v_thread, v_dispprof, v_disp, v_drv,
   'Demo Dispatcher', 'Sacred Pathway Dispatch (Demo)', 'L-10472', 'Coyote Logistics', 'MC-561438', '555-0411', 'ops@coyote.example',
   current_date - 1, current_date + 1, 'Atlanta, GA', 'Dallas, TX', 781, 2050.00, 180.00, 75.00,
   2305.00, 'percentage', null, 8.0, 'weekly', 'Dry van, no-touch freight. Detention covered after 2 hrs.', 'accepted', now()-interval '5 days', now()-interval '5 days', now()-interval '5 days'),
  (v_offer2, v_drv, null, v_dispprof, v_disp, v_drv,
   'Demo Dispatcher', 'Sacred Pathway Dispatch (Demo)', 'L-10588', 'TQL', 'MC-225181', '555-0712', 'dispatch@tql.example',
   current_date + 2, current_date + 4, 'Dallas, TX', 'Memphis, TN', 452, 1380.00, 95.00, 0.00,
   1475.00, 'flat', 150.00, null, 'weekly', 'Reefer, continuous 34F. Pickup appointment required.', 'pending', null, now()-interval '1 day', now()-interval '1 day');
end $$;;
