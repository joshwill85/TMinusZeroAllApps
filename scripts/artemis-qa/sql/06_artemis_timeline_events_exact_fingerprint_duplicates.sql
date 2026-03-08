-- Exact-key duplicate check for timeline events.
-- Should be empty because fingerprint is intended unique.

select
  fingerprint,
  count(*) as duplicate_count,
  min(announced_time) as first_announced,
  max(announced_time) as last_announced,
  array_agg(id order by announced_time desc nulls last) as sample_ids
from public.artemis_timeline_events
group by fingerprint
having count(*) > 1
order by duplicate_count desc, fingerprint;
