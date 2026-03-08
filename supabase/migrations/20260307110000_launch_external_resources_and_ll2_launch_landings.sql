-- Launch detail enrichment storage for external mission bundles and LL2 launch-landings.
--
-- Goals:
-- 1) Keep SpaceX website launch-content metadata out of trajectory-only tables.
-- 2) Add a compact public read path for launch-page media/resource bundles.
-- 3) Persist LL2 launch -> landing joins for booster/spacecraft recovery lookups.
-- 4) Use a changed-row upsert RPC to avoid no-op rewrites for content bundles.

create table if not exists public.launch_external_resources (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  source text not null,
  content_type text not null,
  source_id text not null,
  confidence double precision,
  source_hash text,
  data jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launch_external_resources_source_unique unique (launch_id, source, content_type, source_id),
  constraint launch_external_resources_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1))
);

create index if not exists launch_external_resources_launch_idx
  on public.launch_external_resources (launch_id, source, content_type);

create index if not exists launch_external_resources_source_idx
  on public.launch_external_resources (source, content_type, fetched_at desc);

alter table public.launch_external_resources enable row level security;

drop policy if exists "public read launch external resources" on public.launch_external_resources;
create policy "public read launch external resources"
  on public.launch_external_resources
  for select
  using (true);

create table if not exists public.ll2_launch_landings (
  ll2_launch_uuid uuid not null,
  launch_id uuid references public.launches(id) on delete set null,
  ll2_landing_id int not null references public.ll2_landings(ll2_landing_id) on delete cascade,
  landing_role text not null default 'unknown',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ll2_launch_uuid, ll2_landing_id, landing_role),
  constraint ll2_launch_landings_role_check
    check (landing_role in ('booster', 'spacecraft', 'unknown'))
);

create index if not exists ll2_launch_landings_launch_idx
  on public.ll2_launch_landings (launch_id, fetched_at desc);

create index if not exists ll2_launch_landings_landing_idx
  on public.ll2_launch_landings (ll2_landing_id);

alter table public.ll2_launch_landings enable row level security;

drop policy if exists "public read ll2 launch landings" on public.ll2_launch_landings;
create policy "public read ll2 launch landings"
  on public.ll2_launch_landings
  for select
  using (true);

create or replace function public.upsert_launch_external_resources_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      nullif(btrim(r.source), '') as source,
      nullif(btrim(r.content_type), '') as content_type,
      nullif(btrim(r.source_id), '') as source_id,
      r.confidence,
      nullif(btrim(r.source_hash), '') as source_hash,
      coalesce(r.data, '{}'::jsonb) as data,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      source text,
      content_type text,
      source_id text,
      confidence double precision,
      source_hash text,
      data jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.launch_id is not null
  ),
  input as (
    select distinct on (i.launch_id, i.source, i.content_type, i.source_id)
      i.launch_id,
      i.source,
      i.content_type,
      i.source_id,
      i.confidence,
      i.source_hash,
      i.data,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source is not null
      and i.content_type is not null
      and i.source_id is not null
    order by i.launch_id, i.source, i.content_type, i.source_id, i.fetched_at desc, i.updated_at desc
  ),
  upserted as (
    insert into public.launch_external_resources (
      launch_id,
      source,
      content_type,
      source_id,
      confidence,
      source_hash,
      data,
      fetched_at,
      updated_at
    )
    select
      i.launch_id,
      i.source,
      i.content_type,
      i.source_id,
      i.confidence,
      i.source_hash,
      i.data,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (launch_id, source, content_type, source_id) do update
      set confidence = excluded.confidence,
          source_hash = excluded.source_hash,
          data = excluded.data,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where launch_external_resources.confidence is distinct from excluded.confidence
        or launch_external_resources.source_hash is distinct from excluded.source_hash
        or launch_external_resources.data is distinct from excluded.data
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;

revoke execute on function public.upsert_launch_external_resources_if_changed(jsonb) from public;
grant execute on function public.upsert_launch_external_resources_if_changed(jsonb) to service_role;
