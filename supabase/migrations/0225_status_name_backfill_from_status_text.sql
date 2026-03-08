-- Normalize status_name from existing status text so filters expose meaningful values
-- instead of collapsing most rows into "unknown".

with normalized_launches as (
  select
    id,
    case
      when src like '%partial failure%' or src like '%failure%' or src like '%scrub%' then 'scrubbed'
      when src like '%hold%' then 'hold'
      when src like '%tbd%' or src like '%tbc%' or src like '%to be determined%' or src like '%to be confirmed%' then 'tbd'
      when src like '%go%' or src like '%success%' or src like '%in flight%' or src like '%in-flight%' then 'go'
      else 'unknown'
    end as normalized_status
  from (
    select
      id,
      lower(
        coalesce(
          nullif(trim(status_abbrev), ''),
          nullif(trim(status_name), ''),
          ''
        )
      ) as src
    from public.launches
  ) s
),
normalized_cache as (
  select
    launch_id,
    case
      when src like '%partial failure%' or src like '%failure%' or src like '%scrub%' then 'scrubbed'
      when src like '%hold%' then 'hold'
      when src like '%tbd%' or src like '%tbc%' or src like '%to be determined%' or src like '%to be confirmed%' then 'tbd'
      when src like '%go%' or src like '%success%' or src like '%in flight%' or src like '%in-flight%' then 'go'
      else 'unknown'
    end as normalized_status
  from (
    select
      launch_id,
      lower(
        coalesce(
          nullif(trim(status_abbrev), ''),
          nullif(trim(status_name), ''),
          ''
        )
      ) as src
    from public.launches_public_cache
  ) s
)
update public.launches l
set status_name = n.normalized_status
from normalized_launches n
where l.id = n.id
  and l.status_name is distinct from n.normalized_status;

update public.launches_public_cache c
set status_name = n.normalized_status
from normalized_cache n
where c.launch_id = n.launch_id
  and c.status_name is distinct from n.normalized_status;
