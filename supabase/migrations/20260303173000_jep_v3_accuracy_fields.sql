-- JEP v3: calibrated probability + explainability fields for fast public reads.

alter table if exists public.launch_jep_scores
  add column if not exists probability decimal(6,5),
  add column if not exists calibration_band text
    check (calibration_band is null or calibration_band in ('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'UNKNOWN')),
  add column if not exists sunlit_margin_km decimal(9,3),
  add column if not exists los_visible_fraction decimal(6,5),
  add column if not exists weather_freshness_min integer,
  add column if not exists explainability jsonb not null default '{}'::jsonb;

create index if not exists launch_jep_scores_probability_idx
  on public.launch_jep_scores (launch_id, observer_location_hash, probability desc);

insert into public.system_settings (key, value)
values
  ('jep_score_model_version', '"jep_v3"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
