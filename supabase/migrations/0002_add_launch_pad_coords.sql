-- Add pad coordinates for location lookups
alter table public.launches
  add column if not exists pad_latitude double precision,
  add column if not exists pad_longitude double precision;
