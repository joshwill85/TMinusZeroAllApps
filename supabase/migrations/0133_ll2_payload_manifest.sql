-- LL2 payload manifest storage (payloads, payload flights, landings, docking events).
-- Public-read (anon) via RLS policies.

create table if not exists public.ll2_payload_types (
  ll2_payload_type_id int primary key,
  name text not null,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_payload_types_name_idx on public.ll2_payload_types(name);

create table if not exists public.ll2_payloads (
  ll2_payload_id int primary key,
  name text not null,
  description text,
  payload_type_id int references public.ll2_payload_types(ll2_payload_type_id),
  manufacturer_id int references public.ll2_agencies(ll2_agency_id),
  operator_id int references public.ll2_agencies(ll2_agency_id),
  wiki_link text,
  info_link text,
  cost_usd int,
  mass_kg double precision,
  program jsonb,
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

create index if not exists ll2_payloads_name_idx on public.ll2_payloads(name);
create index if not exists ll2_payloads_type_idx on public.ll2_payloads(payload_type_id);
create index if not exists ll2_payloads_manufacturer_idx on public.ll2_payloads(manufacturer_id);
create index if not exists ll2_payloads_operator_idx on public.ll2_payloads(operator_id);

create table if not exists public.ll2_landings (
  ll2_landing_id int primary key,
  attempt boolean,
  success boolean,
  description text,
  downrange_distance_km double precision,
  landing_location jsonb,
  landing_type jsonb,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll2_payload_flights (
  ll2_payload_flight_id int primary key,
  ll2_launch_uuid uuid not null,
  launch_id uuid references public.launches(id) on delete set null,
  ll2_payload_id int references public.ll2_payloads(ll2_payload_id),
  url text,
  destination text,
  amount int,
  ll2_landing_id int references public.ll2_landings(ll2_landing_id),
  active boolean not null default true,
  last_seen_at timestamptz,
  raw jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_payload_flights_launch_idx on public.ll2_payload_flights(ll2_launch_uuid, active);
create index if not exists ll2_payload_flights_payload_idx on public.ll2_payload_flights(ll2_payload_id);
create index if not exists ll2_payload_flights_launch_id_idx on public.ll2_payload_flights(launch_id);

create table if not exists public.ll2_payload_flight_docking_events (
  ll2_payload_flight_id int not null references public.ll2_payload_flights(ll2_payload_flight_id) on delete cascade,
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
  primary key (ll2_payload_flight_id, ll2_docking_event_id)
);

create index if not exists ll2_payload_flight_docking_events_docking_idx
  on public.ll2_payload_flight_docking_events(ll2_payload_flight_id, docking);

-- Public read access (anon) via RLS.
alter table public.ll2_payload_types enable row level security;
alter table public.ll2_payloads enable row level security;
alter table public.ll2_landings enable row level security;
alter table public.ll2_payload_flights enable row level security;
alter table public.ll2_payload_flight_docking_events enable row level security;

drop policy if exists "public read ll2 payload types" on public.ll2_payload_types;
create policy "public read ll2 payload types"
  on public.ll2_payload_types
  for select
  using (true);

drop policy if exists "public read ll2 payloads" on public.ll2_payloads;
create policy "public read ll2 payloads"
  on public.ll2_payloads
  for select
  using (true);

drop policy if exists "public read ll2 landings" on public.ll2_landings;
create policy "public read ll2 landings"
  on public.ll2_landings
  for select
  using (true);

drop policy if exists "public read ll2 payload flights" on public.ll2_payload_flights;
create policy "public read ll2 payload flights"
  on public.ll2_payload_flights
  for select
  using (true);

drop policy if exists "public read ll2 payload flight docking events" on public.ll2_payload_flight_docking_events;
create policy "public read ll2 payload flight docking events"
  on public.ll2_payload_flight_docking_events
  for select
  using (true);

-- Convenience RPC for launch detail pages (public / anon callable).
create or replace function public.get_launch_payload_manifest(ll2_launch_uuid_in uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
      )
      order by pf.ll2_payload_flight_id
    ),
    '[]'::jsonb
  )
  from public.ll2_payload_flights pf
  left join public.ll2_payloads p on p.ll2_payload_id = pf.ll2_payload_id
  left join public.ll2_payload_types pt on pt.ll2_payload_type_id = p.payload_type_id
  left join public.ll2_agencies m on m.ll2_agency_id = p.manufacturer_id
  left join public.ll2_agencies o on o.ll2_agency_id = p.operator_id
  left join public.ll2_landings l on l.ll2_landing_id = pf.ll2_landing_id
  where pf.ll2_launch_uuid = ll2_launch_uuid_in
    and pf.active = true;
$$;

grant execute on function public.get_launch_payload_manifest(uuid) to anon, authenticated;

