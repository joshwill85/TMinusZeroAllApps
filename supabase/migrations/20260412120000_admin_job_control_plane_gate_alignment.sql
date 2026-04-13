-- Align invoke_edge_job per-job gates with the admin control-plane registry.
-- This makes admin enabled/disabled state truthful for pg_cron and managed jobs
-- that dispatch through invoke_edge_job(job_slug).

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
