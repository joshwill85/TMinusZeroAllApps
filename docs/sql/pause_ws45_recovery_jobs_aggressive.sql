-- Aggressive incident pause script for WS45 schema recovery.
--
-- Use this only if the narrower pause set is insufficient and the project is still
-- timing out. This widens the blast radius by pausing:
-- - LL2 premium live incremental refresh
-- - SpaceX drone ship ingest
--
-- Apply the narrower script first:
-- - docs/sql/pause_ws45_recovery_jobs.sql

insert into public.system_settings (key, value)
values
  ('ll2_incremental_job_enabled', 'false'::jsonb),
  ('spacex_drone_ship_ingest_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

update public.managed_scheduler_jobs
set enabled = false,
    updated_at = now()
where cron_job_name in (
  'spacex_drone_ship_ingest'
);

select key, value
from public.system_settings
where key in (
  'll2_incremental_job_enabled',
  'spacex_drone_ship_ingest_enabled'
)
order by key;

select cron_job_name, enabled, next_run_at, updated_at
from public.managed_scheduler_jobs
where cron_job_name in (
  'spacex_drone_ship_ingest'
)
order by cron_job_name;
