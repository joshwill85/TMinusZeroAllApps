-- Support National Weather Service (NWS) forecasts for launches.

-- Quick-access icon for cards (copied into public cache).
alter table public.launches
  add column if not exists weather_icon_url text;

alter table public.launches_public_cache
  add column if not exists weather_icon_url text;

-- NWS /points lookup cache (lat/lon -> gridpoint + forecast URLs).
create table if not exists public.nws_points (
  id uuid primary key default gen_random_uuid(),
  coord_key text not null unique,
  ll2_pad_id int references public.ll2_pads(ll2_pad_id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  cwa text,
  grid_id text not null,
  grid_x int not null,
  grid_y int not null,
  forecast_url text not null,
  forecast_hourly_url text not null,
  forecast_grid_data_url text,
  time_zone text,
  county_url text,
  forecast_zone_url text,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nws_points_ll2_pad_id_uidx on public.nws_points(ll2_pad_id) where ll2_pad_id is not null;
create index if not exists nws_points_grid_idx on public.nws_points(grid_id, grid_x, grid_y);
create index if not exists nws_points_fetched_at_idx on public.nws_points(fetched_at desc);

alter table public.nws_points enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'nws_points' and policyname = 'admin manage nws points'
  ) then
    create policy "admin manage nws points" on public.nws_points
      for all using (public.is_admin()) with check (public.is_admin());
  end if;
end $$;

-- Keep a single "latest" forecast row per launch + source.
-- This allows idempotent upserts from the ingestion job.
with keep as (
  select distinct on (launch_id, source) id
  from public.launch_weather
  order by launch_id, source, issued_at desc nulls last, updated_at desc
)
delete from public.launch_weather
where id not in (select id from keep);

create unique index if not exists launch_weather_launch_id_source_uidx on public.launch_weather(launch_id, source);
