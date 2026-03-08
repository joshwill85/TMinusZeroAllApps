-- Rebalance launch social + NAVCEN cadences to reduce scheduler churn.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'launch_social_refresh') then
    perform cron.unschedule('launch_social_refresh');
  end if;

  perform cron.schedule(
    'launch_social_refresh',
    '*/15 * * * *',
    $job$select public.invoke_edge_job('launch-social-refresh');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'navcen_bnm_ingest') then
    perform cron.unschedule('navcen_bnm_ingest');
  end if;

  perform cron.schedule(
    'navcen_bnm_ingest',
    '33 * * * *',
    $job$select public.invoke_edge_job('navcen-bnm-ingest');$job$
  );
end $$;
