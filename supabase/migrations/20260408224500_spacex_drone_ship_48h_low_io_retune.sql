-- Retune SpaceX drone-ship assignment refresh for lower IO and bounded runtime.

insert into public.system_settings (key, value)
values
  ('spacex_drone_ship_ingest_batch_size', '12'::jsonb),
  ('spacex_drone_ship_ingest_lookback_days', '2'::jsonb),
  ('spacex_drone_ship_ingest_lookahead_days', '7'::jsonb),
  ('spacex_drone_ship_ingest_stale_hours', '48'::jsonb),
  ('spacex_drone_ship_ingest_lock_ttl_seconds', '900'::jsonb),
  ('spacex_drone_ship_ll2_fetch_timeout_ms', '12000'::jsonb),
  ('spacex_drone_ship_wiki_fetch_timeout_ms', '10000'::jsonb),
  ('spacex_drone_ship_wiki_sync_lock_ttl_seconds', '900'::jsonb),
  ('spacex_drone_ship_wiki_sync_interval_days', '30'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

insert into public.system_settings (key, value)
values
  ('spacex_drone_ship_ingest_enabled', 'true'::jsonb),
  ('spacex_drone_ship_wiki_sync_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function public.get_spacex_drone_ship_ingest_candidates(
  limit_n int default 12,
  lookback_days int default 2,
  lookahead_days int default 7,
  stale_hours int default 48
)
returns table (
  launch_id uuid,
  ll2_launch_uuid uuid,
  net timestamptz,
  assignment_last_verified timestamptz
)
language sql
security definer
set search_path = public
as $function$
  with filtered as (
    select
      lpc.launch_id,
      lpc.ll2_launch_uuid,
      lpc.net,
      a.launch_id as assignment_launch_id,
      a.ship_slug,
      a.last_verified_at
    from public.launches_public_cache lpc
    left join public.spacex_drone_ship_assignments a
      on a.launch_id = lpc.launch_id
    where lpc.ll2_launch_uuid is not null
      and lpc.net is not null
      and lpc.net >= now() - make_interval(days => greatest(1, lookback_days))
      and lpc.net <= now() + make_interval(days => greatest(1, lookahead_days))
      and (
        lpc.provider ilike '%SpaceX%'
        or lpc.provider ilike '%Space X%'
        or lpc.name ilike '%Starship%'
        or lpc.name ilike '%Super Heavy%'
        or lpc.name ilike '%Falcon 9%'
        or lpc.name ilike '%Falcon Heavy%'
        or lpc.name ilike '%Crew Dragon%'
        or lpc.name ilike '%Cargo Dragon%'
        or lpc.mission_name ilike '%Starship%'
        or lpc.mission_name ilike '%Falcon%'
        or lpc.mission_name ilike '%Dragon%'
        or lpc.vehicle ilike '%Starship%'
        or lpc.vehicle ilike '%Falcon%'
        or lpc.vehicle ilike '%Dragon%'
        or lpc.rocket_full_name ilike '%Starship%'
        or lpc.rocket_full_name ilike '%Falcon%'
        or lpc.rocket_full_name ilike '%Dragon%'
      )
  ),
  prioritized as (
    select
      f.launch_id,
      f.ll2_launch_uuid,
      f.net,
      f.last_verified_at,
      case when f.assignment_launch_id is null then 0 else 1 end as row_presence_rank,
      case
        when f.assignment_launch_id is null then 0
        when f.ship_slug is null then 1
        else 2
      end as assignment_quality_rank,
      case when f.net >= now() then 0 else 1 end as temporal_rank,
      abs(extract(epoch from (f.net - now()))) as distance_seconds
    from filtered f
    where f.assignment_launch_id is null
       or f.last_verified_at is null
       or f.last_verified_at <= now() - make_interval(hours => greatest(1, stale_hours))
       or (f.ship_slug is null and f.net >= now() - make_interval(days => greatest(1, lookback_days)))
  )
  select
    p.launch_id,
    p.ll2_launch_uuid,
    p.net,
    p.last_verified_at as assignment_last_verified
  from prioritized p
  order by
    p.row_presence_rank asc,
    p.assignment_quality_rank asc,
    p.temporal_rank asc,
    p.distance_seconds asc,
    p.net desc
  limit least(greatest(limit_n, 1), 200);
$function$;

revoke execute on function public.get_spacex_drone_ship_ingest_candidates(int, int, int, int) from public;
grant execute on function public.get_spacex_drone_ship_ingest_candidates(int, int, int, int) to service_role;

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
    when 'spacex-drone-ship-ingest' then 'spacex_drone_ship_ingest_enabled'
    when 'spacex-drone-ship-wiki-sync' then 'spacex_drone_ship_wiki_sync_enabled'
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
values (
  'spacex_drone_ship_ingest',
  'spacex-drone-ship-ingest',
  172800,
  900,
  true,
  3,
  public.managed_scheduler_next_run(now(), 172800, 900)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = public.managed_scheduler_jobs.enabled,
    max_attempts = excluded.max_attempts,
    next_run_at = public.managed_scheduler_next_run(now(), excluded.interval_seconds, excluded.offset_seconds),
    updated_at = now();

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values (
  'spacex_drone_ship_wiki_sync',
  'spacex-drone-ship-wiki-sync',
  604800,
  12600,
  true,
  3,
  public.managed_scheduler_next_run(now(), 604800, 12600)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = public.managed_scheduler_jobs.enabled,
    max_attempts = excluded.max_attempts,
    next_run_at = public.managed_scheduler_next_run(now(), excluded.interval_seconds, excluded.offset_seconds),
    updated_at = now();
