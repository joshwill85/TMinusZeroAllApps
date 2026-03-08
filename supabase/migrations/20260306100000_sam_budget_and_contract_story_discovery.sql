-- Align SAM scheduling/budgets to the non-federal 10/day key and add discovery-side read models.

insert into public.system_settings (key, value)
values
  ('artemis_sam_daily_quota_limit', to_jsonb(10)),
  ('artemis_sam_daily_quota_reserve', to_jsonb(0)),
  ('artemis_sam_max_requests_per_run', to_jsonb(10)),
  ('artemis_sam_probe_both_endpoints_first', to_jsonb(false)),
  ('artemis_sam_single_pass_per_endpoint', to_jsonb(true)),
  ('artemis_sam_entity_sync_enabled', to_jsonb(false)),
  ('artemis_sam_contract_awards_extract_enabled', to_jsonb(false)),
  ('artemis_sam_query_cooldown_days_invalid_request', to_jsonb(7))
on conflict (key) do update
set value = excluded.value;

delete from public.sam_query_fingerprints
where endpoint = 'contract-awards'
  and (
    query_params ? 'awardingSubTier'
    or query_params ? 'awarding_sub_tier'
  );

create table if not exists public.program_contract_story_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_key text not null unique,
  program_scope text not null,
  source_type text not null,
  source_record_key text not null,
  candidate_story_key text,
  confidence_tier text not null,
  confidence_score numeric not null default 0,
  signals jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_contract_story_candidates_scope_check
    check (program_scope in ('artemis', 'spacex', 'blue-origin')),
  constraint program_contract_story_candidates_source_type_check
    check (source_type in ('sam-contract-award', 'sam-opportunity')),
  constraint program_contract_story_candidates_confidence_tier_check
    check (confidence_tier in ('exact', 'candidate', 'discovery-only')),
  constraint program_contract_story_candidates_status_check
    check (status in ('active', 'promoted', 'suppressed')),
  constraint program_contract_story_candidates_confidence_score_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create index if not exists program_contract_story_candidates_scope_status_idx
  on public.program_contract_story_candidates(program_scope, status, confidence_tier, updated_at desc);

create index if not exists program_contract_story_candidates_source_idx
  on public.program_contract_story_candidates(source_type, source_record_key);

create index if not exists program_contract_story_candidates_story_idx
  on public.program_contract_story_candidates(candidate_story_key)
  where candidate_story_key is not null;

alter table public.program_contract_story_candidates enable row level security;

drop policy if exists "service role manage program contract story candidates" on public.program_contract_story_candidates;
create policy "service role manage program contract story candidates" on public.program_contract_story_candidates
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.program_contract_story_discoveries (
  id uuid primary key default gen_random_uuid(),
  discovery_key text not null unique,
  program_scope text not null,
  source_type text not null,
  source_record_key text not null,
  title text,
  summary text,
  entity_name text,
  agency_name text,
  piid text,
  solicitation_id text,
  notice_id text,
  usaspending_award_id text,
  source_url text,
  published_at timestamptz,
  amount numeric,
  join_status text not null default 'unlinked',
  best_candidate_story_key text,
  relevance_score numeric not null default 0,
  relevance_signals jsonb not null default '[]'::jsonb,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_contract_story_discoveries_scope_check
    check (program_scope in ('artemis', 'spacex', 'blue-origin')),
  constraint program_contract_story_discoveries_source_type_check
    check (source_type in ('sam-contract-award', 'sam-opportunity')),
  constraint program_contract_story_discoveries_join_status_check
    check (join_status in ('unlinked', 'candidate', 'linked', 'suppressed')),
  constraint program_contract_story_discoveries_relevance_score_check
    check (relevance_score >= 0 and relevance_score <= 1)
);

create index if not exists program_contract_story_discoveries_scope_status_idx
  on public.program_contract_story_discoveries(program_scope, join_status, published_at desc, updated_at desc);

create index if not exists program_contract_story_discoveries_source_idx
  on public.program_contract_story_discoveries(source_type, source_record_key);

create index if not exists program_contract_story_discoveries_story_idx
  on public.program_contract_story_discoveries(best_candidate_story_key)
  where best_candidate_story_key is not null;

create index if not exists program_contract_story_discoveries_scope_identifier_idx
  on public.program_contract_story_discoveries(program_scope, piid, solicitation_id, notice_id);

alter table public.program_contract_story_discoveries enable row level security;

drop policy if exists "public read program contract story discoveries" on public.program_contract_story_discoveries;
create policy "public read program contract story discoveries" on public.program_contract_story_discoveries
  for select using (true);

drop policy if exists "service role manage program contract story discoveries" on public.program_contract_story_discoveries;
create policy "service role manage program contract story discoveries" on public.program_contract_story_discoveries
  for all
  to service_role
  using (true)
  with check (true);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_contracts_ingest') then
    perform cron.unschedule('artemis_contracts_ingest');
  end if;

  perform cron.schedule(
    'artemis_contracts_ingest',
    '17 5 * * *',
    $job$select public.invoke_edge_job('artemis-contracts-ingest');$job$
  );
end $$;
