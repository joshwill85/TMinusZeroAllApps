-- Ensure NWS forecast horizon defaults to 14 days.

insert into public.system_settings (key, value, updated_at)
values
  ('nws_horizon_days', '14'::jsonb, now())
on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;
