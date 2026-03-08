-- Optimize launch filter lookups by using launches_public_cache, which is already
-- optimized for API reads, and add targeted supporting indexes for timeout-prone
-- paths used by the filters endpoint.

-- Add hidden column to launches_public_cache if it doesn't exist
alter table public.launches_public_cache
  add column if not exists hidden boolean not null default false;

-- Add pad_country_code column to launches_public_cache if it doesn't exist
alter table public.launches_public_cache
  add column if not exists pad_country_code text;

-- Add pad_state column to launches_public_cache if it doesn't exist
alter table public.launches_public_cache
  add column if not exists pad_state text;

create or replace function public.get_launch_filter_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;

alter function public.get_launch_filter_options() set search_path = pg_catalog, public;

create or replace function public.get_launch_filter_options_all()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;

alter function public.get_launch_filter_options_all() set search_path = pg_catalog, public;

create or replace function public.get_launch_filter_options_non_us()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;

alter function public.get_launch_filter_options_non_us() set search_path = pg_catalog, public;

create index if not exists launches_public_cache_filter_provider_idx
  on public.launches_public_cache (hidden, pad_country_code, provider)
  where provider is not null and provider <> '';

create index if not exists launches_public_cache_filter_state_idx
  on public.launches_public_cache (hidden, pad_country_code, pad_state)
  where pad_state is not null and pad_state <> '';

create index if not exists launches_public_cache_filter_status_idx
  on public.launches_public_cache (hidden, pad_country_code, status_name)
  where status_name is not null and status_name <> '';

create index if not exists artemis_procurement_awards_source_doc_updated_idx
  on public.artemis_procurement_awards(source_document_id, updated_at desc, awarded_on desc)
  where source_document_id is not null;

create index if not exists artemis_procurement_awards_scope_awarded_updated_idx
  on public.artemis_procurement_awards(program_scope, awarded_on desc, updated_at desc)
  where program_scope is not null;
