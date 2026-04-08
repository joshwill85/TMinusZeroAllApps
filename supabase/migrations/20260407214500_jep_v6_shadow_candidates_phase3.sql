-- JEP v6 phase 3:
-- 1) store shadow watchability candidates beside the live serving table
-- 2) seed the active-model selector for future additive promotion

create table if not exists public.launch_jep_score_candidates (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  observer_location_hash text not null,
  observer_lat_bucket decimal(8,3),
  observer_lon_bucket decimal(9,3),
  score smallint not null check (score between 0 and 100),
  raw_score decimal(6,3) not null check (raw_score >= 0 and raw_score <= 100),
  gate_open boolean not null default false,
  vismap_modifier decimal(4,3) not null default 1.000 check (vismap_modifier >= 0 and vismap_modifier <= 1),
  baseline_model_version text,
  baseline_score smallint check (baseline_score between 0 and 100),
  score_delta smallint,
  feature_refs jsonb not null default '{}'::jsonb,
  feature_availability jsonb not null default '{}'::jsonb,
  factor_payload jsonb not null default '{}'::jsonb,
  compatibility_payload jsonb not null default '{}'::jsonb,
  explainability jsonb not null default '{}'::jsonb,
  model_version text not null,
  input_hash text not null,
  computed_at timestamptz not null default now(),
  expires_at timestamptz,
  snapshot_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (launch_id, observer_location_hash, model_version)
);

create index if not exists launch_jep_score_candidates_launch_observer_idx
  on public.launch_jep_score_candidates (launch_id, observer_location_hash, computed_at desc);

create index if not exists launch_jep_score_candidates_model_idx
  on public.launch_jep_score_candidates (model_version, computed_at desc);

alter table public.launch_jep_score_candidates enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_jep_score_candidates'
      and policyname = 'admin manage launch jep score candidates'
  ) then
    create policy "admin manage launch jep score candidates"
      on public.launch_jep_score_candidates
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_score_active_model_version', '"jep_v5"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
