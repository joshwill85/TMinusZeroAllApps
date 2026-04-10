-- JEP v6 phase 3 vehicle-prior slice:
-- 1) store curated launch-family priors keyed for LL2 joins and US-first fallback families
-- 2) seed dark-gated mission-profile snapshot controls

create table if not exists public.jep_vehicle_priors (
  family_key text primary key,
  family_label text not null,
  ll2_rocket_config_id int references public.ll2_rocket_configs(ll2_config_id) on delete set null,
  provider_key text,
  pad_state text,
  rocket_full_name_pattern text,
  rocket_family_pattern text,
  mission_profile_factor double precision not null default 1.0
    check (mission_profile_factor >= 0 and mission_profile_factor <= 1),
  analyst_confidence text not null default 'medium'
    check (analyst_confidence in ('low', 'medium', 'high')),
  source_url text not null,
  source_title text not null,
  source_revision text,
  rationale text,
  active_from_date date,
  active_to_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active_to_date is null or active_from_date is null or active_to_date >= active_from_date)
);

create index if not exists jep_vehicle_priors_config_idx
  on public.jep_vehicle_priors (ll2_rocket_config_id, pad_state);

create index if not exists jep_vehicle_priors_provider_state_idx
  on public.jep_vehicle_priors (provider_key, pad_state);

alter table public.jep_vehicle_priors enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_vehicle_priors'
      and policyname = 'admin manage jep vehicle priors'
  ) then
    create policy "admin manage jep vehicle priors"
      on public.jep_vehicle_priors
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_v6_vehicle_prior_feature_snapshots_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

insert into public.jep_vehicle_priors (
  family_key,
  family_label,
  ll2_rocket_config_id,
  provider_key,
  pad_state,
  rocket_full_name_pattern,
  rocket_family_pattern,
  mission_profile_factor,
  analyst_confidence,
  source_url,
  source_title,
  source_revision,
  rationale,
  metadata
)
values
  (
    'spacex_falcon9_fl',
    'SpaceX Falcon 9 Florida',
    164,
    'spacex',
    'FL',
    'Falcon 9',
    'falcon',
    1.0,
    'medium',
    'https://www.spacex.com/vehicles/falcon-9/',
    'SpaceX Falcon 9 vehicle page',
    '2026-04-08',
    'Neutral family prior for Falcon 9 launches from Florida. LL2 upstream upcoming launches and configuration records currently resolve Falcon 9 Block 5 as config 164, so this row now uses the exact config-ID join with Florida as the regional discriminator.',
    jsonb_build_object(
      'launchRegion', 'FL',
      'familyType', 'falcon9',
      'policy', 'neutral_baseline',
      'sourceClass', 'official_vehicle_page',
      'joinVerificationSource', 'll2_upcoming_upstream',
      'joinVerificationDate', '2026-04-08',
      'joinVerificationConfigId', 164
    )
  ),
  (
    'spacex_falcon9_ca',
    'SpaceX Falcon 9 California',
    164,
    'spacex',
    'CA',
    'Falcon 9',
    'falcon',
    1.0,
    'medium',
    'https://www.spacex.com/vehicles/falcon-9/',
    'SpaceX Falcon 9 vehicle page',
    '2026-04-08',
    'Neutral family prior for Falcon 9 launches from California. Current LL2 upstream upcoming launches also resolve Vandenberg Falcon 9 flights to Falcon 9 Block 5 config 164, so this row uses the exact config-ID join with California as the regional discriminator.',
    jsonb_build_object(
      'launchRegion', 'CA',
      'familyType', 'falcon9',
      'policy', 'neutral_baseline',
      'sourceClass', 'official_vehicle_page',
      'joinVerificationSource', 'll2_upcoming_upstream',
      'joinVerificationDate', '2026-04-08',
      'joinVerificationConfigId', 164
    )
  ),
  (
    'spacex_falcon_heavy',
    'SpaceX Falcon Heavy',
    161,
    'spacex',
    null,
    'Falcon Heavy',
    'falcon heavy',
    1.0,
    'medium',
    'https://www.spacex.com/vehicles/falcon-heavy/',
    'SpaceX Falcon Heavy vehicle page',
    '2026-04-08',
    'Neutral family prior for Falcon Heavy. Current LL2 upstream upcoming launches resolve Falcon Heavy to config 161, so this row now uses the exact config-ID join instead of relying only on text matching.',
    jsonb_build_object(
      'familyType', 'falcon_heavy',
      'policy', 'neutral_baseline',
      'sourceClass', 'official_vehicle_page',
      'joinVerificationSource', 'll2_upcoming_upstream',
      'joinVerificationDate', '2026-04-08',
      'joinVerificationConfigId', 161
    )
  ),
  (
    'spacex_starship_tx',
    'SpaceX Starship Texas',
    528,
    'spacex',
    'TX',
    'Starship',
    'starship',
    0.9,
    'low',
    'https://www.spacex.com/vehicles/starship/',
    'SpaceX Starship vehicle page',
    '2026-04-08',
    'Conservative initial family prior while Texas Starship twilight watchability is kept separate from the Falcon-family baseline. Current LL2 upstream upcoming launches resolve Starship missions from SpaceX Starbase to config 528, so this row now uses the exact config-ID join plus Texas as the regional discriminator.',
    jsonb_build_object(
      'launchRegion', 'TX',
      'familyType', 'starship',
      'policy', 'conservative_penalty',
      'sourceClass', 'official_vehicle_page',
      'joinVerificationSource', 'll2_upcoming_upstream',
      'joinVerificationDate', '2026-04-08',
      'joinVerificationConfigId', 528
    )
  )
on conflict (family_key) do update
set family_label = excluded.family_label,
    ll2_rocket_config_id = excluded.ll2_rocket_config_id,
    provider_key = excluded.provider_key,
    pad_state = excluded.pad_state,
    rocket_full_name_pattern = excluded.rocket_full_name_pattern,
    rocket_family_pattern = excluded.rocket_family_pattern,
    mission_profile_factor = excluded.mission_profile_factor,
    analyst_confidence = excluded.analyst_confidence,
    source_url = excluded.source_url,
    source_title = excluded.source_title,
    source_revision = excluded.source_revision,
    rationale = excluded.rationale,
    metadata = excluded.metadata,
    updated_at = now();
