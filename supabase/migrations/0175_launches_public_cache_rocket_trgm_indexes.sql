-- Improve fuzzy rocket matching on launch hub pages.
--
-- These queries use ILIKE '%...%' on rocket_full_name / rocket_family / vehicle.
-- Trigram indexes reduce heavy scans and JSON serialization latency.

create extension if not exists pg_trgm;

-- Disable statement timeout for this migration: building GIN indexes on a
-- large table can take several minutes.
set local statement_timeout = 0;

create index if not exists launches_public_cache_rocket_full_name_trgm_idx
  on public.launches_public_cache
  using gin (rocket_full_name gin_trgm_ops)
  where rocket_full_name is not null;

create index if not exists launches_public_cache_rocket_family_trgm_idx
  on public.launches_public_cache
  using gin (rocket_family gin_trgm_ops)
  where rocket_family is not null;

create index if not exists launches_public_cache_vehicle_trgm_idx
  on public.launches_public_cache
  using gin (vehicle gin_trgm_ops)
  where vehicle is not null;
