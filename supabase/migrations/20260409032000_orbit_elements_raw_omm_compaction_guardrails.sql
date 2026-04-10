-- Preserve full orbit history and stop pruning orbit_elements by default.
insert into public.system_settings (key, value)
values ('celestrak_retention_cleanup_enabled', 'false'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
