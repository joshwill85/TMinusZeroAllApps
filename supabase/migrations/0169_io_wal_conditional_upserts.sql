-- Reduce WAL write amplification from high-frequency upserts.
--
-- Freshness stays the same (we still ingest on the same cadence), but we avoid rewriting rows when nothing changed.

-- Throttle membership last_seen_at updates (default: once per day per (group_code,norad_cat_id)).
insert into public.system_settings (key, value)
values ('celestrak_membership_last_seen_min_update_seconds', '86400'::jsonb)
on conflict (key) do nothing;

-- Satellites: identity-only upsert that won't overwrite non-null values with nulls,
-- and won't touch updated_at unless intl_des/object_name actually changed.
create or replace function public.upsert_satellite_identities_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      (r.norad_cat_id)::bigint as norad_cat_id,
      nullif(btrim(r.intl_des), '') as intl_des,
      nullif(btrim(r.object_name), '') as object_name,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      norad_cat_id text,
      intl_des text,
      object_name text,
      updated_at timestamptz
    )
    where r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellites (norad_cat_id, intl_des, object_name, updated_at)
    select
      norad_cat_id,
      intl_des,
      object_name,
      updated_at
    from input
    on conflict (norad_cat_id) do update
      set intl_des = coalesce(excluded.intl_des, satellites.intl_des),
          object_name = coalesce(excluded.object_name, satellites.object_name),
          updated_at = excluded.updated_at
      where satellites.intl_des is distinct from coalesce(excluded.intl_des, satellites.intl_des)
         or satellites.object_name is distinct from coalesce(excluded.object_name, satellites.object_name)
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

alter function public.upsert_satellite_identities_if_changed(jsonb) set search_path = public;
revoke execute on function public.upsert_satellite_identities_if_changed(jsonb) from public;
grant execute on function public.upsert_satellite_identities_if_changed(jsonb) to service_role;

-- Satellite group memberships: upsert with last_seen_at throttling to reduce hot updates.
create or replace function public.upsert_satellite_group_memberships_throttled(rows_in jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  min_update_seconds int := 86400;
  raw_value jsonb;
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0, 'minUpdateSeconds', min_update_seconds);
  end if;

  select value into raw_value
  from public.system_settings
  where key = 'celestrak_membership_last_seen_min_update_seconds'
  limit 1;

  if raw_value is not null then
    min_update_seconds := case
      when jsonb_typeof(raw_value) = 'number' then (raw_value::text)::int
      when jsonb_typeof(raw_value) = 'string' then (trim(both '\"' from raw_value::text))::int
      else min_update_seconds
    end;
  end if;

  min_update_seconds := greatest(0, least(coalesce(min_update_seconds, 86400), 604800)); -- 0..7d

  with input as (
    select
      nullif(btrim(r.group_code), '') as group_code,
      (r.norad_cat_id)::bigint as norad_cat_id,
      coalesce(r.last_seen_at, now()) as last_seen_at
    from jsonb_to_recordset(rows_in) as r(
      group_code text,
      norad_cat_id text,
      last_seen_at timestamptz
    )
    where r.group_code is not null
      and btrim(r.group_code) <> ''
      and r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellite_group_memberships (group_code, norad_cat_id, first_seen_at, last_seen_at)
    select
      group_code,
      norad_cat_id,
      last_seen_at,
      last_seen_at
    from input
    on conflict (group_code, norad_cat_id) do update
      set last_seen_at = greatest(satellite_group_memberships.last_seen_at, excluded.last_seen_at)
      where excluded.last_seen_at >= satellite_group_memberships.last_seen_at + (min_update_seconds * interval '1 second')
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted),
    'minUpdateSeconds', min_update_seconds
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

alter function public.upsert_satellite_group_memberships_throttled(jsonb) set search_path = public;
revoke execute on function public.upsert_satellite_group_memberships_throttled(jsonb) from public;
grant execute on function public.upsert_satellite_group_memberships_throttled(jsonb) to service_role;

-- LL2 catalog cache: only update rows when the payload actually changes.
create or replace function public.upsert_ll2_catalog_public_cache_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      nullif(btrim(r.entity_type), '') as entity_type,
      nullif(btrim(r.entity_id), '') as entity_id,
      nullif(btrim(r.name), '') as name,
      nullif(btrim(r.slug), '') as slug,
      nullif(btrim(r.description), '') as description,
      case
        when r.country_codes is null then null
        when jsonb_typeof(r.country_codes) = 'array' then (
          select array_agg(value)
          from jsonb_array_elements_text(r.country_codes) as value
        )
        else null
      end as country_codes,
      nullif(btrim(r.image_url), '') as image_url,
      r.data as data,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      entity_type text,
      entity_id text,
      name text,
      slug text,
      description text,
      country_codes jsonb,
      image_url text,
      data jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.entity_type is not null
      and btrim(r.entity_type) <> ''
      and r.entity_id is not null
      and btrim(r.entity_id) <> ''
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_catalog_public_cache (
      entity_type,
      entity_id,
      name,
      slug,
      description,
      country_codes,
      image_url,
      data,
      fetched_at,
      updated_at
    )
    select
      entity_type,
      entity_id,
      name,
      slug,
      description,
      country_codes,
      image_url,
      data,
      fetched_at,
      updated_at
    from input
    on conflict (entity_type, entity_id) do update
      set name = excluded.name,
          slug = excluded.slug,
          description = excluded.description,
          country_codes = excluded.country_codes,
          image_url = excluded.image_url,
          data = excluded.data,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where ll2_catalog_public_cache.name is distinct from excluded.name
         or ll2_catalog_public_cache.slug is distinct from excluded.slug
         or ll2_catalog_public_cache.description is distinct from excluded.description
         or ll2_catalog_public_cache.country_codes is distinct from excluded.country_codes
         or ll2_catalog_public_cache.image_url is distinct from excluded.image_url
         or ll2_catalog_public_cache.data is distinct from excluded.data
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

alter function public.upsert_ll2_catalog_public_cache_if_changed(jsonb) set search_path = public;
revoke execute on function public.upsert_ll2_catalog_public_cache_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_catalog_public_cache_if_changed(jsonb) to service_role;

