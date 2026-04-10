-- Fix WS45 helper backfill selection so converged rows are not re-selected.
--
-- Empty required/quarantine arrays are valid for fully processed rows, so they
-- must not be treated as "needs backfill" sentinels.

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
      (f.document_mode = 'unknown' and coalesce(f.raw_text, '') <> '')
      or f.document_family is null
      or f.classification_confidence is null
      or f.parse_confidence is null
      or f.latest_parse_run_id is null
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
