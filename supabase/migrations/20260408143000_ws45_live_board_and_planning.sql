insert into public.system_settings (key, value)
values
  ('ws45_live_weather_job_enabled', 'true'::jsonb),
  ('ws45_planning_forecast_job_enabled', 'true'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create table if not exists public.ws45_live_weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null default '5ws_live_board',
  source_page_url text not null default 'https://45thweathersquadron.nebula.spaceforce.mil/pages/weatherSafety.html',
  board_url text not null default 'https://nimboard.rad.spaceforce.mil/nimboard',
  fetched_at timestamptz not null default now(),
  agency_count int not null default 0 check (agency_count >= 0),
  ring_count int not null default 0 check (ring_count >= 0),
  active_phase_1_count int not null default 0 check (active_phase_1_count >= 0),
  active_phase_2_count int not null default 0 check (active_phase_2_count >= 0),
  active_wind_count int not null default 0 check (active_wind_count >= 0),
  active_severe_count int not null default 0 check (active_severe_count >= 0),
  summary text,
  agencies jsonb not null default '[]'::jsonb,
  lightning_rings jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ws45_live_weather_snapshots_fetched_at_idx
  on public.ws45_live_weather_snapshots (fetched_at desc);

alter table public.ws45_live_weather_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ws45_live_weather_snapshots'
      and policyname = 'paid read ws45 live weather snapshots'
  ) then
    create policy "paid read ws45 live weather snapshots"
      on public.ws45_live_weather_snapshots
      for select using (public.is_paid_user() or public.is_admin());
  end if;
end $$;

create table if not exists public.ws45_planning_forecasts (
  id uuid primary key default gen_random_uuid(),
  product_kind text not null
    check (product_kind in ('planning_24h', 'weekly_planning')),
  source text not null default '45ws_planning',
  source_page_url text not null default 'https://45thweathersquadron.nebula.spaceforce.mil/pages/planningAndAviationForecastProducts.html',
  source_label text,
  pdf_url text not null,
  pdf_etag text,
  pdf_last_modified timestamptz,
  pdf_sha256 text not null,
  pdf_bytes int,
  pdf_metadata jsonb,
  fetched_at timestamptz not null default now(),
  issued_at timestamptz,
  valid_start timestamptz,
  valid_end timestamptz,
  valid_window tstzrange generated always as (
    case
      when valid_start is not null and valid_end is not null then tstzrange(valid_start, valid_end, '[)')
      else null
    end
  ) stored,
  headline text,
  summary text,
  highlights text[] not null default '{}',
  raw_text text,
  raw jsonb not null default '{}'::jsonb,
  parse_version text not null default 'v1',
  document_family text,
  parse_status text not null default 'failed'
    check (parse_status in ('parsed', 'partial', 'failed')),
  parse_confidence int check (parse_confidence between 0 and 100),
  publish_eligible boolean not null default false,
  quarantine_reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_kind, pdf_url, pdf_sha256)
);

create index if not exists ws45_planning_forecasts_product_fetched_idx
  on public.ws45_planning_forecasts (product_kind, fetched_at desc);

create index if not exists ws45_planning_forecasts_product_issued_idx
  on public.ws45_planning_forecasts (product_kind, issued_at desc);

create index if not exists ws45_planning_forecasts_publish_idx
  on public.ws45_planning_forecasts (publish_eligible, fetched_at desc);

create index if not exists ws45_planning_forecasts_valid_window_gist
  on public.ws45_planning_forecasts using gist (valid_window);

alter table public.ws45_planning_forecasts enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ws45_planning_forecasts'
      and policyname = 'paid read ws45 planning forecasts'
  ) then
    create policy "paid read ws45 planning forecasts"
      on public.ws45_planning_forecasts
      for select using (public.is_paid_user() or public.is_admin());
  end if;
end $$;

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
  ('ws45_live_weather_ingest', 'ws45-live-weather-ingest', 900, 780, true, 3, public.managed_scheduler_next_run(now(), 900, 780)),
  ('ws45_planning_forecast_ingest', 'ws45-planning-forecast-ingest', 1800, 1560, true, 3, public.managed_scheduler_next_run(now(), 1800, 1560))
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();
