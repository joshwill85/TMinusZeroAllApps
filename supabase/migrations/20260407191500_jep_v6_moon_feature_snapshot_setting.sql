insert into public.system_settings (key, value)
values
  ('jep_v6_moon_feature_snapshots_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
