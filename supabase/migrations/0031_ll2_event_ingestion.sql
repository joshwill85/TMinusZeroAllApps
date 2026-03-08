-- LL2 event storage + ingestion settings.

create table if not exists public.ll2_events (
  ll2_event_id int primary key,
  name text not null,
  slug text,
  description text,
  type_id int,
  type_name text,
  date timestamptz,
  date_precision text,
  duration text,
  location_id int,
  location_name text,
  location_country_code text,
  webcast_live boolean,
  image_url text,
  image_credit text,
  image_license_name text,
  image_license_url text,
  image_single_use boolean,
  info_urls jsonb,
  vid_urls jsonb,
  updates jsonb,
  url text,
  last_updated_source timestamptz,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ll2_events_date_idx on public.ll2_events(date desc);
create index if not exists ll2_events_last_updated_idx on public.ll2_events(last_updated_source desc);

create table if not exists public.ll2_event_launches (
  ll2_event_id int not null references public.ll2_events(ll2_event_id) on delete cascade,
  launch_id uuid not null references public.launches(id) on delete cascade,
  primary key (ll2_event_id, launch_id)
);

create index if not exists ll2_event_launches_launch_id_idx on public.ll2_event_launches(launch_id);

alter table public.ll2_events enable row level security;
alter table public.ll2_event_launches enable row level security;

drop policy if exists "public read ll2 events" on public.ll2_events;
create policy "public read ll2 events" on public.ll2_events for select using (true);

drop policy if exists "public read ll2 event launches" on public.ll2_event_launches;
create policy "public read ll2 event launches" on public.ll2_event_launches for select using (true);

insert into public.system_settings (key, value)
values
  ('ll2_event_ingest_enabled', 'true'::jsonb),
  ('ll2_event_ingest_batch_size', '1'::jsonb),
  ('ll2_event_ingest_stale_hours', '24'::jsonb)
on conflict (key) do nothing;
