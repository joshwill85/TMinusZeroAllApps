-- JEP v6 phase 3:
-- 1) store precomputed terrain/building horizon masks by fine observer feature cell
-- 2) seed dark-gated horizon scorer controls and future builder config

create table if not exists public.jep_horizon_masks (
  observer_feature_key text primary key,
  observer_lat_bucket decimal(8,4) not null,
  observer_lon_bucket decimal(9,4) not null,
  observer_cell_deg decimal(5,3) not null,
  azimuth_step_deg decimal(5,3) not null,
  terrain_mask_profile jsonb not null default '[]'::jsonb,
  building_mask_profile jsonb not null default '[]'::jsonb,
  total_mask_profile jsonb not null default '[]'::jsonb,
  dominant_source_profile jsonb not null default '[]'::jsonb,
  dominant_distance_m_profile jsonb not null default '[]'::jsonb,
  dem_source_key text,
  dem_source_version_id bigint references public.jep_source_versions(id) on delete set null,
  dem_release_id text,
  building_source_key text,
  building_source_version_id bigint references public.jep_source_versions(id) on delete set null,
  building_release_id text,
  metadata jsonb not null default '{}'::jsonb,
  confidence_payload jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jep_horizon_masks_observer_idx
  on public.jep_horizon_masks (observer_lat_bucket, observer_lon_bucket);

alter table public.jep_horizon_masks enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'jep_horizon_masks'
      and policyname = 'admin manage jep horizon masks'
  ) then
    create policy "admin manage jep horizon masks"
      on public.jep_horizon_masks
      for all
      using (public.is_admin())
      with check (public.is_admin());
  end if;
end $$;

insert into public.system_settings (key, value)
values
  ('jep_v6_horizon_enabled', 'false'::jsonb),
  ('jep_v6_horizon_feature_snapshots_enabled', 'false'::jsonb),
  ('jep_source_refresh_cop_dem_enabled', 'false'::jsonb),
  ('jep_source_refresh_overture_enabled', 'false'::jsonb),
  ('jep_horizon_azimuth_step_deg', '0.25'::jsonb),
  ('jep_horizon_corridor_half_width_deg', '2.5'::jsonb),
  ('jep_horizon_max_distance_km', '80'::jsonb),
  ('jep_horizon_building_distance_km', '3'::jsonb),
  ('jep_horizon_dense_urban_distance_km', '5'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
