-- Speed up SupGP lookups used by AR trajectory derivation.
--
-- trajectory-orbit-ingest derives prelaunch orbits by querying:
--   source = 'supgp' AND group_or_source ILIKE '%...%'
-- This trigram index avoids sequential scans / heavy buffer reads as orbit_elements grows.

create extension if not exists pg_trgm;

-- Disable statement timeout locally for this transaction: building a large GIN
-- index on orbit_elements can take several minutes on a populated table.
set local statement_timeout = 0;

create index if not exists orbit_elements_supgp_group_or_source_trgm_idx
  on public.orbit_elements
  using gin (group_or_source gin_trgm_ops)
  where source = 'supgp' and group_or_source is not null;

