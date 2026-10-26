-- Rollback for PROPOSED #5: removes only the function. Loads it created stay (normal rows).
drop function if exists public.sph_load_create_verified(jsonb);
