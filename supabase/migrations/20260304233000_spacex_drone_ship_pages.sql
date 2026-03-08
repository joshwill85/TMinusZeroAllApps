-- Dedicated SpaceX drone-ship registry + launch assignment cache powering
-- /spacex/drone-ships pages, APIs, and command deck KPI tiles.

create table if not exists public.spacex_drone_ships (
  slug text primary key,
  name text not null,
  abbrev text,
  status text not null default 'active'
    check (status in ('active', 'retired', 'unknown')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.spacex_drone_ships (slug, name, abbrev, status, description)
values
  (
    'ocisly',
    'Of Course I Still Love You',
    'OCISLY',
    'active',
    'Autonomous Spaceport Drone Ship supporting Falcon first-stage recoveries.'
  ),
  (
    'asog',
    'A Shortfall of Gravitas',
    'ASOG',
    'active',
    'Autonomous Spaceport Drone Ship used for Atlantic landing operations.'
  ),
  (
    'jrti',
    'Just Read the Instructions',
    'JRTI',
    'active',
    'Autonomous Spaceport Drone Ship used in Pacific recovery campaigns.'
  )
on conflict (slug) do update
set
  name = excluded.name,
  abbrev = excluded.abbrev,
  status = excluded.status,
  description = excluded.description,
  updated_at = now();

create table if not exists public.spacex_drone_ship_assignments (
  launch_id uuid primary key references public.launches(id) on delete cascade,
  launch_library_id uuid,
  ship_slug text references public.spacex_drone_ships(slug) on delete set null,
  ship_name_raw text,
  ship_abbrev_raw text,
  landing_attempt boolean,
  landing_success boolean,
  landing_result text not null default 'unknown'
    check (landing_result in ('success', 'failure', 'no_attempt', 'unknown')),
  landing_time timestamptz,
  source text not null default 'll2',
  source_landing_id text,
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spacex_drone_ship_assignments_ship_slug_idx
  on public.spacex_drone_ship_assignments (ship_slug, landing_time desc);

create index if not exists spacex_drone_ship_assignments_last_verified_idx
  on public.spacex_drone_ship_assignments (last_verified_at desc);

create index if not exists spacex_drone_ship_assignments_launch_library_id_idx
  on public.spacex_drone_ship_assignments (launch_library_id);

create unique index if not exists spacex_drone_ship_assignments_source_landing_uniq
  on public.spacex_drone_ship_assignments (source, source_landing_id)
  where source_landing_id is not null;

alter table public.spacex_drone_ships enable row level security;
alter table public.spacex_drone_ship_assignments enable row level security;

drop policy if exists "public read spacex drone ships" on public.spacex_drone_ships;
create policy "public read spacex drone ships"
  on public.spacex_drone_ships
  for select
  using (true);

drop policy if exists "service role manage spacex drone ships" on public.spacex_drone_ships;
create policy "service role manage spacex drone ships"
  on public.spacex_drone_ships
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "public read spacex drone ship assignments" on public.spacex_drone_ship_assignments;
create policy "public read spacex drone ship assignments"
  on public.spacex_drone_ship_assignments
  for select
  using (true);

drop policy if exists "service role manage spacex drone ship assignments" on public.spacex_drone_ship_assignments;
create policy "service role manage spacex drone ship assignments"
  on public.spacex_drone_ship_assignments
  for all to service_role
  using (true)
  with check (true);

create or replace function public.get_spacex_drone_ship_ingest_candidates(
  limit_n int default 24,
  lookback_days int default 3650,
  lookahead_days int default 365,
  stale_hours int default 120
)
returns table (
  launch_id uuid,
  ll2_launch_uuid uuid,
  net timestamptz,
  assignment_last_verified timestamptz
)
language sql
security definer
set search_path = public
as $function$
  with filtered as (
    select
      lpc.launch_id,
      lpc.ll2_launch_uuid,
      lpc.net,
      a.last_verified_at
    from public.launches_public_cache lpc
    left join public.spacex_drone_ship_assignments a
      on a.launch_id = lpc.launch_id
    where lpc.ll2_launch_uuid is not null
      and lpc.net is not null
      and lpc.net >= now() - make_interval(days => greatest(1, lookback_days))
      and lpc.net <= now() + make_interval(days => greatest(1, lookahead_days))
      and (
        lpc.provider ilike '%SpaceX%'
        or lpc.provider ilike '%Space X%'
        or lpc.name ilike '%Starship%'
        or lpc.name ilike '%Super Heavy%'
        or lpc.name ilike '%Falcon 9%'
        or lpc.name ilike '%Falcon Heavy%'
        or lpc.name ilike '%Crew Dragon%'
        or lpc.name ilike '%Cargo Dragon%'
        or lpc.mission_name ilike '%Starship%'
        or lpc.mission_name ilike '%Falcon%'
        or lpc.mission_name ilike '%Dragon%'
        or lpc.vehicle ilike '%Starship%'
        or lpc.vehicle ilike '%Falcon%'
        or lpc.vehicle ilike '%Dragon%'
        or lpc.rocket_full_name ilike '%Starship%'
        or lpc.rocket_full_name ilike '%Falcon%'
        or lpc.rocket_full_name ilike '%Dragon%'
      )
  ),
  prioritized as (
    select
      f.launch_id,
      f.ll2_launch_uuid,
      f.net,
      f.last_verified_at,
      case when f.last_verified_at is null then 0 else 1 end as verified_rank,
      case when f.net >= now() then 0 else 1 end as temporal_rank,
      abs(extract(epoch from (f.net - now()))) as distance_seconds
    from filtered f
    where f.last_verified_at is null
       or f.last_verified_at <= now() - make_interval(hours => greatest(1, stale_hours))
       or f.net >= now() - interval '2 days'
  )
  select
    p.launch_id,
    p.ll2_launch_uuid,
    p.net,
    p.last_verified_at as assignment_last_verified
  from prioritized p
  order by
    p.verified_rank asc,
    p.temporal_rank asc,
    p.distance_seconds asc,
    p.net desc
  limit least(greatest(limit_n, 1), 200);
$function$;

revoke execute on function public.get_spacex_drone_ship_ingest_candidates(int, int, int, int) from public;
grant execute on function public.get_spacex_drone_ship_ingest_candidates(int, int, int, int) to service_role;

insert into public.system_settings (key, value)
values
  ('spacex_drone_ship_ingest_enabled', 'true'::jsonb),
  ('spacex_drone_ship_ingest_batch_size', '24'::jsonb),
  ('spacex_drone_ship_ingest_lookback_days', '3650'::jsonb),
  ('spacex_drone_ship_ingest_lookahead_days', '365'::jsonb),
  ('spacex_drone_ship_ingest_stale_hours', '120'::jsonb)
on conflict (key) do nothing;

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values (
  'spacex_drone_ship_ingest',
  'spacex-drone-ship-ingest',
  3600,
  900,
  true,
  3,
  public.managed_scheduler_next_run(now(), 3600, 900)
)
on conflict (cron_job_name) do update
set
  edge_job_slug = excluded.edge_job_slug,
  interval_seconds = excluded.interval_seconds,
  offset_seconds = excluded.offset_seconds,
  enabled = excluded.enabled,
  max_attempts = excluded.max_attempts,
  next_run_at = excluded.next_run_at,
  updated_at = now();

select public.managed_scheduler_enqueue_due(200);
