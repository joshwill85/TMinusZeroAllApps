-- Scheduled ingestion of mission/press-kit documents to extract target orbit parameters (inclination, azimuth, etc.).

insert into public.system_settings (key, value)
values ('trajectory_orbit_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_horizon_days', '30'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_lookback_hours', '24'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_launch_limit', '60'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_docs_per_launch', '2'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_truth_domains', to_jsonb('ulalaunch.com,nasa.gov,jpl.nasa.gov'::text))
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('trajectory_orbit_fallback_domains', to_jsonb('.gov,.mil'::text))
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_orbit_ingest') then
    perform cron.unschedule('trajectory_orbit_ingest');
  end if;

  -- Runs every 6 hours; uses conditional fetch to avoid unnecessary work.
  perform cron.schedule(
    'trajectory_orbit_ingest',
    '21 */6 * * *',
    $job$select public.invoke_edge_job('trajectory-orbit-ingest');$job$
  );
end $$;

