-- Follow-up: bound SAM opportunities data-services processing per run to avoid Edge worker exhaustion.

insert into public.system_settings (key, value)
values
  ('artemis_sam_opportunities_data_services_max_files_per_source_per_run', '1'::jsonb),
  ('artemis_sam_opportunities_data_services_max_file_bytes', '250000000'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
