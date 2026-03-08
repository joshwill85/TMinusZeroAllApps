create table if not exists public.jep_outcome_reports (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reported_at timestamptz not null default now(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  user_id uuid references public.profiles(user_id) on delete set null,
  reporter_hash text not null,
  observer_location_hash text not null,
  observer_lat_bucket numeric(6,3),
  observer_lon_bucket numeric(7,3),
  observer_personalized boolean not null default false,
  outcome text not null check (outcome in ('seen', 'not_seen', 'not_observable')),
  source text not null default 'curated_import' check (source in ('curated_import', 'admin_manual')),
  report_mode text not null check (report_mode in ('watchability', 'probability')),
  reported_score smallint not null check (reported_score between 0 and 100),
  reported_probability numeric(6,5) not null check (reported_probability >= 0 and reported_probability <= 1),
  calibration_band text not null check (calibration_band in ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'UNKNOWN')),
  model_version text not null,
  score_computed_at timestamptz,
  trajectory_authority_tier text check (
    trajectory_authority_tier is null
    or trajectory_authority_tier in (
      'partner_feed',
      'official_numeric',
      'regulatory_constrained',
      'supplemental_ephemeris',
      'public_metadata',
      'model_prior'
    )
  ),
  trajectory_quality_state text check (
    trajectory_quality_state is null
    or trajectory_quality_state in ('precision', 'guided', 'search', 'pad_only')
  ),
  trajectory_confidence_tier text check (
    trajectory_confidence_tier is null
    or trajectory_confidence_tier in ('A', 'B', 'C', 'D')
  ),
  trajectory_safe_mode boolean not null default false,
  trajectory_evidence_epoch timestamptz,
  check (char_length(reporter_hash) between 16 and 64),
  check (char_length(observer_location_hash) between 3 and 64),
  check (char_length(model_version) between 1 and 64),
  unique (launch_id, observer_location_hash, reporter_hash)
);

create index if not exists jep_outcome_reports_reported_at_idx
  on public.jep_outcome_reports (reported_at desc);

create index if not exists jep_outcome_reports_launch_reported_idx
  on public.jep_outcome_reports (launch_id, reported_at desc);

create index if not exists jep_outcome_reports_outcome_idx
  on public.jep_outcome_reports (outcome, reported_at desc);

alter table public.jep_outcome_reports enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_outcome_reports'
      and policyname = 'admin manage jep outcome reports'
  ) then
    create policy "admin manage jep outcome reports"
      on public.jep_outcome_reports
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;
