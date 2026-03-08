-- Store manufacturer logos for detail pages.

alter table public.launches
  add column if not exists rocket_manufacturer_logo_url text,
  add column if not exists rocket_manufacturer_image_url text;

alter table public.launches_public_cache
  add column if not exists rocket_manufacturer_logo_url text,
  add column if not exists rocket_manufacturer_image_url text;
