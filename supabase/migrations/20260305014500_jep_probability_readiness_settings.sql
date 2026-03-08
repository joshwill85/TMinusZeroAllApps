insert into public.system_settings (key, value)
values
  ('jep_probability_min_labeled_outcomes', '500'::jsonb),
  ('jep_probability_labeled_outcomes', '0'::jsonb),
  ('jep_probability_max_ece', '0.05'::jsonb),
  ('jep_probability_current_ece', 'null'::jsonb),
  ('jep_probability_max_brier', '0.16'::jsonb),
  ('jep_probability_current_brier', 'null'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
