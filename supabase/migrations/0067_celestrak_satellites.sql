-- CelesTrak satellites + orbital elements ingestion support (GP/SATCAT/SupGP).

-- Operational dataset tracking (per group/source + per-dataset min intervals).
create table if not exists public.celestrak_datasets (
  dataset_key text primary key,
  dataset_type text not null check (dataset_type in ('gp','satcat','supgp')),
  code text not null,
  label text,
  query jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  min_interval_seconds int not null default 7200,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures int not null default 0,
  last_http_status int,
  last_error text,
  etag text,
  last_modified text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_type, code)
);

create index if not exists celestrak_datasets_due_idx on public.celestrak_datasets(dataset_type, enabled, last_attempt_at);
create index if not exists celestrak_datasets_success_idx on public.celestrak_datasets(dataset_type, enabled, last_success_at);

-- Canonical satellites (metadata from SATCAT; partially backfilled from GP name/intdes).
create table if not exists public.satellites (
  norad_cat_id bigint primary key,
  intl_des text,
  object_name text,
  object_type text default 'UNK' check (object_type in ('PAY','RB','DEB','UNK') or object_type is null),
  ops_status_code text,
  owner text,
  launch_date date,
  launch_site text,
  decay_date date,
  period_min double precision,
  inclination_deg double precision,
  apogee_km double precision,
  perigee_km double precision,
  rcs_m2 double precision,
  raw_satcat jsonb,
  satcat_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists satellites_object_type_owner_idx on public.satellites(object_type, owner);

-- Orbital elements (OMM JSON) with limited history.
create table if not exists public.orbit_elements (
  id bigserial primary key,
  norad_cat_id bigint not null references public.satellites(norad_cat_id) on delete cascade,
  source text not null check (source in ('gp','supgp')),
  group_or_source text,
  epoch timestamptz not null,
  inclination_deg double precision,
  raan_deg double precision,
  eccentricity double precision,
  arg_perigee_deg double precision,
  mean_anomaly_deg double precision,
  mean_motion_rev_per_day double precision,
  bstar double precision,
  raw_omm jsonb not null,
  fetched_at timestamptz not null default now(),
  hash text,
  unique (norad_cat_id, source, epoch)
);

create index if not exists orbit_elements_source_epoch_idx on public.orbit_elements(source, epoch desc);
create index if not exists orbit_elements_norad_epoch_idx on public.orbit_elements(norad_cat_id, epoch desc);

-- Track which CelesTrak "Current Data" groups each satellite appears in (for filtering).
create table if not exists public.satellite_group_memberships (
  group_code text not null,
  norad_cat_id bigint not null references public.satellites(norad_cat_id) on delete cascade,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (group_code, norad_cat_id)
);

create index if not exists satellite_group_memberships_group_last_seen_idx on public.satellite_group_memberships(group_code, last_seen_at desc);
create index if not exists satellite_group_memberships_norad_idx on public.satellite_group_memberships(norad_cat_id);

-- Atomically claim due datasets (prevents overlap + enforces per-dataset minimum interval).
create or replace function public.claim_celestrak_datasets(
  dataset_type_filter text,
  batch_size int
)
returns setof public.celestrak_datasets
language plpgsql
security definer
as $$
begin
  return query
  with candidates as (
    select dataset_key
    from public.celestrak_datasets
    where enabled = true
      and dataset_type = dataset_type_filter
      and (
        last_attempt_at is null
        or last_attempt_at <= now() - (min_interval_seconds * interval '1 second')
      )
    order by coalesce(last_attempt_at, '1970-01-01'::timestamptz) asc, dataset_key asc
    for update skip locked
    limit batch_size
  )
  update public.celestrak_datasets d
  set last_attempt_at = now(),
      updated_at = now()
  where d.dataset_key in (select dataset_key from candidates)
  returning d.*;
end;
$$;

alter function public.claim_celestrak_datasets(text, int) set search_path = public;

-- Batch retention helper (avoid unbounded 2-hour snapshots forever).
create or replace function public.purge_orbit_elements_before(
  cutoff_in timestamptz,
  batch_size int default 50000
)
returns int
language plpgsql
security definer
as $$
declare
  deleted_count int := 0;
begin
  with candidates as (
    select id
    from public.orbit_elements
    where epoch < cutoff_in
    order by epoch asc
    limit batch_size
  )
  delete from public.orbit_elements
  where id in (select id from candidates);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter function public.purge_orbit_elements_before(timestamptz, int) set search_path = public;

-- RLS (service role bypasses; clients are admin-only by default).
alter table public.celestrak_datasets enable row level security;
alter table public.satellites enable row level security;
alter table public.orbit_elements enable row level security;
alter table public.satellite_group_memberships enable row level security;

drop policy if exists "admin manage celestrak datasets" on public.celestrak_datasets;
create policy "admin manage celestrak datasets"
  on public.celestrak_datasets for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin read satellites" on public.satellites;
create policy "admin read satellites"
  on public.satellites for select
  using (public.is_admin());

drop policy if exists "admin read orbit elements" on public.orbit_elements;
create policy "admin read orbit elements"
  on public.orbit_elements for select
  using (public.is_admin());

drop policy if exists "admin read satellite group memberships" on public.satellite_group_memberships;
create policy "admin read satellite group memberships"
  on public.satellite_group_memberships for select
  using (public.is_admin());

-- Job settings (defaults; can be overridden in system_settings).
insert into public.system_settings (key, value)
values
  ('celestrak_gp_groups_sync_enabled', 'true'::jsonb),
  ('celestrak_gp_job_enabled', 'true'::jsonb),
  ('celestrak_gp_max_datasets_per_run', '7'::jsonb),
  ('celestrak_gp_default_min_interval_seconds', '7200'::jsonb),
  ('celestrak_satcat_job_enabled', 'true'::jsonb),
  ('celestrak_satcat_max_datasets_per_run', '6'::jsonb),
  ('celestrak_satcat_default_min_interval_seconds', '86400'::jsonb),
  ('celestrak_supgp_job_enabled', 'false'::jsonb),
  ('celestrak_supgp_max_datasets_per_run', '3'::jsonb),
  ('celestrak_supgp_default_min_interval_seconds', '7200'::jsonb),
  ('celestrak_orbit_elements_retention_days', '30'::jsonb),
  ('celestrak_retention_cleanup_enabled', 'true'::jsonb)
on conflict (key) do nothing;

-- Seed all CelesTrak "Current GP Element Sets" groups for both GP and SATCAT (as of 2026-01-15).
insert into public.celestrak_datasets (dataset_key, dataset_type, code, label, query, enabled, min_interval_seconds)
values
  ('gp:active', 'gp', 'active', 'Active Satellites', jsonb_build_object('GROUP', 'active'), true, 7200),
  ('gp:amateur', 'gp', 'amateur', 'Amateur Radio', jsonb_build_object('GROUP', 'amateur'), true, 7200),
  ('gp:analyst', 'gp', 'analyst', 'Analyst Satellites', jsonb_build_object('GROUP', 'analyst'), true, 7200),
  ('gp:argos', 'gp', 'argos', 'ARGOS Data Collection System', jsonb_build_object('GROUP', 'argos'), true, 7200),
  ('gp:beidou', 'gp', 'beidou', 'Beidou', jsonb_build_object('GROUP', 'beidou'), true, 7200),
  ('gp:cosmos-1408-debris', 'gp', 'cosmos-1408-debris', 'Russian ASAT Test Debris (COSMOS 1408)', jsonb_build_object('GROUP', 'cosmos-1408-debris'), true, 7200),
  ('gp:cosmos-2251-debris', 'gp', 'cosmos-2251-debris', 'COSMOS 2251 Debris', jsonb_build_object('GROUP', 'cosmos-2251-debris'), true, 7200),
  ('gp:cubesat', 'gp', 'cubesat', 'CubeSats', jsonb_build_object('GROUP', 'cubesat'), true, 7200),
  ('gp:dmc', 'gp', 'dmc', 'Disaster Monitoring', jsonb_build_object('GROUP', 'dmc'), true, 7200),
  ('gp:education', 'gp', 'education', 'Education', jsonb_build_object('GROUP', 'education'), true, 7200),
  ('gp:engineering', 'gp', 'engineering', 'Engineering', jsonb_build_object('GROUP', 'engineering'), true, 7200),
  ('gp:eutelsat', 'gp', 'eutelsat', 'Eutelsat', jsonb_build_object('GROUP', 'eutelsat'), true, 7200),
  ('gp:fengyun-1c-debris', 'gp', 'fengyun-1c-debris', 'Chinese ASAT Test Debris (FENGYUN 1C)', jsonb_build_object('GROUP', 'fengyun-1c-debris'), true, 7200),
  ('gp:galileo', 'gp', 'galileo', 'Galileo', jsonb_build_object('GROUP', 'galileo'), true, 7200),
  ('gp:geo', 'gp', 'geo', 'Active Geosynchronous', jsonb_build_object('GROUP', 'geo'), true, 7200),
  ('gp:geodetic', 'gp', 'geodetic', 'Geodetic', jsonb_build_object('GROUP', 'geodetic'), true, 7200),
  ('gp:glo-ops', 'gp', 'glo-ops', 'GLONASS Operational', jsonb_build_object('GROUP', 'glo-ops'), true, 7200),
  ('gp:globalstar', 'gp', 'globalstar', 'Globalstar', jsonb_build_object('GROUP', 'globalstar'), true, 7200),
  ('gp:gnss', 'gp', 'gnss', 'GNSS', jsonb_build_object('GROUP', 'gnss'), true, 7200),
  ('gp:goes', 'gp', 'goes', 'GOES', jsonb_build_object('GROUP', 'goes'), true, 7200),
  ('gp:gps-ops', 'gp', 'gps-ops', 'GPS Operational', jsonb_build_object('GROUP', 'gps-ops'), true, 7200),
  ('gp:hulianwang', 'gp', 'hulianwang', 'Hulianwang Digui', jsonb_build_object('GROUP', 'hulianwang'), true, 7200),
  ('gp:intelsat', 'gp', 'intelsat', 'Intelsat', jsonb_build_object('GROUP', 'intelsat'), true, 7200),
  ('gp:iridium-33-debris', 'gp', 'iridium-33-debris', 'IRIDIUM 33 Debris', jsonb_build_object('GROUP', 'iridium-33-debris'), true, 7200),
  ('gp:iridium-NEXT', 'gp', 'iridium-NEXT', 'Iridium NEXT', jsonb_build_object('GROUP', 'iridium-NEXT'), true, 7200),
  ('gp:kuiper', 'gp', 'kuiper', 'Kuiper', jsonb_build_object('GROUP', 'kuiper'), true, 7200),
  ('gp:last-30-days', 'gp', 'last-30-days', 'Last 30 Days'' Launches', jsonb_build_object('GROUP', 'last-30-days'), true, 7200),
  ('gp:military', 'gp', 'military', 'Miscellaneous Military', jsonb_build_object('GROUP', 'military'), true, 7200),
  ('gp:musson', 'gp', 'musson', 'Russian LEO Navigation', jsonb_build_object('GROUP', 'musson'), true, 7200),
  ('gp:nnss', 'gp', 'nnss', 'Navy Navigation Satellite System (NNSS)', jsonb_build_object('GROUP', 'nnss'), true, 7200),
  ('gp:noaa', 'gp', 'noaa', 'NOAA', jsonb_build_object('GROUP', 'noaa'), true, 7200),
  ('gp:oneweb', 'gp', 'oneweb', 'OneWeb', jsonb_build_object('GROUP', 'oneweb'), true, 7200),
  ('gp:orbcomm', 'gp', 'orbcomm', 'Orbcomm', jsonb_build_object('GROUP', 'orbcomm'), true, 7200),
  ('gp:other', 'gp', 'other', 'Other Satellites', jsonb_build_object('GROUP', 'other'), true, 7200),
  ('gp:other-comm', 'gp', 'other-comm', 'Other Comm', jsonb_build_object('GROUP', 'other-comm'), true, 7200),
  ('gp:planet', 'gp', 'planet', 'Planet', jsonb_build_object('GROUP', 'planet'), true, 7200),
  ('gp:qianfan', 'gp', 'qianfan', 'Qianfan', jsonb_build_object('GROUP', 'qianfan'), true, 7200),
  ('gp:radar', 'gp', 'radar', 'Radar Calibration', jsonb_build_object('GROUP', 'radar'), true, 7200),
  ('gp:resource', 'gp', 'resource', 'Earth Resources', jsonb_build_object('GROUP', 'resource'), true, 7200),
  ('gp:sarsat', 'gp', 'sarsat', 'Search & Rescue (SARSAT)', jsonb_build_object('GROUP', 'sarsat'), true, 7200),
  ('gp:satnogs', 'gp', 'satnogs', 'SatNOGS', jsonb_build_object('GROUP', 'satnogs'), true, 7200),
  ('gp:sbas', 'gp', 'sbas', 'Satellite-Based Augmentation System (WAAS/EGNOS/MSAS)', jsonb_build_object('GROUP', 'sbas'), true, 7200),
  ('gp:science', 'gp', 'science', 'Space & Earth Science', jsonb_build_object('GROUP', 'science'), true, 7200),
  ('gp:ses', 'gp', 'ses', 'SES', jsonb_build_object('GROUP', 'ses'), true, 7200),
  ('gp:spire', 'gp', 'spire', 'Spire', jsonb_build_object('GROUP', 'spire'), true, 7200),
  ('gp:starlink', 'gp', 'starlink', 'Starlink', jsonb_build_object('GROUP', 'starlink'), true, 7200),
  ('gp:stations', 'gp', 'stations', 'Space Stations', jsonb_build_object('GROUP', 'stations'), true, 7200),
  ('gp:tdrss', 'gp', 'tdrss', 'Tracking and Data Relay Satellite System (TDRSS)', jsonb_build_object('GROUP', 'tdrss'), true, 7200),
  ('gp:telesat', 'gp', 'telesat', 'Telesat', jsonb_build_object('GROUP', 'telesat'), true, 7200),
  ('gp:visual', 'gp', 'visual', '100 (or so) Brightest', jsonb_build_object('GROUP', 'visual'), true, 7200),
  ('gp:weather', 'gp', 'weather', 'Weather', jsonb_build_object('GROUP', 'weather'), true, 7200),
  ('gp:x-comm', 'gp', 'x-comm', 'Experimental Comm', jsonb_build_object('GROUP', 'x-comm'), true, 7200),

  ('satcat:active', 'satcat', 'active', 'Active Satellites', jsonb_build_object('GROUP', 'active', 'ONORBIT', 1), true, 86400),
  ('satcat:amateur', 'satcat', 'amateur', 'Amateur Radio', jsonb_build_object('GROUP', 'amateur', 'ONORBIT', 1), true, 86400),
  ('satcat:analyst', 'satcat', 'analyst', 'Analyst Satellites', jsonb_build_object('GROUP', 'analyst', 'ONORBIT', 1), true, 86400),
  ('satcat:argos', 'satcat', 'argos', 'ARGOS Data Collection System', jsonb_build_object('GROUP', 'argos', 'ONORBIT', 1), true, 86400),
  ('satcat:beidou', 'satcat', 'beidou', 'Beidou', jsonb_build_object('GROUP', 'beidou', 'ONORBIT', 1), true, 86400),
  ('satcat:cosmos-1408-debris', 'satcat', 'cosmos-1408-debris', 'Russian ASAT Test Debris (COSMOS 1408)', jsonb_build_object('GROUP', 'cosmos-1408-debris', 'ONORBIT', 1), true, 86400),
  ('satcat:cosmos-2251-debris', 'satcat', 'cosmos-2251-debris', 'COSMOS 2251 Debris', jsonb_build_object('GROUP', 'cosmos-2251-debris', 'ONORBIT', 1), true, 86400),
  ('satcat:cubesat', 'satcat', 'cubesat', 'CubeSats', jsonb_build_object('GROUP', 'cubesat', 'ONORBIT', 1), true, 86400),
  ('satcat:dmc', 'satcat', 'dmc', 'Disaster Monitoring', jsonb_build_object('GROUP', 'dmc', 'ONORBIT', 1), true, 86400),
  ('satcat:education', 'satcat', 'education', 'Education', jsonb_build_object('GROUP', 'education', 'ONORBIT', 1), true, 86400),
  ('satcat:engineering', 'satcat', 'engineering', 'Engineering', jsonb_build_object('GROUP', 'engineering', 'ONORBIT', 1), true, 86400),
  ('satcat:eutelsat', 'satcat', 'eutelsat', 'Eutelsat', jsonb_build_object('GROUP', 'eutelsat', 'ONORBIT', 1), true, 86400),
  ('satcat:fengyun-1c-debris', 'satcat', 'fengyun-1c-debris', 'Chinese ASAT Test Debris (FENGYUN 1C)', jsonb_build_object('GROUP', 'fengyun-1c-debris', 'ONORBIT', 1), true, 86400),
  ('satcat:galileo', 'satcat', 'galileo', 'Galileo', jsonb_build_object('GROUP', 'galileo', 'ONORBIT', 1), true, 86400),
  ('satcat:geo', 'satcat', 'geo', 'Active Geosynchronous', jsonb_build_object('GROUP', 'geo', 'ONORBIT', 1), true, 86400),
  ('satcat:geodetic', 'satcat', 'geodetic', 'Geodetic', jsonb_build_object('GROUP', 'geodetic', 'ONORBIT', 1), true, 86400),
  ('satcat:glo-ops', 'satcat', 'glo-ops', 'GLONASS Operational', jsonb_build_object('GROUP', 'glo-ops', 'ONORBIT', 1), true, 86400),
  ('satcat:globalstar', 'satcat', 'globalstar', 'Globalstar', jsonb_build_object('GROUP', 'globalstar', 'ONORBIT', 1), true, 86400),
  ('satcat:gnss', 'satcat', 'gnss', 'GNSS', jsonb_build_object('GROUP', 'gnss', 'ONORBIT', 1), true, 86400),
  ('satcat:goes', 'satcat', 'goes', 'GOES', jsonb_build_object('GROUP', 'goes', 'ONORBIT', 1), true, 86400),
  ('satcat:gps-ops', 'satcat', 'gps-ops', 'GPS Operational', jsonb_build_object('GROUP', 'gps-ops', 'ONORBIT', 1), true, 86400),
  ('satcat:hulianwang', 'satcat', 'hulianwang', 'Hulianwang Digui', jsonb_build_object('GROUP', 'hulianwang', 'ONORBIT', 1), true, 86400),
  ('satcat:intelsat', 'satcat', 'intelsat', 'Intelsat', jsonb_build_object('GROUP', 'intelsat', 'ONORBIT', 1), true, 86400),
  ('satcat:iridium-33-debris', 'satcat', 'iridium-33-debris', 'IRIDIUM 33 Debris', jsonb_build_object('GROUP', 'iridium-33-debris', 'ONORBIT', 1), true, 86400),
  ('satcat:iridium-NEXT', 'satcat', 'iridium-NEXT', 'Iridium NEXT', jsonb_build_object('GROUP', 'iridium-NEXT', 'ONORBIT', 1), true, 86400),
  ('satcat:kuiper', 'satcat', 'kuiper', 'Kuiper', jsonb_build_object('GROUP', 'kuiper', 'ONORBIT', 1), true, 86400),
  ('satcat:last-30-days', 'satcat', 'last-30-days', 'Last 30 Days'' Launches', jsonb_build_object('GROUP', 'last-30-days', 'ONORBIT', 1), true, 86400),
  ('satcat:military', 'satcat', 'military', 'Miscellaneous Military', jsonb_build_object('GROUP', 'military', 'ONORBIT', 1), true, 86400),
  ('satcat:musson', 'satcat', 'musson', 'Russian LEO Navigation', jsonb_build_object('GROUP', 'musson', 'ONORBIT', 1), true, 86400),
  ('satcat:nnss', 'satcat', 'nnss', 'Navy Navigation Satellite System (NNSS)', jsonb_build_object('GROUP', 'nnss', 'ONORBIT', 1), true, 86400),
  ('satcat:noaa', 'satcat', 'noaa', 'NOAA', jsonb_build_object('GROUP', 'noaa', 'ONORBIT', 1), true, 86400),
  ('satcat:oneweb', 'satcat', 'oneweb', 'OneWeb', jsonb_build_object('GROUP', 'oneweb', 'ONORBIT', 1), true, 86400),
  ('satcat:orbcomm', 'satcat', 'orbcomm', 'Orbcomm', jsonb_build_object('GROUP', 'orbcomm', 'ONORBIT', 1), true, 86400),
  ('satcat:other', 'satcat', 'other', 'Other Satellites', jsonb_build_object('GROUP', 'other', 'ONORBIT', 1), true, 86400),
  ('satcat:other-comm', 'satcat', 'other-comm', 'Other Comm', jsonb_build_object('GROUP', 'other-comm', 'ONORBIT', 1), true, 86400),
  ('satcat:planet', 'satcat', 'planet', 'Planet', jsonb_build_object('GROUP', 'planet', 'ONORBIT', 1), true, 86400),
  ('satcat:qianfan', 'satcat', 'qianfan', 'Qianfan', jsonb_build_object('GROUP', 'qianfan', 'ONORBIT', 1), true, 86400),
  ('satcat:radar', 'satcat', 'radar', 'Radar Calibration', jsonb_build_object('GROUP', 'radar', 'ONORBIT', 1), true, 86400),
  ('satcat:resource', 'satcat', 'resource', 'Earth Resources', jsonb_build_object('GROUP', 'resource', 'ONORBIT', 1), true, 86400),
  ('satcat:sarsat', 'satcat', 'sarsat', 'Search & Rescue (SARSAT)', jsonb_build_object('GROUP', 'sarsat', 'ONORBIT', 1), true, 86400),
  ('satcat:satnogs', 'satcat', 'satnogs', 'SatNOGS', jsonb_build_object('GROUP', 'satnogs', 'ONORBIT', 1), true, 86400),
  ('satcat:sbas', 'satcat', 'sbas', 'Satellite-Based Augmentation System (WAAS/EGNOS/MSAS)', jsonb_build_object('GROUP', 'sbas', 'ONORBIT', 1), true, 86400),
  ('satcat:science', 'satcat', 'science', 'Space & Earth Science', jsonb_build_object('GROUP', 'science', 'ONORBIT', 1), true, 86400),
  ('satcat:ses', 'satcat', 'ses', 'SES', jsonb_build_object('GROUP', 'ses', 'ONORBIT', 1), true, 86400),
  ('satcat:spire', 'satcat', 'spire', 'Spire', jsonb_build_object('GROUP', 'spire', 'ONORBIT', 1), true, 86400),
  ('satcat:starlink', 'satcat', 'starlink', 'Starlink', jsonb_build_object('GROUP', 'starlink', 'ONORBIT', 1), true, 86400),
  ('satcat:stations', 'satcat', 'stations', 'Space Stations', jsonb_build_object('GROUP', 'stations', 'ONORBIT', 1), true, 86400),
  ('satcat:tdrss', 'satcat', 'tdrss', 'Tracking and Data Relay Satellite System (TDRSS)', jsonb_build_object('GROUP', 'tdrss', 'ONORBIT', 1), true, 86400),
  ('satcat:telesat', 'satcat', 'telesat', 'Telesat', jsonb_build_object('GROUP', 'telesat', 'ONORBIT', 1), true, 86400),
  ('satcat:visual', 'satcat', 'visual', '100 (or so) Brightest', jsonb_build_object('GROUP', 'visual', 'ONORBIT', 1), true, 86400),
  ('satcat:weather', 'satcat', 'weather', 'Weather', jsonb_build_object('GROUP', 'weather', 'ONORBIT', 1), true, 86400),
  ('satcat:x-comm', 'satcat', 'x-comm', 'Experimental Comm', jsonb_build_object('GROUP', 'x-comm', 'ONORBIT', 1), true, 86400)
on conflict (dataset_key) do update
  set label = excluded.label,
      query = excluded.query,
      updated_at = now();

-- Optional: one example SupGP source (disabled by default).
insert into public.celestrak_datasets (dataset_key, dataset_type, code, label, query, enabled, min_interval_seconds)
values ('supgp:SpaceX-E', 'supgp', 'SpaceX-E', 'SpaceX-E', jsonb_build_object('SOURCE', 'SpaceX-E'), false, 7200)
on conflict (dataset_key) do update
  set label = excluded.label,
      query = excluded.query,
      updated_at = now();

-- Scheduling (jobs_enabled gating happens inside public.invoke_edge_job).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'celestrak_gp_groups_sync') then
    perform cron.unschedule('celestrak_gp_groups_sync');
  end if;
  perform cron.schedule('celestrak_gp_groups_sync', '12 4 * * *', $job$select public.invoke_edge_job('celestrak-gp-groups-sync');$job$);

  if exists (select 1 from cron.job where jobname = 'celestrak_gp_ingest') then
    perform cron.unschedule('celestrak_gp_ingest');
  end if;
  perform cron.schedule('celestrak_gp_ingest', '*/15 * * * *', $job$select public.invoke_edge_job('celestrak-gp-ingest');$job$);

  if exists (select 1 from cron.job where jobname = 'celestrak_satcat_ingest') then
    perform cron.unschedule('celestrak_satcat_ingest');
  end if;
  perform cron.schedule('celestrak_satcat_ingest', '17 * * * *', $job$select public.invoke_edge_job('celestrak-satcat-ingest');$job$);

  if exists (select 1 from cron.job where jobname = 'celestrak_supgp_ingest') then
    perform cron.unschedule('celestrak_supgp_ingest');
  end if;
  perform cron.schedule('celestrak_supgp_ingest', '*/30 * * * *', $job$select public.invoke_edge_job('celestrak-supgp-ingest');$job$);

  if exists (select 1 from cron.job where jobname = 'celestrak_retention_cleanup') then
    perform cron.unschedule('celestrak_retention_cleanup');
  end if;
  perform cron.schedule('celestrak_retention_cleanup', '42 4 * * *', $job$select public.invoke_edge_job('celestrak-retention-cleanup');$job$);
end $$;
