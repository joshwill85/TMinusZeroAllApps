-- Public satellite detail (read-only) for deep linking / SEO.
-- Uses SECURITY DEFINER so anon/auth can read SATCAT + latest orbit elements without exposing raw tables.

create or replace function public.get_satellite_detail(norad_cat_id_in bigint)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with sat as (
    select
      norad_cat_id,
      intl_des,
      object_name,
      object_type,
      ops_status_code,
      owner,
      launch_date,
      launch_site,
      decay_date,
      period_min,
      inclination_deg,
      apogee_km,
      perigee_km,
      rcs_m2,
      satcat_updated_at
    from public.satellites
    where norad_cat_id = norad_cat_id_in
    limit 1
  ),
  orbit as (
    select
      source,
      epoch,
      inclination_deg,
      raan_deg,
      eccentricity,
      arg_perigee_deg,
      mean_anomaly_deg,
      mean_motion_rev_per_day,
      bstar,
      fetched_at
    from public.orbit_elements
    where norad_cat_id = norad_cat_id_in
    order by epoch desc
    limit 1
  ),
  groups as (
    select array_agg(group_code order by group_code) as group_codes
    from public.satellite_group_memberships
    where norad_cat_id = norad_cat_id_in
  )
  select coalesce(
    (
      select jsonb_build_object(
        'norad_cat_id', sat.norad_cat_id,
        'intl_des', sat.intl_des,
        'name', sat.object_name,
        'object_type', sat.object_type,
        'ops_status_code', sat.ops_status_code,
        'owner', sat.owner,
        'launch_date', sat.launch_date,
        'launch_site', sat.launch_site,
        'decay_date', sat.decay_date,
        'period_min', sat.period_min,
        'inclination_deg', sat.inclination_deg,
        'apogee_km', sat.apogee_km,
        'perigee_km', sat.perigee_km,
        'rcs_m2', sat.rcs_m2,
        'satcat_updated_at', sat.satcat_updated_at,
        'orbit', (
          select jsonb_build_object(
            'source', orbit.source,
            'epoch', orbit.epoch,
            'inclination_deg', orbit.inclination_deg,
            'raan_deg', orbit.raan_deg,
            'eccentricity', orbit.eccentricity,
            'arg_perigee_deg', orbit.arg_perigee_deg,
            'mean_anomaly_deg', orbit.mean_anomaly_deg,
            'mean_motion_rev_per_day', orbit.mean_motion_rev_per_day,
            'bstar', orbit.bstar,
            'fetched_at', orbit.fetched_at
          )
          from orbit
        ),
        'groups', (select group_codes from groups)
      )
      from sat
    ),
    '{}'::jsonb
  );
$$;

grant execute on function public.get_satellite_detail(bigint) to anon, authenticated;

