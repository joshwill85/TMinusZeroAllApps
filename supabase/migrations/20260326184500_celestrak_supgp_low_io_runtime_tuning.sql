-- Tighten SupGP throughput for zero-revenue low-I/O operation while keeping the existing scheduler cadence.

insert into public.system_settings (key, value)
values
  ('celestrak_supgp_family_min_interval_seconds', '43200'::jsonb),
  ('celestrak_supgp_launch_min_interval_seconds', '1800'::jsonb),
  ('celestrak_supgp_launch_retention_hours', '24'::jsonb),
  ('celestrak_supgp_max_datasets_per_run', '4'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
