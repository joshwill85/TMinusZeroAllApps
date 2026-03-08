-- Add pad coordinates to public cache for AR direction finding.

alter table public.launches_public_cache
  add column if not exists pad_latitude double precision,
  add column if not exists pad_longitude double precision;
