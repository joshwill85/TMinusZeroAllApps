-- Enrich launch and public cache detail fields for media/links.

alter table public.launches
  add column if not exists rocket_image_url text,
  add column if not exists rocket_variant text,
  add column if not exists rocket_length_m double precision,
  add column if not exists rocket_diameter_m double precision,
  add column if not exists launch_info_urls jsonb,
  add column if not exists launch_vid_urls jsonb,
  add column if not exists flightclub_url text,
  add column if not exists hashtag text,
  add column if not exists probability int,
  add column if not exists hold_reason text,
  add column if not exists fail_reason text,
  add column if not exists provider_logo_url text,
  add column if not exists provider_image_url text;

alter table public.launches_public_cache
  add column if not exists rocket_image_url text,
  add column if not exists rocket_variant text,
  add column if not exists rocket_length_m double precision,
  add column if not exists rocket_diameter_m double precision,
  add column if not exists launch_info_urls jsonb,
  add column if not exists launch_vid_urls jsonb,
  add column if not exists flightclub_url text,
  add column if not exists hashtag text,
  add column if not exists probability int,
  add column if not exists hold_reason text,
  add column if not exists fail_reason text,
  add column if not exists provider_logo_url text,
  add column if not exists provider_image_url text;
