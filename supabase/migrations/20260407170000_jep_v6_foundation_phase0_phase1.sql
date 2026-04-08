-- JEP v6 phase 0/1 foundation:
-- 1) shadow/public/source-refresh control settings
-- 2) source provenance registries
-- 3) additive feature snapshot storage for v6 shadow preparation

create table if not exists public.jep_source_versions (
  id bigserial primary key,
  source_key text not null,
  version_key text not null,
  version_label text,
  upstream_url text,
  content_hash text,
  release_at timestamptz,
  fetched_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(source_key) between 1 and 64),
  check (char_length(version_key) between 1 and 128),
  unique (source_key, version_key)
);

create index if not exists jep_source_versions_source_release_idx
  on public.jep_source_versions (source_key, release_at desc nulls last, fetched_at desc);

alter table public.jep_source_versions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_source_versions'
      and policyname = 'admin manage jep source versions'
  ) then
    create policy "admin manage jep source versions"
      on public.jep_source_versions
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

create table if not exists public.jep_source_fetch_runs (
  id bigserial primary key,
  source_key text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  trigger_mode text not null default 'scheduled' check (trigger_mode in ('scheduled', 'manual', 'backfill', 'retry')),
  version_id bigint references public.jep_source_versions(id) on delete set null,
  request_ref text,
  asset_count integer not null default 0 check (asset_count >= 0),
  row_count bigint not null default 0 check (row_count >= 0),
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(source_key) between 1 and 64),
  check (completed_at is null or completed_at >= started_at)
);

create index if not exists jep_source_fetch_runs_source_started_idx
  on public.jep_source_fetch_runs (source_key, started_at desc);

create index if not exists jep_source_fetch_runs_status_started_idx
  on public.jep_source_fetch_runs (status, started_at desc);

alter table public.jep_source_fetch_runs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_source_fetch_runs'
      and policyname = 'admin manage jep source fetch runs'
  ) then
    create policy "admin manage jep source fetch runs"
      on public.jep_source_fetch_runs
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

create table if not exists public.jep_feature_snapshots (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  observer_location_hash text not null,
  observer_feature_key text not null,
  observer_lat_bucket numeric(6,3),
  observer_lon_bucket numeric(7,3),
  feature_family text not null,
  model_version text not null,
  input_hash text not null,
  trajectory_input_hash text,
  source_refs jsonb not null default '[]'::jsonb,
  feature_payload jsonb not null default '{}'::jsonb,
  confidence_payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(observer_location_hash) between 1 and 64),
  check (char_length(observer_feature_key) between 1 and 128),
  check (char_length(feature_family) between 1 and 64),
  check (char_length(model_version) between 1 and 64),
  check (char_length(input_hash) between 1 and 128),
  unique (launch_id, observer_location_hash, feature_family, input_hash)
);

create index if not exists jep_feature_snapshots_launch_observer_idx
  on public.jep_feature_snapshots (launch_id, observer_location_hash, computed_at desc);

create index if not exists jep_feature_snapshots_family_model_idx
  on public.jep_feature_snapshots (feature_family, model_version, computed_at desc);

alter table public.jep_feature_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_feature_snapshots'
      and policyname = 'admin manage jep feature snapshots'
  ) then
    create policy "admin manage jep feature snapshots"
      on public.jep_feature_snapshots
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_v6_shadow_enabled', 'false'::jsonb),
  ('jep_v6_public_enabled', 'false'::jsonb),
  ('jep_v6_feature_snapshots_enabled', 'false'::jsonb),
  ('jep_v6_source_jobs_enabled', 'false'::jsonb),
  ('jep_v6_feature_jobs_enabled', 'false'::jsonb),
  ('jep_v6_model_version', '"jep_v6"'::jsonb),
  ('jep_v6_observer_feature_cell_deg', '0.02'::jsonb),
  ('jep_v6_us_only_enabled', 'true'::jsonb),
  ('jep_v6_us_launch_states', '["FL","CA","TX"]'::jsonb),
  ('jep_source_refresh_horizons_enabled', 'false'::jsonb),
  ('jep_source_refresh_usno_enabled', 'false'::jsonb),
  ('jep_source_refresh_black_marble_enabled', 'false'::jsonb),
  ('jep_source_refresh_copernicus_dem_enabled', 'false'::jsonb),
  ('jep_source_refresh_overture_buildings_enabled', 'false'::jsonb),
  ('jep_source_refresh_visibility_maps_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
