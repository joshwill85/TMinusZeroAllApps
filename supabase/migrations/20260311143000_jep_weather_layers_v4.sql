-- JEP weather v4:
-- 1) persist mid/high cloud layers for clearer user explanations
-- 2) bump model version for the revised layer-weighted weather term

alter table if exists public.launch_jep_scores
  add column if not exists cloud_cover_mid_pct smallint,
  add column if not exists cloud_cover_high_pct smallint;

insert into public.system_settings (key, value)
values
  ('jep_score_model_version', '"jep_v4"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
