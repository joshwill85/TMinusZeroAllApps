-- LL2 catalog tables + public cache for info pages.

-- Expand reference tables with catalog fields.
alter table if exists public.ll2_agencies
  add column if not exists type text,
  add column if not exists country_code text,
  add column if not exists description text,
  add column if not exists administrator text,
  add column if not exists founding_year text,
  add column if not exists launchers text,
  add column if not exists spacecraft text,
  add column if not exists parent text,
  add column if not exists image_url text,
  add column if not exists logo_url text,
  add column if not exists featured boolean,
  add column if not exists raw jsonb,
  add column if not exists fetched_at timestamptz;

alter table if exists public.ll2_locations
  add column if not exists description text,
  add column if not exists map_image text,
  add column if not exists total_launch_count int,
  add column if not exists total_landing_count int,
  add column if not exists raw jsonb,
  add column if not exists fetched_at timestamptz;

alter table if exists public.ll2_pads
  add column if not exists agency_id text,
  add column if not exists description text,
  add column if not exists info_url text,
  add column if not exists wiki_url text,
  add column if not exists map_url text,
  add column if not exists map_image text,
  add column if not exists country_code text,
  add column if not exists total_launch_count int,
  add column if not exists orbital_launch_attempt_count int,
  add column if not exists raw jsonb,
  add column if not exists fetched_at timestamptz;

alter table if exists public.ll2_rocket_configs
  add column if not exists variant text,
  add column if not exists reusable boolean,
  add column if not exists image_url text,
  add column if not exists info_url text,
  add column if not exists wiki_url text,
  add column if not exists manufacturer_id int,
  add column if not exists raw jsonb,
  add column if not exists fetched_at timestamptz;

-- Catalog entities.
create table if not exists public.ll2_astronauts (
  ll2_astronaut_id int primary key,
  name text not null,
  status text,
  type text,
  agency_id int,
  agency_name text,
  nationality text,
  in_space boolean,
  time_in_space text,
  eva_time text,
  age int,
  date_of_birth date,
  date_of_death date,
  bio text,
  profile_image text,
  profile_image_thumbnail text,
  twitter text,
  instagram text,
  wiki text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_astronauts_name_idx on public.ll2_astronauts(name);
create index if not exists ll2_astronauts_agency_idx on public.ll2_astronauts(agency_id);

create table if not exists public.ll2_space_stations (
  ll2_space_station_id int primary key,
  name text not null,
  status text,
  type text,
  founded date,
  deorbited date,
  description text,
  orbit text,
  owners jsonb,
  active_expeditions jsonb,
  image_url text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_space_stations_name_idx on public.ll2_space_stations(name);

create table if not exists public.ll2_expeditions (
  ll2_expedition_id int primary key,
  name text not null,
  start_time timestamptz,
  end_time timestamptz,
  space_station_id int,
  mission_patches jsonb,
  spacewalks jsonb,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_expeditions_station_idx on public.ll2_expeditions(space_station_id);

create table if not exists public.ll2_docking_events (
  ll2_docking_event_id int primary key,
  launch_id text,
  docking timestamptz,
  departure timestamptz,
  flight_vehicle jsonb,
  docking_location jsonb,
  space_station_id int,
  space_station_name text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_docking_events_launch_idx on public.ll2_docking_events(launch_id);
create index if not exists ll2_docking_events_station_idx on public.ll2_docking_events(space_station_id);

create table if not exists public.ll2_launchers (
  ll2_launcher_id int primary key,
  serial_number text,
  flight_proven boolean,
  status text,
  details text,
  image_url text,
  launcher_config_id int,
  flights jsonb,
  first_launch_date date,
  last_launch_date date,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_launchers_config_idx on public.ll2_launchers(launcher_config_id);
create index if not exists ll2_launchers_serial_idx on public.ll2_launchers(serial_number);

create table if not exists public.ll2_spacecraft_configurations (
  ll2_spacecraft_config_id int primary key,
  name text not null,
  agency_id int,
  agency_name text,
  in_use boolean,
  capability text,
  maiden_flight date,
  human_rated boolean,
  crew_capacity int,
  image_url text,
  nation_url text,
  wiki_url text,
  info_url text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_spacecraft_config_name_idx on public.ll2_spacecraft_configurations(name);
create index if not exists ll2_spacecraft_config_agency_idx on public.ll2_spacecraft_configurations(agency_id);

-- Public cache for catalog UI.
create table if not exists public.ll2_catalog_public_cache (
  entity_type text not null,
  entity_id text not null,
  name text not null,
  slug text,
  description text,
  country_codes text[],
  image_url text,
  data jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id)
);

create index if not exists ll2_catalog_public_cache_type_idx on public.ll2_catalog_public_cache(entity_type);
create index if not exists ll2_catalog_public_cache_name_idx on public.ll2_catalog_public_cache(name);
create index if not exists ll2_catalog_public_cache_country_codes_gin on public.ll2_catalog_public_cache using gin (country_codes);

alter table if exists public.ll2_astronauts enable row level security;
alter table if exists public.ll2_space_stations enable row level security;
alter table if exists public.ll2_expeditions enable row level security;
alter table if exists public.ll2_docking_events enable row level security;
alter table if exists public.ll2_launchers enable row level security;
alter table if exists public.ll2_spacecraft_configurations enable row level security;

alter table if exists public.ll2_catalog_public_cache enable row level security;

drop policy if exists "public read ll2 catalog cache" on public.ll2_catalog_public_cache;
create policy "public read ll2 catalog cache"
  on public.ll2_catalog_public_cache
  for select
  using (true);
