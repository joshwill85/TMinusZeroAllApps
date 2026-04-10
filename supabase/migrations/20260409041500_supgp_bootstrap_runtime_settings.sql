-- Seed runtime guardrails for long-running jobs.

insert into public.system_settings (key, value)
values
  ('artemis_procurement_http_timeout_ms', '12000'::jsonb),
  ('artemis_procurement_run_deadline_ms', '120000'::jsonb),
  ('artemis_procurement_stale_run_timeout_ms', '7200000'::jsonb),
  ('artemis_procurement_lock_ttl_seconds', '1800'::jsonb),
  ('artemis_contracts_ingest_stage', '"normalize"'::jsonb),
  ('trajectory_templates_lock_ttl_seconds', '900'::jsonb),
  ('trajectory_templates_stale_run_timeout_ms', '21600000'::jsonb),
  ('celestrak_retention_cleanup_batch_size', '5000'::jsonb),
  ('celestrak_retention_cleanup_max_batches', '8'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
