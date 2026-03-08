-- Trajectory low-IO merge path + FAA hazard coverage expansion.
--
-- 1) Add conditional upsert RPC for launch_trajectory_constraints (skip no-op rewrites).
-- 2) Increase trajectory source coverage defaults.
-- 3) Add FAA trajectory hazard ingest settings + managed scheduler job.
-- 4) Wire invoke_edge_job per-job enabled mapping for the new FAA hazard job.

create or replace function public.upsert_launch_trajectory_constraints_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      nullif(btrim(r.source), '') as source,
      nullif(btrim(r.source_id), '') as source_id,
      nullif(btrim(r.constraint_type), '') as constraint_type,
      coalesce(r.data, '{}'::jsonb) as data,
      r.geometry,
      r.confidence,
      r.ingestion_run_id,
      nullif(btrim(r.source_hash), '') as source_hash,
      coalesce(r.extracted_field_map, '{}'::jsonb) as extracted_field_map,
      nullif(btrim(r.parse_rule_id), '') as parse_rule_id,
      nullif(btrim(r.parser_version), '') as parser_version,
      nullif(btrim(r.license_class), '') as license_class,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      source text,
      source_id text,
      constraint_type text,
      data jsonb,
      geometry jsonb,
      confidence double precision,
      ingestion_run_id bigint,
      source_hash text,
      extracted_field_map jsonb,
      parse_rule_id text,
      parser_version text,
      license_class text,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.launch_id is not null
  ),
  input as (
    select distinct on (i.launch_id, i.source, i.constraint_type, i.source_id)
      i.launch_id,
      i.source,
      i.source_id,
      i.constraint_type,
      i.data,
      i.geometry,
      i.confidence,
      i.ingestion_run_id,
      i.source_hash,
      i.extracted_field_map,
      i.parse_rule_id,
      i.parser_version,
      i.license_class,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source is not null
      and i.constraint_type is not null
      and i.source_id is not null
    order by i.launch_id, i.source, i.constraint_type, i.source_id, i.fetched_at desc, i.updated_at desc
  ),
  upserted as (
    insert into public.launch_trajectory_constraints (
      launch_id,
      source,
      source_id,
      constraint_type,
      data,
      geometry,
      confidence,
      ingestion_run_id,
      source_hash,
      extracted_field_map,
      parse_rule_id,
      parser_version,
      license_class,
      fetched_at,
      updated_at
    )
    select
      i.launch_id,
      i.source,
      i.source_id,
      i.constraint_type,
      i.data,
      i.geometry,
      i.confidence,
      i.ingestion_run_id,
      i.source_hash,
      i.extracted_field_map,
      i.parse_rule_id,
      i.parser_version,
      i.license_class,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (launch_id, source, constraint_type, source_id) do update
      set data = excluded.data,
          geometry = excluded.geometry,
          confidence = excluded.confidence,
          ingestion_run_id = excluded.ingestion_run_id,
          source_hash = excluded.source_hash,
          extracted_field_map = excluded.extracted_field_map,
          parse_rule_id = excluded.parse_rule_id,
          parser_version = excluded.parser_version,
          license_class = excluded.license_class,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where launch_trajectory_constraints.data is distinct from excluded.data
        or launch_trajectory_constraints.geometry is distinct from excluded.geometry
        or launch_trajectory_constraints.confidence is distinct from excluded.confidence
        or launch_trajectory_constraints.source_hash is distinct from excluded.source_hash
        or launch_trajectory_constraints.extracted_field_map is distinct from excluded.extracted_field_map
        or launch_trajectory_constraints.parse_rule_id is distinct from excluded.parse_rule_id
        or launch_trajectory_constraints.parser_version is distinct from excluded.parser_version
        or launch_trajectory_constraints.license_class is distinct from excluded.license_class
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;

revoke execute on function public.upsert_launch_trajectory_constraints_if_changed(jsonb) from public;
grant execute on function public.upsert_launch_trajectory_constraints_if_changed(jsonb) to service_role;

insert into public.system_settings (key, value)
values
  ('trajectory_constraints_eligible_limit', '8'::jsonb),
  ('trajectory_orbit_launch_limit', '100'::jsonb),
  ('faa_trajectory_hazard_job_enabled', 'true'::jsonb),
  ('faa_trajectory_hazard_record_limit', '500'::jsonb),
  ('faa_trajectory_hazard_match_horizon_days', '21'::jsonb),
  ('faa_trajectory_hazard_window_buffer_hours', '12'::jsonb)
on conflict (key) do update
set value = excluded.value,
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
  'faa_trajectory_hazard_ingest',
  'faa-trajectory-hazard-ingest',
  3600,
  1980,
  true,
  3,
  public.managed_scheduler_next_run(now(), 3600, 1980)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    next_run_at = public.managed_scheduler_next_run(now(), excluded.interval_seconds, excluded.offset_seconds),
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
    when 'jep-score-refresh' then 'jep_score_job_enabled'
    when 'faa-tfr-ingest' then 'faa_job_enabled'
    when 'faa-notam-detail-ingest' then 'faa_notam_detail_job_enabled'
    when 'faa-launch-match' then 'faa_match_job_enabled'
    when 'faa-trajectory-hazard-ingest' then 'faa_trajectory_hazard_job_enabled'
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
