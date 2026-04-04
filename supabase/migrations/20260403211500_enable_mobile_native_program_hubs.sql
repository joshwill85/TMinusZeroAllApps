insert into public.system_settings (key, value, updated_at)
values
  ('mobile_hub_blue_origin_native_enabled', 'true', timezone('utc'::text, now())),
  ('mobile_hub_blue_origin_external_deep_links_enabled', 'true', timezone('utc'::text, now())),
  ('mobile_hub_spacex_native_enabled', 'true', timezone('utc'::text, now())),
  ('mobile_hub_spacex_external_deep_links_enabled', 'true', timezone('utc'::text, now())),
  ('mobile_hub_artemis_native_enabled', 'true', timezone('utc'::text, now())),
  ('mobile_hub_artemis_external_deep_links_enabled', 'true', timezone('utc'::text, now()))
on conflict (key) do update
set
  value = excluded.value,
  updated_at = excluded.updated_at;
