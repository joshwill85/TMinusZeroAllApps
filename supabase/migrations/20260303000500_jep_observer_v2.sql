-- JEP v2 upgrades:
-- 1) observer-scoped score keys for personalized LOS/weather
-- 2) observer registry for low-IO precompute targeting
-- 3) corridor cache table for azimuth provenance
-- 4) admin validation/public-release gate settings

alter table if exists public.launch_jep_scores
  add column if not exists observer_location_hash text,
  add column if not exists observer_lat_bucket decimal(6,3),
  add column if not exists observer_lon_bucket decimal(6,3);

update public.launch_jep_scores
set observer_location_hash = 'pad'
where observer_location_hash is null or btrim(observer_location_hash) = '';

alter table if exists public.launch_jep_scores
  alter column observer_location_hash set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'launch_jep_scores_pkey'
      and conrelid = 'public.launch_jep_scores'::regclass
  ) then
    alter table public.launch_jep_scores
      drop constraint launch_jep_scores_pkey;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'launch_jep_scores_pkey'
      and conrelid = 'public.launch_jep_scores'::regclass
  ) then
    alter table public.launch_jep_scores
      add constraint launch_jep_scores_pkey primary key (launch_id, observer_location_hash);
  end if;
end $$;

create index if not exists launch_jep_scores_launch_hash_idx
  on public.launch_jep_scores (launch_id, observer_location_hash, expires_at);

create index if not exists launch_jep_scores_observer_computed_idx
  on public.launch_jep_scores (observer_location_hash, computed_at desc);

create table if not exists public.jep_observer_locations (
  observer_location_hash text primary key,
  lat_bucket decimal(6,3) not null check (lat_bucket >= -90 and lat_bucket <= 90),
  lon_bucket decimal(6,3) not null check (lon_bucket >= -180 and lon_bucket <= 180),
  source text not null default 'request',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lat_bucket, lon_bucket)
);

create index if not exists jep_observer_locations_last_seen_idx
  on public.jep_observer_locations (last_seen_at desc);

alter table public.jep_observer_locations enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_observer_locations'
      and policyname = 'admin manage jep observer locations'
  ) then
    create policy "admin manage jep observer locations"
      on public.jep_observer_locations
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

create table if not exists public.jep_corridor_cache (
  id bigserial primary key,
  launch_id uuid references public.launches(id) on delete cascade,
  source text not null check (source in ('bnm', 'tfr', 'default_table')),
  raw_text text,
  parsed_azimuth_deg decimal(6,3),
  polygon_coords jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (launch_id, source)
);

create index if not exists jep_corridor_cache_launch_idx
  on public.jep_corridor_cache (launch_id, fetched_at desc);

alter table public.jep_corridor_cache enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_corridor_cache'
      and policyname = 'admin manage jep corridor cache'
  ) then
    create policy "admin manage jep corridor cache"
      on public.jep_corridor_cache
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_score_model_version', '"jep_v2"'::jsonb),
  ('jep_public_enabled', 'false'::jsonb),
  ('jep_validation_ready', 'false'::jsonb),
  ('jep_model_card_published', 'false'::jsonb),
  ('jep_score_observer_lookback_days', '14'::jsonb),
  ('jep_score_observer_registry_limit', '128'::jsonb),
  ('jep_score_max_observers_per_launch', '12'::jsonb),
  ('jep_score_max_observer_distance_km', '1800'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
