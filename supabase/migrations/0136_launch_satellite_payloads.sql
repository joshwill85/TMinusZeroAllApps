-- Satellite payload list (per launch) via launch_designator -> CelesTrak SATCAT.
-- Exposes public/anon-readable JSON without opening up the underlying admin-only satellites tables.

create index if not exists satellites_intl_des_pattern_idx
  on public.satellites(intl_des text_pattern_ops);

create or replace function public.get_launch_satellite_payloads(ll2_launch_uuid_in uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with ld as (
    select launch_designator
    from public.launches
    where ll2_launch_uuid = ll2_launch_uuid_in
    limit 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'norad_cat_id', s.norad_cat_id,
        'intl_des', s.intl_des,
        'name', s.object_name,
        'object_type', s.object_type,
        'ops_status_code', s.ops_status_code,
        'owner', s.owner,
        'launch_date', s.launch_date,
        'launch_site', s.launch_site,
        'period_min', s.period_min,
        'inclination_deg', s.inclination_deg,
        'apogee_km', s.apogee_km,
        'perigee_km', s.perigee_km,
        'raw', s.raw_satcat
      )
      order by s.intl_des
    ),
    '[]'::jsonb
  )
  from ld
  join public.satellites s
    on ld.launch_designator is not null
   and s.intl_des is not null
   and s.object_type = 'PAY'
   and s.intl_des like ld.launch_designator || '%';
$$;

grant execute on function public.get_launch_satellite_payloads(uuid) to anon, authenticated;
