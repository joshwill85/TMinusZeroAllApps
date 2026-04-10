-- Canonical contracts cache read model for exact-first paging and snapshot reuse.
-- This remains additive: existing full-array routes stay intact and can fall back
-- to the request-time assembler until this migration is deployed.

set local statement_timeout = 0;

create extension if not exists pg_trgm;

create table if not exists public.canonical_contracts_cache (
  uid text primary key,
  scope text not null,
  story_status text not null default 'pending',
  story_key text,
  match_confidence numeric,
  has_full_story boolean not null default false,
  action_count integer not null default 0,
  notice_count integer not null default 0,
  spending_count integer not null default 0,
  bidder_count integer not null default 0,
  title text not null,
  description text,
  contract_key text not null,
  piid text,
  usaspending_award_id text,
  mission_key text,
  mission_label text not null,
  agency text,
  customer text,
  recipient text,
  amount numeric,
  awarded_on date,
  source_url text,
  source_label text,
  status text,
  updated_at timestamptz,
  canonical_path text not null,
  program_path text not null,
  keywords text[] not null default array[]::text[],
  search_text text not null default '',
  sort_exact_rank smallint not null default 1,
  sort_date timestamptz,
  cache_refreshed_at timestamptz not null default now(),
  constraint canonical_contracts_cache_scope_check
    check (scope in ('spacex', 'blue-origin', 'artemis')),
  constraint canonical_contracts_cache_story_status_check
    check (story_status in ('exact', 'pending')),
  constraint canonical_contracts_cache_sort_exact_rank_check
    check (sort_exact_rank in (0, 1))
);

create index if not exists canonical_contracts_cache_list_idx
  on public.canonical_contracts_cache(sort_exact_rank, sort_date desc nulls last, scope, title, uid);

create index if not exists canonical_contracts_cache_scope_list_idx
  on public.canonical_contracts_cache(scope, sort_exact_rank, sort_date desc nulls last, title, uid);

create index if not exists canonical_contracts_cache_story_key_idx
  on public.canonical_contracts_cache(story_key)
  where story_key is not null;

create index if not exists canonical_contracts_cache_scope_contract_key_idx
  on public.canonical_contracts_cache(scope, contract_key);

create index if not exists canonical_contracts_cache_scope_award_idx
  on public.canonical_contracts_cache(scope, usaspending_award_id)
  where usaspending_award_id is not null;

create index if not exists canonical_contracts_cache_scope_piid_idx
  on public.canonical_contracts_cache(scope, piid)
  where piid is not null;

create index if not exists canonical_contracts_cache_search_text_trgm_idx
  on public.canonical_contracts_cache
  using gin (search_text gin_trgm_ops)
  where search_text <> '';

create index if not exists canonical_contracts_cache_refreshed_idx
  on public.canonical_contracts_cache(cache_refreshed_at desc);

alter table public.canonical_contracts_cache enable row level security;

drop policy if exists "service role manage canonical contracts cache" on public.canonical_contracts_cache;
create policy "service role manage canonical contracts cache" on public.canonical_contracts_cache
  for all to service_role using (true) with check (true);

create or replace function public.replace_canonical_contracts_cache_v1(rows_in jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  refreshed_at timestamptz := now();
  inserted_count integer := 0;
begin
  delete from public.canonical_contracts_cache;

  if rows_in is null
     or jsonb_typeof(rows_in) <> 'array'
     or jsonb_array_length(rows_in) = 0 then
    return 0;
  end if;

  insert into public.canonical_contracts_cache (
    uid,
    scope,
    story_status,
    story_key,
    match_confidence,
    has_full_story,
    action_count,
    notice_count,
    spending_count,
    bidder_count,
    title,
    description,
    contract_key,
    piid,
    usaspending_award_id,
    mission_key,
    mission_label,
    agency,
    customer,
    recipient,
    amount,
    awarded_on,
    source_url,
    source_label,
    status,
    updated_at,
    canonical_path,
    program_path,
    keywords,
    search_text,
    sort_exact_rank,
    sort_date,
    cache_refreshed_at
  )
  select
    row.uid,
    row.scope,
    coalesce(row.story_status, 'pending'),
    row.story_key,
    row.match_confidence,
    coalesce(row.has_full_story, false),
    coalesce(row.action_count, 0),
    coalesce(row.notice_count, 0),
    coalesce(row.spending_count, 0),
    coalesce(row.bidder_count, 0),
    row.title,
    row.description,
    row.contract_key,
    row.piid,
    row.usaspending_award_id,
    row.mission_key,
    row.mission_label,
    row.agency,
    row.customer,
    row.recipient,
    row.amount,
    row.awarded_on,
    row.source_url,
    row.source_label,
    row.status,
    row.updated_at,
    row.canonical_path,
    row.program_path,
    coalesce(row.keywords, array[]::text[]),
    coalesce(row.search_text, ''),
    coalesce(row.sort_exact_rank, case when coalesce(row.story_status, 'pending') = 'exact' then 0 else 1 end),
    row.sort_date,
    refreshed_at
  from jsonb_to_recordset(rows_in) as row(
    uid text,
    scope text,
    story_status text,
    story_key text,
    match_confidence numeric,
    has_full_story boolean,
    action_count integer,
    notice_count integer,
    spending_count integer,
    bidder_count integer,
    title text,
    description text,
    contract_key text,
    piid text,
    usaspending_award_id text,
    mission_key text,
    mission_label text,
    agency text,
    customer text,
    recipient text,
    amount numeric,
    awarded_on date,
    source_url text,
    source_label text,
    status text,
    updated_at timestamptz,
    canonical_path text,
    program_path text,
    keywords text[],
    search_text text,
    sort_exact_rank smallint,
    sort_date timestamptz
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

create or replace function public.get_canonical_contract_totals_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'all', count(*)::bigint,
    'exact', count(*) filter (where story_status = 'exact'),
    'pending', count(*) filter (where story_status = 'pending'),
    'spacex', count(*) filter (where scope = 'spacex'),
    'blueOrigin', count(*) filter (where scope = 'blue-origin'),
    'artemis', count(*) filter (where scope = 'artemis')
  )
  from public.canonical_contracts_cache;
$function$;

grant execute on function public.replace_canonical_contracts_cache_v1(jsonb) to service_role;
grant execute on function public.get_canonical_contract_totals_v1() to service_role;
