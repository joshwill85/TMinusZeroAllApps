-- Slim launch payload RPCs for public UI consumption.
--
-- Goals:
-- 1) Keep current launch payload/satellite UI answers intact.
-- 2) Avoid returning large raw source blobs by default.
-- 3) Preserve optional raw access for diagnostics via include_raw=true.

create or replace function public.get_launch_payload_manifest_v2(
  ll2_launch_uuid_in uuid,
  include_raw boolean default false
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  with meta as (
    select
      max(l.launch_designator) as launch_designator,
      max(l.net) as net,
      lower(coalesce(max(l.status_name), '') || ' ' || coalesce(max(l.status_abbrev), '')) as status_text
    from public.launches l
    where l.ll2_launch_uuid = ll2_launch_uuid_in
  ),
  satcat as (
    select count(*)::int as payload_count
    from meta m
    join public.satellites s
      on m.launch_designator is not null
     and s.intl_des is not null
     and s.object_type = 'PAY'
     and s.intl_des like m.launch_designator || '%'
  ),
  deployment as (
    select
      case
        when m.net is not null and m.net > now() then 'unknown'
        when sc.payload_count > 0 then 'confirmed'
        when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'unconfirmed'
        else 'unknown'
      end as deployment_status,
      to_jsonb(
        array_remove(
          array[
            case when sc.payload_count > 0 then 'satcat_payload_match' end,
            case when m.status_text like '%success%' or m.status_text like '%successful%' then 'launch_status_success' end,
            case when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'launch_status_failure' end,
            case when m.net is not null and m.net > now() then 'launch_in_future_or_pending' end
          ],
          null::text
        )
      ) as deployment_evidence,
      case
        when m.net is not null and m.net > now() then 'Launch is in the future; deployment is not yet knowable.'
        when sc.payload_count > 0 then format('Confirmed by %s SATCAT payload match(es).', sc.payload_count)
        when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'Launch outcome indicates failure/anomaly and no SATCAT deployment match was found.'
        else 'No explicit SATCAT deployment evidence is currently available.'
      end as deployment_notes
    from meta m
    cross join satcat sc
  ),
  payload_entries as (
    select
      0 as kind_order,
      pf.ll2_payload_flight_id as sort_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'kind', 'payload_flight',
          'id', pf.ll2_payload_flight_id,
          'url', pf.url,
          'destination', pf.destination,
          'amount', pf.amount,
          'deployment_status', d.deployment_status,
          'deployment_evidence', d.deployment_evidence,
          'deployment_notes', d.deployment_notes,
          'payload', jsonb_strip_nulls(
            jsonb_build_object(
              'id', p.ll2_payload_id,
              'name', p.name,
              'description', p.description,
              'mass_kg', p.mass_kg,
              'cost_usd', p.cost_usd,
              'wiki_link', p.wiki_link,
              'info_link', p.info_link,
              'program', p.program,
              'type', case
                when pt.ll2_payload_type_id is null then null
                else jsonb_build_object('id', pt.ll2_payload_type_id, 'name', pt.name)
              end,
              'manufacturer', case
                when m.ll2_agency_id is null then null
                else jsonb_build_object('id', m.ll2_agency_id, 'name', m.name, 'abbrev', m.abbrev)
              end,
              'operator', case
                when o.ll2_agency_id is null then null
                else jsonb_build_object('id', o.ll2_agency_id, 'name', o.name, 'abbrev', o.abbrev)
              end,
              'image', jsonb_strip_nulls(
                jsonb_build_object(
                  'image_url', p.image_url,
                  'thumbnail_url', p.thumbnail_url,
                  'credit', p.image_credit,
                  'license_name', p.image_license_name,
                  'license_url', p.image_license_url,
                  'single_use', p.image_single_use
                )
              ),
              'raw', case when include_raw then p.raw else null end
            )
          ),
          'landing', case
            when l.ll2_landing_id is null then null
            else jsonb_strip_nulls(
              jsonb_build_object(
                'id', l.ll2_landing_id,
                'attempt', l.attempt,
                'success', l.success,
                'description', l.description,
                'downrange_distance_km', l.downrange_distance_km,
                'landing_location', l.landing_location,
                'landing_type', l.landing_type,
                'raw', case when include_raw then l.raw else null end
              )
            )
          end,
          'docking_events', (
            select coalesce(
              jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'id', de.ll2_docking_event_id,
                    'docking', de.docking,
                    'departure', de.departure,
                    'space_station_target', de.space_station,
                    'raw', case when include_raw then de.raw else null end
                  )
                )
                order by de.docking
              ),
              '[]'::jsonb
            )
            from public.ll2_payload_flight_docking_events de
            where de.ll2_payload_flight_id = pf.ll2_payload_flight_id
          ),
          'raw', case when include_raw then pf.raw else null end
        )
      ) as entry
    from public.ll2_payload_flights pf
    left join public.ll2_payloads p on p.ll2_payload_id = pf.ll2_payload_id
    left join public.ll2_payload_types pt on pt.ll2_payload_type_id = p.payload_type_id
    left join public.ll2_agencies m on m.ll2_agency_id = p.manufacturer_id
    left join public.ll2_agencies o on o.ll2_agency_id = p.operator_id
    left join public.ll2_landings l on l.ll2_landing_id = pf.ll2_landing_id
    cross join deployment d
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  spacecraft_entries as (
    select
      1 as kind_order,
      sf.ll2_spacecraft_flight_id as sort_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'kind', 'spacecraft_flight',
          'id', -sf.ll2_spacecraft_flight_id,
          'url', sf.url,
          'destination', sf.destination,
          'amount', null,
          'deployment_status', d.deployment_status,
          'deployment_evidence', d.deployment_evidence,
          'deployment_notes', d.deployment_notes,
          'payload', jsonb_strip_nulls(
            jsonb_build_object(
              'id', sc.ll2_spacecraft_id,
              'name', sc.name,
              'description', sc.description,
              'mass_kg', null,
              'cost_usd', null,
              'wiki_link', null,
              'info_link', null,
              'program', null,
              'type', case
                when sct.ll2_spacecraft_type_id is null then null
                else jsonb_build_object('id', sct.ll2_spacecraft_type_id, 'name', sct.name)
              end,
              'manufacturer', case
                when a.ll2_agency_id is null then null
                else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
              end,
              'operator', case
                when a.ll2_agency_id is null then null
                else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
              end,
              'image', jsonb_strip_nulls(
                jsonb_build_object(
                  'image_url', coalesce(sc.image_url, cfg.image_url),
                  'thumbnail_url', coalesce(sc.thumbnail_url, cfg.thumbnail_url),
                  'credit', coalesce(sc.image_credit, cfg.image_credit),
                  'license_name', coalesce(sc.image_license_name, cfg.image_license_name),
                  'license_url', coalesce(sc.image_license_url, cfg.image_license_url),
                  'single_use', coalesce(sc.image_single_use, cfg.image_single_use)
                )
              ),
              'raw', case when include_raw then sc.raw else null end
            )
          ),
          'landing', case
            when l.ll2_landing_id is null then null
            else jsonb_strip_nulls(
              jsonb_build_object(
                'id', l.ll2_landing_id,
                'attempt', l.attempt,
                'success', l.success,
                'description', l.description,
                'downrange_distance_km', l.downrange_distance_km,
                'landing_location', l.landing_location,
                'landing_type', l.landing_type,
                'raw', case when include_raw then l.raw else null end
              )
            )
          end,
          'docking_events', (
            select coalesce(
              jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'id', de.ll2_docking_event_id,
                    'docking', de.docking,
                    'departure', de.departure,
                    'space_station_target', de.space_station,
                    'raw', case when include_raw then de.raw else null end
                  )
                )
                order by de.docking
              ),
              '[]'::jsonb
            )
            from public.ll2_spacecraft_flight_docking_events de
            where de.ll2_spacecraft_flight_id = sf.ll2_spacecraft_flight_id
          ),
          'raw', case when include_raw then sf.raw else null end
        )
      ) as entry
    from public.ll2_spacecraft_flights sf
    left join public.ll2_spacecrafts sc on sc.ll2_spacecraft_id = sf.ll2_spacecraft_id
    left join public.ll2_spacecraft_configs cfg on cfg.ll2_spacecraft_config_id = sc.spacecraft_config_id
    left join public.ll2_spacecraft_types sct on sct.ll2_spacecraft_type_id = cfg.spacecraft_type_id
    left join public.ll2_agencies a on a.ll2_agency_id = cfg.agency_id
    left join public.ll2_landings l on l.ll2_landing_id = sf.ll2_landing_id
    cross join deployment d
    where sf.ll2_launch_uuid = ll2_launch_uuid_in
      and sf.active = true
  ),
  combined as (
    select * from payload_entries
    union all
    select * from spacecraft_entries
  )
  select coalesce(
    jsonb_agg(combined.entry order by combined.kind_order, combined.sort_id),
    '[]'::jsonb
  )
  from combined;
$$;

grant execute on function public.get_launch_payload_manifest_v2(uuid, boolean) to anon, authenticated;

create or replace function public.get_launch_satellite_payloads_v2(
  ll2_launch_uuid_in uuid,
  include_raw boolean default false
)
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
      jsonb_strip_nulls(
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
          'raw', case when include_raw then s.raw_satcat else null end
        )
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

grant execute on function public.get_launch_satellite_payloads_v2(uuid, boolean) to anon, authenticated;
