-- Expose SpaceX-scoped procurement rows through a contract-shaped relation.
-- This keeps SpaceX contract pages and APIs from depending on implicit
-- "program scope only via code-path filtering" and provides a first-class source
-- for contract hub reads.

create or replace view public.spacex_contracts as
select
  id,
  coalesce(usaspending_award_id, ('spacex-award-' || id::text)) as contract_key,
  coalesce(nullif(trim(mission_key), ''), 'program') as mission_key,
  award_title as title,
  recipient as agency,
  recipient as customer,
  obligated_amount as amount,
  awarded_on,
  coalesce(
    nullif(metadata->>'description', ''),
    nullif(award_title, ''),
    'USASpending award record'
  ) as description,
  coalesce(
    nullif(metadata->>'awardPageUrl', ''),
    nullif(metadata->>'awardApiUrl', ''),
    nullif(metadata->>'sourceUrl', ''),
    case
      when usaspending_award_id is not null then
        'https://www.usaspending.gov/search/?hash=' || usaspending_award_id
      else null
    end
  ) as source_url,
  coalesce(nullif(metadata->>'sourceTitle', ''), 'USASpending award record') as source_label,
  'awarded' as status,
  metadata,
  updated_at
from public.artemis_procurement_awards
where coalesce(
  program_scope,
  lower(coalesce(metadata->>'programScope', metadata->>'program_scope'))
) = 'spacex';

grant select on public.spacex_contracts to anon;
grant select on public.spacex_contracts to authenticated;
