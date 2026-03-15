-- Align trajectory coverage with JEP's broader scoring horizon.
-- JEP evaluates a 16-day window, so trajectory constraints/products need a wider eligible launch set
-- than the low-IO phase tuning used for AR-only coverage.

insert into public.system_settings (key, value)
values
  ('trajectory_constraints_eligible_limit', '24'::jsonb),
  ('trajectory_products_eligible_limit', '24'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();
