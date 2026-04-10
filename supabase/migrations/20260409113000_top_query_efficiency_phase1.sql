-- Phase 1 read-path efficiency fixes for the current highest-cost queries.
-- Focus:
-- 1) Add the missing sort/search indexes used by the top hot paths.
-- 2) Materialize Artemis normalized-contract procurement rows for hub reads.
-- 3) Add narrow helper RPCs for latest successful ingestion runs and SpaceX contract metrics/detail.

set local statement_timeout = 0;

create extension if not exists pg_trgm;

create index if not exists artemis_contract_actions_updated_action_contract_idx
  on public.artemis_contract_actions(updated_at desc, action_date desc nulls last, contract_id desc);

create index if not exists artemis_contracts_updated_id_idx
  on public.artemis_contracts(updated_at desc, id desc);

create index if not exists artemis_contracts_base_award_updated_id_idx
  on public.artemis_contracts(base_award_date desc nulls last, updated_at desc, id desc);

create index if not exists launches_public_cache_name_trgm_idx
  on public.launches_public_cache
  using gin (name gin_trgm_ops)
  where name is not null;

create index if not exists launches_public_cache_mission_name_trgm_idx
  on public.launches_public_cache
  using gin (mission_name gin_trgm_ops)
  where mission_name is not null;

create index if not exists launches_public_cache_provider_trgm_idx
  on public.launches_public_cache
  using gin (provider gin_trgm_ops)
  where provider is not null;

create index if not exists satellites_satcat_updated_norad_idx
  on public.satellites(satcat_updated_at desc, norad_cat_id desc)
  where norad_cat_id is not null;

create table if not exists public.artemis_program_procurement_cache (
  contract_id uuid primary key references public.artemis_contracts(id) on delete cascade,
  usaspending_award_id text,
  contract_key text not null,
  mission_key text not null default 'program',
  recipient text,
  award_title text,
  obligated_amount numeric,
  awarded_on date,
  solicitation_id text,
  action_count integer not null default 0,
  latest_mod_number text,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists artemis_program_procurement_cache_order_idx
  on public.artemis_program_procurement_cache(updated_at desc, awarded_on desc nulls last, contract_key desc);

create index if not exists artemis_program_procurement_cache_mission_order_idx
  on public.artemis_program_procurement_cache(mission_key, updated_at desc, awarded_on desc nulls last, contract_key desc);

alter table public.artemis_program_procurement_cache enable row level security;

drop policy if exists "public read artemis program procurement cache" on public.artemis_program_procurement_cache;
create policy "public read artemis program procurement cache" on public.artemis_program_procurement_cache
  for select using (true);

grant select on table public.artemis_program_procurement_cache to anon;
grant select on table public.artemis_program_procurement_cache to authenticated;

create or replace function public.refresh_artemis_program_procurement_cache(contract_ids_in uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  refreshed_count integer := 0;
begin
  if contract_ids_in is null or coalesce(array_length(contract_ids_in, 1), 0) = 0 then
    delete from public.artemis_program_procurement_cache;
  else
    delete from public.artemis_program_procurement_cache
    where contract_id = any(contract_ids_in);
  end if;

  with latest_action as (
    select distinct on (a.contract_id)
      a.contract_id,
      a.solicitation_id,
      a.mod_number,
      a.source_document_id,
      a.updated_at
    from public.artemis_contract_actions a
    where contract_ids_in is null
       or a.contract_id = any(contract_ids_in)
    order by
      a.contract_id,
      a.updated_at desc nulls last,
      a.action_date desc nulls last,
      a.mod_number desc nulls last
  ),
  action_rollup as (
    select
      a.contract_id,
      sum(coalesce(a.obligation_delta, 0)) as obligated_amount,
      max(a.action_date) as awarded_on,
      count(*)::integer as action_count,
      max(a.updated_at) as latest_action_updated_at
    from public.artemis_contract_actions a
    where contract_ids_in is null
       or a.contract_id = any(contract_ids_in)
    group by a.contract_id
  ),
  rows_to_upsert as (
    select
      c.id as contract_id,
      c.piid as usaspending_award_id,
      c.contract_key,
      coalesce(c.mission_key, 'program') as mission_key,
      c.awardee_name as recipient,
      c.description as award_title,
      ar.obligated_amount,
      ar.awarded_on,
      la.solicitation_id,
      ar.action_count,
      la.mod_number as latest_mod_number,
      coalesce(la.source_document_id, c.source_document_id) as source_document_id,
      greatest(
        coalesce(c.updated_at, 'epoch'::timestamptz),
        coalesce(ar.latest_action_updated_at, 'epoch'::timestamptz)
      ) as updated_at,
      jsonb_strip_nulls(
        jsonb_build_object(
          'contractKey', c.contract_key,
          'solicitationId', la.solicitation_id,
          'latestModNumber', la.mod_number,
          'actionCount', ar.action_count,
          'awardFamily', 'contracts',
          'sourceModel', 'normalized-contracts',
          'programScope', 'artemis'
        )
      ) as metadata
    from public.artemis_contracts c
    join action_rollup ar
      on ar.contract_id = c.id
    left join latest_action la
      on la.contract_id = c.id
    where contract_ids_in is null
       or c.id = any(contract_ids_in)
  )
  insert into public.artemis_program_procurement_cache (
    contract_id,
    usaspending_award_id,
    contract_key,
    mission_key,
    recipient,
    award_title,
    obligated_amount,
    awarded_on,
    solicitation_id,
    action_count,
    latest_mod_number,
    source_document_id,
    updated_at,
    metadata
  )
  select
    contract_id,
    usaspending_award_id,
    contract_key,
    mission_key,
    recipient,
    award_title,
    obligated_amount,
    awarded_on,
    solicitation_id,
    action_count,
    latest_mod_number,
    source_document_id,
    updated_at,
    metadata
  from rows_to_upsert
  on conflict (contract_id) do update
  set
    usaspending_award_id = excluded.usaspending_award_id,
    contract_key = excluded.contract_key,
    mission_key = excluded.mission_key,
    recipient = excluded.recipient,
    award_title = excluded.award_title,
    obligated_amount = excluded.obligated_amount,
    awarded_on = excluded.awarded_on,
    solicitation_id = excluded.solicitation_id,
    action_count = excluded.action_count,
    latest_mod_number = excluded.latest_mod_number,
    source_document_id = excluded.source_document_id,
    updated_at = excluded.updated_at,
    metadata = excluded.metadata;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$function$;

grant execute on function public.refresh_artemis_program_procurement_cache(uuid[]) to service_role;

create or replace function public.get_latest_successful_ingestion_runs_v1(job_names_in text[])
returns table (
  job_name text,
  started_at timestamptz,
  ended_at timestamptz,
  success boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select distinct on (ir.job_name)
    ir.job_name,
    ir.started_at,
    ir.ended_at,
    ir.success
  from public.ingestion_runs ir
  where ir.success = true
    and ir.job_name = any(coalesce(job_names_in, array[]::text[]))
  order by ir.job_name, ir.ended_at desc nulls last, ir.started_at desc nulls last;
$function$;

grant execute on function public.get_latest_successful_ingestion_runs_v1(text[]) to service_role;

create or replace function public.normalize_spacex_contract_slug_v1(value_in text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select left(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(value_in, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ),
    128
  );
$function$;

create or replace function public.get_spacex_contract_by_slug_v1(contract_slug_in text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select coalesce(
    (
      select to_jsonb(s)
      from public.spacex_contracts s
      where public.normalize_spacex_contract_slug_v1(s.contract_key) =
            public.normalize_spacex_contract_slug_v1(contract_slug_in)
      order by
        s.awarded_on desc nulls last,
        s.updated_at desc nulls last,
        s.contract_key desc nulls last,
        s.id desc
      limit 1
    ),
    'null'::jsonb
  );
$function$;

create or replace function public.get_spacex_contract_metrics_v1()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'total_contract_count',
    count(*)::bigint,
    'total_amount',
    coalesce(sum(amount), 0)
  )
  from public.spacex_contracts;
$function$;

grant execute on function public.get_spacex_contract_by_slug_v1(text) to service_role;
grant execute on function public.get_spacex_contract_metrics_v1() to service_role;

select public.refresh_artemis_program_procurement_cache();
