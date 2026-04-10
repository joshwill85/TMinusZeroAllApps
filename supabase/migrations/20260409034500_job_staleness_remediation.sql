-- Remediate stale or broken scheduled jobs identified in the 2026-04-08/09 review.
--
-- Changes:
-- - restore Artemis procurement to the intended daily cadence
-- - pause the launch social backfill until there is fresh backlog to process
-- - stop invoking the rocket-media backfill while it is a persistent no-op
-- - pause CelesTrak retention cleanup until the DB-side epoch index is in place
-- - add the missing epoch index needed for orbit-elements retention scans
-- - stage safer retention-cleanup batch defaults for when it is re-enabled

insert into public.system_settings (key, value)
values
  ('artemis_procurement_poll_interval_minutes', '1440'::jsonb),
  ('artemis_procurement_http_timeout_ms', '12000'::jsonb),
  ('artemis_procurement_run_deadline_ms', '120000'::jsonb),
  ('artemis_procurement_stale_run_timeout_ms', '7200000'::jsonb),
  ('artemis_procurement_lock_ttl_seconds', '1800'::jsonb),
  ('artemis_contracts_ingest_stage', '"normalize"'::jsonb),
  ('trajectory_templates_lock_ttl_seconds', '900'::jsonb),
  ('trajectory_templates_stale_run_timeout_ms', '21600000'::jsonb),
  ('rocket_media_backfill_job_enabled', 'false'::jsonb),
  ('celestrak_retention_cleanup_enabled', 'false'::jsonb),
  ('celestrak_retention_cleanup_batch_size', '5000'::jsonb),
  ('celestrak_retention_cleanup_max_batches', '8'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

create index if not exists orbit_elements_epoch_idx
  on public.orbit_elements (epoch asc);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_procurement_ingest') then
    perform cron.unschedule('artemis_procurement_ingest');
  end if;

  perform cron.schedule(
    'artemis_procurement_ingest',
    '47 4 * * *',
    $job$select public.invoke_edge_job('artemis-procurement-ingest');$job$
  );

  if exists (select 1 from cron.job where jobname = 'launch_social_link_backfill') then
    perform cron.unschedule('launch_social_link_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'rocket_media_backfill') then
    perform cron.unschedule('rocket_media_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'celestrak_retention_cleanup') then
    perform cron.unschedule('celestrak_retention_cleanup');
  end if;
end $$;
