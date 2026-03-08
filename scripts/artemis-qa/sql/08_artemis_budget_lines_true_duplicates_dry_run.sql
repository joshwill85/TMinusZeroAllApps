-- True-duplicate dry-run for artemis_budget_lines.
-- Purpose: identify only rows that are semantically identical for Artemis UI projection.
-- Safe: read-only.

with normalized as (
  select
    id,
    updated_at,
    announced_time,
    coalesce(fiscal_year::text, 'na') as fiscal_year_key,
    coalesce(lower(trim(agency)), 'na') as agency_key,
    coalesce(lower(trim(program)), 'na') as program_key,
    coalesce(lower(trim(line_item)), 'na') as line_item_key,
    coalesce(amount_requested::text, 'na') as amount_requested_key,
    coalesce(amount_enacted::text, 'na') as amount_enacted_key,
    coalesce(announced_time::date::text, 'na') as announced_day_key,
    coalesce(source_document_id::text, 'na') as source_document_key,
    coalesce(lower(trim(metadata ->> 'sourceClass')), 'na') as source_class_key,
    coalesce(lower(trim(metadata ->> 'amountType')), 'na') as amount_type_key,
    coalesce(lower(trim(metadata ->> 'sourceUrl')), 'na') as source_url_key,
    coalesce(lower(trim(metadata ->> 'sourceTitle')), 'na') as source_title_key,
    coalesce(lower(trim(coalesce(metadata ->> 'detail', metadata ->> 'snippet'))), 'na') as detail_key
  from public.artemis_budget_lines
),
keyed as (
  select
    id,
    updated_at,
    announced_time,
    (
      fiscal_year_key || '|' ||
      agency_key || '|' ||
      program_key || '|' ||
      line_item_key || '|' ||
      amount_requested_key || '|' ||
      amount_enacted_key || '|' ||
      announced_day_key || '|' ||
      source_document_key || '|' ||
      source_class_key || '|' ||
      amount_type_key || '|' ||
      source_url_key || '|' ||
      source_title_key || '|' ||
      detail_key
    ) as strict_key
  from normalized
),
ranked as (
  select
    id,
    strict_key,
    updated_at,
    announced_time,
    row_number() over (
      partition by strict_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as rn,
    count(*) over (partition by strict_key) as group_size,
    first_value(id) over (
      partition by strict_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as keep_id
  from keyed
)
select
  strict_key,
  group_size as duplicate_count,
  keep_id,
  array_agg(id order by rn) as ordered_ids,
  array_agg(id order by rn) filter (where rn > 1) as delete_ids,
  min(updated_at) as first_seen,
  max(updated_at) as last_seen
from ranked
where group_size > 1
group by strict_key, group_size, keep_id
order by duplicate_count desc, strict_key;

-- Summary query.
with normalized as (
  select
    id,
    updated_at,
    announced_time,
    (
      coalesce(fiscal_year::text, 'na') || '|' ||
      coalesce(lower(trim(agency)), 'na') || '|' ||
      coalesce(lower(trim(program)), 'na') || '|' ||
      coalesce(lower(trim(line_item)), 'na') || '|' ||
      coalesce(amount_requested::text, 'na') || '|' ||
      coalesce(amount_enacted::text, 'na') || '|' ||
      coalesce(announced_time::date::text, 'na') || '|' ||
      coalesce(source_document_id::text, 'na') || '|' ||
      coalesce(lower(trim(metadata ->> 'sourceClass')), 'na') || '|' ||
      coalesce(lower(trim(metadata ->> 'amountType')), 'na') || '|' ||
      coalesce(lower(trim(metadata ->> 'sourceUrl')), 'na') || '|' ||
      coalesce(lower(trim(metadata ->> 'sourceTitle')), 'na') || '|' ||
      coalesce(lower(trim(coalesce(metadata ->> 'detail', metadata ->> 'snippet'))), 'na')
    ) as strict_key
  from public.artemis_budget_lines
),
ranked as (
  select
    strict_key,
    row_number() over (
      partition by strict_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as rn,
    count(*) over (partition by strict_key) as group_size
  from normalized
)
select
  count(*) filter (where group_size > 1) as rows_in_duplicate_groups,
  count(*) filter (where group_size > 1 and rn > 1) as rows_to_delete,
  count(distinct strict_key) filter (where group_size > 1) as duplicate_groups
from ranked;
