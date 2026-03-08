-- Enrich public cache so the free-tier site can render detail pages without live LL2 calls.

alter table public.launches_public_cache
  add column if not exists mission_description text,
  add column if not exists mission_info_urls jsonb,
  add column if not exists mission_vid_urls jsonb,
  add column if not exists rocket_description text,
  add column if not exists rocket_reusable boolean,
  add column if not exists rocket_maiden_flight date,
  add column if not exists rocket_leo_capacity int,
  add column if not exists rocket_gto_capacity int,
  add column if not exists rocket_launch_mass int,
  add column if not exists rocket_launch_cost text,
  add column if not exists rocket_info_url text,
  add column if not exists rocket_wiki_url text,
  add column if not exists provider_description text,
  add column if not exists crew jsonb,
  add column if not exists payloads jsonb,
  add column if not exists pad_map_url text;
