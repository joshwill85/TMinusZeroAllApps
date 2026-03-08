-- Expand launch_updates capture to include all launch fields shown on the launch detail page.
-- This keeps the user-facing change log consistent with the data we render.

create or replace function public.log_launch_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  changed text[] := '{}';
  old_values jsonb := '{}'::jsonb;
  new_values jsonb := '{}'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Identity + schedule/status.
  if new.name is distinct from old.name then
    changed := array_append(changed, 'name');
    old_values := old_values || jsonb_build_object('name', old.name);
    new_values := new_values || jsonb_build_object('name', new.name);
  end if;

  if new.status_id is distinct from old.status_id then
    changed := array_append(changed, 'status_id');
    old_values := old_values || jsonb_build_object('status_id', old.status_id);
    new_values := new_values || jsonb_build_object('status_id', new.status_id);
  end if;

  if new.status_name is distinct from old.status_name then
    changed := array_append(changed, 'status_name');
    old_values := old_values || jsonb_build_object('status_name', old.status_name);
    new_values := new_values || jsonb_build_object('status_name', new.status_name);
  end if;

  if new.status_abbrev is distinct from old.status_abbrev then
    changed := array_append(changed, 'status_abbrev');
    old_values := old_values || jsonb_build_object('status_abbrev', old.status_abbrev);
    new_values := new_values || jsonb_build_object('status_abbrev', new.status_abbrev);
  end if;

  if new.net is distinct from old.net then
    changed := array_append(changed, 'net');
    old_values := old_values || jsonb_build_object('net', old.net);
    new_values := new_values || jsonb_build_object('net', new.net);
  end if;

  if new.net_precision is distinct from old.net_precision then
    changed := array_append(changed, 'net_precision');
    old_values := old_values || jsonb_build_object('net_precision', old.net_precision);
    new_values := new_values || jsonb_build_object('net_precision', new.net_precision);
  end if;

  if new.window_start is distinct from old.window_start then
    changed := array_append(changed, 'window_start');
    old_values := old_values || jsonb_build_object('window_start', old.window_start);
    new_values := new_values || jsonb_build_object('window_start', new.window_start);
  end if;

  if new.window_end is distinct from old.window_end then
    changed := array_append(changed, 'window_end');
    old_values := old_values || jsonb_build_object('window_end', old.window_end);
    new_values := new_values || jsonb_build_object('window_end', new.window_end);
  end if;

  -- Provider + vehicle.
  if new.provider is distinct from old.provider then
    changed := array_append(changed, 'provider');
    old_values := old_values || jsonb_build_object('provider', old.provider);
    new_values := new_values || jsonb_build_object('provider', new.provider);
  end if;

  if new.provider_type is distinct from old.provider_type then
    changed := array_append(changed, 'provider_type');
    old_values := old_values || jsonb_build_object('provider_type', old.provider_type);
    new_values := new_values || jsonb_build_object('provider_type', new.provider_type);
  end if;

  if new.provider_country_code is distinct from old.provider_country_code then
    changed := array_append(changed, 'provider_country_code');
    old_values := old_values || jsonb_build_object('provider_country_code', old.provider_country_code);
    new_values := new_values || jsonb_build_object('provider_country_code', new.provider_country_code);
  end if;

  if new.provider_description is distinct from old.provider_description then
    changed := array_append(changed, 'provider_description');
    old_values := old_values || jsonb_build_object('provider_description', old.provider_description);
    new_values := new_values || jsonb_build_object('provider_description', new.provider_description);
  end if;

  if new.provider_logo_url is distinct from old.provider_logo_url then
    changed := array_append(changed, 'provider_logo_url');
    old_values := old_values || jsonb_build_object('provider_logo_url', old.provider_logo_url);
    new_values := new_values || jsonb_build_object('provider_logo_url', new.provider_logo_url);
  end if;

  if new.provider_image_url is distinct from old.provider_image_url then
    changed := array_append(changed, 'provider_image_url');
    old_values := old_values || jsonb_build_object('provider_image_url', old.provider_image_url);
    new_values := new_values || jsonb_build_object('provider_image_url', new.provider_image_url);
  end if;

  if new.vehicle is distinct from old.vehicle then
    changed := array_append(changed, 'vehicle');
    old_values := old_values || jsonb_build_object('vehicle', old.vehicle);
    new_values := new_values || jsonb_build_object('vehicle', new.vehicle);
  end if;

  -- Pad / site.
  if new.pad_name is distinct from old.pad_name then
    changed := array_append(changed, 'pad_name');
    old_values := old_values || jsonb_build_object('pad_name', old.pad_name);
    new_values := new_values || jsonb_build_object('pad_name', new.pad_name);
  end if;

  if new.pad_short_code is distinct from old.pad_short_code then
    changed := array_append(changed, 'pad_short_code');
    old_values := old_values || jsonb_build_object('pad_short_code', old.pad_short_code);
    new_values := new_values || jsonb_build_object('pad_short_code', new.pad_short_code);
  end if;

  if new.pad_state is distinct from old.pad_state then
    changed := array_append(changed, 'pad_state');
    old_values := old_values || jsonb_build_object('pad_state', old.pad_state);
    new_values := new_values || jsonb_build_object('pad_state', new.pad_state);
  end if;

  if new.pad_timezone is distinct from old.pad_timezone then
    changed := array_append(changed, 'pad_timezone');
    old_values := old_values || jsonb_build_object('pad_timezone', old.pad_timezone);
    new_values := new_values || jsonb_build_object('pad_timezone', new.pad_timezone);
  end if;

  if new.pad_location_name is distinct from old.pad_location_name then
    changed := array_append(changed, 'pad_location_name');
    old_values := old_values || jsonb_build_object('pad_location_name', old.pad_location_name);
    new_values := new_values || jsonb_build_object('pad_location_name', new.pad_location_name);
  end if;

  if new.pad_map_url is distinct from old.pad_map_url then
    changed := array_append(changed, 'pad_map_url');
    old_values := old_values || jsonb_build_object('pad_map_url', old.pad_map_url);
    new_values := new_values || jsonb_build_object('pad_map_url', new.pad_map_url);
  end if;

  -- Mission.
  if new.mission_name is distinct from old.mission_name then
    changed := array_append(changed, 'mission_name');
    old_values := old_values || jsonb_build_object('mission_name', old.mission_name);
    new_values := new_values || jsonb_build_object('mission_name', new.mission_name);
  end if;

  if new.mission_description is distinct from old.mission_description then
    changed := array_append(changed, 'mission_description');
    old_values := old_values || jsonb_build_object('mission_description', old.mission_description);
    new_values := new_values || jsonb_build_object('mission_description', new.mission_description);
  end if;

  if new.mission_type is distinct from old.mission_type then
    changed := array_append(changed, 'mission_type');
    old_values := old_values || jsonb_build_object('mission_type', old.mission_type);
    new_values := new_values || jsonb_build_object('mission_type', new.mission_type);
  end if;

  if new.mission_orbit is distinct from old.mission_orbit then
    changed := array_append(changed, 'mission_orbit');
    old_values := old_values || jsonb_build_object('mission_orbit', old.mission_orbit);
    new_values := new_values || jsonb_build_object('mission_orbit', new.mission_orbit);
  end if;

  if new.mission_agencies is distinct from old.mission_agencies then
    changed := array_append(changed, 'mission_agencies');
    old_values := old_values || jsonb_build_object('mission_agencies', old.mission_agencies);
    new_values := new_values || jsonb_build_object('mission_agencies', new.mission_agencies);
  end if;

  if new.mission_info_urls is distinct from old.mission_info_urls then
    changed := array_append(changed, 'mission_info_urls');
    old_values := old_values || jsonb_build_object('mission_info_urls', old.mission_info_urls);
    new_values := new_values || jsonb_build_object('mission_info_urls', new.mission_info_urls);
  end if;

  if new.mission_vid_urls is distinct from old.mission_vid_urls then
    changed := array_append(changed, 'mission_vid_urls');
    old_values := old_values || jsonb_build_object('mission_vid_urls', old.mission_vid_urls);
    new_values := new_values || jsonb_build_object('mission_vid_urls', new.mission_vid_urls);
  end if;

  -- Rocket.
  if new.rocket_full_name is distinct from old.rocket_full_name then
    changed := array_append(changed, 'rocket_full_name');
    old_values := old_values || jsonb_build_object('rocket_full_name', old.rocket_full_name);
    new_values := new_values || jsonb_build_object('rocket_full_name', new.rocket_full_name);
  end if;

  if new.rocket_manufacturer is distinct from old.rocket_manufacturer then
    changed := array_append(changed, 'rocket_manufacturer');
    old_values := old_values || jsonb_build_object('rocket_manufacturer', old.rocket_manufacturer);
    new_values := new_values || jsonb_build_object('rocket_manufacturer', new.rocket_manufacturer);
  end if;

  if new.rocket_description is distinct from old.rocket_description then
    changed := array_append(changed, 'rocket_description');
    old_values := old_values || jsonb_build_object('rocket_description', old.rocket_description);
    new_values := new_values || jsonb_build_object('rocket_description', new.rocket_description);
  end if;

  if new.rocket_image_url is distinct from old.rocket_image_url then
    changed := array_append(changed, 'rocket_image_url');
    old_values := old_values || jsonb_build_object('rocket_image_url', old.rocket_image_url);
    new_values := new_values || jsonb_build_object('rocket_image_url', new.rocket_image_url);
  end if;

  if new.rocket_variant is distinct from old.rocket_variant then
    changed := array_append(changed, 'rocket_variant');
    old_values := old_values || jsonb_build_object('rocket_variant', old.rocket_variant);
    new_values := new_values || jsonb_build_object('rocket_variant', new.rocket_variant);
  end if;

  if new.rocket_length_m is distinct from old.rocket_length_m then
    changed := array_append(changed, 'rocket_length_m');
    old_values := old_values || jsonb_build_object('rocket_length_m', old.rocket_length_m);
    new_values := new_values || jsonb_build_object('rocket_length_m', new.rocket_length_m);
  end if;

  if new.rocket_diameter_m is distinct from old.rocket_diameter_m then
    changed := array_append(changed, 'rocket_diameter_m');
    old_values := old_values || jsonb_build_object('rocket_diameter_m', old.rocket_diameter_m);
    new_values := new_values || jsonb_build_object('rocket_diameter_m', new.rocket_diameter_m);
  end if;

  if new.rocket_reusable is distinct from old.rocket_reusable then
    changed := array_append(changed, 'rocket_reusable');
    old_values := old_values || jsonb_build_object('rocket_reusable', old.rocket_reusable);
    new_values := new_values || jsonb_build_object('rocket_reusable', new.rocket_reusable);
  end if;

  if new.rocket_maiden_flight is distinct from old.rocket_maiden_flight then
    changed := array_append(changed, 'rocket_maiden_flight');
    old_values := old_values || jsonb_build_object('rocket_maiden_flight', old.rocket_maiden_flight);
    new_values := new_values || jsonb_build_object('rocket_maiden_flight', new.rocket_maiden_flight);
  end if;

  if new.rocket_leo_capacity is distinct from old.rocket_leo_capacity then
    changed := array_append(changed, 'rocket_leo_capacity');
    old_values := old_values || jsonb_build_object('rocket_leo_capacity', old.rocket_leo_capacity);
    new_values := new_values || jsonb_build_object('rocket_leo_capacity', new.rocket_leo_capacity);
  end if;

  if new.rocket_gto_capacity is distinct from old.rocket_gto_capacity then
    changed := array_append(changed, 'rocket_gto_capacity');
    old_values := old_values || jsonb_build_object('rocket_gto_capacity', old.rocket_gto_capacity);
    new_values := new_values || jsonb_build_object('rocket_gto_capacity', new.rocket_gto_capacity);
  end if;

  if new.rocket_launch_mass is distinct from old.rocket_launch_mass then
    changed := array_append(changed, 'rocket_launch_mass');
    old_values := old_values || jsonb_build_object('rocket_launch_mass', old.rocket_launch_mass);
    new_values := new_values || jsonb_build_object('rocket_launch_mass', new.rocket_launch_mass);
  end if;

  if new.rocket_launch_cost is distinct from old.rocket_launch_cost then
    changed := array_append(changed, 'rocket_launch_cost');
    old_values := old_values || jsonb_build_object('rocket_launch_cost', old.rocket_launch_cost);
    new_values := new_values || jsonb_build_object('rocket_launch_cost', new.rocket_launch_cost);
  end if;

  if new.rocket_info_url is distinct from old.rocket_info_url then
    changed := array_append(changed, 'rocket_info_url');
    old_values := old_values || jsonb_build_object('rocket_info_url', old.rocket_info_url);
    new_values := new_values || jsonb_build_object('rocket_info_url', new.rocket_info_url);
  end if;

  if new.rocket_wiki_url is distinct from old.rocket_wiki_url then
    changed := array_append(changed, 'rocket_wiki_url');
    old_values := old_values || jsonb_build_object('rocket_wiki_url', old.rocket_wiki_url);
    new_values := new_values || jsonb_build_object('rocket_wiki_url', new.rocket_wiki_url);
  end if;

  if new.rocket_manufacturer_logo_url is distinct from old.rocket_manufacturer_logo_url then
    changed := array_append(changed, 'rocket_manufacturer_logo_url');
    old_values := old_values || jsonb_build_object('rocket_manufacturer_logo_url', old.rocket_manufacturer_logo_url);
    new_values := new_values || jsonb_build_object('rocket_manufacturer_logo_url', new.rocket_manufacturer_logo_url);
  end if;

  if new.rocket_manufacturer_image_url is distinct from old.rocket_manufacturer_image_url then
    changed := array_append(changed, 'rocket_manufacturer_image_url');
    old_values := old_values || jsonb_build_object('rocket_manufacturer_image_url', old.rocket_manufacturer_image_url);
    new_values := new_values || jsonb_build_object('rocket_manufacturer_image_url', new.rocket_manufacturer_image_url);
  end if;

  -- Links.
  if new.video_url is distinct from old.video_url then
    changed := array_append(changed, 'video_url');
    old_values := old_values || jsonb_build_object('video_url', old.video_url);
    new_values := new_values || jsonb_build_object('video_url', new.video_url);
  end if;

  if new.webcast_live is distinct from old.webcast_live then
    changed := array_append(changed, 'webcast_live');
    old_values := old_values || jsonb_build_object('webcast_live', old.webcast_live);
    new_values := new_values || jsonb_build_object('webcast_live', new.webcast_live);
  end if;

  if new.launch_info_urls is distinct from old.launch_info_urls then
    changed := array_append(changed, 'launch_info_urls');
    old_values := old_values || jsonb_build_object('launch_info_urls', old.launch_info_urls);
    new_values := new_values || jsonb_build_object('launch_info_urls', new.launch_info_urls);
  end if;

  if new.launch_vid_urls is distinct from old.launch_vid_urls then
    changed := array_append(changed, 'launch_vid_urls');
    old_values := old_values || jsonb_build_object('launch_vid_urls', old.launch_vid_urls);
    new_values := new_values || jsonb_build_object('launch_vid_urls', new.launch_vid_urls);
  end if;

  if new.flightclub_url is distinct from old.flightclub_url then
    changed := array_append(changed, 'flightclub_url');
    old_values := old_values || jsonb_build_object('flightclub_url', old.flightclub_url);
    new_values := new_values || jsonb_build_object('flightclub_url', new.flightclub_url);
  end if;

  if new.hashtag is distinct from old.hashtag then
    changed := array_append(changed, 'hashtag');
    old_values := old_values || jsonb_build_object('hashtag', old.hashtag);
    new_values := new_values || jsonb_build_object('hashtag', new.hashtag);
  end if;

  -- Operational fields displayed in detail.
  if new.probability is distinct from old.probability then
    changed := array_append(changed, 'probability');
    old_values := old_values || jsonb_build_object('probability', old.probability);
    new_values := new_values || jsonb_build_object('probability', new.probability);
  end if;

  if new.hold_reason is distinct from old.hold_reason then
    changed := array_append(changed, 'hold_reason');
    old_values := old_values || jsonb_build_object('hold_reason', old.hold_reason);
    new_values := new_values || jsonb_build_object('hold_reason', new.hold_reason);
  end if;

  if new.fail_reason is distinct from old.fail_reason then
    changed := array_append(changed, 'fail_reason');
    old_values := old_values || jsonb_build_object('fail_reason', old.fail_reason);
    new_values := new_values || jsonb_build_object('fail_reason', new.fail_reason);
  end if;

  -- Detail sections backed by JSON blobs.
  if new.programs is distinct from old.programs then
    changed := array_append(changed, 'programs');
    old_values := old_values || jsonb_build_object('programs', old.programs);
    new_values := new_values || jsonb_build_object('programs', new.programs);
  end if;

  if new.crew is distinct from old.crew then
    changed := array_append(changed, 'crew');
    old_values := old_values || jsonb_build_object('crew', old.crew);
    new_values := new_values || jsonb_build_object('crew', new.crew);
  end if;

  if new.payloads is distinct from old.payloads then
    changed := array_append(changed, 'payloads');
    old_values := old_values || jsonb_build_object('payloads', old.payloads);
    new_values := new_values || jsonb_build_object('payloads', new.payloads);
  end if;

  if new.timeline is distinct from old.timeline then
    changed := array_append(changed, 'timeline');
    old_values := old_values || jsonb_build_object('timeline', old.timeline);
    new_values := new_values || jsonb_build_object('timeline', new.timeline);
  end if;

  -- User-visible tier and admin overrides.
  if new.tier_auto is distinct from old.tier_auto then
    changed := array_append(changed, 'tier_auto');
    old_values := old_values || jsonb_build_object('tier_auto', old.tier_auto);
    new_values := new_values || jsonb_build_object('tier_auto', new.tier_auto);
  end if;

  if new.tier_override is distinct from old.tier_override then
    changed := array_append(changed, 'tier_override');
    old_values := old_values || jsonb_build_object('tier_override', old.tier_override);
    new_values := new_values || jsonb_build_object('tier_override', new.tier_override);
  end if;

  if new.featured is distinct from old.featured then
    changed := array_append(changed, 'featured');
    old_values := old_values || jsonb_build_object('featured', old.featured);
    new_values := new_values || jsonb_build_object('featured', new.featured);
  end if;

  if new.hidden is distinct from old.hidden then
    changed := array_append(changed, 'hidden');
    old_values := old_values || jsonb_build_object('hidden', old.hidden);
    new_values := new_values || jsonb_build_object('hidden', new.hidden);
  end if;

  -- Images (hero + credits/licenses surfaced via UI).
  if new.image_url is distinct from old.image_url then
    changed := array_append(changed, 'image_url');
    old_values := old_values || jsonb_build_object('image_url', old.image_url);
    new_values := new_values || jsonb_build_object('image_url', new.image_url);
  end if;

  if new.image_thumbnail_url is distinct from old.image_thumbnail_url then
    changed := array_append(changed, 'image_thumbnail_url');
    old_values := old_values || jsonb_build_object('image_thumbnail_url', old.image_thumbnail_url);
    new_values := new_values || jsonb_build_object('image_thumbnail_url', new.image_thumbnail_url);
  end if;

  if new.image_credit is distinct from old.image_credit then
    changed := array_append(changed, 'image_credit');
    old_values := old_values || jsonb_build_object('image_credit', old.image_credit);
    new_values := new_values || jsonb_build_object('image_credit', new.image_credit);
  end if;

  if new.image_license_name is distinct from old.image_license_name then
    changed := array_append(changed, 'image_license_name');
    old_values := old_values || jsonb_build_object('image_license_name', old.image_license_name);
    new_values := new_values || jsonb_build_object('image_license_name', new.image_license_name);
  end if;

  if new.image_license_url is distinct from old.image_license_url then
    changed := array_append(changed, 'image_license_url');
    old_values := old_values || jsonb_build_object('image_license_url', old.image_license_url);
    new_values := new_values || jsonb_build_object('image_license_url', new.image_license_url);
  end if;

  if new.image_single_use is distinct from old.image_single_use then
    changed := array_append(changed, 'image_single_use');
    old_values := old_values || jsonb_build_object('image_single_use', old.image_single_use);
    new_values := new_values || jsonb_build_object('image_single_use', new.image_single_use);
  end if;

  if array_length(changed, 1) is null then
    return new;
  end if;

  insert into public.launch_updates(launch_id, changed_fields, old_values, new_values, detected_at)
  values (new.id, changed, old_values, new_values, now());

  return new;
end;
$$;

