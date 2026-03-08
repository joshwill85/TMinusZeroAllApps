-- Schedule NWS forecast refresh (every 20 minutes).

insert into public.system_settings (key, value)
values
  ('nws_horizon_days', '7'::jsonb),
  ('nws_points_cache_hours', '24'::jsonb),
  ('nws_max_launches_per_run', '80'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'nws_refresh') then
    perform cron.unschedule('nws_refresh');
  end if;
  perform cron.schedule('nws_refresh', '*/20 * * * *', $job$select public.invoke_edge_job('nws-refresh');$job$);
end $$;

