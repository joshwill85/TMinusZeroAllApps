-- Launch filter option performance indexes.
--
-- The filter endpoints request distinct provider/state/status lists with simple
-- predicate scans on hidden + pad country constraints. These partial indexes
-- reduce the scan footprint for both live and public fallback paths.

create index if not exists launches_filter_provider_idx
  on public.launches (hidden, pad_country_code, provider)
  where provider is not null and provider <> '';

create index if not exists launches_filter_pad_state_idx
  on public.launches (hidden, pad_country_code, pad_state)
  where pad_state is not null and pad_state <> '';

create index if not exists launches_filter_status_idx
  on public.launches (hidden, pad_country_code, status_name)
  where status_name is not null and status_name <> '';
