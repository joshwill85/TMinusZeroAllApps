-- Reduce write churn for LL2 catalog reference tables + FAA launch matching.
--
-- 1) LL2: upsert only when payload changed (skip no-op rewrites)
-- 2) FAA: merge auto-match rows in place (replace delete+insert cycles)

create or replace function public.upsert_ll2_locations_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_location_id,
      r.name,
      r.country_code,
      r.timezone_name,
      r.latitude,
      r.longitude,
      r.description,
      r.map_image,
      r.total_launch_count,
      r.total_landing_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_location_id int,
      name text,
      country_code text,
      timezone_name text,
      latitude double precision,
      longitude double precision,
      description text,
      map_image text,
      total_launch_count int,
      total_landing_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_location_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_locations (
      ll2_location_id,
      name,
      country_code,
      timezone_name,
      latitude,
      longitude,
      description,
      map_image,
      total_launch_count,
      total_landing_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_location_id,
      i.name,
      i.country_code,
      i.timezone_name,
      i.latitude,
      i.longitude,
      i.description,
      i.map_image,
      i.total_launch_count,
      i.total_landing_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_location_id) do update
      set name = excluded.name,
          country_code = excluded.country_code,
          timezone_name = excluded.timezone_name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          description = excluded.description,
          map_image = excluded.map_image,
          total_launch_count = excluded.total_launch_count,
          total_landing_count = excluded.total_landing_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_locations.name is distinct from excluded.name
        or ll2_locations.country_code is distinct from excluded.country_code
        or ll2_locations.timezone_name is distinct from excluded.timezone_name
        or ll2_locations.latitude is distinct from excluded.latitude
        or ll2_locations.longitude is distinct from excluded.longitude
        or ll2_locations.description is distinct from excluded.description
        or ll2_locations.map_image is distinct from excluded.map_image
        or ll2_locations.total_launch_count is distinct from excluded.total_launch_count
        or ll2_locations.total_landing_count is distinct from excluded.total_landing_count
        or ll2_locations.raw is distinct from excluded.raw
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

create or replace function public.upsert_ll2_pads_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_pad_id,
      r.ll2_location_id,
      r.name,
      r.latitude,
      r.longitude,
      r.state_code,
      r.agency_id,
      r.description,
      r.info_url,
      r.wiki_url,
      r.map_url,
      r.map_image,
      r.country_code,
      r.total_launch_count,
      r.orbital_launch_attempt_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_pad_id int,
      ll2_location_id int,
      name text,
      latitude double precision,
      longitude double precision,
      state_code text,
      agency_id text,
      description text,
      info_url text,
      wiki_url text,
      map_url text,
      map_image text,
      country_code text,
      total_launch_count int,
      orbital_launch_attempt_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_pad_id is not null
      and r.ll2_location_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_pads (
      ll2_pad_id,
      ll2_location_id,
      name,
      latitude,
      longitude,
      state_code,
      agency_id,
      description,
      info_url,
      wiki_url,
      map_url,
      map_image,
      country_code,
      total_launch_count,
      orbital_launch_attempt_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_pad_id,
      i.ll2_location_id,
      i.name,
      i.latitude,
      i.longitude,
      i.state_code,
      i.agency_id,
      i.description,
      i.info_url,
      i.wiki_url,
      i.map_url,
      i.map_image,
      i.country_code,
      i.total_launch_count,
      i.orbital_launch_attempt_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_pad_id) do update
      set ll2_location_id = excluded.ll2_location_id,
          name = excluded.name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          state_code = excluded.state_code,
          agency_id = excluded.agency_id,
          description = excluded.description,
          info_url = excluded.info_url,
          wiki_url = excluded.wiki_url,
          map_url = excluded.map_url,
          map_image = excluded.map_image,
          country_code = excluded.country_code,
          total_launch_count = excluded.total_launch_count,
          orbital_launch_attempt_count = excluded.orbital_launch_attempt_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_pads.ll2_location_id is distinct from excluded.ll2_location_id
        or ll2_pads.name is distinct from excluded.name
        or ll2_pads.latitude is distinct from excluded.latitude
        or ll2_pads.longitude is distinct from excluded.longitude
        or ll2_pads.state_code is distinct from excluded.state_code
        or ll2_pads.agency_id is distinct from excluded.agency_id
        or ll2_pads.description is distinct from excluded.description
        or ll2_pads.info_url is distinct from excluded.info_url
        or ll2_pads.wiki_url is distinct from excluded.wiki_url
        or ll2_pads.map_url is distinct from excluded.map_url
        or ll2_pads.map_image is distinct from excluded.map_image
        or ll2_pads.country_code is distinct from excluded.country_code
        or ll2_pads.total_launch_count is distinct from excluded.total_launch_count
        or ll2_pads.orbital_launch_attempt_count is distinct from excluded.orbital_launch_attempt_count
        or ll2_pads.raw is distinct from excluded.raw
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

create or replace function public.upsert_ll2_rocket_configs_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_config_id,
      r.name,
      r.full_name,
      r.family,
      r.manufacturer,
      r.variant,
      r.reusable,
      r.image_url,
      r.info_url,
      r.wiki_url,
      r.manufacturer_id,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_config_id int,
      name text,
      full_name text,
      family text,
      manufacturer text,
      variant text,
      reusable boolean,
      image_url text,
      info_url text,
      wiki_url text,
      manufacturer_id int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_config_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_rocket_configs (
      ll2_config_id,
      name,
      full_name,
      family,
      manufacturer,
      variant,
      reusable,
      image_url,
      info_url,
      wiki_url,
      manufacturer_id,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_config_id,
      i.name,
      i.full_name,
      i.family,
      i.manufacturer,
      i.variant,
      i.reusable,
      i.image_url,
      i.info_url,
      i.wiki_url,
      i.manufacturer_id,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_config_id) do update
      set name = excluded.name,
          full_name = excluded.full_name,
          family = excluded.family,
          manufacturer = excluded.manufacturer,
          variant = excluded.variant,
          reusable = excluded.reusable,
          image_url = excluded.image_url,
          info_url = excluded.info_url,
          wiki_url = excluded.wiki_url,
          manufacturer_id = excluded.manufacturer_id,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_rocket_configs.name is distinct from excluded.name
        or ll2_rocket_configs.full_name is distinct from excluded.full_name
        or ll2_rocket_configs.family is distinct from excluded.family
        or ll2_rocket_configs.manufacturer is distinct from excluded.manufacturer
        or ll2_rocket_configs.variant is distinct from excluded.variant
        or ll2_rocket_configs.reusable is distinct from excluded.reusable
        or ll2_rocket_configs.image_url is distinct from excluded.image_url
        or ll2_rocket_configs.info_url is distinct from excluded.info_url
        or ll2_rocket_configs.wiki_url is distinct from excluded.wiki_url
        or ll2_rocket_configs.manufacturer_id is distinct from excluded.manufacturer_id
        or ll2_rocket_configs.raw is distinct from excluded.raw
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

create or replace function public.upsert_ll2_launchers_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_launcher_id,
      r.serial_number,
      r.flight_proven,
      r.status,
      r.details,
      r.image_url,
      r.launcher_config_id,
      r.flights,
      r.first_launch_date,
      r.last_launch_date,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_launcher_id int,
      serial_number text,
      flight_proven boolean,
      status text,
      details text,
      image_url text,
      launcher_config_id int,
      flights jsonb,
      first_launch_date date,
      last_launch_date date,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_launcher_id is not null
  ),
  upserted as (
    insert into public.ll2_launchers (
      ll2_launcher_id,
      serial_number,
      flight_proven,
      status,
      details,
      image_url,
      launcher_config_id,
      flights,
      first_launch_date,
      last_launch_date,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_launcher_id,
      i.serial_number,
      i.flight_proven,
      i.status,
      i.details,
      i.image_url,
      i.launcher_config_id,
      i.flights,
      i.first_launch_date,
      i.last_launch_date,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_launcher_id) do update
      set serial_number = excluded.serial_number,
          flight_proven = excluded.flight_proven,
          status = excluded.status,
          details = excluded.details,
          image_url = excluded.image_url,
          launcher_config_id = excluded.launcher_config_id,
          flights = excluded.flights,
          first_launch_date = excluded.first_launch_date,
          last_launch_date = excluded.last_launch_date,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_launchers.serial_number is distinct from excluded.serial_number
        or ll2_launchers.flight_proven is distinct from excluded.flight_proven
        or ll2_launchers.status is distinct from excluded.status
        or ll2_launchers.details is distinct from excluded.details
        or ll2_launchers.image_url is distinct from excluded.image_url
        or ll2_launchers.launcher_config_id is distinct from excluded.launcher_config_id
        or ll2_launchers.flights is distinct from excluded.flights
        or ll2_launchers.first_launch_date is distinct from excluded.first_launch_date
        or ll2_launchers.last_launch_date is distinct from excluded.last_launch_date
        or ll2_launchers.raw is distinct from excluded.raw
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

create or replace function public.upsert_ll2_astronauts_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_astronaut_id,
      r.name,
      r.status,
      r.type,
      r.agency_id,
      r.agency_name,
      r.nationality,
      r.in_space,
      r.time_in_space,
      r.eva_time,
      r.age,
      r.date_of_birth,
      r.date_of_death,
      r.bio,
      r.profile_image,
      r.profile_image_thumbnail,
      r.twitter,
      r.instagram,
      r.wiki,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_astronaut_id int,
      name text,
      status text,
      type text,
      agency_id int,
      agency_name text,
      nationality text,
      in_space boolean,
      time_in_space text,
      eva_time text,
      age int,
      date_of_birth date,
      date_of_death date,
      bio text,
      profile_image text,
      profile_image_thumbnail text,
      twitter text,
      instagram text,
      wiki text,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_astronaut_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_astronauts (
      ll2_astronaut_id,
      name,
      status,
      type,
      agency_id,
      agency_name,
      nationality,
      in_space,
      time_in_space,
      eva_time,
      age,
      date_of_birth,
      date_of_death,
      bio,
      profile_image,
      profile_image_thumbnail,
      twitter,
      instagram,
      wiki,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_astronaut_id,
      i.name,
      i.status,
      i.type,
      i.agency_id,
      i.agency_name,
      i.nationality,
      i.in_space,
      i.time_in_space,
      i.eva_time,
      i.age,
      i.date_of_birth,
      i.date_of_death,
      i.bio,
      i.profile_image,
      i.profile_image_thumbnail,
      i.twitter,
      i.instagram,
      i.wiki,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_astronaut_id) do update
      set name = excluded.name,
          status = excluded.status,
          type = excluded.type,
          agency_id = excluded.agency_id,
          agency_name = excluded.agency_name,
          nationality = excluded.nationality,
          in_space = excluded.in_space,
          time_in_space = excluded.time_in_space,
          eva_time = excluded.eva_time,
          age = excluded.age,
          date_of_birth = excluded.date_of_birth,
          date_of_death = excluded.date_of_death,
          bio = excluded.bio,
          profile_image = excluded.profile_image,
          profile_image_thumbnail = excluded.profile_image_thumbnail,
          twitter = excluded.twitter,
          instagram = excluded.instagram,
          wiki = excluded.wiki,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_astronauts.name is distinct from excluded.name
        or ll2_astronauts.status is distinct from excluded.status
        or ll2_astronauts.type is distinct from excluded.type
        or ll2_astronauts.agency_id is distinct from excluded.agency_id
        or ll2_astronauts.agency_name is distinct from excluded.agency_name
        or ll2_astronauts.nationality is distinct from excluded.nationality
        or ll2_astronauts.in_space is distinct from excluded.in_space
        or ll2_astronauts.time_in_space is distinct from excluded.time_in_space
        or ll2_astronauts.eva_time is distinct from excluded.eva_time
        or ll2_astronauts.age is distinct from excluded.age
        or ll2_astronauts.date_of_birth is distinct from excluded.date_of_birth
        or ll2_astronauts.date_of_death is distinct from excluded.date_of_death
        or ll2_astronauts.bio is distinct from excluded.bio
        or ll2_astronauts.profile_image is distinct from excluded.profile_image
        or ll2_astronauts.profile_image_thumbnail is distinct from excluded.profile_image_thumbnail
        or ll2_astronauts.twitter is distinct from excluded.twitter
        or ll2_astronauts.instagram is distinct from excluded.instagram
        or ll2_astronauts.wiki is distinct from excluded.wiki
        or ll2_astronauts.raw is distinct from excluded.raw
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

create index if not exists faa_launch_matches_auto_record_updated_idx
  on public.faa_launch_matches(match_origin, faa_tfr_record_id, updated_at desc, id desc);

create or replace function public.upsert_faa_launch_matches_auto_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'dedupDeleted', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      r.faa_tfr_record_id,
      r.faa_tfr_shape_id,
      coalesce(nullif(btrim(r.match_status), ''), 'unmatched') as match_status,
      r.match_confidence,
      r.match_score,
      r.match_strategy,
      coalesce(r.match_meta, '{}'::jsonb) as match_meta,
      coalesce(r.matched_at, now()) as matched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      faa_tfr_record_id uuid,
      faa_tfr_shape_id uuid,
      match_status text,
      match_confidence int,
      match_score double precision,
      match_strategy text,
      match_meta jsonb,
      matched_at timestamptz,
      updated_at timestamptz
    )
    where r.faa_tfr_record_id is not null
  ),
  input as (
    select distinct on (i.faa_tfr_record_id)
      i.launch_id,
      i.faa_tfr_record_id,
      i.faa_tfr_shape_id,
      case
        when i.match_status in ('matched', 'ambiguous', 'unmatched', 'manual') then i.match_status
        else 'unmatched'
      end as match_status,
      i.match_confidence,
      i.match_score,
      i.match_strategy,
      i.match_meta,
      i.matched_at,
      i.updated_at
    from input_raw i
    order by i.faa_tfr_record_id, i.matched_at desc nulls last, i.updated_at desc nulls last
  ),
  existing_ranked as (
    select
      m.id,
      m.faa_tfr_record_id,
      row_number() over (partition by m.faa_tfr_record_id order by m.updated_at desc nulls last, m.id desc) as rn
    from public.faa_launch_matches m
    join input i
      on i.faa_tfr_record_id = m.faa_tfr_record_id
    where m.match_origin = 'auto'
  ),
  primary_existing as (
    select e.id, e.faa_tfr_record_id
    from existing_ranked e
    where e.rn = 1
  ),
  updated as (
    update public.faa_launch_matches m
    set launch_id = i.launch_id,
        faa_tfr_shape_id = i.faa_tfr_shape_id,
        match_status = i.match_status,
        match_confidence = i.match_confidence,
        match_score = i.match_score,
        match_strategy = i.match_strategy,
        match_meta = i.match_meta,
        matched_at = i.matched_at,
        updated_at = i.updated_at
    from input i
    join primary_existing p
      on p.faa_tfr_record_id = i.faa_tfr_record_id
    where m.id = p.id
      and (
        m.launch_id is distinct from i.launch_id
        or m.faa_tfr_shape_id is distinct from i.faa_tfr_shape_id
        or m.match_status is distinct from i.match_status
        or m.match_confidence is distinct from i.match_confidence
        or m.match_score is distinct from i.match_score
        or m.match_strategy is distinct from i.match_strategy
        or m.match_meta is distinct from i.match_meta
      )
    returning m.faa_tfr_record_id
  ),
  inserted as (
    insert into public.faa_launch_matches (
      launch_id,
      faa_tfr_record_id,
      faa_tfr_shape_id,
      match_status,
      match_confidence,
      match_score,
      match_strategy,
      match_meta,
      match_origin,
      matched_at,
      updated_at
    )
    select
      i.launch_id,
      i.faa_tfr_record_id,
      i.faa_tfr_shape_id,
      i.match_status,
      i.match_confidence,
      i.match_score,
      i.match_strategy,
      i.match_meta,
      'auto',
      i.matched_at,
      i.updated_at
    from input i
    where not exists (
      select 1
      from primary_existing p
      where p.faa_tfr_record_id = i.faa_tfr_record_id
    )
    returning faa_tfr_record_id
  ),
  dedup_deleted as (
    delete from public.faa_launch_matches m
    using existing_ranked e
    where m.id = e.id
      and e.rn > 1
    returning 1
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from inserted),
    'updated', (select count(*) from updated),
    'dedupDeleted', (select count(*) from dedup_deleted),
    'skipped', (select count(*) from input) - (select count(*) from inserted) - (select count(*) from updated)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'dedupDeleted', 0, 'skipped', 0));
end;
$$;

revoke execute on function public.upsert_ll2_locations_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_locations_if_changed(jsonb) to service_role;

revoke execute on function public.upsert_ll2_pads_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_pads_if_changed(jsonb) to service_role;

revoke execute on function public.upsert_ll2_rocket_configs_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_rocket_configs_if_changed(jsonb) to service_role;

revoke execute on function public.upsert_ll2_launchers_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_launchers_if_changed(jsonb) to service_role;

revoke execute on function public.upsert_ll2_astronauts_if_changed(jsonb) from public;
grant execute on function public.upsert_ll2_astronauts_if_changed(jsonb) to service_role;

revoke execute on function public.upsert_faa_launch_matches_auto_if_changed(jsonb) from public;
grant execute on function public.upsert_faa_launch_matches_auto_if_changed(jsonb) to service_role;
