-- Phase tuning for trajectory + JEP readiness.
-- Goal: broaden eligible coverage and improve weather reliability while keeping disk I/O conservative.

insert into public.system_settings (key, value)
values
  ('trajectory_products_eligible_limit', '8'::jsonb),
  ('trajectory_products_lookahead_limit', '80'::jsonb),
  ('jep_score_model_version', '"jep_v3"'::jsonb),
  ('jep_score_open_meteo_us_models', '["best_match","gfs_seamless"]'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

-- Keep trajectory jobs enabled but avoid higher-frequency churn.
update public.managed_scheduler_jobs
set enabled = true,
    updated_at = now()
where cron_job_name in (
  'trajectory_orbit_ingest',
  'trajectory_constraints_ingest',
  'trajectory_products_generate'
);

-- Ensure JEP refresh remains on 5-minute cadence for near-real-time launch shifts.
update public.managed_scheduler_jobs
set interval_seconds = 300,
    offset_seconds = 150,
    enabled = true,
    updated_at = now()
where cron_job_name = 'jep_score_refresh';
