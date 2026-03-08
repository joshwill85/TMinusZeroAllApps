-- Blue Origin entity model expansion: vehicles, engines, mappings, people profiles,
-- and contract-detail tables for action / notice / spending drill-down.

create table if not exists public.blue_origin_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_slug text not null unique,
  mission_key text not null,
  display_name text not null,
  vehicle_class text,
  status text,
  first_flight date,
  description text,
  official_url text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_vehicles_slug_check
    check (vehicle_slug in ('new-shepard', 'new-glenn', 'blue-moon', 'blue-ring')),
  constraint blue_origin_vehicles_mission_check
    check (mission_key in ('new-shepard', 'new-glenn', 'blue-moon', 'blue-ring'))
);

create index if not exists blue_origin_vehicles_mission_idx
  on public.blue_origin_vehicles(mission_key, updated_at desc);

create table if not exists public.blue_origin_engines (
  id uuid primary key default gen_random_uuid(),
  engine_slug text not null unique,
  mission_key text not null,
  display_name text not null,
  propellants text,
  cycle text,
  thrust_vac_kN numeric,
  thrust_sl_kN numeric,
  status text,
  description text,
  official_url text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_engines_slug_check
    check (engine_slug in ('be-3pm', 'be-3u', 'be-4', 'be-7')),
  constraint blue_origin_engines_mission_check
    check (mission_key in ('blue-origin-program', 'be-4', 'blue-moon', 'new-shepard', 'new-glenn'))
);

create index if not exists blue_origin_engines_mission_idx
  on public.blue_origin_engines(mission_key, updated_at desc);

create table if not exists public.blue_origin_vehicle_engine_map (
  vehicle_slug text not null references public.blue_origin_vehicles(vehicle_slug) on delete cascade,
  engine_slug text not null references public.blue_origin_engines(engine_slug) on delete cascade,
  role text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (vehicle_slug, engine_slug)
);

create index if not exists blue_origin_vehicle_engine_engine_idx
  on public.blue_origin_vehicle_engine_map(engine_slug, updated_at desc);

create table if not exists public.blue_origin_flights (
  id uuid primary key default gen_random_uuid(),
  flight_code text not null unique,
  mission_key text not null,
  launch_id text,
  ll2_launch_uuid text,
  launch_name text,
  launch_date timestamptz,
  status text,
  official_mission_url text,
  source text not null default 'launches_public_cache',
  confidence text not null default 'medium',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_flights_mission_check
    check (mission_key in ('new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4', 'blue-origin-program')),
  constraint blue_origin_flights_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create index if not exists blue_origin_flights_mission_date_idx
  on public.blue_origin_flights(mission_key, launch_date desc nulls last);

create table if not exists public.blue_origin_people_profiles (
  id uuid primary key default gen_random_uuid(),
  person_key text not null unique,
  name text not null,
  nationality text,
  bio text,
  profile_url text,
  source text not null default 'derived',
  confidence text not null default 'medium',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_people_profiles_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create index if not exists blue_origin_people_profiles_name_idx
  on public.blue_origin_people_profiles(name);

create table if not exists public.blue_origin_contract_actions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.blue_origin_contracts(id) on delete cascade,
  action_key text not null unique,
  mod_number text not null default '0',
  action_date date,
  obligation_delta numeric,
  obligation_cumulative numeric,
  source text not null default 'manual',
  source_record_hash text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_contract_actions_source_check
    check (source in ('usaspending', 'sam', 'government-record', 'manual'))
);

create index if not exists blue_origin_contract_actions_contract_idx
  on public.blue_origin_contract_actions(contract_id, action_date desc nulls last);

create table if not exists public.blue_origin_opportunity_notices (
  id uuid primary key default gen_random_uuid(),
  notice_id text not null unique,
  solicitation_id text,
  title text,
  posted_date date,
  response_deadline timestamptz,
  awardee_name text,
  award_amount numeric,
  notice_url text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists blue_origin_opportunity_notices_solicitation_idx
  on public.blue_origin_opportunity_notices(solicitation_id, posted_date desc nulls last);

create table if not exists public.blue_origin_spending_timeseries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.blue_origin_contracts(id) on delete cascade,
  fiscal_year int not null,
  fiscal_month int not null,
  obligations numeric,
  outlays numeric,
  source text not null default 'usaspending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_spending_month_check
    check (fiscal_month between 1 and 12),
  constraint blue_origin_spending_source_check
    check (source in ('usaspending', 'sam', 'manual')),
  unique (contract_id, fiscal_year, fiscal_month, source)
);

create index if not exists blue_origin_spending_contract_idx
  on public.blue_origin_spending_timeseries(contract_id, fiscal_year desc, fiscal_month desc);

create table if not exists public.blue_origin_contract_vehicle_map (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.blue_origin_contracts(id) on delete cascade,
  vehicle_slug text references public.blue_origin_vehicles(vehicle_slug) on delete set null,
  engine_slug text references public.blue_origin_engines(engine_slug) on delete set null,
  match_method text not null default 'rule',
  confidence numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_contract_vehicle_match_method_check
    check (match_method in ('rule', 'keyword', 'manual')),
  constraint blue_origin_contract_vehicle_confidence_check
    check (confidence >= 0 and confidence <= 1),
  unique (contract_id, vehicle_slug, engine_slug, match_method)
);

create index if not exists blue_origin_contract_vehicle_contract_idx
  on public.blue_origin_contract_vehicle_map(contract_id, confidence desc);

alter table public.blue_origin_vehicles enable row level security;
alter table public.blue_origin_engines enable row level security;
alter table public.blue_origin_vehicle_engine_map enable row level security;
alter table public.blue_origin_flights enable row level security;
alter table public.blue_origin_people_profiles enable row level security;
alter table public.blue_origin_contract_actions enable row level security;
alter table public.blue_origin_opportunity_notices enable row level security;
alter table public.blue_origin_spending_timeseries enable row level security;
alter table public.blue_origin_contract_vehicle_map enable row level security;

drop policy if exists "public read blue origin vehicles" on public.blue_origin_vehicles;
create policy "public read blue origin vehicles" on public.blue_origin_vehicles
  for select using (true);

drop policy if exists "service role manage blue origin vehicles" on public.blue_origin_vehicles;
create policy "service role manage blue origin vehicles" on public.blue_origin_vehicles
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin engines" on public.blue_origin_engines;
create policy "public read blue origin engines" on public.blue_origin_engines
  for select using (true);

drop policy if exists "service role manage blue origin engines" on public.blue_origin_engines;
create policy "service role manage blue origin engines" on public.blue_origin_engines
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin vehicle engine map" on public.blue_origin_vehicle_engine_map;
create policy "public read blue origin vehicle engine map" on public.blue_origin_vehicle_engine_map
  for select using (true);

drop policy if exists "service role manage blue origin vehicle engine map" on public.blue_origin_vehicle_engine_map;
create policy "service role manage blue origin vehicle engine map" on public.blue_origin_vehicle_engine_map
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin flights" on public.blue_origin_flights;
create policy "public read blue origin flights" on public.blue_origin_flights
  for select using (true);

drop policy if exists "service role manage blue origin flights" on public.blue_origin_flights;
create policy "service role manage blue origin flights" on public.blue_origin_flights
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin people profiles" on public.blue_origin_people_profiles;
create policy "public read blue origin people profiles" on public.blue_origin_people_profiles
  for select using (true);

drop policy if exists "service role manage blue origin people profiles" on public.blue_origin_people_profiles;
create policy "service role manage blue origin people profiles" on public.blue_origin_people_profiles
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin contract actions" on public.blue_origin_contract_actions;
create policy "public read blue origin contract actions" on public.blue_origin_contract_actions
  for select using (true);

drop policy if exists "service role manage blue origin contract actions" on public.blue_origin_contract_actions;
create policy "service role manage blue origin contract actions" on public.blue_origin_contract_actions
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin opportunity notices" on public.blue_origin_opportunity_notices;
create policy "public read blue origin opportunity notices" on public.blue_origin_opportunity_notices
  for select using (true);

drop policy if exists "service role manage blue origin opportunity notices" on public.blue_origin_opportunity_notices;
create policy "service role manage blue origin opportunity notices" on public.blue_origin_opportunity_notices
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin spending timeseries" on public.blue_origin_spending_timeseries;
create policy "public read blue origin spending timeseries" on public.blue_origin_spending_timeseries
  for select using (true);

drop policy if exists "service role manage blue origin spending timeseries" on public.blue_origin_spending_timeseries;
create policy "service role manage blue origin spending timeseries" on public.blue_origin_spending_timeseries
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin contract vehicle map" on public.blue_origin_contract_vehicle_map;
create policy "public read blue origin contract vehicle map" on public.blue_origin_contract_vehicle_map
  for select using (true);

drop policy if exists "service role manage blue origin contract vehicle map" on public.blue_origin_contract_vehicle_map;
create policy "service role manage blue origin contract vehicle map" on public.blue_origin_contract_vehicle_map
  for all to service_role using (true) with check (true);

insert into public.system_settings (key, value)
values
  ('blue_origin_vehicles_job_enabled', 'true'::jsonb),
  ('blue_origin_engines_job_enabled', 'true'::jsonb),
  ('blue_origin_passengers_ll2_window_hours', '96'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

insert into public.blue_origin_ingest_checkpoints (source_key, source_type, status)
values
  ('blue_origin_vehicles', 'blue-origin-official', 'pending'),
  ('blue_origin_engines', 'blue-origin-official', 'pending')
on conflict (source_key) do nothing;
