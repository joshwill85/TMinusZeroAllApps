-- Store NAVCEN Broadcast Notice to Mariners (BNM) messages and parsed hazard areas.
-- These advisories can be updated/cancelled; we store each distinct version historically (by sha256).

create table if not exists public.navcen_bnm_messages (
  id uuid primary key default gen_random_uuid(),

  -- Source identity
  source text not null default 'navcen',
  district int not null default 7,
  navcen_guid text not null,
  message_url text not null,

  -- Fetch metadata (used for periodic checks + dedupe)
  fetched_at timestamptz not null default now(),
  http_status int,
  etag text,
  last_modified timestamptz,
  sha256 text not null,
  bytes int,

  -- Provenance / discovery context (RSS -> bulletin -> NAVCEN message)
  rss_feed_url text,
  govdelivery_topic_id text,
  govdelivery_bulletin_url text,
  rss_item_title text,
  rss_item_published_at timestamptz,

  -- Parsed header fields (best-effort)
  title text,
  category text,
  issued_at timestamptz,
  valid_start timestamptz,
  valid_end timestamptz,
  valid_window tstzrange generated always as (tstzrange(valid_start, valid_end, '[)')) stored,

  -- Raw extraction for forward-compatibility / re-parsing
  raw_text text,
  raw_html text,
  raw jsonb,
  parse_version text not null default 'v1',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (navcen_guid, sha256)
);

create index if not exists navcen_bnm_messages_navcen_guid_idx on public.navcen_bnm_messages(navcen_guid);
create index if not exists navcen_bnm_messages_fetched_at_idx on public.navcen_bnm_messages(fetched_at desc);
create index if not exists navcen_bnm_messages_valid_window_gist on public.navcen_bnm_messages using gist (valid_window);

create table if not exists public.navcen_bnm_hazard_areas (
  id uuid primary key default gen_random_uuid(),

  message_id uuid not null references public.navcen_bnm_messages(id) on delete cascade,
  navcen_guid text not null,

  area_name text not null,
  valid_start timestamptz,
  valid_end timestamptz,
  valid_window tstzrange generated always as (tstzrange(valid_start, valid_end, '[)')) stored,

  geometry jsonb,
  confidence int check (confidence is null or (confidence between 0 and 100)),
  raw_text_snippet text,
  data jsonb,
  parse_version text not null default 'v1',

  -- Optional stored match to a launch (helps avoid re-matching on every run)
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'ambiguous', 'manual')),
  matched_launch_id uuid references public.launches(id) on delete set null,
  match_confidence int check (match_confidence is null or (match_confidence between 0 and 100)),
  match_strategy text,
  match_meta jsonb,
  matched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (message_id, area_name)
);

create index if not exists navcen_bnm_hazard_areas_navcen_guid_idx on public.navcen_bnm_hazard_areas(navcen_guid);
create index if not exists navcen_bnm_hazard_areas_message_id_idx on public.navcen_bnm_hazard_areas(message_id);
create index if not exists navcen_bnm_hazard_areas_fetched_at_idx on public.navcen_bnm_hazard_areas(created_at desc);
create index if not exists navcen_bnm_hazard_areas_valid_window_gist on public.navcen_bnm_hazard_areas using gist (valid_window);
create index if not exists navcen_bnm_hazard_areas_matched_launch_id_idx on public.navcen_bnm_hazard_areas(matched_launch_id);

alter table public.navcen_bnm_messages enable row level security;
alter table public.navcen_bnm_hazard_areas enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'navcen_bnm_messages' and policyname = 'admin read navcen bnm messages'
  ) then
    create policy "admin read navcen bnm messages" on public.navcen_bnm_messages
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'navcen_bnm_hazard_areas' and policyname = 'admin read navcen bnm hazard areas'
  ) then
    create policy "admin read navcen bnm hazard areas" on public.navcen_bnm_hazard_areas
      for select using (public.is_admin());
  end if;
end $$;

