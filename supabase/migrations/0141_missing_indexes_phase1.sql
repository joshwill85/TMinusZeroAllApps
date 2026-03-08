-- Phase 1 index fixes to reduce unnecessary seq scans and improve FK lookups.
-- Keep this focused on small/medium tables to minimize lock time during creation.

-- FK indexes (common Postgres best practice).
create index if not exists ll2_pads_ll2_location_id_idx on public.ll2_pads(ll2_location_id);
create index if not exists launches_ll2_agency_id_idx on public.launches(ll2_agency_id);
create index if not exists launches_ll2_rocket_config_id_idx on public.launches(ll2_rocket_config_id);
create index if not exists launch_updates_launch_id_idx on public.launch_updates(launch_id);

-- Operational queries.
create index if not exists ingestion_runs_job_started_idx on public.ingestion_runs(job_name, started_at desc);
create index if not exists ingestion_runs_started_at_idx on public.ingestion_runs(started_at desc);

-- Notification joins/filters (keeps existing status+scheduled_for index intact).
create index if not exists notifications_outbox_user_id_idx on public.notifications_outbox(user_id);
create index if not exists notifications_outbox_launch_id_idx on public.notifications_outbox(launch_id);

-- Public cache filters (per Supabase performance advisor suggestions).
create index if not exists launches_public_cache_provider_idx on public.launches_public_cache(provider);
create index if not exists launches_public_cache_vehicle_idx on public.launches_public_cache(vehicle);
create index if not exists launches_public_cache_rocket_full_name_idx on public.launches_public_cache(rocket_full_name);
