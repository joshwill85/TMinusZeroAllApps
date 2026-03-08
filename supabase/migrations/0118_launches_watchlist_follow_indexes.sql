-- Indexes to keep Premium watchlist "follows" fast (provider + pad rules).
-- Used by:
-- - /api/me/watchlists/:id/launches (My Launches feed)
-- - tokenized feeds that filter by provider/state/status

create index if not exists launches_provider_idx
  on public.launches(provider);

create index if not exists launches_pad_short_code_idx
  on public.launches(pad_short_code);

