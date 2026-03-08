-- Follow-up: wire SAM opportunities data-services listfiles manifests.

insert into public.system_settings (key, value)
values
  ('artemis_sam_opportunities_data_services_enabled', 'true'::jsonb),
  ('artemis_sam_opportunities_data_services_active_url', '"https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Contract+Opportunities%2Fdatagov"'::jsonb),
  ('artemis_sam_opportunities_data_services_archived_url', '"https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Contract+Opportunities%2FArchived+Data"'::jsonb),
  ('artemis_sam_opportunities_data_services_api_key_param', '"api_key"'::jsonb),
  ('artemis_sam_opportunities_data_services_timeout_ms', '120000'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
