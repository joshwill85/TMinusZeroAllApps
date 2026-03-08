-- Separate NWS refresh cadence to meet near-launch weather requirements.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'nws_refresh') then
    perform cron.unschedule('nws_refresh');
  end if;
  perform cron.schedule('nws_refresh', '*/5 * * * *', $job$select public.invoke_edge_job('nws-refresh');$job$);
end $$;
