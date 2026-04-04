-- Move the highest-value machine-readable public read surfaces behind
-- server-owned access paths. The site now reads these through a
-- server-owned Supabase client, so anon/authenticated no longer need
-- direct SQL/RPC access.

revoke select on table public.search_documents from anon, authenticated;

revoke select on table public.blue_origin_contracts from anon, authenticated;
revoke select on table public.blue_origin_contract_actions from anon, authenticated;
revoke select on table public.blue_origin_spending_timeseries from anon, authenticated;
revoke select on table public.blue_origin_contract_vehicle_map from anon, authenticated;
revoke select on table public.blue_origin_travelers from anon, authenticated;
revoke select on table public.blue_origin_traveler_sources from anon, authenticated;
revoke select on table public.blue_origin_flights from anon, authenticated;
revoke select on table public.blue_origin_vehicles from anon, authenticated;
revoke select on table public.blue_origin_engines from anon, authenticated;
revoke select on table public.blue_origin_vehicle_engine_map from anon, authenticated;
revoke select on table public.blue_origin_passengers from anon, authenticated;
revoke select on table public.blue_origin_payloads from anon, authenticated;

revoke select on public.spacex_contracts from anon, authenticated;

revoke execute on function public.validate_calendar_token(uuid) from anon, authenticated;
revoke execute on function public.validate_embed_token(uuid) from anon, authenticated;
revoke execute on function public.search_public_documents(text, integer, integer, text[]) from anon, authenticated;
revoke execute on function public.get_satellite_sitemap_batch_v1(int, int) from anon, authenticated;
revoke execute on function public.get_satellite_preview_batch_v1(int, int) from anon, authenticated;
revoke execute on function public.get_satellite_owner_index_v1(int, int) from anon, authenticated;
revoke execute on function public.get_satellite_owner_profile_v1(text, int, int, int) from anon, authenticated;
