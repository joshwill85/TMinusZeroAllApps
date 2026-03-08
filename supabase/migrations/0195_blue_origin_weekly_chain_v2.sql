-- Blue Origin weekly ingestion chain v2.
-- Preserves weekly cadence and 90-minute spacing while adding vehicles and engines stages.
-- Anchor: Monday 00:00 UTC.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'blue_origin_bootstrap') then
    perform cron.unschedule('blue_origin_bootstrap');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_vehicles_ingest') then
    perform cron.unschedule('blue_origin_vehicles_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_engines_ingest') then
    perform cron.unschedule('blue_origin_engines_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_missions_ingest') then
    perform cron.unschedule('blue_origin_missions_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_news_ingest') then
    perform cron.unschedule('blue_origin_news_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_media_ingest') then
    perform cron.unschedule('blue_origin_media_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_passengers_ingest') then
    perform cron.unschedule('blue_origin_passengers_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_payloads_ingest') then
    perform cron.unschedule('blue_origin_payloads_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_contracts_ingest') then
    perform cron.unschedule('blue_origin_contracts_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_social_ingest') then
    perform cron.unschedule('blue_origin_social_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'blue_origin_snapshot_build') then
    perform cron.unschedule('blue_origin_snapshot_build');
  end if;

  perform cron.schedule(
    'blue_origin_bootstrap',
    '0 0 * * 1',
    $job$select public.invoke_edge_job('blue-origin-bootstrap');$job$
  );

  perform cron.schedule(
    'blue_origin_vehicles_ingest',
    '30 1 * * 1',
    $job$select public.invoke_edge_job('blue-origin-vehicles-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_engines_ingest',
    '0 3 * * 1',
    $job$select public.invoke_edge_job('blue-origin-engines-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_missions_ingest',
    '30 4 * * 1',
    $job$select public.invoke_edge_job('blue-origin-missions-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_news_ingest',
    '0 6 * * 1',
    $job$select public.invoke_edge_job('blue-origin-news-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_media_ingest',
    '30 7 * * 1',
    $job$select public.invoke_edge_job('blue-origin-media-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_passengers_ingest',
    '0 9 * * 1',
    $job$select public.invoke_edge_job('blue-origin-passengers-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_payloads_ingest',
    '30 10 * * 1',
    $job$select public.invoke_edge_job('blue-origin-payloads-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_contracts_ingest',
    '0 12 * * 1',
    $job$select public.invoke_edge_job('blue-origin-contracts-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_social_ingest',
    '30 13 * * 1',
    $job$select public.invoke_edge_job('blue-origin-social-ingest');$job$
  );

  perform cron.schedule(
    'blue_origin_snapshot_build',
    '0 15 * * 1',
    $job$select public.invoke_edge_job('blue-origin-snapshot-build');$job$
  );
end $$;
