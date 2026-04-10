-- Recovery helpers for WS45 quality backfill.
--
-- Intentionally does not run a full-table update during migration. Use these
-- functions in small batches after the database is stable again.

create or replace function public.ws45_backfill_launch_forecast_quality_batch(
  batch_limit_in int default 250
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_updated int := 0;
begin
  with target as (
    select
      f.id,
      f.raw_text,
      f.forecast_kind,
      f.product_name,
      f.mission_name,
      f.issued_at,
      f.valid_start,
      f.valid_end,
      f.match_status
    from public.ws45_launch_forecasts f
    where
      f.document_mode = 'unknown'
      or f.document_family is null
      or f.classification_confidence is null
      or f.parse_confidence is null
      or f.latest_parse_run_id is null
      or coalesce(array_length(f.required_fields_missing, 1), 0) = 0
      or coalesce(array_length(f.quarantine_reasons, 1), 0) = 0
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  ), computed as (
    select
      t.id,
      case
        when coalesce(t.raw_text, '') <> '' then 'digital'
        else 'unknown'
      end as document_mode,
      case
        when coalesce(t.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_heading_variant'
        when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_abbrev_month_2digit_year'
        when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]+[A-Za-z]+\\.?[[:space:]]+[0-9]{4}[[:>:]]' then 'legacy_spaced_full_month_year'
        else 'unknown_family'
      end as document_family,
      array_remove(array[
        case when t.product_name is null then 'product_name' end,
        case when t.mission_name is null then 'mission_name' end,
        case when t.issued_at is null then 'issued_at' end,
        case when t.valid_start is null then 'valid_start' end,
        case when t.valid_end is null then 'valid_end' end
      ], null) as required_fields_missing,
      array_remove(array[
        case when coalesce(t.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_forecast_discussion_heading' end,
        case when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_date_tokens' end
      ], null) as normalization_flags
    from target t
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

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;

create or replace function public.ws45_seed_parse_runs_batch(
  batch_limit_in int default 250
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_inserted int := 0;
begin
  with target as (
    select
      f.id,
      f.parse_version,
      f.document_mode,
      f.document_family,
      f.parse_status,
      f.parse_confidence,
      f.publish_eligible,
      f.required_fields_missing,
      f.normalization_flags,
      f.source_label,
      f.forecast_kind,
      f.product_name,
      f.mission_name,
      f.issued_at,
      f.valid_start,
      f.valid_end,
      f.match_strategy,
      f.match_status,
      f.match_confidence,
      f.updated_at,
      f.created_at
    from public.ws45_launch_forecasts f
    where not exists (
      select 1
      from public.ws45_forecast_parse_runs r
      where r.forecast_id = f.id
    )
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  )
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
    t.id,
    coalesce(t.parse_version, 'unknown'),
    'script',
    'backfill',
    t.document_mode,
    t.document_family,
    t.parse_status,
    t.parse_confidence,
    t.publish_eligible,
    t.required_fields_missing,
    array_remove(array[
      case when t.valid_start is not null and t.valid_end is not null and t.valid_end <= t.valid_start then 'invalid_valid_window_order' end
    ], null),
    t.normalization_flags,
    jsonb_build_object(
      'product_name', case when t.product_name is not null then 100 else 0 end,
      'mission_name', case when t.mission_name is not null then 100 else 0 end,
      'issued_at', case when t.issued_at is not null then 100 else 0 end,
      'valid_start', case when t.valid_start is not null then 100 else 0 end,
      'valid_end', case when t.valid_end is not null then 100 else 0 end
    ),
    jsonb_build_object(
      'source_label', t.source_label,
      'forecast_kind', t.forecast_kind,
      'product_name', t.product_name,
      'mission_name', t.mission_name,
      'issued_at', t.issued_at,
      'valid_start', t.valid_start,
      'valid_end', t.valid_end
    ),
    jsonb_build_object(
      'match_strategy', t.match_strategy,
      'match_status', t.match_status
    ),
    jsonb_build_object(
      'match_status', t.match_status,
      'match_confidence', t.match_confidence,
      'match_strategy', t.match_strategy
    ),
    coalesce(t.updated_at, t.created_at, now())
  from target t;

  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;

create or replace function public.ws45_sync_latest_parse_run_ids_batch(
  batch_limit_in int default 250
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_updated int := 0;
begin
  with target as (
    select f.id
    from public.ws45_launch_forecasts f
    where f.latest_parse_run_id is null
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  ), latest as (
    select distinct on (r.forecast_id)
      r.forecast_id,
      r.id
    from public.ws45_forecast_parse_runs r
    join target t on t.id = r.forecast_id
    order by r.forecast_id, r.created_at desc, r.id desc
  )
  update public.ws45_launch_forecasts f
  set latest_parse_run_id = latest.id
  from latest
  where latest.forecast_id = f.id;

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;
