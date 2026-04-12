alter table public.ws45_planning_forecasts
  add column if not exists structured_payload jsonb not null default '{}'::jsonb;

update public.managed_scheduler_jobs
set interval_seconds = 1800,
    offset_seconds = 1440,
    next_run_at = public.managed_scheduler_next_run(now(), 1800, 1440),
    updated_at = now()
where cron_job_name = 'ws45_forecasts_ingest';
