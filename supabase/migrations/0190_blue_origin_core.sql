-- Blue Origin core data model: timeline, source docs, passengers, payloads, contracts, and mission snapshots.

create table if not exists public.blue_origin_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_type text not null,
  url text not null,
  title text,
  published_at timestamptz,
  announced_time timestamptz,
  fetched_at timestamptz not null default now(),
  http_status int,
  etag text,
  last_modified timestamptz,
  sha256 text,
  bytes int,
  content_type text,
  summary text,
  raw jsonb,
  parse_version text not null default 'v1',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (url, sha256)
);

create index if not exists blue_origin_source_documents_source_key_idx on public.blue_origin_source_documents(source_key);
create index if not exists blue_origin_source_documents_source_type_idx on public.blue_origin_source_documents(source_type);
create index if not exists blue_origin_source_documents_fetched_at_idx on public.blue_origin_source_documents(fetched_at desc);

create table if not exists public.blue_origin_ingest_checkpoints (
  source_key text primary key,
  source_type text not null,
  status text not null default 'pending',
  cursor text,
  records_ingested bigint not null default 0,
  last_announced_time timestamptz,
  last_event_time timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint blue_origin_ingest_checkpoints_status_check check (status in ('pending', 'running', 'complete', 'error'))
);

create index if not exists blue_origin_ingest_checkpoints_status_idx on public.blue_origin_ingest_checkpoints(status);
create index if not exists blue_origin_ingest_checkpoints_updated_at_idx on public.blue_origin_ingest_checkpoints(updated_at desc);

create table if not exists public.blue_origin_timeline_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  mission_key text not null,
  title text not null,
  summary text,
  event_time timestamptz,
  announced_time timestamptz not null,
  source_type text not null,
  confidence text not null,
  status text not null default 'upcoming',
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  source_url text,
  supersedes_event_key text,
  is_superseded boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_timeline_mission_check
    check (mission_key in ('blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4')),
  constraint blue_origin_timeline_source_type_check
    check (source_type in ('blue-origin-official', 'government-record', 'll2-cache', 'curated-fallback', 'social')),
  constraint blue_origin_timeline_confidence_check
    check (confidence in ('high', 'medium', 'low')),
  constraint blue_origin_timeline_status_check
    check (status in ('completed', 'upcoming', 'tentative', 'superseded'))
);

create index if not exists blue_origin_timeline_events_mission_time_idx on public.blue_origin_timeline_events(mission_key, event_time desc nulls last);
create index if not exists blue_origin_timeline_events_announced_time_idx on public.blue_origin_timeline_events(announced_time desc);
create index if not exists blue_origin_timeline_events_source_type_idx on public.blue_origin_timeline_events(source_type);

create table if not exists public.blue_origin_mission_snapshots (
  mission_key text primary key,
  generated_at timestamptz not null default now(),
  last_updated timestamptz,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  constraint blue_origin_mission_snapshots_mission_key_check
    check (mission_key in ('blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4'))
);

create table if not exists public.blue_origin_passengers (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null,
  flight_code text,
  flight_slug text,
  name text not null,
  name_normalized text generated always as (lower(name)) stored,
  role text,
  nationality text,
  launch_id text,
  launch_name text,
  launch_date timestamptz,
  source text not null default 'derived',
  confidence text not null default 'medium',
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint blue_origin_passengers_mission_check
    check (mission_key in ('blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4')),
  constraint blue_origin_passengers_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create unique index if not exists blue_origin_passengers_launch_name_key on public.blue_origin_passengers(launch_id, name_normalized);
create index if not exists blue_origin_passengers_mission_date_idx on public.blue_origin_passengers(mission_key, launch_date desc nulls last);

create table if not exists public.blue_origin_payloads (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null,
  flight_code text,
  flight_slug text,
  name text not null,
  name_normalized text generated always as (lower(name)) stored,
  payload_type text,
  orbit text,
  agency text,
  launch_id text,
  launch_name text,
  launch_date timestamptz,
  source text not null default 'derived',
  confidence text not null default 'medium',
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint blue_origin_payloads_mission_check
    check (mission_key in ('blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4')),
  constraint blue_origin_payloads_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create unique index if not exists blue_origin_payloads_launch_name_key on public.blue_origin_payloads(launch_id, name_normalized);
create index if not exists blue_origin_payloads_mission_date_idx on public.blue_origin_payloads(mission_key, launch_date desc nulls last);

create table if not exists public.blue_origin_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_key text not null unique,
  mission_key text not null,
  title text not null,
  agency text,
  customer text,
  amount numeric,
  awarded_on date,
  description text,
  source_url text,
  source_label text,
  status text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_contracts_mission_check
    check (mission_key in ('blue-origin-program', 'new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4'))
);

create index if not exists blue_origin_contracts_mission_idx on public.blue_origin_contracts(mission_key, awarded_on desc nulls last);
create index if not exists blue_origin_contracts_updated_idx on public.blue_origin_contracts(updated_at desc);

alter table public.blue_origin_source_documents enable row level security;
alter table public.blue_origin_ingest_checkpoints enable row level security;
alter table public.blue_origin_timeline_events enable row level security;
alter table public.blue_origin_mission_snapshots enable row level security;
alter table public.blue_origin_passengers enable row level security;
alter table public.blue_origin_payloads enable row level security;
alter table public.blue_origin_contracts enable row level security;

drop policy if exists "public read blue origin source documents" on public.blue_origin_source_documents;
create policy "public read blue origin source documents" on public.blue_origin_source_documents
  for select using (true);

drop policy if exists "service role manage blue origin source documents" on public.blue_origin_source_documents;
create policy "service role manage blue origin source documents" on public.blue_origin_source_documents
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin ingest checkpoints" on public.blue_origin_ingest_checkpoints;
create policy "public read blue origin ingest checkpoints" on public.blue_origin_ingest_checkpoints
  for select using (true);

drop policy if exists "service role manage blue origin ingest checkpoints" on public.blue_origin_ingest_checkpoints;
create policy "service role manage blue origin ingest checkpoints" on public.blue_origin_ingest_checkpoints
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin timeline" on public.blue_origin_timeline_events;
create policy "public read blue origin timeline" on public.blue_origin_timeline_events
  for select using (true);

drop policy if exists "service role manage blue origin timeline" on public.blue_origin_timeline_events;
create policy "service role manage blue origin timeline" on public.blue_origin_timeline_events
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin mission snapshots" on public.blue_origin_mission_snapshots;
create policy "public read blue origin mission snapshots" on public.blue_origin_mission_snapshots
  for select using (true);

drop policy if exists "service role manage blue origin mission snapshots" on public.blue_origin_mission_snapshots;
create policy "service role manage blue origin mission snapshots" on public.blue_origin_mission_snapshots
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin passengers" on public.blue_origin_passengers;
create policy "public read blue origin passengers" on public.blue_origin_passengers
  for select using (true);

drop policy if exists "service role manage blue origin passengers" on public.blue_origin_passengers;
create policy "service role manage blue origin passengers" on public.blue_origin_passengers
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin payloads" on public.blue_origin_payloads;
create policy "public read blue origin payloads" on public.blue_origin_payloads
  for select using (true);

drop policy if exists "service role manage blue origin payloads" on public.blue_origin_payloads;
create policy "service role manage blue origin payloads" on public.blue_origin_payloads
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin contracts" on public.blue_origin_contracts;
create policy "public read blue origin contracts" on public.blue_origin_contracts
  for select using (true);

drop policy if exists "service role manage blue origin contracts" on public.blue_origin_contracts;
create policy "service role manage blue origin contracts" on public.blue_origin_contracts
  for all to service_role using (true) with check (true);

insert into public.system_settings (key, value)
values
  ('blue_origin_bootstrap_job_enabled', 'true'::jsonb),
  ('blue_origin_missions_job_enabled', 'true'::jsonb),
  ('blue_origin_news_job_enabled', 'true'::jsonb),
  ('blue_origin_media_job_enabled', 'true'::jsonb),
  ('blue_origin_passengers_job_enabled', 'true'::jsonb),
  ('blue_origin_payloads_job_enabled', 'true'::jsonb),
  ('blue_origin_contracts_job_enabled', 'true'::jsonb),
  ('blue_origin_social_job_enabled', 'true'::jsonb),
  ('blue_origin_snapshot_job_enabled', 'true'::jsonb),
  ('blue_origin_program_mode', '"weekly"'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

insert into public.blue_origin_ingest_checkpoints (source_key, source_type, status)
values
  ('blue_origin_bootstrap', 'blue-origin-official', 'pending'),
  ('blue_origin_missions', 'blue-origin-official', 'pending'),
  ('blue_origin_news', 'blue-origin-official', 'pending'),
  ('blue_origin_media', 'blue-origin-official', 'pending'),
  ('blue_origin_passengers', 'll2-cache', 'pending'),
  ('blue_origin_payloads', 'll2-cache', 'pending'),
  ('blue_origin_contracts', 'government-record', 'pending'),
  ('blue_origin_social', 'social', 'pending'),
  ('blue_origin_snapshot', 'curated-fallback', 'pending')
on conflict (source_key) do nothing;
