-- Space-Track.org (Basic SSA) enrichment tables + rate limits.

alter table public.launches
  add column if not exists launch_designator text;

create index if not exists launches_launch_designator_idx on public.launches(launch_designator);

create table if not exists public.spacetrack_objects (
  norad_cat_id bigint primary key,
  intldes text,
  object_name text,
  object_type text,
  country_code text,
  launch_date date,
  site text,
  decay_date date,
  source_file int,
  data jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spacetrack_objects_intldes_idx on public.spacetrack_objects(intldes);

create table if not exists public.spacetrack_launch_objects (
  launch_id uuid not null references public.launches(id) on delete cascade,
  norad_cat_id bigint not null references public.spacetrack_objects(norad_cat_id) on delete cascade,
  intldes text,
  primary key (launch_id, norad_cat_id)
);

create index if not exists spacetrack_launch_objects_launch_id_idx on public.spacetrack_launch_objects(launch_id);

create table if not exists public.spacetrack_gp_latest (
  norad_cat_id bigint primary key references public.spacetrack_objects(norad_cat_id) on delete cascade,
  epoch timestamptz,
  source_file int,
  tle_line1 text,
  tle_line2 text,
  data jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists spacetrack_gp_latest_epoch_idx on public.spacetrack_gp_latest(epoch desc);

alter table public.spacetrack_objects enable row level security;
alter table public.spacetrack_launch_objects enable row level security;
alter table public.spacetrack_gp_latest enable row level security;

create policy "public read spacetrack objects" on public.spacetrack_objects for select using (true);
create policy "public read spacetrack launch objects" on public.spacetrack_launch_objects for select using (true);
create policy "public read spacetrack gp latest" on public.spacetrack_gp_latest for select using (true);

insert into public.system_settings(key, value)
values ('spacetrack_rate_limit_per_minute', '30'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings(key, value)
values ('spacetrack_rate_limit_per_hour', '300'::jsonb)
on conflict (key) do nothing;
