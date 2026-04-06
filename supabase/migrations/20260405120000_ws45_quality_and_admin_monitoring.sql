-- Harden WS45 ingestion with parser quality state, parse-run history, and
-- publish gating support for admin monitoring and launch-detail reads.

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

with computed as (
  select
    f.id,
    case
      when coalesce(f.raw_text, '') <> '' then 'digital'
      else 'unknown'
    end as document_mode,
    case
      when coalesce(f.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_heading_variant'
      when coalesce(f.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_abbrev_month_2digit_year'
      when coalesce(f.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]+[A-Za-z]+\\.?[[:space:]]+[0-9]{4}[[:>:]]' then 'legacy_spaced_full_month_year'
      else 'unknown_family'
    end as document_family,
    array_remove(array[
      case when f.product_name is null then 'product_name' end,
      case when f.mission_name is null then 'mission_name' end,
      case when f.issued_at is null then 'issued_at' end,
      case when f.valid_start is null then 'valid_start' end,
      case when f.valid_end is null then 'valid_end' end
    ], null) as required_fields_missing,
    array_remove(array[
      case when coalesce(f.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_forecast_discussion_heading' end,
      case when coalesce(f.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_date_tokens' end
    ], null) as normalization_flags
  from public.ws45_launch_forecasts f
)
update public.ws45_launch_forecasts f
set
  document_mode = computed.document_mode,
  document_family = computed.document_family,
  classification_confidence = case
    when computed.document_family = 'unknown_family' then 40
    else 90
  end,
  required_fields_missing = computed.required_fields_missing,
  normalization_flags = computed.normalization_flags,
  parse_status = case
    when coalesce(f.product_name, '') = ''
      and coalesce(f.mission_name, '') = ''
      and f.issued_at is null
      and f.valid_start is null
      and f.valid_end is null
    then 'failed'
    when array_length(computed.required_fields_missing, 1) is not null
      or (f.valid_start is not null and f.valid_end is not null and f.valid_end <= f.valid_start)
    then 'partial'
    else 'parsed'
  end,
  parse_confidence = case
    when f.match_status = 'matched'
      and f.product_name is not null
      and f.mission_name is not null
      and f.issued_at is not null
      and f.valid_start is not null
      and f.valid_end is not null
      and (f.valid_end is null or f.valid_start is null or f.valid_end > f.valid_start)
    then 95
    when coalesce(f.product_name, '') <> ''
      or coalesce(f.mission_name, '') <> ''
      or f.issued_at is not null
      or f.valid_start is not null
      or f.valid_end is not null
    then 60
    else 20
  end,
  publish_eligible = (
    coalesce(f.forecast_kind, '') <> 'faq'
    and f.product_name is not null
    and f.mission_name is not null
    and f.issued_at is not null
    and f.valid_start is not null
    and f.valid_end is not null
    and f.valid_end > f.valid_start
    and f.match_status = 'matched'
  ),
  quarantine_reasons = array_remove(array[
    case when f.product_name is null then 'missing_product_name' end,
    case when f.mission_name is null then 'missing_mission_name' end,
    case when f.issued_at is null then 'missing_issued_at' end,
    case when f.valid_start is null then 'missing_valid_start' end,
    case when f.valid_end is null then 'missing_valid_end' end,
    case when f.valid_start is not null and f.valid_end is not null and f.valid_end <= f.valid_start then 'invalid_valid_window_order' end,
    case when f.match_status = 'unmatched' then 'unmatched_launch' end,
    case when f.match_status = 'ambiguous' then 'ambiguous_launch' end
  ], null)
from computed
where computed.id = f.id;

insert into public.ws45_forecast_parse_runs (
  forecast_id,
  parser_version,
  runtime,
  attempt_reason,
  document_mode,
  document_family,
  parse_status,
  parse_confidence,
  publish_eligible,
  missing_required_fields,
  validation_failures,
  normalization_flags,
  field_confidence,
  field_evidence,
  strategy_trace,
  stats,
  created_at
)
select
  f.id,
  coalesce(f.parse_version, 'unknown'),
  'script',
  'backfill',
  f.document_mode,
  f.document_family,
  f.parse_status,
  f.parse_confidence,
  f.publish_eligible,
  f.required_fields_missing,
  array_remove(array[
    case when f.valid_start is not null and f.valid_end is not null and f.valid_end <= f.valid_start then 'invalid_valid_window_order' end
  ], null),
  f.normalization_flags,
  jsonb_build_object(
    'product_name', case when f.product_name is not null then 100 else 0 end,
    'mission_name', case when f.mission_name is not null then 100 else 0 end,
    'issued_at', case when f.issued_at is not null then 100 else 0 end,
    'valid_start', case when f.valid_start is not null then 100 else 0 end,
    'valid_end', case when f.valid_end is not null then 100 else 0 end
  ),
  jsonb_build_object(
    'source_label', f.source_label,
    'forecast_kind', f.forecast_kind,
    'product_name', f.product_name,
    'mission_name', f.mission_name,
    'issued_at', f.issued_at,
    'valid_start', f.valid_start,
    'valid_end', f.valid_end
  ),
  jsonb_build_object(
    'match_strategy', f.match_strategy,
    'match_status', f.match_status
  ),
  jsonb_build_object(
    'match_status', f.match_status,
    'match_confidence', f.match_confidence,
    'match_strategy', f.match_strategy
  ),
  coalesce(f.updated_at, f.created_at, now())
from public.ws45_launch_forecasts f
where not exists (
  select 1
  from public.ws45_forecast_parse_runs r
  where r.forecast_id = f.id
);

with latest as (
  select distinct on (forecast_id)
    forecast_id,
    id
  from public.ws45_forecast_parse_runs
  order by forecast_id, created_at desc, id desc
)
update public.ws45_launch_forecasts f
set latest_parse_run_id = latest.id
from latest
where latest.forecast_id = f.id;
