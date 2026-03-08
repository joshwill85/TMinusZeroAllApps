-- Backfill persisted USASpending links so user-facing URLs never point to api.usaspending.gov.
-- Scope:
-- - Blue Origin contract/timeline source URLs
-- - Artemis procurement metadata, timeline source URLs, content URLs, and budget metadata source URLs
-- - Artemis source registry base URL for USASpending
-- - SpaceX contracts view URL precedence

create or replace function public._tmz_usaspending_public_url(
  input_url text,
  fallback_award_id text default null
)
returns text
language sql
immutable
as $$
  select
    case
      when nullif(btrim(coalesce(input_url, '')), '') is null then
        case
          when nullif(btrim(coalesce(fallback_award_id, '')), '') is not null
            then 'https://www.usaspending.gov/search/?hash=' || btrim(fallback_award_id)
          else
            'https://www.usaspending.gov/'
        end
      when input_url ~* '^https?://api\.usaspending\.gov' then
        case
          when nullif(btrim(coalesce(fallback_award_id, '')), '') is not null
            then 'https://www.usaspending.gov/search/?hash=' || btrim(fallback_award_id)
          when nullif(
            btrim(substring(input_url from '[?&]hash=([^&]+)')),
            ''
          ) is not null
            then 'https://www.usaspending.gov/search/?hash=' || btrim(substring(input_url from '[?&]hash=([^&]+)'))
          when nullif(
            btrim(substring(input_url from '/award/([^/?#]+)')),
            ''
          ) is not null
            then 'https://www.usaspending.gov/search/?hash=' || btrim(substring(input_url from '/award/([^/?#]+)'))
          else
            'https://www.usaspending.gov/'
        end
      else
        input_url
    end;
$$;

with resolved as (
  select
    c.id,
    coalesce(
      nullif(
        btrim(
          case
            when c.contract_key ~* '^USASPENDING-' then substr(c.contract_key, 13)
            else null
          end
        ),
        ''
      ),
      nullif(btrim(c.metadata ->> 'usaspending_award_id'), ''),
      nullif(btrim(c.metadata ->> 'usaspendingAwardId'), ''),
      nullif(btrim(c.metadata ->> 'award_id'), ''),
      nullif(btrim(c.metadata ->> 'awardId'), ''),
      nullif(btrim(c.metadata ->> 'sourceAwardId'), ''),
      nullif(btrim(c.metadata ->> 'source_award_id'), ''),
      nullif(btrim(substring(c.source_url from '[?&]hash=([^&]+)')), ''),
      nullif(btrim(substring(c.source_url from '/award/([^/?#]+)')), '')
    ) as award_id
  from public.blue_origin_contracts as c
  where
    coalesce(c.source_url, '') ~* '^https?://api\.usaspending\.gov'
    or coalesce(c.metadata ->> 'sourceUrl', '') ~* '^https?://api\.usaspending\.gov'
)
update public.blue_origin_contracts as c
set
  source_url = public._tmz_usaspending_public_url(c.source_url, r.award_id),
  metadata = jsonb_set(
    jsonb_set(
      coalesce(c.metadata, '{}'::jsonb),
      '{sourceUrl}',
      to_jsonb(
        public._tmz_usaspending_public_url(
          coalesce(c.metadata ->> 'sourceUrl', c.source_url),
          r.award_id
        )
      ),
      true
    ),
    '{awardPageUrl}',
    case
      when
        coalesce(c.metadata ->> 'awardPageUrl', '') ~* '^https?://api\.usaspending\.gov'
        or coalesce(c.metadata ->> 'awardPageUrl', '') = ''
      then to_jsonb(
        public._tmz_usaspending_public_url(c.metadata ->> 'awardPageUrl', r.award_id)
      )
      else c.metadata -> 'awardPageUrl'
    end,
    true
  ),
  updated_at = now()
from resolved as r
where c.id = r.id;

with resolved as (
  select
    e.id,
    coalesce(
      nullif(
        btrim(
          case
            when coalesce(e.metadata ->> 'contractKey', '') ~* '^USASPENDING-' then substr(e.metadata ->> 'contractKey', 13)
            else null
          end
        ),
        ''
      ),
      nullif(btrim(e.metadata ->> 'sourceAwardId'), ''),
      nullif(btrim(e.metadata ->> 'source_award_id'), ''),
      nullif(btrim(e.metadata ->> 'usaspendingAwardId'), ''),
      nullif(btrim(e.metadata ->> 'usaspending_award_id'), ''),
      nullif(btrim(substring(e.source_url from '[?&]hash=([^&]+)')), ''),
      nullif(btrim(substring(e.source_url from '/award/([^/?#]+)')), '')
    ) as award_id
  from public.blue_origin_timeline_events as e
  where coalesce(e.source_url, '') ~* '^https?://api\.usaspending\.gov'
)
update public.blue_origin_timeline_events as e
set
  source_url = public._tmz_usaspending_public_url(e.source_url, r.award_id),
  updated_at = now()
from resolved as r
where e.id = r.id;

with resolved as (
  select
    a.id,
    coalesce(
      nullif(btrim(a.usaspending_award_id), ''),
      nullif(btrim(a.metadata ->> 'generatedAwardId'), ''),
      nullif(btrim(a.metadata ->> 'usaspending_award_id'), ''),
      nullif(btrim(a.metadata ->> 'usaspendingAwardId'), ''),
      nullif(btrim(a.metadata ->> 'award_id'), ''),
      nullif(btrim(a.metadata ->> 'awardId'), ''),
      nullif(btrim(a.metadata ->> 'sourceAwardId'), ''),
      nullif(btrim(a.metadata ->> 'source_award_id'), ''),
      nullif(
        btrim(
          substring(
            coalesce(a.metadata ->> 'sourceUrl', a.metadata ->> 'awardApiUrl', '')
            from '[?&]hash=([^&]+)'
          )
        ),
        ''
      ),
      nullif(
        btrim(
          substring(
            coalesce(a.metadata ->> 'sourceUrl', a.metadata ->> 'awardApiUrl', '')
            from '/award/([^/?#]+)'
          )
        ),
        ''
      )
    ) as award_id
  from public.artemis_procurement_awards as a
  where
    coalesce(a.metadata ->> 'sourceUrl', '') ~* '^https?://api\.usaspending\.gov'
    or (
      coalesce(a.metadata ->> 'sourceUrl', '') = ''
      and coalesce(a.metadata ->> 'awardApiUrl', '') ~* '^https?://api\.usaspending\.gov'
    )
    or coalesce(a.metadata ->> 'awardPageUrl', '') ~* '^https?://api\.usaspending\.gov'
)
update public.artemis_procurement_awards as a
set
  metadata = jsonb_set(
    jsonb_set(
      coalesce(a.metadata, '{}'::jsonb),
      '{sourceUrl}',
      to_jsonb(
        public._tmz_usaspending_public_url(
          coalesce(a.metadata ->> 'sourceUrl', a.metadata ->> 'awardApiUrl'),
          r.award_id
        )
      ),
      true
    ),
    '{awardPageUrl}',
    case
      when
        coalesce(a.metadata ->> 'awardPageUrl', '') ~* '^https?://api\.usaspending\.gov'
        or coalesce(a.metadata ->> 'awardPageUrl', '') = ''
      then to_jsonb(
        public._tmz_usaspending_public_url(a.metadata ->> 'awardPageUrl', r.award_id)
      )
      else a.metadata -> 'awardPageUrl'
    end,
    true
  ),
  updated_at = now()
from resolved as r
where a.id = r.id;

with resolved as (
  select
    e.id,
    coalesce(
      nullif(btrim(e.metadata ->> 'sourceAwardId'), ''),
      nullif(btrim(e.metadata ->> 'source_award_id'), ''),
      nullif(btrim(e.metadata ->> 'usaspendingAwardId'), ''),
      nullif(btrim(e.metadata ->> 'usaspending_award_id'), ''),
      nullif(btrim(e.metadata ->> 'awardId'), ''),
      nullif(btrim(e.metadata ->> 'award_id'), ''),
      nullif(btrim(substring(e.source_url from '[?&]hash=([^&]+)')), ''),
      nullif(btrim(substring(e.source_url from '/award/([^/?#]+)')), '')
    ) as award_id
  from public.artemis_timeline_events as e
  where coalesce(e.source_url, '') ~* '^https?://api\.usaspending\.gov'
)
update public.artemis_timeline_events as e
set
  source_url = public._tmz_usaspending_public_url(e.source_url, r.award_id),
  updated_at = now()
from resolved as r
where e.id = r.id;

with resolved as (
  select
    c.id,
    c.source_class,
    coalesce(
      nullif(btrim(c.external_id), ''),
      nullif(btrim(c.data_label), ''),
      nullif(btrim(c.metadata ->> 'sourceAwardId'), ''),
      nullif(btrim(c.metadata ->> 'source_award_id'), ''),
      nullif(btrim(c.metadata ->> 'usaspendingAwardId'), ''),
      nullif(btrim(c.metadata ->> 'usaspending_award_id'), ''),
      nullif(btrim(c.metadata ->> 'awardId'), ''),
      nullif(btrim(c.metadata ->> 'award_id'), ''),
      nullif(btrim(substring(c.url from '[?&]hash=([^&]+)')), ''),
      nullif(btrim(substring(c.url from '/award/([^/?#]+)')), '')
    ) as award_id
  from public.artemis_content_items as c
  where coalesce(c.url, '') ~* '^https?://api\.usaspending\.gov'
)
update public.artemis_content_items as c
set
  url = public._tmz_usaspending_public_url(c.url, r.award_id),
  metadata = case
    when r.source_class = 'procurement'
      then jsonb_set(
        coalesce(c.metadata, '{}'::jsonb),
        '{sourceUrl}',
        to_jsonb(public._tmz_usaspending_public_url(c.url, r.award_id)),
        true
      )
    else c.metadata
  end,
  updated_at = now()
from resolved as r
where c.id = r.id;

update public.artemis_budget_lines
set
  metadata = jsonb_set(
    coalesce(metadata, '{}'::jsonb),
    '{sourceUrl}',
    to_jsonb('https://www.usaspending.gov/'::text),
    true
  ),
  updated_at = now()
where coalesce(metadata ->> 'sourceUrl', '') ~* '^https?://api\.usaspending\.gov';

update public.artemis_source_registry
set
  base_url = 'https://www.usaspending.gov',
  updated_at = now()
where
  source_key = 'usaspending_awards'
  and coalesce(base_url, '') <> 'https://www.usaspending.gov';

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
    nullif(metadata ->> 'description', ''),
    nullif(award_title, ''),
    'USASpending award record'
  ) as description,
  coalesce(
    nullif(metadata ->> 'awardPageUrl', ''),
    nullif(metadata ->> 'sourceUrl', ''),
    case
      when usaspending_award_id is not null then
        'https://www.usaspending.gov/search/?hash=' || usaspending_award_id
      else null
    end
  ) as source_url,
  coalesce(nullif(metadata ->> 'sourceTitle', ''), 'USASpending award record') as source_label,
  'awarded' as status,
  metadata,
  updated_at
from public.artemis_procurement_awards
where coalesce(
  program_scope,
  lower(coalesce(metadata ->> 'programScope', metadata ->> 'program_scope'))
) = 'spacex';

grant select on public.spacex_contracts to anon;
grant select on public.spacex_contracts to authenticated;

drop function if exists public._tmz_usaspending_public_url(text, text);
