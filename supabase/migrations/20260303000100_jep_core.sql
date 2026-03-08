-- JEP core persistence tables.

create table if not exists public.jep_profiles (
  id bigserial primary key,
  vehicle_slug text not null,
  mission_type text not null,
  profile_json jsonb not null,
  source_flight_count int,
  confidence text not null default 'MEDIUM' check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (vehicle_slug, mission_type)
);

create index if not exists jep_profiles_vehicle_mission_idx
  on public.jep_profiles (vehicle_slug, mission_type);

alter table public.jep_profiles enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_profiles'
      and policyname = 'admin manage jep profiles'
  ) then
    create policy "admin manage jep profiles"
      on public.jep_profiles
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

create table if not exists public.launch_jep_scores (
  launch_id uuid primary key references public.launches(id) on delete cascade,
  score smallint not null check (score between 0 and 100),
  illumination_factor decimal(4,3) not null check (illumination_factor >= 0 and illumination_factor <= 1),
  darkness_factor decimal(4,3) not null check (darkness_factor >= 0 and darkness_factor <= 1),
  los_factor decimal(4,3) not null check (los_factor >= 0 and los_factor <= 1),
  weather_factor decimal(4,3) not null check (weather_factor >= 0 and weather_factor <= 1),
  solar_depression_deg decimal(6,3),
  cloud_cover_pct smallint,
  cloud_cover_low_pct smallint,
  time_confidence text not null default 'UNKNOWN' check (time_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  trajectory_confidence text not null default 'UNKNOWN' check (trajectory_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  weather_confidence text not null default 'UNKNOWN' check (weather_confidence in ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')),
  weather_source text,
  azimuth_source text,
  geometry_only_fallback boolean not null default false,
  model_version text not null default 'jep_v1',
  input_hash text not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_jep_scores_expires_idx
  on public.launch_jep_scores (expires_at);

create index if not exists launch_jep_scores_computed_idx
  on public.launch_jep_scores (computed_at desc);

alter table public.launch_jep_scores enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_jep_scores'
      and policyname = 'public read launch jep scores'
  ) then
    create policy "public read launch jep scores"
      on public.launch_jep_scores
      for select
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_jep_scores'
      and policyname = 'admin manage launch jep scores'
  ) then
    create policy "admin manage launch jep scores"
      on public.launch_jep_scores
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;
