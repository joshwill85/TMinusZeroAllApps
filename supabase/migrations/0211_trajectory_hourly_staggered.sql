-- Reduce trajectory cron pressure by running once per hour, staggered to avoid overlap.
-- Order is intentional: orbit ingest (:00), constraints ingest (:20), products generate (:40).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_orbit_ingest') then
    perform cron.unschedule('trajectory_orbit_ingest');
  end if;

  perform cron.schedule(
    'trajectory_orbit_ingest',
    '0 * * * *',
    $job$select public.invoke_edge_job('trajectory-orbit-ingest');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_constraints_ingest') then
    perform cron.unschedule('trajectory_constraints_ingest');
  end if;

  perform cron.schedule(
    'trajectory_constraints_ingest',
    '20 * * * *',
    $job$select public.invoke_edge_job('trajectory-constraints-ingest');$job$
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'trajectory_products_generate') then
    perform cron.unschedule('trajectory_products_generate');
  end if;

  perform cron.schedule(
    'trajectory_products_generate',
    '40 * * * *',
    $job$select public.invoke_edge_job('trajectory-products-generate');$job$
  );
end $$;
