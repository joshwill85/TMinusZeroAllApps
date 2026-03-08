-- Enable global LL2 ingestion (no US-only location filter).

insert into public.system_settings (key, value)
values
  ('ll2_location_filter_mode', '"all"'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();
