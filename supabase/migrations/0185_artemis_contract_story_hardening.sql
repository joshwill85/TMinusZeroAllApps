-- Artemis contract-story data hardening: normalized contract spine + notices + spending overlays.
-- Phase 1 is data-first; public UI can adopt these tables incrementally.

create table if not exists public.artemis_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_key text not null unique,
  piid text not null,
  referenced_idv_piid text,
  parent_award_id text,
  agency_code text,
  subtier_code text,
  mission_key text not null default 'program',
  awardee_name text,
  awardee_uei text,
  contract_type text not null default 'definitive',
  description text,
  base_award_date date,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_contracts_mission_key_check
    check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii')),
  constraint artemis_contracts_contract_type_check
    check (contract_type in ('definitive', 'idv', 'order', 'unknown'))
);

create index if not exists artemis_contracts_piid_idx
  on public.artemis_contracts(piid);

create index if not exists artemis_contracts_piid_ref_idx
  on public.artemis_contracts(piid, referenced_idv_piid);

create index if not exists artemis_contracts_mission_idx
  on public.artemis_contracts(mission_key, updated_at desc);

create index if not exists artemis_contracts_source_document_idx
  on public.artemis_contracts(source_document_id);

create table if not exists public.artemis_contract_actions (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.artemis_contracts(id) on delete cascade,
  action_key text not null unique,
  mod_number text not null default '0',
  action_date date,
  obligation_delta numeric,
  obligation_cumulative numeric,
  solicitation_id text,
  sam_notice_id text,
  source text not null default 'usaspending',
  source_record_hash text,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_contract_actions_source_check
    check (source in ('sam_contract_awards', 'sam_data_services', 'usaspending', 'manual'))
);

create index if not exists artemis_contract_actions_contract_idx
  on public.artemis_contract_actions(contract_id, action_date desc nulls last);

create index if not exists artemis_contract_actions_solicitation_idx
  on public.artemis_contract_actions(solicitation_id);

create index if not exists artemis_contract_actions_source_document_idx
  on public.artemis_contract_actions(source_document_id);

create table if not exists public.artemis_opportunity_notices (
  id uuid primary key default gen_random_uuid(),
  notice_id text not null unique,
  solicitation_id text,
  ptype text,
  title text,
  posted_date date,
  response_deadline timestamptz,
  latest_active_version boolean not null default true,
  awardee_name text,
  award_amount numeric,
  notice_url text,
  attachment_count int,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists artemis_opportunity_notices_solicitation_idx
  on public.artemis_opportunity_notices(solicitation_id, posted_date desc nulls last);

create index if not exists artemis_opportunity_notices_ptype_idx
  on public.artemis_opportunity_notices(ptype, posted_date desc nulls last);

create index if not exists artemis_opportunity_notices_source_document_idx
  on public.artemis_opportunity_notices(source_document_id);

create table if not exists public.artemis_contract_budget_map (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.artemis_contracts(id) on delete cascade,
  budget_line_id uuid not null references public.artemis_budget_lines(id) on delete cascade,
  match_method text not null,
  confidence numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_contract_budget_map_method_check
    check (match_method in ('rule', 'keyword', 'manual')),
  constraint artemis_contract_budget_map_confidence_check
    check (confidence >= 0 and confidence <= 1),
  unique (contract_id, budget_line_id, match_method)
);

create index if not exists artemis_contract_budget_map_budget_line_idx
  on public.artemis_contract_budget_map(budget_line_id, confidence desc);

create table if not exists public.artemis_spending_timeseries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.artemis_contracts(id) on delete cascade,
  fiscal_year int not null,
  fiscal_month int not null,
  obligations numeric,
  outlays numeric,
  source text not null default 'usaspending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_spending_timeseries_month_check
    check (fiscal_month between 1 and 12),
  constraint artemis_spending_timeseries_source_check
    check (source in ('usaspending', 'sam', 'manual')),
  unique (contract_id, fiscal_year, fiscal_month, source)
);

create index if not exists artemis_spending_timeseries_contract_idx
  on public.artemis_spending_timeseries(contract_id, fiscal_year desc, fiscal_month desc);

alter table public.artemis_contracts enable row level security;
alter table public.artemis_contract_actions enable row level security;
alter table public.artemis_opportunity_notices enable row level security;
alter table public.artemis_contract_budget_map enable row level security;
alter table public.artemis_spending_timeseries enable row level security;

drop policy if exists "public read artemis contracts" on public.artemis_contracts;
create policy "public read artemis contracts" on public.artemis_contracts
  for select using (true);

drop policy if exists "service role manage artemis contracts" on public.artemis_contracts;
create policy "service role manage artemis contracts" on public.artemis_contracts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "public read artemis contract actions" on public.artemis_contract_actions;
create policy "public read artemis contract actions" on public.artemis_contract_actions
  for select using (true);

drop policy if exists "service role manage artemis contract actions" on public.artemis_contract_actions;
create policy "service role manage artemis contract actions" on public.artemis_contract_actions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "public read artemis opportunity notices" on public.artemis_opportunity_notices;
create policy "public read artemis opportunity notices" on public.artemis_opportunity_notices
  for select using (true);

drop policy if exists "service role manage artemis opportunity notices" on public.artemis_opportunity_notices;
create policy "service role manage artemis opportunity notices" on public.artemis_opportunity_notices
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "public read artemis contract budget map" on public.artemis_contract_budget_map;
create policy "public read artemis contract budget map" on public.artemis_contract_budget_map
  for select using (true);

drop policy if exists "service role manage artemis contract budget map" on public.artemis_contract_budget_map;
create policy "service role manage artemis contract budget map" on public.artemis_contract_budget_map
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "public read artemis spending timeseries" on public.artemis_spending_timeseries;
create policy "public read artemis spending timeseries" on public.artemis_spending_timeseries
  for select using (true);

drop policy if exists "service role manage artemis spending timeseries" on public.artemis_spending_timeseries;
create policy "service role manage artemis spending timeseries" on public.artemis_spending_timeseries
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

insert into public.system_settings (key, value)
values
  ('artemis_contracts_job_enabled', 'true'::jsonb),
  ('artemis_sam_daily_quota_limit', '10'::jsonb),
  ('artemis_sam_daily_quota_reserve', '2'::jsonb),
  ('artemis_sam_backfill_start_fy', '2010'::jsonb),
  ('artemis_contracts_ingest_mode', '"incremental"'::jsonb),
  ('artemis_sam_opportunities_api_url', '"https://api.sam.gov/prod/opportunities/v2/search"'::jsonb),
  ('artemis_sam_contract_awards_api_url', '"https://api.sam.gov/prod/data-services/v1/contract-awards/search"'::jsonb),
  ('artemis_sam_quota_state', jsonb_build_object('date', null, 'used', 0, 'limit', 10, 'reserve', 2))
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

insert into public.artemis_ingest_checkpoints (source_key, source_type, status, records_ingested, updated_at)
values
  ('artemis_contracts_normalized', 'procurement', 'complete', 0, now()),
  ('sam_contract_awards', 'procurement', 'complete', 0, now()),
  ('sam_opportunities', 'procurement', 'complete', 0, now()),
  ('usaspending_contract_spending', 'procurement', 'complete', 0, now())
on conflict (source_key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_contracts_ingest') then
    perform cron.unschedule('artemis_contracts_ingest');
  end if;

  -- Ten daily runs to respect strict non-federal SAM request ceilings.
  perform cron.schedule(
    'artemis_contracts_ingest',
    '7 0,2,4,6,8,10,12,14,16,18 * * *',
    $job$select public.invoke_edge_job('artemis-contracts-ingest');$job$
  );
end $$;
