-- Apply cleanup for duplicate "refreshed" timeline rows.
-- Strategy: keep newest row per strict refresh-key, mark older rows superseded.
-- SAFETY:
-- 1) Run 10_artemis_timeline_refresh_duplicates_dry_run.sql first.
-- 2) Set expected_rows_to_supersede in the DO block below.
-- 3) Review _timeline_refresh_dedupe_targets before COMMIT.

begin;

create temp table _timeline_refresh_dedupe_targets on commit drop as
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
    summary,
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
  id as supersede_id,
  keep_id,
  refresh_key
from ranked
where group_size > 1 and rn > 1;

-- Inspect candidates before update.
select
  count(*) as rows_to_supersede,
  count(distinct refresh_key) as duplicate_groups
from _timeline_refresh_dedupe_targets;

select *
from _timeline_refresh_dedupe_targets
order by refresh_key, supersede_id;

-- Hard safety gate: update expected_rows_to_supersede after dry-run confirmation.
do $$
declare
  expected_rows_to_supersede integer := -1;
  actual_rows_to_supersede integer;
begin
  select count(*) into actual_rows_to_supersede from _timeline_refresh_dedupe_targets;

  if expected_rows_to_supersede < 0 then
    raise exception
      'Set expected_rows_to_supersede in scripts/artemis-qa/sql/11_artemis_timeline_refresh_duplicates_apply.sql before running.';
  end if;

  if actual_rows_to_supersede <> expected_rows_to_supersede then
    raise exception
      'Safety check failed: expected % rows_to_supersede but found %.',
      expected_rows_to_supersede,
      actual_rows_to_supersede;
  end if;
end $$;

-- Backup affected rows inside transaction (for rollback inspection).
create temp table _timeline_refresh_dedupe_backup on commit drop as
select e.*
from public.artemis_timeline_events e
join _timeline_refresh_dedupe_targets t on t.supersede_id = e.id;

update public.artemis_timeline_events e
set
  is_superseded = true,
  supersedes_event_id = t.keep_id,
  updated_at = now()
from _timeline_refresh_dedupe_targets t
where e.id = t.supersede_id
  and coalesce(e.is_superseded, false) = false
  and e.supersedes_event_id is null;

-- Post-update verification for targeted refresh keys.
with base as (
  select
    lower(trim(mission_key)) as mission_key_norm,
    lower(trim(title)) as title_norm,
    coalesce(lower(trim(source_type)), 'na') as source_type_norm,
    coalesce(lower(regexp_replace(trim(summary), '\s+', ' ', 'g')), 'na') as summary_norm,
    coalesce(lower(trim(regexp_replace(source_url, '/+$', ''))), 'na') as source_url_norm,
    coalesce(event_time::date::text, announced_time::date::text, 'na') as day_key
  from public.artemis_timeline_events
  where coalesce(is_superseded, false) = false
    and lower(trim(title)) like '%refreshed%'
),
current_counts as (
  select
    (
      mission_key_norm || '|' ||
      title_norm || '|' ||
      source_type_norm || '|' ||
      day_key || '|' ||
      summary_norm || '|' ||
      source_url_norm
    ) as refresh_key,
    count(*) as active_rows
  from base
  group by mission_key_norm, title_norm, source_type_norm, day_key, summary_norm, source_url_norm
)
select
  c.refresh_key,
  c.active_rows
from current_counts c
where c.refresh_key in (select distinct refresh_key from _timeline_refresh_dedupe_targets)
  and c.active_rows > 1;

commit;
