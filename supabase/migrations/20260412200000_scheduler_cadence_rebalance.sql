-- Rebalance scheduler cadence after the April restart investigation.
-- Goals:
-- 1) reduce noisy non-critical wakeups
-- 2) keep live/hot-path jobs on their existing fast paths
-- 3) retire Artemis bootstrap once the original bootstrap checkpoints are complete
-- 4) stagger longer-running jobs so they do not pile onto the same minute

with desired(cron_job_name, interval_seconds, offset_seconds) as (
  values
    ('ingestion_cycle', 1800, 180),
    ('jep_score_refresh', 7200, 2460),
    ('monitoring_check', 3600, 1080),
    ('ws45_forecasts_ingest', 14400, 5760),
    ('ws45_planning_forecast_ingest', 14400, 6960),
    ('celestrak_supgp_sync', 10800, 420),
    ('celestrak_supgp_ingest', 3600, 2220),
    ('spacex_x_post_snapshot', 3600, 3120),
    ('jep_moon_ephemeris_refresh', 14400, 1560),
    ('billing_reconcile', 10800, 9300),
    ('faa_tfr_ingest', 10800, 1740),
    ('launch_social_refresh', 10800, 2820),
    ('faa_notam_detail_ingest', 10800, 3900),
    ('trajectory_orbit_ingest', 10800, 660),
    ('trajectory_constraints_ingest', 10800, 4980),
    ('faa_launch_match', 10800, 6060),
    ('faa_trajectory_hazard_ingest', 10800, 7140),
    ('trajectory_products_generate', 10800, 8220),
    ('social_posts_dispatch', 1800, 480),
    ('ws45_live_weather_ingest', 900, 780)
)
update public.managed_scheduler_jobs j
set interval_seconds = d.interval_seconds,
    offset_seconds = d.offset_seconds,
    next_run_at = public.managed_scheduler_next_run(now(), d.interval_seconds, d.offset_seconds),
    updated_at = now()
from desired d
where j.cron_job_name = d.cron_job_name;

-- Keep SupGP throughput reasonable after slowing the base scheduler.
insert into public.system_settings (key, value)
values ('celestrak_supgp_max_datasets_per_run', '12'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

-- Hazard freshness alerts need a little more slack once the source jobs run every 3 hours.
insert into public.system_settings as s (key, value)
values ('trajectory_freshness_hazard_max_age_hours', '6'::jsonb)
on conflict (key) do update
set value = case
      when jsonb_typeof(s.value) = 'number'
        and (s.value::text)::numeric > 6
        then s.value
      else excluded.value
    end,
    updated_at = now();

do $$
declare
  v_bootstrap_complete boolean := false;
begin
  select not exists (
    select 1
    from public.artemis_ingest_checkpoints
    where source_key in (
      'nasa_campaign_pages',
      'nasa_blog_posts',
      'nasa_reference_timelines',
      'nasa_rss',
      'oig_reports',
      'gao_reports',
      'moon_to_mars_docs',
      'ntrs_api',
      'techport_api',
      'nasa_budget_docs',
      'usaspending_awards',
      'nasa_media_assets'
    )
      and status <> 'complete'
  )
  into v_bootstrap_complete;

  insert into public.system_settings (key, value)
  values ('artemis_bootstrap_complete', to_jsonb(v_bootstrap_complete))
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

  if v_bootstrap_complete then
    insert into public.system_settings (key, value)
    values ('artemis_bootstrap_job_enabled', 'false'::jsonb)
    on conflict (key) do update
    set value = excluded.value,
        updated_at = now();

    update public.managed_scheduler_jobs
    set enabled = false,
        updated_at = now()
    where cron_job_name = 'artemis_bootstrap';
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'navcen_bnm_ingest') then
    perform cron.unschedule('navcen_bnm_ingest');
  end if;
  perform cron.schedule(
    'navcen_bnm_ingest',
    '24 */3 * * *',
    $job$select public.invoke_edge_job('navcen-bnm-ingest');$job$
  );

  if exists (select 1 from cron.job where jobname = 'cron_job_run_details_prune') then
    perform cron.unschedule('cron_job_run_details_prune');
  end if;
  perform cron.schedule(
    'cron_job_run_details_prune',
    '47 */6 * * *',
    $job$select public.prune_cron_job_run_details(interval '48 hours', 50000);$job$
  );

  if exists (select 1 from cron.job where jobname = 'net_http_response_prune') then
    perform cron.unschedule('net_http_response_prune');
  end if;
  perform cron.schedule(
    'net_http_response_prune',
    '17 */6 * * *',
    $job$select public.prune_net_http_response();$job$
  );
end $$;
