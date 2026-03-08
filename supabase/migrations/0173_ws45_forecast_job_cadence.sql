-- Increase 45 WS forecast ingest cadence for near-launch document availability.
-- Replaces daily schedule with a 30-minute cadence.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ws45_forecasts_ingest') then
    perform cron.unschedule('ws45_forecasts_ingest');
  end if;

  perform cron.schedule(
    'ws45_forecasts_ingest',
    '*/30 * * * *',
    $job$select public.invoke_edge_job('ws45-forecast-ingest');$job$
  );
end $$;
