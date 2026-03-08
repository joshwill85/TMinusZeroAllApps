-- Add Blue Origin engine source URL settings introduced after initial source settings rollout.

insert into public.system_settings (key, value)
values
  ('blue_origin_source_engines_url', '"https://www.blueorigin.com/engines"'::jsonb),
  ('blue_origin_source_be3pm_url', '"https://www.blueorigin.com/engines/be-3"'::jsonb),
  ('blue_origin_source_be3u_url', '"https://www.blueorigin.com/engines/be-3"'::jsonb),
  ('blue_origin_source_be4_url', '"https://www.blueorigin.com/engines/be-4"'::jsonb),
  ('blue_origin_source_be7_url', '"https://www.blueorigin.com/engines/be-7"'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
