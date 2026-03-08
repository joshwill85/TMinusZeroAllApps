-- Natural-key duplicate check for budget rows.
-- Budget table has no hard unique key; this query finds likely duplicates.

with keyed as (
  select
    id,
    coalesce(fiscal_year::text, 'na') || '|' ||
    coalesce(lower(trim(agency)), 'na') || '|' ||
    coalesce(lower(trim(program)), 'na') || '|' ||
    coalesce(lower(trim(line_item)), 'na') || '|' ||
    coalesce(amount_requested::text, 'na') || '|' ||
    coalesce(amount_enacted::text, 'na') || '|' ||
    coalesce(source_document_id::text, 'na') as natural_key,
    announced_time,
    updated_at
  from public.artemis_budget_lines
)
select
  natural_key,
  count(*) as duplicate_count,
  min(updated_at) as first_seen,
  max(updated_at) as last_seen,
  array_agg(id order by updated_at desc nulls last) as sample_ids
from keyed
group by natural_key
having count(*) > 1
order by duplicate_count desc, natural_key;
