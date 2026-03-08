-- Apply cleanup for true duplicates in artemis_budget_lines.
-- SAFETY:
-- 1) Run 08_artemis_budget_lines_true_duplicates_dry_run.sql first.
-- 2) Set expected_rows_to_delete in the DO block below.
-- 3) Review DELETE candidates from _budget_dedupe_targets before COMMIT.

begin;

create temp table _budget_dedupe_targets on commit drop as
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
    id,
    strict_key,
    row_number() over (
      partition by strict_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as rn,
    count(*) over (partition by strict_key) as group_size,
    first_value(id) over (
      partition by strict_key
      order by updated_at desc nulls last, announced_time desc nulls last, id desc
    ) as keep_id
  from normalized
)
select
  id as delete_id,
  keep_id,
  strict_key
from ranked
where group_size > 1 and rn > 1;

-- Inspect candidates before delete.
select
  count(*) as rows_to_delete,
  count(distinct strict_key) as duplicate_groups
from _budget_dedupe_targets;

select *
from _budget_dedupe_targets
order by strict_key, delete_id;

-- Hard safety gate: update expected_rows_to_delete after dry-run confirmation.
do $$
declare
  expected_rows_to_delete integer := -1;
  actual_rows_to_delete integer;
begin
  select count(*) into actual_rows_to_delete from _budget_dedupe_targets;

  if expected_rows_to_delete < 0 then
    raise exception
      'Set expected_rows_to_delete in scripts/artemis-qa/sql/09_artemis_budget_lines_true_duplicates_apply.sql before running.';
  end if;

  if actual_rows_to_delete <> expected_rows_to_delete then
    raise exception
      'Safety check failed: expected % rows_to_delete but found %.',
      expected_rows_to_delete,
      actual_rows_to_delete;
  end if;
end $$;

-- Backup affected rows inside transaction (for rollback inspection).
create temp table _budget_dedupe_backup on commit drop as
select b.*
from public.artemis_budget_lines b
join _budget_dedupe_targets t on t.delete_id = b.id;

delete from public.artemis_budget_lines b
using _budget_dedupe_targets t
where b.id = t.delete_id;

-- Post-delete verification for targeted strict keys.
with normalized as (
  select
    id,
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
)
select
  strict_key,
  count(*) as remaining_count
from normalized
where strict_key in (select distinct strict_key from _budget_dedupe_targets)
group by strict_key
having count(*) > 1;

commit;
