-- Semantic duplicate check by canonicalized URL across Artemis content items.
-- Useful for user-visible duplicates where keys differ.

with normalized as (
  select
    id,
    lower(trim(url)) as normalized_url,
    kind,
    mission_key,
    title,
    published_at,
    captured_at
  from public.artemis_content_items
  where url is not null
)
select
  normalized_url,
  count(*) as duplicate_count,
  count(distinct kind) as distinct_kinds,
  count(distinct mission_key) as distinct_missions,
  min(coalesce(published_at, captured_at)) as first_seen,
  max(coalesce(published_at, captured_at)) as last_seen,
  array_agg(id order by coalesce(published_at, captured_at) desc nulls last) as sample_ids
from normalized
group by normalized_url
having count(*) > 1
order by duplicate_count desc, normalized_url;
