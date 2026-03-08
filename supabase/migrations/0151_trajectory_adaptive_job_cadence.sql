-- Increase trajectory-related job cadence to support near-launch freshness gates.
-- This complements source-contract enforcement in trajectory-products-generate.

-- Tune orbit ingest defaults for higher cadence runs (reduce per-run blast radius).
insert into public.system_settings (key, value)
values
  ('trajectory_orbit_launch_limit', '20'::jsonb),
  ('trajectory_orbit_horizon_days', '14'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

-- Increase navcen hazard feed cadence (critical azimuth/downrange constraint).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'navcen_bnm_ingest') then
    perform cron.unschedule('navcen_bnm_ingest');
  end if;
  perform cron.schedule(
    'navcen_bnm_ingest',
    '*/2 * * * *',
    $job$select public.invoke_edge_job('navcen-bnm-ingest');$job$
  );
end $$;

-- Increase trajectory orbit document cadence.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_orbit_ingest') then
    perform cron.unschedule('trajectory_orbit_ingest');
  end if;
  perform cron.schedule(
    'trajectory_orbit_ingest',
    '*/5 * * * *',
    $job$select public.invoke_edge_job('trajectory-orbit-ingest');$job$
  );
end $$;

-- Increase landing constraints cadence.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_constraints_ingest') then
    perform cron.unschedule('trajectory_constraints_ingest');
  end if;
  perform cron.schedule(
    'trajectory_constraints_ingest',
    '*/5 * * * *',
    $job$select public.invoke_edge_job('trajectory-constraints-ingest');$job$
  );
end $$;

-- Increase product regeneration cadence.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_products_generate') then
    perform cron.unschedule('trajectory_products_generate');
  end if;
  perform cron.schedule(
    'trajectory_products_generate',
    '*/5 * * * *',
    $job$select public.invoke_edge_job('trajectory-products-generate');$job$
  );
end $$;

-- Increase SupGP ingest cadence and lower dataset interval to support prelaunch windows.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'celestrak_supgp_ingest') then
    perform cron.unschedule('celestrak_supgp_ingest');
  end if;
  perform cron.schedule(
    'celestrak_supgp_ingest',
    '*/2 * * * *',
    $job$select public.invoke_edge_job('celestrak-supgp-ingest');$job$
  );
end $$;

update public.celestrak_datasets
set min_interval_seconds = least(coalesce(min_interval_seconds, 7200), 120),
    updated_at = now()
where dataset_type = 'supgp';

