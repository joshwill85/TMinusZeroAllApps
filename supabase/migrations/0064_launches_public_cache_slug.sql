alter table public.launches_public_cache
  add column if not exists slug text;
