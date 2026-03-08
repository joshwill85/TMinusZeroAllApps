-- SAM contracts recovery: keep both endpoints active under throttle and stop entity-sync churn.
-- These are runtime guardrail settings; code handles endpoint-level throttling behavior.

insert into public.system_settings (key, value, updated_at)
values
  ('artemis_sam_probe_both_endpoints_first', 'true'::jsonb, now()),
  ('artemis_sam_entity_sync_enabled', 'false'::jsonb, now()),
  ('artemis_sam_opportunities_data_services_enabled', 'false'::jsonb, now()),
  ('artemis_sam_opportunities_api_delta_only', 'false'::jsonb, now()),
  ('artemis_sam_opportunities_data_services_max_file_bytes', '250000000'::jsonb, now())
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
