-- Schedule 45th Weather Squadron forecast ingest (daily).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ws45_forecasts_ingest') then
    perform cron.unschedule('ws45_forecasts_ingest');
  end if;
  -- Runs daily at ~06:15 ET (11:15 UTC).
  perform cron.schedule('ws45_forecasts_ingest', '15 11 * * *', $job$select public.invoke_edge_job('ws45-forecast-ingest');$job$);
end $$;

