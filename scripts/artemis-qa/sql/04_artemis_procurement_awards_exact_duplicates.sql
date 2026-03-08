-- Exact-key duplicate check for procurement awards.
-- Should be empty because (usaspending_award_id, mission_key) is intended unique.

select
  usaspending_award_id,
  mission_key,
  count(*) as duplicate_count,
  min(updated_at) as first_seen,
  max(updated_at) as last_seen,
  array_agg(id order by updated_at desc nulls last) as sample_ids
from public.artemis_procurement_awards
group by usaspending_award_id, mission_key
having count(*) > 1
order by duplicate_count desc, usaspending_award_id, mission_key;
