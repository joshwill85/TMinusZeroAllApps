-- SAM query partitioning and duplicate-query suppression for higher recall under fixed daily quota.

create table if not exists public.sam_query_fingerprints (
  fingerprint text primary key,
  endpoint text not null,
  query_params jsonb not null default '{}'::jsonb,
  last_status int,
  last_row_count int,
  last_error text,
  consecutive_failures int not null default 0,
  next_retry_at timestamptz,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sam_query_fingerprints_endpoint_check
    check (endpoint in ('contract-awards', 'opportunities')),
  constraint sam_query_fingerprints_consecutive_failures_check
    check (consecutive_failures >= 0)
);

create index if not exists sam_query_fingerprints_endpoint_idx
  on public.sam_query_fingerprints(endpoint, updated_at desc);

create index if not exists sam_query_fingerprints_retry_idx
  on public.sam_query_fingerprints(next_retry_at);

create index if not exists sam_query_fingerprints_cooldown_idx
  on public.sam_query_fingerprints(cooldown_until);

alter table public.sam_query_fingerprints enable row level security;

drop policy if exists "service role manage sam query fingerprints" on public.sam_query_fingerprints;
create policy "service role manage sam query fingerprints" on public.sam_query_fingerprints
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.sam_query_partitions (
  partition_key text primary key,
  endpoint text not null,
  program_scope text,
  keyword text,
  organization_name text,
  posted_from date,
  posted_to date,
  current_offset int not null default 0,
  status text not null default 'active',
  next_retry_at timestamptz,
  last_scanned_at timestamptz,
  last_http_status int,
  last_row_count int,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sam_query_partitions_endpoint_check
    check (endpoint in ('opportunities', 'contract-awards')),
  constraint sam_query_partitions_status_check
    check (status in ('active', 'paused', 'retired')),
  constraint sam_query_partitions_scope_check
    check (program_scope is null or program_scope in ('artemis', 'blue-origin', 'spacex', 'other')),
  constraint sam_query_partitions_offset_check
    check (current_offset >= 0),
  constraint sam_query_partitions_row_count_check
    check (last_row_count is null or last_row_count >= 0)
);

create index if not exists sam_query_partitions_scan_idx
  on public.sam_query_partitions(endpoint, status, last_scanned_at asc);

create index if not exists sam_query_partitions_retry_idx
  on public.sam_query_partitions(next_retry_at);

alter table public.sam_query_partitions enable row level security;

drop policy if exists "service role manage sam query partitions" on public.sam_query_partitions;
create policy "service role manage sam query partitions" on public.sam_query_partitions
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.sam_entity_registry (
  entity_key text primary key,
  legal_business_name text,
  uei text,
  cage text,
  parent_uei text,
  parent_legal_business_name text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sam_entity_registry_uei_idx
  on public.sam_entity_registry(uei);

create index if not exists sam_entity_registry_cage_idx
  on public.sam_entity_registry(cage);

create index if not exists sam_entity_registry_parent_uei_idx
  on public.sam_entity_registry(parent_uei);

alter table public.sam_entity_registry enable row level security;

drop policy if exists "service role manage sam entity registry" on public.sam_entity_registry;
create policy "service role manage sam entity registry" on public.sam_entity_registry
  for all
  to service_role
  using (true)
  with check (true);

insert into public.system_settings (key, value)
values
  ('artemis_sam_query_cooldown_days_empty', '14'::jsonb),
  ('artemis_sam_query_cooldown_hours_duplicate', '24'::jsonb),
  ('artemis_sam_query_retry_backoff_base_minutes', '30'::jsonb),
  ('artemis_sam_opportunities_partition_days', '30'::jsonb),
  ('artemis_sam_opportunities_partition_enabled', 'true'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_contracts_ingest') then
    perform cron.unschedule('artemis_contracts_ingest');
  end if;

  perform cron.schedule(
    'artemis_contracts_ingest',
    '17 5,13,21 * * *',
    $job$select public.invoke_edge_job('artemis-contracts-ingest');$job$
  );
end $$;
