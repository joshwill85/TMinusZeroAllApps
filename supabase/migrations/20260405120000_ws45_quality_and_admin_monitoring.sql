-- Harden WS45 ingestion with parser quality state, parse-run history, and
-- publish gating support for admin monitoring and launch-detail reads.
--
-- Recovery note:
-- Keep this migration schema-only so production can land the missing columns
-- quickly during incidents. Historical row backfill is installed separately in
-- a follow-up helper migration and can be run in batches once the database is
-- stable again.

alter table public.ws45_launch_forecasts
  add column if not exists document_mode text not null default 'unknown'
    check (document_mode in ('digital', 'scanned', 'unknown')),
  add column if not exists document_family text,
  add column if not exists classification_confidence int
    check (classification_confidence between 0 and 100),
  add column if not exists parse_status text not null default 'failed'
    check (parse_status in ('parsed', 'partial', 'failed')),
  add column if not exists parse_confidence int
    check (parse_confidence between 0 and 100),
  add column if not exists publish_eligible boolean not null default false,
  add column if not exists quarantine_reasons text[] not null default '{}',
  add column if not exists required_fields_missing text[] not null default '{}',
  add column if not exists normalization_flags text[] not null default '{}',
  add column if not exists latest_parse_run_id uuid;

create index if not exists ws45_launch_forecasts_publish_eligible_idx
  on public.ws45_launch_forecasts (publish_eligible, fetched_at desc);

create index if not exists ws45_launch_forecasts_parse_status_idx
  on public.ws45_launch_forecasts (parse_status, fetched_at desc);

create index if not exists ws45_launch_forecasts_document_family_idx
  on public.ws45_launch_forecasts (document_family, fetched_at desc);

create table if not exists public.ws45_forecast_parse_runs (
  id uuid primary key default gen_random_uuid(),
  forecast_id uuid not null references public.ws45_launch_forecasts(id) on delete cascade,
  parser_version text not null,
  runtime text not null check (runtime in ('edge', 'node', 'script')),
  attempt_reason text not null check (attempt_reason in ('ingest', 'reparse', 'admin_replay', 'backfill')),
  document_mode text not null check (document_mode in ('digital', 'scanned', 'unknown')),
  document_family text,
  parse_status text not null check (parse_status in ('parsed', 'partial', 'failed')),
  parse_confidence int check (parse_confidence between 0 and 100),
  publish_eligible boolean not null default false,
  missing_required_fields text[] not null default '{}',
  validation_failures text[] not null default '{}',
  normalization_flags text[] not null default '{}',
  field_confidence jsonb,
  field_evidence jsonb,
  strategy_trace jsonb,
  stats jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ws45_forecast_parse_runs_forecast_idx
  on public.ws45_forecast_parse_runs (forecast_id, created_at desc);

create index if not exists ws45_forecast_parse_runs_parser_version_idx
  on public.ws45_forecast_parse_runs (parser_version, created_at desc);

create index if not exists ws45_forecast_parse_runs_publish_idx
  on public.ws45_forecast_parse_runs (publish_eligible, created_at desc);

create index if not exists ws45_forecast_parse_runs_document_family_idx
  on public.ws45_forecast_parse_runs (document_family, created_at desc);

alter table public.ws45_forecast_parse_runs enable row level security;

drop policy if exists "admin read ws45 forecast parse runs" on public.ws45_forecast_parse_runs;
create policy "admin read ws45 forecast parse runs"
  on public.ws45_forecast_parse_runs for select
  using (public.is_admin());

drop policy if exists "admin insert ws45 forecast parse runs" on public.ws45_forecast_parse_runs;
create policy "admin insert ws45 forecast parse runs"
  on public.ws45_forecast_parse_runs for insert
  with check (public.is_admin());

drop policy if exists "admin update ws45 forecast parse runs" on public.ws45_forecast_parse_runs;
create policy "admin update ws45 forecast parse runs"
  on public.ws45_forecast_parse_runs for update
  using (public.is_admin())
  with check (public.is_admin());
