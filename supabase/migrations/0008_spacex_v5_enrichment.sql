-- SpaceX v5 enrichment + robust join metadata for SpaceX launches.

alter table public.launches
  add column if not exists ll2_r_spacex_api_id text,
  add column if not exists spacex_launch_id text,
  add column if not exists spacex_match jsonb,
  add column if not exists spacex_data jsonb,
  add column if not exists spacex_synced_at timestamptz;

create index if not exists launches_spacex_launch_id_idx on public.launches(spacex_launch_id);
create index if not exists launches_ll2_r_spacex_api_id_idx on public.launches(ll2_r_spacex_api_id);

alter table public.launches_public_cache
  add column if not exists spacex_launch_id text,
  add column if not exists spacex_match jsonb,
  add column if not exists spacex_data jsonb,
  add column if not exists spacex_synced_at timestamptz;

insert into public.system_settings(key, value)
values ('spacex_rate_limit_per_hour', '15'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings(key, value)
values ('spacex_join_overrides', '{}'::jsonb)
on conflict (key) do nothing;
