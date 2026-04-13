-- Tighten scheduler pressure and make pg_net edge-job dispatches traceable.
--
-- Incident goals:
-- 1) stop using the pg_net default 5s timeout for edge-job dispatches
-- 2) persist request_id -> job_slug attribution for net._http_response reviews
-- 3) lower the busiest scheduler/prune defaults to reduce recurring startup pressure
-- 4) surface public-cache batching intent as an explicit runtime setting

create table if not exists public.edge_job_dispatches (
  request_id bigint primary key,
  job_slug text not null check (char_length(job_slug) between 1 and 255),
  request_url text not null check (char_length(request_url) between 1 and 2048),
  timeout_milliseconds integer not null check (timeout_milliseconds between 1000 and 60000),
  dispatched_at timestamptz not null default now()
);

create index if not exists edge_job_dispatches_job_slug_dispatched_at_idx
  on public.edge_job_dispatches(job_slug, dispatched_at desc);

create index if not exists edge_job_dispatches_dispatched_at_idx
  on public.edge_job_dispatches(dispatched_at desc);

alter table public.edge_job_dispatches enable row level security;

revoke all on table public.edge_job_dispatches from public;
revoke all on table public.edge_job_dispatches from anon, authenticated;
grant all on table public.edge_job_dispatches to service_role;

insert into public.system_settings (key, value)
values
  ('jobs_http_timeout_ms', '15000'::jsonb),
  ('managed_scheduler_enqueue_limit', '100'::jsonb),
  ('managed_scheduler_process_limit', '50'::jsonb),
  ('net_http_response_prune_batch_limit', '10000'::jsonb),
  ('public_cache_page_size', '250'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

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
  timeout_ms integer := 15000;
  request_url text := '';
  request_id bigint := null;
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
    when 'notifications-dispatch' then 'notifications_dispatch_job_enabled'
    when 'notifications-send' then 'notifications_send_job_enabled'

    when 'artemis-bootstrap' then 'artemis_bootstrap_job_enabled'
    when 'artemis-nasa-ingest' then 'artemis_nasa_job_enabled'
    when 'artemis-oversight-ingest' then 'artemis_oversight_job_enabled'
    when 'artemis-budget-ingest' then 'artemis_budget_job_enabled'
    when 'artemis-procurement-ingest' then 'artemis_procurement_job_enabled'
    when 'artemis-contracts-ingest' then 'artemis_contracts_job_enabled'
    when 'artemis-snapshot-build' then 'artemis_snapshot_job_enabled'
    when 'artemis-content-ingest' then 'artemis_content_job_enabled'
    when 'artemis-nasa-blog-backfill' then 'artemis_nasa_blog_backfill_job_enabled'
    when 'artemis-crew-ingest' then 'artemis_crew_job_enabled'
    when 'artemis-components-ingest' then 'artemis_components_job_enabled'

    when 'blue-origin-bootstrap' then 'blue_origin_bootstrap_job_enabled'
    when 'blue-origin-vehicles-ingest' then 'blue_origin_vehicles_job_enabled'
    when 'blue-origin-engines-ingest' then 'blue_origin_engines_job_enabled'
    when 'blue-origin-missions-ingest' then 'blue_origin_missions_job_enabled'
    when 'blue-origin-news-ingest' then 'blue_origin_news_job_enabled'
    when 'blue-origin-media-ingest' then 'blue_origin_media_job_enabled'
    when 'blue-origin-passengers-ingest' then 'blue_origin_passengers_job_enabled'
    when 'blue-origin-payloads-ingest' then 'blue_origin_payloads_job_enabled'
    when 'blue-origin-contracts-ingest' then 'blue_origin_contracts_job_enabled'
    when 'blue-origin-social-ingest' then 'blue_origin_social_job_enabled'
    when 'blue-origin-snapshot-build' then 'blue_origin_snapshot_job_enabled'

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
    when 'll2-backfill' then 'll2_backfill_job_enabled'
    when 'll2-payload-backfill' then 'll2_payload_backfill_job_enabled'

    when 'navcen-bnm-ingest' then 'navcen_bnm_job_enabled'
    when 'rocket-media-backfill' then 'rocket_media_backfill_job_enabled'
    when 'spacex-infographics-ingest' then 'spacex_infographics_job_enabled'
    when 'spacex-drone-ship-ingest' then 'spacex_drone_ship_ingest_enabled'
    when 'spacex-drone-ship-wiki-sync' then 'spacex_drone_ship_wiki_sync_enabled'

    when 'trajectory-orbit-ingest' then 'trajectory_orbit_job_enabled'
    when 'trajectory-constraints-ingest' then 'trajectory_constraints_job_enabled'
    when 'trajectory-products-generate' then 'trajectory_products_job_enabled'
    when 'trajectory-templates-generate' then 'trajectory_templates_job_enabled'

    when 'jep-score-refresh' then 'jep_score_job_enabled'
    when 'jep-moon-ephemeris-refresh' then 'jep_moon_ephemeris_job_enabled'
    when 'jep-background-light-refresh' then 'jep_background_light_job_enabled'

    when 'faa-tfr-ingest' then 'faa_job_enabled'
    when 'faa-notam-detail-ingest' then 'faa_notam_detail_job_enabled'
    when 'faa-launch-match' then 'faa_match_job_enabled'
    when 'faa-trajectory-hazard-ingest' then 'faa_trajectory_hazard_job_enabled'

    when 'ws45-live-weather-ingest' then 'ws45_live_weather_job_enabled'
    when 'ws45-planning-forecast-ingest' then 'ws45_planning_forecast_job_enabled'
    when 'ws45-weather-retention-cleanup' then 'ws45_weather_retention_cleanup_enabled'

    when 'launch-social-link-backfill' then 'launch_social_link_backfill_enabled'
    when 'og-prewarm' then 'og_prewarm_enabled'
    when 'ops-metrics-collect' then 'ops_metrics_collection_enabled'
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

  select
    case
      when jsonb_typeof(value) = 'number' then greatest(1000, least((value::text)::int, 60000))
      when jsonb_typeof(value) = 'string'
        and trim(both '"' from value::text) ~ '^-?\\d+$'
        then greatest(1000, least((trim(both '"' from value::text))::int, 60000))
      else null
    end
  into timeout_ms
  from public.system_settings
  where key = 'jobs_http_timeout_ms';

  timeout_ms := coalesce(timeout_ms, 15000);

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

  request_url := base_url || '/' || job_slug;

  headers := jsonb_build_object(
    'Authorization', format('Bearer %s', api_key),
    'apikey', api_key,
    'x-job-token', auth_token,
    'Content-Type', 'application/json'
  );

  request_id := net.http_post(
    url := request_url,
    headers := headers,
    body := '{}'::jsonb,
    timeout_milliseconds := timeout_ms
  );

  if request_id is null then
    return;
  end if;

  begin
    insert into public.edge_job_dispatches (
      request_id,
      job_slug,
      request_url,
      timeout_milliseconds,
      dispatched_at
    )
    values (
      request_id,
      job_slug,
      request_url,
      timeout_ms,
      now()
    )
    on conflict (request_id) do update
    set job_slug = excluded.job_slug,
        request_url = excluded.request_url,
        timeout_milliseconds = excluded.timeout_milliseconds,
        dispatched_at = excluded.dispatched_at;
  exception
    when others then
      raise notice 'edge_job_dispatches insert failed for %: %', job_slug, sqlerrm;
  end;
end;
$function$;

create or replace function public.prune_net_http_response(
  retain_hours_in int default null,
  batch_limit_in int default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_retain_hours int := 24;
  v_batch_limit int := 50000;
  v_deleted int := 0;
  v_dispatch_deleted int := 0;
  v_sql text;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;

  if retain_hours_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 24 * 30))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1, least((trim(both '"' from s.value::text))::int, 24 * 30))
        else null
      end
    into v_retain_hours
    from public.system_settings s
    where s.key = 'net_http_response_retention_hours';
  else
    v_retain_hours := greatest(1, least(retain_hours_in, 24 * 30));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1000, least((s.value::text)::int, 500000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1000, least((trim(both '"' from s.value::text))::int, 500000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'net_http_response_prune_batch_limit';
  else
    v_batch_limit := greatest(1000, least(batch_limit_in, 500000));
  end if;

  v_retain_hours := coalesce(v_retain_hours, 24);
  v_batch_limit := coalesce(v_batch_limit, 50000);

  v_sql := format(
    $qry$
      with doomed as (
        select ctid
        from net._http_response
        where created < now() - make_interval(hours => %s)
        order by created asc
        limit %s
      ), deleted_rows as (
        delete from net._http_response r
        using doomed
        where r.ctid = doomed.ctid
        returning 1
      )
      select count(*)::int from deleted_rows
    $qry$,
    v_retain_hours,
    v_batch_limit
  );

  execute v_sql into v_deleted;

  if to_regclass('public.edge_job_dispatches') is not null then
    with doomed as (
      select ctid
      from public.edge_job_dispatches
      where dispatched_at < now() - make_interval(hours => v_retain_hours)
      order by dispatched_at asc
      limit v_batch_limit
    ), deleted_rows as (
      delete from public.edge_job_dispatches d
      using doomed
      where d.ctid = doomed.ctid
      returning 1
    )
    select count(*)::int into v_dispatch_deleted from deleted_rows;
  end if;

  return coalesce(v_deleted, 0);
end;
$$;

revoke execute on function public.prune_net_http_response(int, int) from public;
grant execute on function public.prune_net_http_response(int, int) to service_role;
