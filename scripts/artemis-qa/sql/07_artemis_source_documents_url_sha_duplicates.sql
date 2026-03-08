-- Exact-key duplicate check for source documents.
-- Should be empty because (url, sha256) is intended unique.

select
  lower(trim(url)) as normalized_url,
  sha256,
  count(*) as duplicate_count,
  min(fetched_at) as first_fetched,
  max(fetched_at) as last_fetched,
  array_agg(id order by fetched_at desc nulls last) as sample_ids
from public.artemis_source_documents
group by lower(trim(url)), sha256
having count(*) > 1
order by duplicate_count desc, normalized_url;
