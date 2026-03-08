-- Artemis source authority registry + unified content cards for articles/photos/social/data.

create table if not exists public.artemis_source_registry (
  source_key text primary key,
  source_type text not null,
  source_tier text not null default 'tier2',
  display_name text not null,
  base_url text,
  authority_score numeric(4, 3) not null default 0.5,
  relevance_weight numeric(4, 3) not null default 0.5,
  freshness_sla_minutes integer,
  poll_interval_minutes integer,
  active boolean not null default true,
  parser_version text not null default 'v1',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint artemis_source_registry_source_type_check
    check (source_type in ('nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media')),
  constraint artemis_source_registry_source_tier_check
    check (source_tier in ('tier1', 'tier2')),
  constraint artemis_source_registry_authority_score_check
    check (authority_score >= 0 and authority_score <= 1),
  constraint artemis_source_registry_relevance_weight_check
    check (relevance_weight >= 0 and relevance_weight <= 1)
);

create index if not exists artemis_source_registry_active_idx
  on public.artemis_source_registry(active, source_tier, source_type);

create table if not exists public.artemis_social_accounts (
  id bigserial primary key,
  platform text not null,
  handle text not null,
  handle_normalized text generated always as (lower(handle)) stored,
  mission_scope text not null default 'program',
  source_tier text not null default 'tier1',
  active boolean not null default true,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint artemis_social_accounts_platform_check
    check (platform in ('x', 'twitter', 'youtube', 'instagram', 'facebook', 'other')),
  constraint artemis_social_accounts_source_tier_check
    check (source_tier in ('tier1', 'tier2')),
  constraint artemis_social_accounts_mission_scope_check
    check (mission_scope in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'))
);

create unique index if not exists artemis_social_accounts_platform_handle_key
  on public.artemis_social_accounts(platform, handle_normalized);

create index if not exists artemis_social_accounts_active_idx
  on public.artemis_social_accounts(active, mission_scope, source_tier);

create table if not exists public.artemis_content_items (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  kind text not null,
  mission_key text not null,
  title text not null,
  summary text,
  url text not null,
  published_at timestamptz,
  captured_at timestamptz not null default now(),
  source_key text references public.artemis_source_registry(source_key) on delete set null,
  source_type text not null,
  source_class text not null,
  source_tier text not null default 'tier2',
  authority_score numeric(4, 3) not null default 0.5,
  relevance_score numeric(4, 3) not null default 0.5,
  freshness_score numeric(4, 3) not null default 0.5,
  overall_score numeric(4, 3) not null default 0.5,
  image_url text,
  external_id text,
  platform text,
  data_label text,
  data_value numeric,
  data_unit text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint artemis_content_items_kind_check
    check (kind in ('article', 'photo', 'social', 'data')),
  constraint artemis_content_items_mission_key_check
    check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii')),
  constraint artemis_content_items_source_type_check
    check (source_type in ('nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media')),
  constraint artemis_content_items_source_class_check
    check (source_class in ('nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media', 'll2-cache', 'curated-fallback')),
  constraint artemis_content_items_source_tier_check
    check (source_tier in ('tier1', 'tier2')),
  constraint artemis_content_items_authority_score_check
    check (authority_score >= 0 and authority_score <= 1),
  constraint artemis_content_items_relevance_score_check
    check (relevance_score >= 0 and relevance_score <= 1),
  constraint artemis_content_items_freshness_score_check
    check (freshness_score >= 0 and freshness_score <= 1),
  constraint artemis_content_items_overall_score_check
    check (overall_score >= 0 and overall_score <= 1)
);

create index if not exists artemis_content_items_kind_pub_idx
  on public.artemis_content_items(kind, published_at desc nulls last, captured_at desc);

create index if not exists artemis_content_items_mission_kind_idx
  on public.artemis_content_items(mission_key, kind, overall_score desc, published_at desc nulls last);

create index if not exists artemis_content_items_source_idx
  on public.artemis_content_items(source_tier, source_class, source_type, overall_score desc);

create index if not exists artemis_content_items_source_key_idx
  on public.artemis_content_items(source_key);

create table if not exists public.artemis_content_scores (
  id bigserial primary key,
  content_item_id uuid not null references public.artemis_content_items(id) on delete cascade,
  evaluated_at timestamptz not null default now(),
  authority_score numeric(4, 3) not null,
  relevance_score numeric(4, 3) not null,
  freshness_score numeric(4, 3) not null,
  stability_score numeric(4, 3) not null,
  risk_score numeric(4, 3) not null,
  overall_score numeric(4, 3) not null,
  weights jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  constraint artemis_content_scores_authority_score_check
    check (authority_score >= 0 and authority_score <= 1),
  constraint artemis_content_scores_relevance_score_check
    check (relevance_score >= 0 and relevance_score <= 1),
  constraint artemis_content_scores_freshness_score_check
    check (freshness_score >= 0 and freshness_score <= 1),
  constraint artemis_content_scores_stability_score_check
    check (stability_score >= 0 and stability_score <= 1),
  constraint artemis_content_scores_risk_score_check
    check (risk_score >= 0 and risk_score <= 1),
  constraint artemis_content_scores_overall_score_check
    check (overall_score >= 0 and overall_score <= 1)
);

create index if not exists artemis_content_scores_item_time_idx
  on public.artemis_content_scores(content_item_id, evaluated_at desc);

alter table public.artemis_source_registry enable row level security;
alter table public.artemis_social_accounts enable row level security;
alter table public.artemis_content_items enable row level security;
alter table public.artemis_content_scores enable row level security;

drop policy if exists "public read artemis source registry" on public.artemis_source_registry;
create policy "public read artemis source registry" on public.artemis_source_registry
  for select using (true);

drop policy if exists "service role manage artemis source registry" on public.artemis_source_registry;
create policy "service role manage artemis source registry" on public.artemis_source_registry
  for all to service_role using (true) with check (true);

drop policy if exists "public read artemis social accounts" on public.artemis_social_accounts;
create policy "public read artemis social accounts" on public.artemis_social_accounts
  for select using (true);

drop policy if exists "service role manage artemis social accounts" on public.artemis_social_accounts;
create policy "service role manage artemis social accounts" on public.artemis_social_accounts
  for all to service_role using (true) with check (true);

drop policy if exists "public read artemis content items" on public.artemis_content_items;
create policy "public read artemis content items" on public.artemis_content_items
  for select using (true);

drop policy if exists "service role manage artemis content items" on public.artemis_content_items;
create policy "service role manage artemis content items" on public.artemis_content_items
  for all to service_role using (true) with check (true);

drop policy if exists "admin read artemis content scores" on public.artemis_content_scores;
create policy "admin read artemis content scores" on public.artemis_content_scores
  for select using (public.is_admin());

drop policy if exists "service role manage artemis content scores" on public.artemis_content_scores;
create policy "service role manage artemis content scores" on public.artemis_content_scores
  for all to service_role using (true) with check (true);

insert into public.artemis_source_registry (
  source_key,
  source_type,
  source_tier,
  display_name,
  base_url,
  authority_score,
  relevance_weight,
  freshness_sla_minutes,
  poll_interval_minutes,
  active,
  parser_version,
  metadata
)
values
  ('nasa_campaign_pages', 'nasa_primary', 'tier1', 'NASA Artemis campaign pages', 'https://www.nasa.gov/artemis', 0.98, 0.95, 360, 360, true, 'v1', jsonb_build_object('class', 'nasa_primary')),
  ('nasa_blog_posts', 'nasa_primary', 'tier1', 'NASA Artemis blog', 'https://www.nasa.gov/blogs/artemis/', 0.96, 0.9, 180, 60, true, 'v1', jsonb_build_object('class', 'nasa_primary')),
  ('nasa_reference_timelines', 'nasa_primary', 'tier1', 'NASA reference timelines', 'https://www.nasa.gov/reference/', 0.97, 0.9, 720, 360, true, 'v1', jsonb_build_object('class', 'nasa_primary')),
  ('nasa_rss', 'nasa_primary', 'tier1', 'NASA Artemis RSS', 'https://www.nasa.gov/missions/artemis/feed/', 0.97, 0.95, 120, 60, true, 'v1', jsonb_build_object('class', 'nasa_primary')),
  ('nasa_media_assets', 'media', 'tier1', 'NASA Images API', 'https://images-api.nasa.gov', 0.95, 0.9, 360, 180, true, 'v1', jsonb_build_object('class', 'media')),
  ('oig_reports', 'oversight', 'tier1', 'NASA OIG audits', 'https://oig.nasa.gov/audits/', 0.95, 0.85, 1440, 720, true, 'v1', jsonb_build_object('class', 'oversight')),
  ('gao_reports', 'oversight', 'tier2', 'GAO Artemis reports', 'https://www.gao.gov', 0.9, 0.8, 1440, 720, true, 'v1', jsonb_build_object('class', 'oversight')),
  ('nasa_budget_docs', 'budget', 'tier1', 'NASA budget documents', 'https://www.nasa.gov/budget/', 0.95, 0.85, 10080, 1440, true, 'v1', jsonb_build_object('class', 'budget')),
  ('usaspending_awards', 'procurement', 'tier1', 'USASpending awards', 'https://api.usaspending.gov', 0.93, 0.8, 2880, 1440, true, 'v1', jsonb_build_object('class', 'procurement')),
  ('moon_to_mars_docs', 'technical', 'tier1', 'Moon to Mars architecture docs', 'https://www.nasa.gov', 0.92, 0.75, 10080, 10080, true, 'v1', jsonb_build_object('class', 'technical')),
  ('ntrs_api', 'technical', 'tier1', 'NASA NTRS search', 'https://ntrs.nasa.gov', 0.92, 0.7, 10080, 10080, true, 'v1', jsonb_build_object('class', 'technical')),
  ('techport_api', 'technical', 'tier1', 'NASA TechPort', 'https://techport.nasa.gov', 0.9, 0.7, 10080, 10080, true, 'v1', jsonb_build_object('class', 'technical')),
  ('snapi_artemis', 'technical', 'tier2', 'SNAPI Artemis relevance feed', 'https://api.spaceflightnewsapi.net', 0.62, 0.65, 240, 120, true, 'v1', jsonb_build_object('class', 'technical')),
  ('launch_social_links', 'media', 'tier1', 'Launch-linked official social posts', 'https://x.com', 0.9, 0.85, 180, 120, true, 'v1', jsonb_build_object('class', 'media')),
  ('ll2_cache', 'technical', 'tier1', 'Launch Library 2 cache', 'https://ll.thespacedevs.com', 0.88, 0.9, 60, 60, true, 'v1', jsonb_build_object('class', 'll2-cache'))
on conflict (source_key) do update set
  source_type = excluded.source_type,
  source_tier = excluded.source_tier,
  display_name = excluded.display_name,
  base_url = excluded.base_url,
  authority_score = excluded.authority_score,
  relevance_weight = excluded.relevance_weight,
  freshness_sla_minutes = excluded.freshness_sla_minutes,
  poll_interval_minutes = excluded.poll_interval_minutes,
  active = excluded.active,
  parser_version = excluded.parser_version,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.artemis_social_accounts (platform, handle, mission_scope, source_tier, active, notes, metadata)
values
  ('x', 'NASA', 'program', 'tier1', true, 'Primary NASA account', '{}'::jsonb),
  ('x', 'NASAArtemis', 'program', 'tier1', true, 'NASA Artemis campaign account', '{}'::jsonb),
  ('x', 'NASA_Orion', 'program', 'tier1', true, 'NASA Orion account', '{}'::jsonb),
  ('x', 'NASA_SLS', 'program', 'tier1', true, 'NASA SLS account', '{}'::jsonb),
  ('x', 'NASA_Johnson', 'program', 'tier1', true, 'NASA Johnson account', '{}'::jsonb),
  ('x', 'NASA_Kennedy', 'program', 'tier1', true, 'NASA Kennedy account', '{}'::jsonb),
  ('x', 'SpaceX', 'program', 'tier2', true, 'Prime contractor account used for launch-linked cross-reference', '{}'::jsonb),
  ('x', 'blueorigin', 'program', 'tier2', true, 'Prime contractor account used for program context', '{}'::jsonb),
  ('x', 'ESA', 'artemis-ii', 'tier2', true, 'Partner agency account', '{}'::jsonb),
  ('x', 'CSA_ASC', 'artemis-ii', 'tier2', true, 'Canadian Space Agency account', '{}'::jsonb)
on conflict (platform, handle_normalized) do update set
  mission_scope = excluded.mission_scope,
  source_tier = excluded.source_tier,
  active = excluded.active,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();
