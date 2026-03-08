-- Artemis program data model for timeline/evidence UI and ingestion jobs.

create table if not exists public.artemis_source_documents (
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

create index if not exists artemis_source_documents_source_key_idx on public.artemis_source_documents(source_key);
create index if not exists artemis_source_documents_source_type_idx on public.artemis_source_documents(source_type);
create index if not exists artemis_source_documents_fetched_at_idx on public.artemis_source_documents(fetched_at desc);

create table if not exists public.artemis_entities (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null unique,
  name text not null,
  entity_type text not null,
  description text,
  related_missions text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artemis_entities_type_idx on public.artemis_entities(entity_type);

create table if not exists public.artemis_timeline_events (
  id uuid primary key default gen_random_uuid(),
  mission_key text not null,
  title text not null,
  summary text,
  event_time timestamptz,
  event_time_precision text not null default 'unknown',
  announced_time timestamptz not null,
  source_type text not null,
  confidence text not null,
  source_document_id uuid not null references public.artemis_source_documents(id) on delete cascade,
  source_url text,
  supersedes_event_id uuid references public.artemis_timeline_events(id) on delete set null,
  is_superseded boolean not null default false,
  fingerprint text not null unique,
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_timeline_events_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii')),
  constraint artemis_timeline_events_source_type_check check (source_type in ('nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media')),
  constraint artemis_timeline_events_confidence_check check (confidence in ('primary', 'oversight', 'secondary'))
);

create index if not exists artemis_timeline_events_mission_time_idx on public.artemis_timeline_events(mission_key, event_time desc nulls last);
create index if not exists artemis_timeline_events_announced_time_idx on public.artemis_timeline_events(announced_time desc);
create index if not exists artemis_timeline_events_source_type_idx on public.artemis_timeline_events(source_type);
create index if not exists artemis_timeline_events_supersedes_idx on public.artemis_timeline_events(supersedes_event_id);

create table if not exists public.artemis_budget_lines (
  id uuid primary key default gen_random_uuid(),
  fiscal_year int,
  agency text,
  program text,
  line_item text,
  amount_requested numeric,
  amount_enacted numeric,
  announced_time timestamptz,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artemis_budget_lines_fiscal_year_idx on public.artemis_budget_lines(fiscal_year desc);
create index if not exists artemis_budget_lines_program_idx on public.artemis_budget_lines(program);

create table if not exists public.artemis_procurement_awards (
  id uuid primary key default gen_random_uuid(),
  usaspending_award_id text,
  award_title text,
  recipient text,
  obligated_amount numeric,
  awarded_on date,
  mission_key text,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (usaspending_award_id, mission_key),
  constraint artemis_procurement_awards_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii'))
);

create index if not exists artemis_procurement_awards_awarded_on_idx on public.artemis_procurement_awards(awarded_on desc);

create table if not exists public.artemis_mission_snapshots (
  mission_key text primary key,
  generated_at timestamptz not null default now(),
  last_updated timestamptz,
  snapshot jsonb not null,
  updated_at timestamptz not null default now(),
  constraint artemis_mission_snapshots_mission_key_check check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii'))
);

alter table public.artemis_source_documents enable row level security;
alter table public.artemis_entities enable row level security;
alter table public.artemis_timeline_events enable row level security;
alter table public.artemis_budget_lines enable row level security;
alter table public.artemis_procurement_awards enable row level security;
alter table public.artemis_mission_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_source_documents' and policyname = 'admin read artemis source documents'
  ) then
    create policy "admin read artemis source documents" on public.artemis_source_documents
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_source_documents' and policyname = 'service role manage artemis source documents'
  ) then
    create policy "service role manage artemis source documents" on public.artemis_source_documents
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_entities' and policyname = 'public read artemis entities'
  ) then
    create policy "public read artemis entities" on public.artemis_entities
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_entities' and policyname = 'service role manage artemis entities'
  ) then
    create policy "service role manage artemis entities" on public.artemis_entities
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_timeline_events' and policyname = 'public read artemis timeline events'
  ) then
    create policy "public read artemis timeline events" on public.artemis_timeline_events
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_timeline_events' and policyname = 'service role manage artemis timeline events'
  ) then
    create policy "service role manage artemis timeline events" on public.artemis_timeline_events
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_budget_lines' and policyname = 'public read artemis budget lines'
  ) then
    create policy "public read artemis budget lines" on public.artemis_budget_lines
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_budget_lines' and policyname = 'service role manage artemis budget lines'
  ) then
    create policy "service role manage artemis budget lines" on public.artemis_budget_lines
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_procurement_awards' and policyname = 'public read artemis procurement awards'
  ) then
    create policy "public read artemis procurement awards" on public.artemis_procurement_awards
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_procurement_awards' and policyname = 'service role manage artemis procurement awards'
  ) then
    create policy "service role manage artemis procurement awards" on public.artemis_procurement_awards
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_mission_snapshots' and policyname = 'public read artemis mission snapshots'
  ) then
    create policy "public read artemis mission snapshots" on public.artemis_mission_snapshots
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'artemis_mission_snapshots' and policyname = 'service role manage artemis mission snapshots'
  ) then
    create policy "service role manage artemis mission snapshots" on public.artemis_mission_snapshots
      for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
