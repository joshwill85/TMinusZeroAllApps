-- Schedule trajectory constraints ingestion (LL2 landings) for eligible launches.

insert into public.system_settings (key, value)
values ('trajectory_constraints_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_constraints_eligible_limit', '3'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_constraints_lookahead_limit', '50'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_constraints_lookback_hours', '24'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_constraints_expiry_hours', '3'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_constraints_ingest') then
    perform cron.unschedule('trajectory_constraints_ingest');
  end if;

  -- Runs every 6 hours to keep landing constraints fresh for top eligible launches.
  perform cron.schedule(
    'trajectory_constraints_ingest',
    '24 */6 * * *',
    $job$select public.invoke_edge_job('trajectory-constraints-ingest');$job$
  );
end $$;

