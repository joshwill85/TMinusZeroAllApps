-- Refresh-event duplicate dry-run for artemis_timeline_events.
-- Purpose: identify repeated "refreshed" timeline rows with strict identity matches
-- (mission, title, source_type, date bucket, summary, source_url).
-- Safe: read-only.

with base as (
  select
    id,
    mission_key,
    title,
    summary,
    source_type,
    source_url,
    event_time,
    announced_time,
    updated_at,
    is_superseded,
    lower(trim(mission_key)) as mission_key_norm,
    lower(trim(title)) as title_norm,
    coalesce(lower(trim(source_type)), 'na') as source_type_norm,
    coalesce(lower(regexp_replace(trim(summary), '\s+', ' ', 'g')), 'na') as summary_norm,
    coalesce(lower(trim(regexp_replace(source_url, '/+$', ''))), 'na') as source_url_norm,
    coalesce(event_time::date::text, announced_time::date::text, 'na') as day_key
  from public.artemis_timeline_events
  where coalesce(is_superseded, false) = false
),
refresh_only as (
  select
    id,
    mission_key,
    title,
    source_type,
    source_url,
    event_time,
    announced_time,
    updated_at,
    (
      mission_key_norm || '|' ||
      title_norm || '|' ||
      source_type_norm || '|' ||
      day_key || '|' ||
      summary_norm || '|' ||
      source_url_norm
    ) as refresh_key
  from base
  where title_norm like '%refreshed%'
),
ranked as (
  select
    id,
    mission_key,
    title,
    source_type,
    source_url,
    event_time,
    announced_time,
    updated_at,
    refresh_key,
    row_number() over (
      partition by refresh_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as rn,
    count(*) over (partition by refresh_key) as group_size,
    first_value(id) over (
      partition by refresh_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as keep_id
  from refresh_only
)
select
  refresh_key,
  group_size as duplicate_count,
  keep_id,
  array_agg(id order by rn) as ordered_ids,
  array_agg(id order by rn) filter (where rn > 1) as supersede_ids,
  min(announced_time) as first_announced,
  max(announced_time) as last_announced
from ranked
where group_size > 1
group by refresh_key, group_size, keep_id
order by duplicate_count desc, refresh_key;

-- Summary query.
with base as (
  select
    lower(trim(mission_key)) as mission_key_norm,
    lower(trim(title)) as title_norm,
    coalesce(lower(trim(source_type)), 'na') as source_type_norm,
    coalesce(lower(regexp_replace(trim(summary), '\s+', ' ', 'g')), 'na') as summary_norm,
    coalesce(lower(trim(regexp_replace(source_url, '/+$', ''))), 'na') as source_url_norm,
    coalesce(event_time::date::text, announced_time::date::text, 'na') as day_key,
    announced_time,
    updated_at,
    id
  from public.artemis_timeline_events
  where coalesce(is_superseded, false) = false
    and lower(trim(title)) like '%refreshed%'
),
ranked as (
  select
    (
      mission_key_norm || '|' ||
      title_norm || '|' ||
      source_type_norm || '|' ||
      day_key || '|' ||
      summary_norm || '|' ||
      source_url_norm
    ) as refresh_key,
    row_number() over (
      partition by mission_key_norm, title_norm, source_type_norm, day_key, summary_norm, source_url_norm
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as rn,
    count(*) over (
      partition by mission_key_norm, title_norm, source_type_norm, day_key, summary_norm, source_url_norm
    ) as group_size
  from base
)
select
  count(*) filter (where group_size > 1) as rows_in_duplicate_groups,
  count(*) filter (where group_size > 1 and rn > 1) as rows_to_supersede,
  count(distinct refresh_key) filter (where group_size > 1) as duplicate_groups
from ranked;
