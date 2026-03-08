-- Spaceflight News API (SNAPI) related news ingestion tables + settings.

create table if not exists public.snapi_items (
  snapi_uid text primary key,
  snapi_id int not null,
  item_type text not null check (item_type in ('article', 'blog', 'report')),
  title text not null,
  url text not null,
  news_site text,
  summary text,
  image_url text,
  published_at timestamptz,
  updated_at timestamptz,
  featured boolean,
  authors jsonb,
  fetched_at timestamptz not null default now(),
  unique (snapi_id, item_type)
);

create index if not exists snapi_items_published_at_idx on public.snapi_items(published_at desc);
create index if not exists snapi_items_updated_at_idx on public.snapi_items(updated_at desc);

create table if not exists public.snapi_item_launches (
  snapi_uid text not null references public.snapi_items(snapi_uid) on delete cascade,
  launch_id uuid not null references public.launches(id) on delete cascade,
  primary key (snapi_uid, launch_id)
);

create index if not exists snapi_item_launches_launch_id_idx on public.snapi_item_launches(launch_id);

create table if not exists public.snapi_item_events (
  snapi_uid text not null references public.snapi_items(snapi_uid) on delete cascade,
  ll2_event_id int not null,
  provider text,
  primary key (snapi_uid, ll2_event_id)
);

alter table public.snapi_items enable row level security;
alter table public.snapi_item_launches enable row level security;
alter table public.snapi_item_events enable row level security;

create policy "public read snapi items" on public.snapi_items for select using (true);
create policy "public read snapi item launches" on public.snapi_item_launches for select using (true);
create policy "public read snapi item events" on public.snapi_item_events for select using (true);

insert into public.system_settings(key, value)
values ('snapi_rate_limit_per_hour', '60'::jsonb)
on conflict (key) do nothing;
