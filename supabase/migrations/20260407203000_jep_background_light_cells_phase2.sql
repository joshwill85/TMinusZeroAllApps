-- JEP v6 phase 2 background-light slice:
-- 1) observer-cell Black Marble baselines with provenance
-- 2) dark-gated background refresh scheduler defaults
-- 3) combined background shadow snapshot toggle

create table if not exists public.jep_background_light_cells (
  id bigserial primary key,
  observer_feature_key text not null,
  observer_lat_bucket numeric(6,3),
  observer_lon_bucket numeric(7,3),
  source_key text not null,
  source_version_id bigint references public.jep_source_versions(id) on delete set null,
  source_fetch_run_id bigint references public.jep_source_fetch_runs(id) on delete set null,
  product_key text not null check (product_key in ('VNP46A3', 'VNP46A4')),
  period_start_date date not null,
  period_end_date date not null,
  tile_h integer not null check (tile_h between 0 and 35),
  tile_v integer not null check (tile_v between 0 and 17),
  tile_row_index integer not null check (tile_row_index between 0 and 2399),
  tile_col_index integer not null check (tile_col_index between 0 and 2399),
  radiance_dataset text,
  radiance_nw_cm2_sr double precision,
  radiance_log double precision,
  radiance_stddev_nw_cm2_sr double precision,
  radiance_observation_count integer,
  quality_code integer,
  land_water_code integer,
  normalization_scope text not null default 'tile_land',
  normalization_version text not null default 'percentile_v1',
  radiance_percentile double precision,
  s_anthro double precision,
  metadata jsonb not null default '{}'::jsonb,
  confidence_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(observer_feature_key) between 1 and 128),
  check (char_length(source_key) between 1 and 64),
  check (period_end_date >= period_start_date),
  check (radiance_percentile is null or (radiance_percentile >= 0 and radiance_percentile <= 1)),
  check (s_anthro is null or (s_anthro >= 0 and s_anthro <= 1)),
  unique (observer_feature_key, source_key, period_start_date)
);

create index if not exists jep_background_light_cells_feature_period_idx
  on public.jep_background_light_cells (observer_feature_key, period_start_date desc, source_key);

create index if not exists jep_background_light_cells_source_period_idx
  on public.jep_background_light_cells (source_key, period_start_date desc, updated_at desc);

alter table public.jep_background_light_cells enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_background_light_cells'
      and policyname = 'admin manage jep background light cells'
  ) then
    create policy "admin manage jep background light cells"
      on public.jep_background_light_cells
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_background_light_job_enabled', 'false'::jsonb),
  ('jep_background_light_horizon_days', '45'::jsonb),
  ('jep_background_light_max_cells_per_run', '96'::jsonb),
  ('jep_background_light_normalization_scope', '"tile_land"'::jsonb),
  ('jep_v6_background_feature_snapshots_enabled', 'false'::jsonb)
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
  'jep_background_light_refresh',
  'jep-background-light-refresh',
  43200,
  1200,
  false,
  3,
  public.managed_scheduler_next_run(now(), 43200, 1200)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();
