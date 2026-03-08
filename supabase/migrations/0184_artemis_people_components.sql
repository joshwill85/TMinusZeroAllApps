-- Artemis II crew + mission component tables + weekly ingestion jobs.

create table if not exists public.artemis_people (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null,
  sort_order integer not null default 0,
  name text not null,
  name_normalized text generated always as (lower(name)) stored,
  agency text not null,
  role text,
  bio_url text not null,
  portrait_url text,
  summary text,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint artemis_people_mission_key_check
    check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'))
);

create unique index if not exists artemis_people_mission_name_key
  on public.artemis_people(mission_key, name_normalized);

create index if not exists artemis_people_mission_sort_idx
  on public.artemis_people(mission_key, sort_order, updated_at desc);

create table if not exists public.artemis_mission_components (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null,
  sort_order integer not null default 0,
  component text not null,
  component_normalized text generated always as (lower(component)) stored,
  description text not null,
  official_urls text[] not null default '{}'::text[],
  image_url text,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint artemis_mission_components_mission_key_check
    check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'))
);

create unique index if not exists artemis_mission_components_mission_component_key
  on public.artemis_mission_components(mission_key, component_normalized);

create index if not exists artemis_mission_components_mission_sort_idx
  on public.artemis_mission_components(mission_key, sort_order, updated_at desc);

alter table public.artemis_people enable row level security;
alter table public.artemis_mission_components enable row level security;

drop policy if exists "public read artemis people" on public.artemis_people;
create policy "public read artemis people" on public.artemis_people
  for select using (true);

drop policy if exists "service role manage artemis people" on public.artemis_people;
create policy "service role manage artemis people" on public.artemis_people
  for all to service_role using (true) with check (true);

drop policy if exists "public read artemis mission components" on public.artemis_mission_components;
create policy "public read artemis mission components" on public.artemis_mission_components
  for select using (true);

drop policy if exists "service role manage artemis mission components" on public.artemis_mission_components;
create policy "service role manage artemis mission components" on public.artemis_mission_components
  for all to service_role using (true) with check (true);

insert into public.system_settings (key, value)
values
  ('artemis_nasa_blog_backfill_job_enabled', 'true'::jsonb),
  ('artemis_crew_job_enabled', 'true'::jsonb),
  ('artemis_components_job_enabled', 'true'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

insert into public.artemis_ingest_checkpoints (source_key, source_type)
values
  ('nasa_blog_posts_backfill', 'nasa_primary'),
  ('artemis_people', 'nasa_primary'),
  ('artemis_mission_components', 'nasa_primary')
on conflict (source_key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_nasa_blog_backfill') then
    perform cron.unschedule('artemis_nasa_blog_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'artemis_crew_ingest') then
    perform cron.unschedule('artemis_crew_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'artemis_components_ingest') then
    perform cron.unschedule('artemis_components_ingest');
  end if;

  -- Weekly, low-IO authoritative refresh. Budget/procurement remain separate weekly jobs.
  perform cron.schedule(
    'artemis_nasa_blog_backfill',
    '15 5 * * 0',
    $job$select public.invoke_edge_job('artemis-nasa-blog-backfill');$job$
  );

  perform cron.schedule(
    'artemis_crew_ingest',
    '35 5 * * 0',
    $job$select public.invoke_edge_job('artemis-crew-ingest');$job$
  );

  perform cron.schedule(
    'artemis_components_ingest',
    '55 5 * * 0',
    $job$select public.invoke_edge_job('artemis-components-ingest');$job$
  );
end $$;

