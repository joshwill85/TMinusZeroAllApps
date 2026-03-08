insert into public.system_settings (key, value)
values
  ('artemis_sam_disable_job_on_guardrail', 'true'::jsonb),
  ('artemis_sam_stop_on_empty_or_error', 'true'::jsonb),
  ('artemis_sam_probe_both_endpoints_first', 'true'::jsonb)
on conflict (key) do nothing;
