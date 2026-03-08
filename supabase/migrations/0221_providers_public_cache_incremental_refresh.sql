-- Make providers_public_cache refresh incremental so ingestion-cycle no longer needs
-- a full launches_public_cache scan on every mutation.

create index if not exists launches_public_cache_provider_key_generated_idx
  on public.launches_public_cache ((lower(btrim(provider))), cache_generated_at desc)
  where provider is not null
    and btrim(provider) <> ''
    and lower(btrim(provider)) <> 'unknown';

create or replace function public.refresh_providers_public_cache_for_keys(provider_keys_in text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
  v_full_refresh boolean := provider_keys_in is null or coalesce(array_length(provider_keys_in, 1), 0) = 0;
begin
  with normalized_keys as (
    select distinct lower(btrim(k)) as provider_key
    from unnest(coalesce(provider_keys_in, array[]::text[])) as k
    where k is not null
      and btrim(k) <> ''
      and lower(btrim(k)) <> 'unknown'
  ),
  src as (
    select
      lower(btrim(c.provider)) as provider_key,
      btrim(c.provider) as provider_name,
      nullif(btrim(c.provider_type), '') as provider_type,
      nullif(btrim(c.provider_country_code), '') as provider_country_code,
      nullif(btrim(c.provider_description), '') as provider_description,
      nullif(btrim(c.provider_logo_url), '') as provider_logo_url,
      nullif(btrim(c.provider_image_url), '') as provider_image_url,
      c.cache_generated_at
    from public.launches_public_cache c
    where c.provider is not null
      and btrim(c.provider) <> ''
      and lower(btrim(c.provider)) <> 'unknown'
      and (
        v_full_refresh
        or lower(btrim(c.provider)) in (select provider_key from normalized_keys)
      )
  ),
  dedup as (
    select
      s.provider_key,
      (array_agg(s.provider_name order by s.cache_generated_at desc nulls last, s.provider_name desc))[1] as name,
      (array_agg(s.provider_type order by (s.provider_type is null), s.cache_generated_at desc nulls last))[1] as provider_type,
      (array_agg(s.provider_country_code order by (s.provider_country_code is null), s.cache_generated_at desc nulls last))[1] as provider_country_code,
      (array_agg(s.provider_description order by (s.provider_description is null), s.cache_generated_at desc nulls last))[1] as provider_description,
      (array_agg(s.provider_logo_url order by (s.provider_logo_url is null), s.cache_generated_at desc nulls last))[1] as provider_logo_url,
      (array_agg(s.provider_image_url order by (s.provider_image_url is null), s.cache_generated_at desc nulls last))[1] as provider_image_url
    from src s
    group by s.provider_key
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
      d.provider_key,
      d.name,
      d.provider_type,
      d.provider_country_code,
      d.provider_description,
      d.provider_logo_url,
      d.provider_image_url,
      now()
    from dedup d
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
    where
      (
        v_full_refresh
        or p.provider_key in (select provider_key from normalized_keys)
      )
      and not exists (select 1 from dedup d where d.provider_key = p.provider_key)
    returning 1
  )
  select jsonb_build_object(
    'mode', case when v_full_refresh then 'full' else 'incremental' end,
    'targetedKeys', case when v_full_refresh then null else (select count(*) from normalized_keys) end,
    'input', (select count(*) from dedup),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'removed', (select count(*) from deleted)
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'mode', case when v_full_refresh then 'full' else 'incremental' end,
      'targetedKeys', case when v_full_refresh then null else 0 end,
      'input', 0,
      'inserted', 0,
      'updated', 0,
      'removed', 0
    )
  );
end;
$$;

create or replace function public.refresh_providers_public_cache()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return public.refresh_providers_public_cache_for_keys(null);
end;
$$;

revoke execute on function public.refresh_providers_public_cache_for_keys(text[]) from public;
grant execute on function public.refresh_providers_public_cache_for_keys(text[]) to service_role;

revoke execute on function public.refresh_providers_public_cache() from public;
grant execute on function public.refresh_providers_public_cache() to service_role;
