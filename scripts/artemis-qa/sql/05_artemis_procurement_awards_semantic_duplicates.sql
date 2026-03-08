-- Semantic duplicate check for procurement awards likely visible in UI.

with normalized as (
  select
    id,
    coalesce(lower(trim(award_title)), 'na') as title_key,
    coalesce(lower(trim(recipient)), 'na') as recipient_key,
    coalesce(obligated_amount::text, 'na') as amount_key,
    coalesce(awarded_on::text, 'na') as date_key,
    coalesce(lower(trim(mission_key)), 'na') as mission_key,
    updated_at
  from public.artemis_procurement_awards
)
select
  title_key,
  recipient_key,
  amount_key,
  date_key,
  mission_key,
  count(*) as duplicate_count,
  array_agg(id order by updated_at desc nulls last) as sample_ids
from normalized
group by title_key, recipient_key, amount_key, date_key, mission_key
having count(*) > 1
order by duplicate_count desc, title_key;
