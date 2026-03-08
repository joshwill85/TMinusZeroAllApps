-- Max-recall SAM tuning under a fixed request ceiling.
-- Goals:
-- 1) Favor rows-per-request allocation across SAM endpoints.
-- 2) Re-enable opportunities data-services snapshots for higher recall.
-- 3) Keep probe/guardrail settings safe for low per-run request budgets.

insert into public.system_settings (key, value)
values
  ('artemis_contracts_job_enabled', 'true'::jsonb),
  ('artemis_procurement_job_enabled', 'true'::jsonb),
  ('artemis_procurement_poll_interval_minutes', '1440'::jsonb),
  ('artemis_sam_stop_on_empty_or_error', 'false'::jsonb),
  ('artemis_sam_single_pass_per_endpoint', 'false'::jsonb),
  ('artemis_sam_probe_both_endpoints_first', 'false'::jsonb),
  ('artemis_sam_request_allocation_enabled', 'true'::jsonb),
  ('artemis_sam_probe_max_budget_share', '0.4'::jsonb),
  ('artemis_sam_probe_min_post_budget', '2'::jsonb),
  ('artemis_sam_opportunities_api_weight_when_data_services', '0.6'::jsonb),
  ('artemis_sam_opportunities_partition_enabled', 'true'::jsonb),
  ('artemis_sam_opportunities_partition_days', '14'::jsonb),
  ('artemis_sam_opportunities_data_services_enabled', 'true'::jsonb),
  ('artemis_sam_opportunities_api_delta_only', 'true'::jsonb),
  ('artemis_sam_opportunities_data_services_active_url', '"https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Contract+Opportunities%2Fdatagov"'::jsonb),
  ('artemis_sam_opportunities_data_services_archived_url', '"https://sam.gov/api/prod/fileextractservices/v1/api/listfiles?domain=Contract+Opportunities%2FArchived+Data"'::jsonb),
  ('artemis_sam_opportunities_data_services_max_files_per_source_per_run', '3'::jsonb),
  ('artemis_sam_entity_sync_enabled', 'false'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
