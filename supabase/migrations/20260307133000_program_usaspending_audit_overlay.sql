create or replace function public.program_usaspending_normalize_identity_component(
  value text,
  max_length integer default 256
)
returns text
language sql
immutable
as $$
  select left(
    regexp_replace(
      replace(lower(trim(coalesce(value, ''))), '|', ' '),
      '\s+',
      ' ',
      'g'
    ),
    greatest(1, coalesce(max_length, 256))
  );
$$;

create or replace function public.program_usaspending_award_identity_key(
  usaspending_award_id text,
  award_title text,
  recipient text,
  awarded_on date,
  metadata jsonb default '{}'::jsonb
)
returns text
language sql
immutable
as $$
  select case
    when public.program_usaspending_normalize_identity_component(usaspending_award_id, 256) <> '' then
      'award:' || public.program_usaspending_normalize_identity_component(usaspending_award_id, 256)
    else
      'fallback:' || coalesce(
        nullif(
          concat_ws(
            '|',
            nullif(public.program_usaspending_normalize_identity_component(award_title, 160), ''),
            nullif(public.program_usaspending_normalize_identity_component(recipient, 120), ''),
            nullif(left(coalesce(awarded_on::text, ''), 10), ''),
            nullif(
              public.program_usaspending_normalize_identity_component(
                coalesce(
                  metadata->>'awardPageUrl',
                  metadata->>'sourceUrl',
                  metadata->>'awardApiUrl',
                  ''
                ),
                240
              ),
              ''
            )
          ),
          ''
        ),
        'unknown'
      )
  end;
$$;

create table if not exists public.program_usaspending_scope_reviews (
  id uuid primary key default gen_random_uuid(),
  award_identity_key text not null,
  usaspending_award_id text,
  program_scope text not null,
  auto_tier text not null,
  final_tier text,
  review_status text not null default 'unreviewed',
  reason_codes text[] not null default '{}',
  signal_snapshot jsonb not null default '[]'::jsonb,
  live_source_snapshot jsonb not null default '{}'::jsonb,
  audit_version text not null default '',
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_usaspending_scope_reviews_identity_scope_key
    unique (award_identity_key, program_scope),
  constraint program_usaspending_scope_reviews_program_scope_check
    check (program_scope in ('artemis', 'spacex', 'blue-origin')),
  constraint program_usaspending_scope_reviews_auto_tier_check
    check (auto_tier in ('exact', 'candidate', 'excluded')),
  constraint program_usaspending_scope_reviews_final_tier_check
    check (final_tier is null or final_tier in ('exact', 'candidate', 'excluded')),
  constraint program_usaspending_scope_reviews_status_check
    check (review_status in ('unreviewed', 'confirmed', 'suppressed'))
);

create index if not exists program_usaspending_scope_reviews_scope_updated_idx
  on public.program_usaspending_scope_reviews(program_scope, updated_at desc);

create index if not exists program_usaspending_scope_reviews_tier_idx
  on public.program_usaspending_scope_reviews(program_scope, auto_tier, final_tier, review_status);

alter table public.program_usaspending_scope_reviews enable row level security;

drop policy if exists "public read program usaspending scope reviews" on public.program_usaspending_scope_reviews;
create policy "public read program usaspending scope reviews" on public.program_usaspending_scope_reviews
  for select using (true);

drop policy if exists "service role manage program usaspending scope reviews" on public.program_usaspending_scope_reviews;
create policy "service role manage program usaspending scope reviews" on public.program_usaspending_scope_reviews
  for all
  to service_role
  using (true)
  with check (true);

grant select on table public.program_usaspending_scope_reviews to anon, authenticated;

create or replace view public.program_usaspending_audited_awards as
select
  a.id,
  public.program_usaspending_award_identity_key(
    a.usaspending_award_id,
    a.award_title,
    a.recipient,
    a.awarded_on,
    a.metadata
  ) as award_identity_key,
  a.usaspending_award_id,
  a.award_title,
  a.recipient,
  a.obligated_amount,
  a.awarded_on,
  a.mission_key,
  a.source_document_id,
  a.metadata,
  a.updated_at,
  lower(coalesce(a.metadata->>'programScope', a.metadata->>'program_scope')) as raw_program_scope,
  r.program_scope,
  r.auto_tier,
  r.final_tier,
  case
    when r.review_status = 'suppressed' then 'excluded'
    else coalesce(r.final_tier, r.auto_tier)
  end as scope_tier,
  r.review_status,
  r.reason_codes,
  r.signal_snapshot,
  r.live_source_snapshot,
  r.audit_version
from public.artemis_procurement_awards as a
join public.program_usaspending_scope_reviews as r
  on r.award_identity_key = public.program_usaspending_award_identity_key(
    a.usaspending_award_id,
    a.award_title,
    a.recipient,
    a.awarded_on,
    a.metadata
  );

grant select on public.program_usaspending_audited_awards to anon;
grant select on public.program_usaspending_audited_awards to authenticated;

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
from public.program_usaspending_audited_awards
where program_scope = 'spacex'
  and scope_tier = 'exact';

grant select on public.spacex_contracts to anon;
grant select on public.spacex_contracts to authenticated;
