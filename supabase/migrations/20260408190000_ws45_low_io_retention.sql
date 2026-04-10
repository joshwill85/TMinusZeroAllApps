insert into public.system_settings (key, value)
values
  ('ws45_weather_retention_cleanup_enabled', 'true'::jsonb),
  ('ws45_live_weather_retention_hours', '72'::jsonb),
  ('ws45_planning_forecast_retention_days', '30'::jsonb),
  ('ws45_weather_retention_cleanup_batch_limit', '5000'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create or replace function public.prune_ws45_live_weather_snapshots(
  retain_hours_in int default null,
  batch_limit_in int default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_retain_hours int := 72;
  v_batch_limit int := 5000;
  v_deleted int := 0;
begin
  if retain_hours_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(24, least((s.value::text)::int, 24 * 30))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(24, least((trim(both '"' from s.value::text))::int, 24 * 30))
        else null
      end
    into v_retain_hours
    from public.system_settings s
    where s.key = 'ws45_live_weather_retention_hours';
  else
    v_retain_hours := greatest(24, least(retain_hours_in, 24 * 30));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(100, least((s.value::text)::int, 50000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(100, least((trim(both '"' from s.value::text))::int, 50000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'ws45_weather_retention_cleanup_batch_limit';
  else
    v_batch_limit := greatest(100, least(batch_limit_in, 50000));
  end if;

  with keep_row as (
    select id
    from public.ws45_live_weather_snapshots
    order by fetched_at desc, created_at desc
    limit 1
  ), doomed as (
    select ctid
    from public.ws45_live_weather_snapshots
    where fetched_at < now() - make_interval(hours => coalesce(v_retain_hours, 72))
      and id not in (select id from keep_row)
    order by fetched_at asc, created_at asc
    limit coalesce(v_batch_limit, 5000)
  ), deleted_rows as (
    delete from public.ws45_live_weather_snapshots t
    using doomed
    where t.ctid = doomed.ctid
    returning 1
  )
  select count(*)::int into v_deleted from deleted_rows;

  return coalesce(v_deleted, 0);
end;
$$;

create or replace function public.prune_ws45_planning_forecasts(
  retain_days_in int default null,
  batch_limit_in int default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_retain_days int := 30;
  v_batch_limit int := 5000;
  v_deleted int := 0;
begin
  if retain_days_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(7, least((s.value::text)::int, 365))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(7, least((trim(both '"' from s.value::text))::int, 365))
        else null
      end
    into v_retain_days
    from public.system_settings s
    where s.key = 'ws45_planning_forecast_retention_days';
  else
    v_retain_days := greatest(7, least(retain_days_in, 365));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(100, least((s.value::text)::int, 50000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(100, least((trim(both '"' from s.value::text))::int, 50000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'ws45_weather_retention_cleanup_batch_limit';
  else
    v_batch_limit := greatest(100, least(batch_limit_in, 50000));
  end if;

  with keep_rows as (
    select distinct on (product_kind) id
    from public.ws45_planning_forecasts
    order by product_kind, fetched_at desc, updated_at desc, created_at desc
  ), doomed as (
    select ctid
    from public.ws45_planning_forecasts
    where fetched_at < now() - make_interval(days => coalesce(v_retain_days, 30))
      and id not in (select id from keep_rows)
    order by fetched_at asc, created_at asc
    limit coalesce(v_batch_limit, 5000)
  ), deleted_rows as (
    delete from public.ws45_planning_forecasts t
    using doomed
    where t.ctid = doomed.ctid
    returning 1
  )
  select count(*)::int into v_deleted from deleted_rows;

  return coalesce(v_deleted, 0);
end;
$$;

create or replace function public.invoke_edge_job(job_slug text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  enabled boolean := false;
  job_enabled boolean := true;
  job_enabled_key text := null;
  base_url text := '';
  auth_token text := '';
  api_key text := '';
  headers jsonb;
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into enabled
  from public.system_settings
  where key = 'jobs_enabled';

  if not enabled then
    return;
  end if;

  job_enabled_key := case job_slug
    when 'celestrak-gp-groups-sync' then 'celestrak_gp_groups_sync_enabled'
    when 'celestrak-gp-ingest' then 'celestrak_gp_job_enabled'
    when 'celestrak-satcat-ingest' then 'celestrak_satcat_job_enabled'
    when 'celestrak-intdes-ingest' then 'celestrak_intdes_job_enabled'
    when 'celestrak-supgp-sync' then 'celestrak_supgp_sync_enabled'
    when 'celestrak-supgp-ingest' then 'celestrak_supgp_job_enabled'
    when 'celestrak-retention-cleanup' then 'celestrak_retention_cleanup_enabled'
    when 'celestrak-ingest' then 'celestrak_ingest_job_enabled'
    when 'll2-catalog' then 'll2_catalog_job_enabled'
    when 'll2-catalog-agencies' then 'll2_catalog_agencies_job_enabled'
    when 'll2-future-launch-sync' then 'll2_future_launch_sync_job_enabled'
    when 'navcen-bnm-ingest' then 'navcen_bnm_job_enabled'
    when 'spacex-infographics-ingest' then 'spacex_infographics_job_enabled'
    when 'll2-backfill' then 'll2_backfill_job_enabled'
    when 'll2-payload-backfill' then 'll2_payload_backfill_job_enabled'
    when 'rocket-media-backfill' then 'rocket_media_backfill_job_enabled'
    when 'trajectory-orbit-ingest' then 'trajectory_orbit_job_enabled'
    when 'trajectory-constraints-ingest' then 'trajectory_constraints_job_enabled'
    when 'trajectory-products-generate' then 'trajectory_products_job_enabled'
    when 'trajectory-templates-generate' then 'trajectory_templates_job_enabled'
    when 'jep-score-refresh' then 'jep_score_job_enabled'
    when 'faa-tfr-ingest' then 'faa_job_enabled'
    when 'faa-notam-detail-ingest' then 'faa_notam_detail_job_enabled'
    when 'faa-launch-match' then 'faa_match_job_enabled'
    when 'faa-trajectory-hazard-ingest' then 'faa_trajectory_hazard_job_enabled'
    when 'ws45-live-weather-ingest' then 'ws45_live_weather_job_enabled'
    when 'ws45-planning-forecast-ingest' then 'ws45_planning_forecast_job_enabled'
    when 'ws45-weather-retention-cleanup' then 'ws45_weather_retention_cleanup_enabled'
    else null
  end;

  if job_enabled_key is not null then
    select
      case
        when jsonb_typeof(value) = 'boolean' then (value::boolean)
        when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
        else false
      end
    into job_enabled
    from public.system_settings
    where key = job_enabled_key;

    if not job_enabled then
      return;
    end if;
  end if;

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into base_url
  from public.system_settings
  where key = 'jobs_base_url';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into auth_token
  from public.system_settings
  where key = 'jobs_auth_token';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into api_key
  from public.system_settings
  where key = 'jobs_apikey';

  if base_url = '' then
    raise notice 'jobs_base_url not set';
    return;
  end if;

  if api_key = '' then
    raise notice 'jobs_apikey not set';
    return;
  end if;

  if auth_token = '' then
    raise notice 'jobs_auth_token not set';
    return;
  end if;

  headers := jsonb_build_object(
    'Authorization', format('Bearer %s', api_key),
    'apikey', api_key,
    'x-job-token', auth_token,
    'Content-Type', 'application/json'
  );

  perform net.http_post(
    url := base_url || '/' || job_slug,
    headers := headers,
    body := '{}'::jsonb
  );
end;
$function$;

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values
  ('ws45_weather_retention_cleanup', 'ws45-weather-retention-cleanup', 86400, 2100, true, 3, public.managed_scheduler_next_run(now(), 86400, 2100))
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();
