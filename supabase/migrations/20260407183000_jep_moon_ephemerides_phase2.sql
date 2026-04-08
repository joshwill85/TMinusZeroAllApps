-- JEP v6 phase 2 slice:
-- 1) observer/time-series moon ephemerides with provenance pointers
-- 2) dark-gated moon refresh scheduler defaults

create table if not exists public.jep_moon_ephemerides (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  observer_location_hash text not null,
  observer_feature_key text not null,
  observer_lat_bucket numeric(6,3),
  observer_lon_bucket numeric(7,3),
  observer_elev_m integer,
  sample_at timestamptz not null,
  sample_offset_sec integer not null default 0,
  source_key text not null,
  source_version_id bigint references public.jep_source_versions(id) on delete set null,
  source_fetch_run_id bigint references public.jep_source_fetch_runs(id) on delete set null,
  qa_source_key text,
  qa_version_id bigint references public.jep_source_versions(id) on delete set null,
  qa_fetch_run_id bigint references public.jep_source_fetch_runs(id) on delete set null,
  moon_az_deg numeric(7,3),
  moon_el_deg numeric(7,3),
  moon_illum_frac numeric(7,5),
  moon_phase_name text,
  moon_phase_angle_deg numeric(7,3),
  moonrise_utc timestamptz,
  moonset_utc timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  confidence_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(observer_location_hash) between 1 and 64),
  check (char_length(observer_feature_key) between 1 and 128),
  check (char_length(source_key) between 1 and 64),
  check (qa_source_key is null or char_length(qa_source_key) between 1 and 64),
  check (sample_offset_sec between -86400 and 86400),
  check (moon_illum_frac is null or (moon_illum_frac >= 0 and moon_illum_frac <= 1)),
  unique (launch_id, observer_location_hash, sample_at)
);

create index if not exists jep_moon_ephemerides_launch_observer_sample_idx
  on public.jep_moon_ephemerides (launch_id, observer_location_hash, sample_at);

create index if not exists jep_moon_ephemerides_feature_sample_idx
  on public.jep_moon_ephemerides (observer_feature_key, sample_at desc);

alter table public.jep_moon_ephemerides enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_moon_ephemerides'
      and policyname = 'admin manage jep moon ephemerides'
  ) then
    create policy "admin manage jep moon ephemerides"
      on public.jep_moon_ephemerides
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_moon_ephemeris_job_enabled', 'false'::jsonb),
  ('jep_moon_ephemeris_horizon_days', '16'::jsonb),
  ('jep_moon_ephemeris_max_launches_per_run', '60'::jsonb),
  ('jep_moon_ephemeris_step_seconds', '60'::jsonb),
  ('jep_moon_ephemeris_prelaunch_padding_minutes', '5'::jsonb),
  ('jep_moon_ephemeris_postlaunch_padding_minutes', '20'::jsonb),
  ('jep_moon_ephemeris_max_window_minutes', '180'::jsonb)
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
  'jep_moon_ephemeris_refresh',
  'jep-moon-ephemeris-refresh',
  1800,
  600,
  false,
  3,
  public.managed_scheduler_next_run(now(), 1800, 600)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();
