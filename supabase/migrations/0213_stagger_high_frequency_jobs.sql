-- Additional staggering pass to reduce recurring minute-level collisions.
-- Frequencies are preserved; only minute offsets are changed.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ingestion_cycle') then
    perform cron.unschedule('ingestion_cycle');
  end if;

  perform cron.schedule(
    'ingestion_cycle',
    '1,16,31,46 * * * *',
    $job$select public.invoke_edge_job('ingestion-cycle');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_bootstrap') then
    perform cron.unschedule('artemis_bootstrap');
  end if;

  perform cron.schedule(
    'artemis_bootstrap',
    '4,19,34,49 * * * *',
    $job$select public.invoke_edge_job('artemis-bootstrap');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'spacex_x_post_snapshot') then
    perform cron.unschedule('spacex_x_post_snapshot');
  end if;

  perform cron.schedule(
    'spacex_x_post_snapshot',
    '11,26,41,56 * * * *',
    $job$select public.invoke_edge_job('spacex-x-post-snapshot');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ws45_forecasts_ingest') then
    perform cron.unschedule('ws45_forecasts_ingest');
  end if;

  perform cron.schedule(
    'ws45_forecasts_ingest',
    '24 */8 * * *',
    $job$select public.invoke_edge_job('ws45-forecast-ingest');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'billing_reconcile') then
    perform cron.unschedule('billing_reconcile');
  end if;

  perform cron.schedule(
    'billing_reconcile',
    '52 * * * *',
    $job$select public.invoke_edge_job('billing-reconcile');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'launch_social_link_backfill') then
    perform cron.unschedule('launch_social_link_backfill');
  end if;

  perform cron.schedule(
    'launch_social_link_backfill',
    '29 */4 * * *',
    $job$select public.invoke_edge_job('launch-social-link-backfill');$job$
  );
end $$;
