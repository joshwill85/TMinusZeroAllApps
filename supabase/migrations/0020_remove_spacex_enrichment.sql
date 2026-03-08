-- Remove SpaceX enrichment schema + settings (api.spacexdata.com).

drop index if exists public.launches_spacex_launch_id_idx;
drop index if exists public.launches_ll2_r_spacex_api_id_idx;

alter table public.launches
  drop column if exists ll2_r_spacex_api_id,
  drop column if exists spacex_launch_id,
  drop column if exists spacex_match,
  drop column if exists spacex_data,
  drop column if exists spacex_synced_at;

alter table public.launches_public_cache
  drop column if exists spacex_launch_id,
  drop column if exists spacex_match,
  drop column if exists spacex_data,
  drop column if exists spacex_synced_at;

delete from public.system_settings
where key in (
  'spacex_rate_limit_per_hour',
  'spacex_join_overrides',
  'spacex_backfill_cursor',
  'spacex_backfill_done'
);
