-- Providers public cache
--
-- Avoid scanning launches_public_cache (and spilling temp) for provider listing pages.
-- This cache is derived from launches_public_cache and refreshed by the ingestion-cycle Edge function.

create table if not exists public.providers_public_cache (
  provider_key text primary key, -- normalized key (lower + trim) for stable dedupe
  name text not null,
  provider_type text,
  provider_country_code text,
  provider_description text,
  provider_logo_url text,
  provider_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists providers_public_cache_name_idx on public.providers_public_cache(name);

alter table public.providers_public_cache enable row level security;

drop policy if exists "public read providers cache" on public.providers_public_cache;
create policy "public read providers cache"
  on public.providers_public_cache
  for select
  using (true);

-- Refresh helper (service-role only).
create or replace function public.refresh_providers_public_cache()
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
begin
  with src as (
    select
      lower(btrim(provider)) as provider_key,
      btrim(provider) as provider_name,
      nullif(btrim(provider_type), '') as provider_type,
      nullif(btrim(provider_country_code), '') as provider_country_code,
      nullif(btrim(provider_description), '') as provider_description,
      nullif(btrim(provider_logo_url), '') as provider_logo_url,
      nullif(btrim(provider_image_url), '') as provider_image_url,
      cache_generated_at
    from public.launches_public_cache
    where provider is not null
      and btrim(provider) <> ''
      and lower(btrim(provider)) <> 'unknown'
  ),
  ranked as (
    select
      provider_key,
      first_value(provider_name) over (partition by provider_key order by cache_generated_at desc nulls last) as name_latest,
      first_value(provider_type) over (
        partition by provider_key
        order by (provider_type is not null) desc, cache_generated_at desc nulls last
      ) as provider_type_best,
      first_value(provider_country_code) over (
        partition by provider_key
        order by (provider_country_code is not null) desc, cache_generated_at desc nulls last
      ) as provider_country_code_best,
      first_value(provider_description) over (
        partition by provider_key
        order by (provider_description is not null) desc, cache_generated_at desc nulls last
      ) as provider_description_best,
      first_value(provider_logo_url) over (
        partition by provider_key
        order by (provider_logo_url is not null) desc, cache_generated_at desc nulls last
      ) as provider_logo_url_best,
      first_value(provider_image_url) over (
        partition by provider_key
        order by (provider_image_url is not null) desc, cache_generated_at desc nulls last
      ) as provider_image_url_best
    from src
  ),
  dedup as (
    select distinct on (provider_key)
      provider_key,
      name_latest as name,
      provider_type_best as provider_type,
      provider_country_code_best as provider_country_code,
      provider_description_best as provider_description,
      provider_logo_url_best as provider_logo_url,
      provider_image_url_best as provider_image_url
    from ranked
    order by provider_key
  ),
  upserted as (
    insert into public.providers_public_cache (
      provider_key,
      name,
      provider_type,
      provider_country_code,
      provider_description,
      provider_logo_url,
      provider_image_url,
      updated_at
    )
    select
      provider_key,
      name,
      provider_type,
      provider_country_code,
      provider_description,
      provider_logo_url,
      provider_image_url,
      now()
    from dedup
    on conflict (provider_key) do update
      set name = excluded.name,
          provider_type = excluded.provider_type,
          provider_country_code = excluded.provider_country_code,
          provider_description = excluded.provider_description,
          provider_logo_url = excluded.provider_logo_url,
          provider_image_url = excluded.provider_image_url,
          updated_at = excluded.updated_at
      where
        providers_public_cache.name is distinct from excluded.name
        or providers_public_cache.provider_type is distinct from excluded.provider_type
        or providers_public_cache.provider_country_code is distinct from excluded.provider_country_code
        or providers_public_cache.provider_description is distinct from excluded.provider_description
        or providers_public_cache.provider_logo_url is distinct from excluded.provider_logo_url
        or providers_public_cache.provider_image_url is distinct from excluded.provider_image_url
    returning (xmax = 0) as inserted
  ),
  deleted as (
    delete from public.providers_public_cache p
    where not exists (select 1 from dedup d where d.provider_key = p.provider_key)
    returning 1
  )
  select jsonb_build_object(
    'input', (select count(*) from dedup),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'removed', (select count(*) from deleted)
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

alter function public.refresh_providers_public_cache() set search_path = public;
revoke execute on function public.refresh_providers_public_cache() from public;
grant execute on function public.refresh_providers_public_cache() to service_role;

