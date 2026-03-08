-- Dynamic launch filter performance indexes for location and pad-name facets.
--
-- The launch feed now filters and facets by:
--   - pad_location_name (Launch Site)
--   - pad_name (Pad)
--
-- These partial composite indexes follow the existing filter-index pattern and
-- optimize the common predicate shape:
--   hidden + region(country) + facet + net window.

create index if not exists launches_filter_location_net_idx
  on public.launches (hidden, pad_country_code, pad_location_name, net)
  where pad_location_name is not null and pad_location_name <> '';

create index if not exists launches_filter_pad_name_net_idx
  on public.launches (hidden, pad_country_code, pad_name, net)
  where pad_name is not null and pad_name <> '';

create index if not exists launches_public_cache_filter_location_net_idx
  on public.launches_public_cache (hidden, pad_country_code, pad_location_name, net)
  where pad_location_name is not null and pad_location_name <> '';

create index if not exists launches_public_cache_filter_pad_name_net_idx
  on public.launches_public_cache (hidden, pad_country_code, pad_name, net)
  where pad_name is not null and pad_name <> '';
