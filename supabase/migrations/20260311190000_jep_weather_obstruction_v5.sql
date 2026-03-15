-- JEP weather v5:
-- 1) split weather into path obstruction + observer contrast
-- 2) bump model version for refreshed rows

insert into public.system_settings (key, value)
values
  ('jep_score_model_version', '"jep_v5"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
