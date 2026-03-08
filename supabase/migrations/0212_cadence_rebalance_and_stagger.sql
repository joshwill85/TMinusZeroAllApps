-- Rebalance selected job cadences and reduce overlap pressure.
-- Requested changes:
-- - nws_refresh and ws45_forecasts_ingest -> every 8 hours
-- - monitoring_check -> every 30 minutes
-- - launch_social_refresh and social_posts_dispatch -> hourly
-- - artemis_nasa_ingest and artemis_snapshot_build -> every 3 days
--
-- Staggering choices in this migration are intentional to avoid minute-level pileups.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nws_refresh') then
    perform cron.unschedule('nws_refresh');
  end if;

  perform cron.schedule(
    'nws_refresh',
    '6 */8 * * *',
    $job$select public.invoke_edge_job('nws-refresh');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ws45_forecasts_ingest') then
    perform cron.unschedule('ws45_forecasts_ingest');
  end if;

  perform cron.schedule(
    'ws45_forecasts_ingest',
    '26 */8 * * *',
    $job$select public.invoke_edge_job('ws45-forecast-ingest');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitoring_check') then
    perform cron.unschedule('monitoring_check');
  end if;

  perform cron.schedule(
    'monitoring_check',
    '14,44 * * * *',
    $job$select public.invoke_edge_job('monitoring-check');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'launch_social_refresh') then
    perform cron.unschedule('launch_social_refresh');
  end if;

  perform cron.schedule(
    'launch_social_refresh',
    '9 * * * *',
    $job$select public.invoke_edge_job('launch-social-refresh');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'social_posts_dispatch') then
    perform cron.unschedule('social_posts_dispatch');
  end if;

  perform cron.schedule(
    'social_posts_dispatch',
    '38 * * * *',
    $job$select public.invoke_edge_job('social-posts-dispatch');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_nasa_ingest') then
    perform cron.unschedule('artemis_nasa_ingest');
  end if;

  perform cron.schedule(
    'artemis_nasa_ingest',
    '7 2 */3 * *',
    $job$select public.invoke_edge_job('artemis-nasa-ingest');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_snapshot_build') then
    perform cron.unschedule('artemis_snapshot_build');
  end if;

  perform cron.schedule(
    'artemis_snapshot_build',
    '37 2 */3 * *',
    $job$select public.invoke_edge_job('artemis-snapshot-build');$job$
  );
end $$;
