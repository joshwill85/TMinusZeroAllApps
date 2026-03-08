-- Rebalance high-IO ingest cadences while preserving freshness for key data paths.
-- - celestrak_ingest: every 6 hours
-- - ll2_catalog: every 2 hours
-- - ll2_catalog_agencies: triggered every 6 hours but performs a full run only every 72 hours
--   via ll2_catalog_agencies_min_interval_seconds guard in the Edge function.
-- All three jobs are staggered to avoid the same minute.

-- Ensure required settings exist and tune CelesTrak per-run throughput to avoid stale coverage
-- after reducing run frequency.
insert into public.system_settings (key, value)
values
  ('ll2_catalog_agencies_job_enabled', 'true'::jsonb),
  ('ll2_catalog_agencies_min_interval_seconds', '259200'::jsonb),
  ('celestrak_gp_max_datasets_per_run', '15'::jsonb),
  ('celestrak_satcat_max_datasets_per_run', '15'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

-- Extend per-job enabled mapping for ll2 catalog jobs.
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
    when 'celestrak-supgp-ingest' then 'celestrak_supgp_job_enabled'
    when 'celestrak-retention-cleanup' then 'celestrak_retention_cleanup_enabled'
    when 'celestrak-ingest' then 'celestrak_ingest_job_enabled'
    when 'll2-catalog' then 'll2_catalog_job_enabled'
    when 'll2-catalog-agencies' then 'll2_catalog_agencies_job_enabled'
    when 'navcen-bnm-ingest' then 'navcen_bnm_job_enabled'
    when 'spacex-infographics-ingest' then 'spacex_infographics_job_enabled'
    when 'll2-backfill' then 'll2_backfill_job_enabled'
    when 'll2-payload-backfill' then 'll2_payload_backfill_job_enabled'
    when 'rocket-media-backfill' then 'rocket_media_backfill_job_enabled'
    when 'trajectory-orbit-ingest' then 'trajectory_orbit_job_enabled'
    when 'trajectory-constraints-ingest' then 'trajectory_constraints_job_enabled'
    when 'trajectory-products-generate' then 'trajectory_products_job_enabled'
    when 'trajectory-templates-generate' then 'trajectory_templates_job_enabled'
    when 'faa-tfr-ingest' then 'faa_job_enabled'
    when 'faa-notam-detail-ingest' then 'faa_notam_detail_job_enabled'
    when 'faa-launch-match' then 'faa_match_job_enabled'
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

do $$
begin
  -- celestrak orchestrator: every 6 hours, minute 11
  if exists (select 1 from cron.job where jobname = 'celestrak_ingest') then
    perform cron.unschedule('celestrak_ingest');
  end if;
  perform cron.schedule(
    'celestrak_ingest',
    '11 */6 * * *',
    $job$select public.invoke_edge_job('celestrak-ingest');$job$
  );

  -- ll2 catalog (non-agency entities): every 2 hours, minute 37
  if exists (select 1 from cron.job where jobname = 'll2_catalog') then
    perform cron.unschedule('ll2_catalog');
  end if;
  perform cron.schedule(
    'll2_catalog',
    '37 */2 * * *',
    $job$select public.invoke_edge_job('ll2-catalog');$job$
  );

  -- ll2 agencies: checked every 6 hours, minute 53; function-level min interval enforces 72h full runs.
  if exists (select 1 from cron.job where jobname = 'll2_catalog_agencies') then
    perform cron.unschedule('ll2_catalog_agencies');
  end if;
  perform cron.schedule(
    'll2_catalog_agencies',
    '53 */6 * * *',
    $job$select public.invoke_edge_job('ll2-catalog-agencies');$job$
  );
end $$;
