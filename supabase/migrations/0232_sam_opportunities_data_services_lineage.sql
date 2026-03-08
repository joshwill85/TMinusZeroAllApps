-- SAM opportunities data-services snapshots + notice version lineage.

create table if not exists public.sam_opportunity_snapshot_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique,
  snapshot_scope text not null,
  request_url text not null,
  response_status int,
  content_hash text,
  notice_count int not null default 0,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sam_opportunity_snapshot_ingest_runs_scope_check
    check (snapshot_scope in ('active', 'archived')),
  constraint sam_opportunity_snapshot_ingest_runs_notice_count_check
    check (notice_count >= 0)
);

create index if not exists sam_opportunity_snapshot_ingest_runs_scope_idx
  on public.sam_opportunity_snapshot_ingest_runs(snapshot_scope, updated_at desc);

create index if not exists sam_opportunity_snapshot_ingest_runs_source_document_idx
  on public.sam_opportunity_snapshot_ingest_runs(source_document_id);

alter table public.sam_opportunity_snapshot_ingest_runs enable row level security;

drop policy if exists "service role manage sam opportunity snapshot ingest runs" on public.sam_opportunity_snapshot_ingest_runs;
create policy "service role manage sam opportunity snapshot ingest runs" on public.sam_opportunity_snapshot_ingest_runs
  for all
  to service_role
  using (true)
  with check (true);

create table if not exists public.artemis_opportunity_notice_versions (
  id uuid primary key default gen_random_uuid(),
  notice_version_key text not null unique,
  notice_id text not null,
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
  source_stream text not null default 'sam_api_delta',
  content_hash text not null,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_opportunity_notice_versions_source_stream_check
    check (source_stream in ('sam_data_services_active', 'sam_data_services_archived', 'sam_api_delta'))
);

create index if not exists artemis_opportunity_notice_versions_notice_idx
  on public.artemis_opportunity_notice_versions(notice_id, updated_at desc);

create index if not exists artemis_opportunity_notice_versions_solicitation_idx
  on public.artemis_opportunity_notice_versions(solicitation_id, posted_date desc nulls last);

create index if not exists artemis_opportunity_notice_versions_source_stream_idx
  on public.artemis_opportunity_notice_versions(source_stream, updated_at desc);

create index if not exists artemis_opportunity_notice_versions_source_document_idx
  on public.artemis_opportunity_notice_versions(source_document_id);

alter table public.artemis_opportunity_notice_versions enable row level security;

drop policy if exists "public read artemis opportunity notice versions" on public.artemis_opportunity_notice_versions;
create policy "public read artemis opportunity notice versions" on public.artemis_opportunity_notice_versions
  for select
  using (true);

drop policy if exists "service role manage artemis opportunity notice versions" on public.artemis_opportunity_notice_versions;
create policy "service role manage artemis opportunity notice versions" on public.artemis_opportunity_notice_versions
  for all
  to service_role
  using (true)
  with check (true);

insert into public.artemis_opportunity_notice_versions (
  notice_version_key,
  notice_id,
  solicitation_id,
  ptype,
  title,
  posted_date,
  response_deadline,
  latest_active_version,
  awardee_name,
  award_amount,
  notice_url,
  attachment_count,
  source_stream,
  content_hash,
  source_document_id,
  metadata,
  updated_at
)
select
  n.notice_id || '|' || md5(coalesce(n.metadata::text, '{}')) as notice_version_key,
  n.notice_id,
  n.solicitation_id,
  n.ptype,
  n.title,
  n.posted_date,
  n.response_deadline,
  n.latest_active_version,
  n.awardee_name,
  n.award_amount,
  n.notice_url,
  n.attachment_count,
  'sam_api_delta'::text as source_stream,
  md5(coalesce(n.metadata::text, '{}')) as content_hash,
  n.source_document_id,
  n.metadata,
  n.updated_at
from public.artemis_opportunity_notices n
on conflict (notice_version_key) do nothing;

insert into public.artemis_ingest_checkpoints (source_key, source_type, status, records_ingested, updated_at)
values
  ('sam_opportunities_data_services', 'procurement', 'complete', 0, now())
on conflict (source_key) do nothing;

insert into public.system_settings (key, value)
values
  ('artemis_sam_opportunities_data_services_enabled', 'true'::jsonb),
  ('artemis_sam_opportunities_api_delta_only', 'true'::jsonb),
  ('artemis_sam_opportunities_data_services_active_url', '""'::jsonb),
  ('artemis_sam_opportunities_data_services_archived_url', '""'::jsonb),
  ('artemis_sam_opportunities_data_services_api_key_param', '"api_key"'::jsonb),
  ('artemis_sam_opportunities_data_services_timeout_ms', '120000'::jsonb)
on conflict (key) do nothing;
