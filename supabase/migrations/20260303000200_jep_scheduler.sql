-- JEP scheduler defaults + managed scheduler registration.

insert into public.system_settings (key, value)
values
  ('jep_score_job_enabled', 'true'::jsonb),
  ('jep_score_horizon_days', '16'::jsonb),
  ('jep_score_max_launches_per_run', '120'::jsonb),
  ('jep_score_weather_cache_minutes', '10'::jsonb),
  ('jep_score_model_version', '"jep_v1"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values (
  'jep_score_refresh',
  'jep-score-refresh',
  300,
  150,
  true,
  3,
  public.managed_scheduler_next_run(now(), 300, 150)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();
