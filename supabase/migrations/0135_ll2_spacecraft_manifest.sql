-- LL2 spacecraft manifest storage (spacecraft, spacecraft flights, landing + docking events).
-- Public-read (anon) via RLS policies.

create table if not exists public.ll2_spacecraft_types (
  ll2_spacecraft_type_id int primary key,
  name text not null,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_spacecraft_types_name_idx on public.ll2_spacecraft_types(name);

create table if not exists public.ll2_spacecraft_configs (
  ll2_spacecraft_config_id int primary key,
  name text not null,
  spacecraft_type_id int references public.ll2_spacecraft_types(ll2_spacecraft_type_id),
  agency_id int references public.ll2_agencies(ll2_agency_id),
  family text,
  in_use boolean,
  image_url text,
  thumbnail_url text,
  image_credit text,
  image_license_name text,
  image_license_url text,
  image_single_use boolean,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_spacecraft_configs_type_idx on public.ll2_spacecraft_configs(spacecraft_type_id);
create index if not exists ll2_spacecraft_configs_agency_idx on public.ll2_spacecraft_configs(agency_id);

create table if not exists public.ll2_spacecrafts (
  ll2_spacecraft_id int primary key,
  name text not null,
  serial_number text,
  description text,
  status jsonb,
  in_space boolean,
  spacecraft_config_id int references public.ll2_spacecraft_configs(ll2_spacecraft_config_id),
  image_url text,
  thumbnail_url text,
  image_credit text,
  image_license_name text,
  image_license_url text,
  image_single_use boolean,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_spacecrafts_name_idx on public.ll2_spacecrafts(name);
create index if not exists ll2_spacecrafts_config_idx on public.ll2_spacecrafts(spacecraft_config_id);

create table if not exists public.ll2_spacecraft_flights (
  ll2_spacecraft_flight_id int primary key,
  ll2_launch_uuid uuid not null,
  launch_id uuid references public.launches(id) on delete set null,
  ll2_spacecraft_id int references public.ll2_spacecrafts(ll2_spacecraft_id),
  url text,
  destination text,
  mission_end timestamptz,
  duration text,
  turn_around_time text,
  ll2_landing_id int references public.ll2_landings(ll2_landing_id),
  launch_crew jsonb,
  onboard_crew jsonb,
  landing_crew jsonb,
  active boolean not null default true,
  last_seen_at timestamptz,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_spacecraft_flights_launch_idx on public.ll2_spacecraft_flights(ll2_launch_uuid, active);
create index if not exists ll2_spacecraft_flights_spacecraft_idx on public.ll2_spacecraft_flights(ll2_spacecraft_id);
create index if not exists ll2_spacecraft_flights_launch_id_idx on public.ll2_spacecraft_flights(launch_id);

create table if not exists public.ll2_spacecraft_flight_docking_events (
  ll2_spacecraft_flight_id int not null references public.ll2_spacecraft_flights(ll2_spacecraft_flight_id) on delete cascade,
  ll2_docking_event_id int not null,
  docking timestamptz,
  departure timestamptz,
  docking_location jsonb,
  space_station jsonb,
  flight_vehicle jsonb,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ll2_spacecraft_flight_id, ll2_docking_event_id)
);

create index if not exists ll2_spacecraft_flight_docking_events_docking_idx
  on public.ll2_spacecraft_flight_docking_events(ll2_spacecraft_flight_id, docking);

-- Public read access (anon) via RLS.
alter table public.ll2_spacecraft_types enable row level security;
alter table public.ll2_spacecraft_configs enable row level security;
alter table public.ll2_spacecrafts enable row level security;
alter table public.ll2_spacecraft_flights enable row level security;
alter table public.ll2_spacecraft_flight_docking_events enable row level security;

drop policy if exists "public read ll2 spacecraft types" on public.ll2_spacecraft_types;
create policy "public read ll2 spacecraft types"
  on public.ll2_spacecraft_types
  for select
  using (true);

drop policy if exists "public read ll2 spacecraft configs" on public.ll2_spacecraft_configs;
create policy "public read ll2 spacecraft configs"
  on public.ll2_spacecraft_configs
  for select
  using (true);

drop policy if exists "public read ll2 spacecrafts" on public.ll2_spacecrafts;
create policy "public read ll2 spacecrafts"
  on public.ll2_spacecrafts
  for select
  using (true);

drop policy if exists "public read ll2 spacecraft flights" on public.ll2_spacecraft_flights;
create policy "public read ll2 spacecraft flights"
  on public.ll2_spacecraft_flights
  for select
  using (true);

drop policy if exists "public read ll2 spacecraft flight docking events" on public.ll2_spacecraft_flight_docking_events;
create policy "public read ll2 spacecraft flight docking events"
  on public.ll2_spacecraft_flight_docking_events
  for select
  using (true);

-- Extend launch payload manifest RPC to include spacecraft flights.
create or replace function public.get_launch_payload_manifest(ll2_launch_uuid_in uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with payload_entries as (
    select
      0 as kind_order,
      pf.ll2_payload_flight_id as sort_id,
      jsonb_build_object(
        'kind', 'payload_flight',
        'id', pf.ll2_payload_flight_id,
        'url', pf.url,
        'destination', pf.destination,
        'amount', pf.amount,
        'payload', jsonb_build_object(
          'id', p.ll2_payload_id,
          'name', p.name,
          'description', p.description,
          'mass_kg', p.mass_kg,
          'cost_usd', p.cost_usd,
          'wiki_link', p.wiki_link,
          'info_link', p.info_link,
          'program', p.program,
          'type', case
            when pt.ll2_payload_type_id is null then null
            else jsonb_build_object('id', pt.ll2_payload_type_id, 'name', pt.name)
          end,
          'manufacturer', case
            when m.ll2_agency_id is null then null
            else jsonb_build_object('id', m.ll2_agency_id, 'name', m.name, 'abbrev', m.abbrev)
          end,
          'operator', case
            when o.ll2_agency_id is null then null
            else jsonb_build_object('id', o.ll2_agency_id, 'name', o.name, 'abbrev', o.abbrev)
          end,
          'image', jsonb_build_object(
            'image_url', p.image_url,
            'thumbnail_url', p.thumbnail_url,
            'credit', p.image_credit,
            'license_name', p.image_license_name,
            'license_url', p.image_license_url,
            'single_use', p.image_single_use
          ),
          'raw', p.raw
        ),
        'landing', case
          when l.ll2_landing_id is null then null
          else jsonb_build_object(
            'id', l.ll2_landing_id,
            'attempt', l.attempt,
            'success', l.success,
            'description', l.description,
            'downrange_distance_km', l.downrange_distance_km,
            'landing_location', l.landing_location,
            'landing_type', l.landing_type,
            'raw', l.raw
          )
        end,
        'docking_events', (
          select coalesce(jsonb_agg(de.raw order by de.docking), '[]'::jsonb)
          from public.ll2_payload_flight_docking_events de
          where de.ll2_payload_flight_id = pf.ll2_payload_flight_id
        ),
        'raw', pf.raw
      ) as entry
    from public.ll2_payload_flights pf
    left join public.ll2_payloads p on p.ll2_payload_id = pf.ll2_payload_id
    left join public.ll2_payload_types pt on pt.ll2_payload_type_id = p.payload_type_id
    left join public.ll2_agencies m on m.ll2_agency_id = p.manufacturer_id
    left join public.ll2_agencies o on o.ll2_agency_id = p.operator_id
    left join public.ll2_landings l on l.ll2_landing_id = pf.ll2_landing_id
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  spacecraft_entries as (
    select
      1 as kind_order,
      sf.ll2_spacecraft_flight_id as sort_id,
      jsonb_build_object(
        'kind', 'spacecraft_flight',
        'id', -sf.ll2_spacecraft_flight_id,
        'url', sf.url,
        'destination', sf.destination,
        'amount', null,
        'payload', jsonb_build_object(
          'id', sc.ll2_spacecraft_id,
          'name', sc.name,
          'description', sc.description,
          'mass_kg', null,
          'cost_usd', null,
          'wiki_link', null,
          'info_link', null,
          'program', null,
          'type', case
            when sct.ll2_spacecraft_type_id is null then null
            else jsonb_build_object('id', sct.ll2_spacecraft_type_id, 'name', sct.name)
          end,
          'manufacturer', case
            when a.ll2_agency_id is null then null
            else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
          end,
          'operator', case
            when a.ll2_agency_id is null then null
            else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
          end,
          'image', jsonb_build_object(
            'image_url', coalesce(sc.image_url, cfg.image_url),
            'thumbnail_url', coalesce(sc.thumbnail_url, cfg.thumbnail_url),
            'credit', coalesce(sc.image_credit, cfg.image_credit),
            'license_name', coalesce(sc.image_license_name, cfg.image_license_name),
            'license_url', coalesce(sc.image_license_url, cfg.image_license_url),
            'single_use', coalesce(sc.image_single_use, cfg.image_single_use)
          ),
          'raw', sc.raw
        ),
        'landing', case
          when l.ll2_landing_id is null then null
          else jsonb_build_object(
            'id', l.ll2_landing_id,
            'attempt', l.attempt,
            'success', l.success,
            'description', l.description,
            'downrange_distance_km', l.downrange_distance_km,
            'landing_location', l.landing_location,
            'landing_type', l.landing_type,
            'raw', l.raw
          )
        end,
        'docking_events', (
          select coalesce(jsonb_agg(de.raw order by de.docking), '[]'::jsonb)
          from public.ll2_spacecraft_flight_docking_events de
          where de.ll2_spacecraft_flight_id = sf.ll2_spacecraft_flight_id
        ),
        'raw', sf.raw
      ) as entry
    from public.ll2_spacecraft_flights sf
    left join public.ll2_spacecrafts sc on sc.ll2_spacecraft_id = sf.ll2_spacecraft_id
    left join public.ll2_spacecraft_configs cfg on cfg.ll2_spacecraft_config_id = sc.spacecraft_config_id
    left join public.ll2_spacecraft_types sct on sct.ll2_spacecraft_type_id = cfg.spacecraft_type_id
    left join public.ll2_agencies a on a.ll2_agency_id = cfg.agency_id
    left join public.ll2_landings l on l.ll2_landing_id = sf.ll2_landing_id
    where sf.ll2_launch_uuid = ll2_launch_uuid_in
      and sf.active = true
  ),
  combined as (
    select * from payload_entries
    union all
    select * from spacecraft_entries
  )
  select coalesce(
    jsonb_agg(combined.entry order by combined.kind_order, combined.sort_id),
    '[]'::jsonb
  )
  from combined;
$$;

grant execute on function public.get_launch_payload_manifest(uuid) to anon, authenticated;
