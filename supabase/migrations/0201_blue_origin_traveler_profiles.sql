-- Blue Origin traveler profile consolidation model.
-- Adds canonical traveler profiles, source-level traveler blocks, and traveler slug linkage.

alter table public.blue_origin_passengers
  add column if not exists traveler_slug text;

create index if not exists blue_origin_passengers_traveler_slug_idx
  on public.blue_origin_passengers(traveler_slug);

create table if not exists public.blue_origin_travelers (
  id uuid primary key default gen_random_uuid(),
  traveler_slug text not null unique,
  canonical_name text not null,
  bio_short text,
  primary_image_url text,
  primary_profile_url text,
  nationality text,
  source_confidence text not null default 'medium',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_travelers_confidence_check
    check (source_confidence in ('high', 'medium', 'low'))
);

create index if not exists blue_origin_travelers_updated_at_idx
  on public.blue_origin_travelers(updated_at desc);

create table if not exists public.blue_origin_traveler_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  traveler_slug text not null references public.blue_origin_travelers(traveler_slug) on delete cascade,
  launch_id text,
  flight_code text,
  source_type text not null,
  source_url text,
  source_document_id uuid references public.blue_origin_source_documents(id) on delete set null,
  profile_url text,
  image_url text,
  bio_full text,
  bio_excerpt text,
  attribution jsonb not null default '{}'::jsonb,
  confidence text not null default 'medium',
  content_sha256 text,
  captured_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blue_origin_traveler_sources_confidence_check
    check (confidence in ('high', 'medium', 'low'))
);

create index if not exists blue_origin_traveler_sources_slug_idx
  on public.blue_origin_traveler_sources(traveler_slug);

create index if not exists blue_origin_traveler_sources_flight_code_idx
  on public.blue_origin_traveler_sources(flight_code);

create index if not exists blue_origin_traveler_sources_source_type_idx
  on public.blue_origin_traveler_sources(source_type);

create index if not exists blue_origin_traveler_sources_updated_at_idx
  on public.blue_origin_traveler_sources(updated_at desc);

alter table public.blue_origin_travelers enable row level security;
alter table public.blue_origin_traveler_sources enable row level security;

drop policy if exists "public read blue origin travelers" on public.blue_origin_travelers;
create policy "public read blue origin travelers" on public.blue_origin_travelers
  for select using (true);

drop policy if exists "service role manage blue origin travelers" on public.blue_origin_travelers;
create policy "service role manage blue origin travelers" on public.blue_origin_travelers
  for all to service_role using (true) with check (true);

drop policy if exists "public read blue origin traveler sources" on public.blue_origin_traveler_sources;
create policy "public read blue origin traveler sources" on public.blue_origin_traveler_sources
  for select using (true);

drop policy if exists "service role manage blue origin traveler sources" on public.blue_origin_traveler_sources;
create policy "service role manage blue origin traveler sources" on public.blue_origin_traveler_sources
  for all to service_role using (true) with check (true);
