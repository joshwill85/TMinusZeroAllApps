-- Exact-key duplicate check for artemis_content_items.
-- Should be empty because fingerprint is intended unique.

select
  fingerprint,
  count(*) as duplicate_count,
  min(created_at) as first_seen,
  max(created_at) as last_seen,
  array_agg(id order by created_at desc) as sample_ids
from public.artemis_content_items
group by fingerprint
having count(*) > 1
order by duplicate_count desc, fingerprint;
