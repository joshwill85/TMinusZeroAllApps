-- Token feed caching fields (DB-backed cache layer).
-- These caches reduce live DB load when clients poll aggressively and ignore HTTP caching.

alter table public.calendar_feeds
  add column if not exists cached_ics text,
  add column if not exists cached_ics_etag text,
  add column if not exists cached_ics_generated_at timestamptz;

alter table public.rss_feeds
  add column if not exists cached_rss_xml text,
  add column if not exists cached_rss_etag text,
  add column if not exists cached_rss_generated_at timestamptz,
  add column if not exists cached_atom_xml text,
  add column if not exists cached_atom_etag text,
  add column if not exists cached_atom_generated_at timestamptz;

