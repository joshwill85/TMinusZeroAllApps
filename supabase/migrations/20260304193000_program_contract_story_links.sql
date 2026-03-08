-- Canonical contract-story linkage read model shared by Artemis, SpaceX, and Blue Origin hubs.

create table if not exists public.program_contract_story_links (
  id uuid primary key default gen_random_uuid(),
  story_key text not null unique,
  program_scope text not null,
  primary_usaspending_award_id text,
  primary_piid text,
  primary_contract_key text,
  primary_solicitation_id text,
  primary_notice_id text,
  mission_key text,
  recipient text,
  title text,
  awarded_on date,
  obligated_amount numeric,
  match_strategy text not null,
  match_confidence numeric not null default 0,
  match_evidence jsonb not null default '{}'::jsonb,
  action_count int not null default 0,
  notice_count int not null default 0,
  spending_point_count int not null default 0,
  bidder_count int not null default 0,
  latest_action_date date,
  latest_notice_date date,
  latest_spending_fiscal_year int,
  latest_spending_fiscal_month int,
  has_full_story boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_contract_story_links_scope_check
    check (program_scope in ('artemis', 'spacex', 'blue-origin')),
  constraint program_contract_story_links_match_strategy_check
    check (match_strategy in ('exact_award_id', 'exact_piid', 'exact_solicitation', 'heuristic_multi_signal')),
  constraint program_contract_story_links_match_confidence_check
    check (match_confidence >= 0 and match_confidence <= 1)
);

create index if not exists program_contract_story_links_scope_award_idx
  on public.program_contract_story_links(program_scope, primary_usaspending_award_id);

create index if not exists program_contract_story_links_scope_piid_idx
  on public.program_contract_story_links(program_scope, primary_piid);

create index if not exists program_contract_story_links_scope_solicitation_idx
  on public.program_contract_story_links(program_scope, primary_solicitation_id);

create index if not exists program_contract_story_links_scope_notice_idx
  on public.program_contract_story_links(program_scope, primary_notice_id);

create index if not exists program_contract_story_links_scope_updated_idx
  on public.program_contract_story_links(program_scope, updated_at desc);

alter table public.program_contract_story_links enable row level security;

drop policy if exists "public read program contract story links" on public.program_contract_story_links;
create policy "public read program contract story links" on public.program_contract_story_links
  for select using (true);

drop policy if exists "service role manage program contract story links" on public.program_contract_story_links;
create policy "service role manage program contract story links" on public.program_contract_story_links
  for all to service_role using (true) with check (true);

insert into public.system_settings (key, value)
values
  ('contract_story_enrichment_enabled', 'true'::jsonb),
  ('contract_story_enrichment_artemis_enabled', 'true'::jsonb),
  ('contract_story_enrichment_spacex_enabled', 'true'::jsonb),
  ('contract_story_enrichment_blue_origin_enabled', 'true'::jsonb),
  ('contract_story_sync_job_enabled', 'true'::jsonb),
  ('contract_story_sync_batch_limit', '2000'::jsonb)
on conflict (key) do update set value = excluded.value;
