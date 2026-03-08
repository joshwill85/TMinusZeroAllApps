-- Keep public cache cards fully renderable without joining live/reference tables.

alter table public.launches_public_cache
  add column if not exists pad_short_code text,
  add column if not exists pad_timezone text;

