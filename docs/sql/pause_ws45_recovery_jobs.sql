-- Incident pause script for WS45 schema recovery.
--
-- Goal:
-- - reduce write and scheduler pressure enough to land the missing WS45 schema
-- - keep the blast radius narrower than setting public.system_settings.jobs_enabled=false
--
-- This pauses:
-- - known high-IO backfills
-- - notifications dispatch/send
-- - new WS45 live/planning jobs
-- - WS45 retention cleanup if it exists in the target environment
--
-- This does not pause:
-- - the entire scheduler platform
-- - core LL2 catalog/incremental live ingestion
-- - the SpaceX drone ship ingest

insert into public.system_settings (key, value)
values
  ('ll2_backfill_job_enabled', 'false'::jsonb),
  ('rocket_media_backfill_job_enabled', 'false'::jsonb),
  ('ll2_payload_backfill_job_enabled', 'false'::jsonb),
  ('notifications_dispatch_job_enabled', 'false'::jsonb),
  ('notifications_send_job_enabled', 'false'::jsonb),
  ('ws45_live_weather_job_enabled', 'false'::jsonb),
  ('ws45_planning_forecast_job_enabled', 'false'::jsonb),
  ('ws45_weather_retention_cleanup_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

update public.managed_scheduler_jobs
set enabled = false,
    updated_at = now()
where cron_job_name in (
  'ws45_live_weather_ingest',
  'ws45_planning_forecast_ingest',
  'ws45_weather_retention_cleanup'
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_backfill') then
    perform cron.unschedule('ll2_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'rocket_media_backfill') then
    perform cron.unschedule('rocket_media_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'll2_payload_backfill') then
    perform cron.unschedule('ll2_payload_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'notifications_dispatch') then
    perform cron.unschedule('notifications_dispatch');
  end if;

  if exists (select 1 from cron.job where jobname = 'notifications_send') then
    perform cron.unschedule('notifications_send');
  end if;
end $$;

select key, value
from public.system_settings
where key in (
  'll2_backfill_job_enabled',
  'rocket_media_backfill_job_enabled',
  'll2_payload_backfill_job_enabled',
  'notifications_dispatch_job_enabled',
  'notifications_send_job_enabled',
  'ws45_live_weather_job_enabled',
  'ws45_planning_forecast_job_enabled',
  'ws45_weather_retention_cleanup_enabled'
)
order by key;

select cron_job_name, enabled, next_run_at, updated_at
from public.managed_scheduler_jobs
where cron_job_name in (
  'ws45_live_weather_ingest',
  'ws45_planning_forecast_ingest',
  'ws45_weather_retention_cleanup'
)
order by cron_job_name;
