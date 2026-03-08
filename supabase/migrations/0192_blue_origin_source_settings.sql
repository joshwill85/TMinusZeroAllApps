-- Seed Blue Origin source URL overrides and resilient fetch tunables used by ingest jobs.
-- These are defaults and can be overridden via system_settings without code changes.

insert into public.system_settings (key, value)
values
  ('blue_origin_source_missions_url', '"https://www.blueorigin.com/missions"'::jsonb),
  ('blue_origin_source_news_url', '"https://www.blueorigin.com/news"'::jsonb),
  ('blue_origin_source_gallery_url', '"https://www.blueorigin.com/gallery"'::jsonb),
  ('blue_origin_source_engines_url', '"https://www.blueorigin.com/engines"'::jsonb),
  ('blue_origin_source_new_shepard_url', '"https://www.blueorigin.com/new-shepard"'::jsonb),
  ('blue_origin_source_new_glenn_url', '"https://www.blueorigin.com/new-glenn"'::jsonb),
  ('blue_origin_source_blue_moon_url', '"https://www.blueorigin.com/blue-moon"'::jsonb),
  ('blue_origin_source_blue_ring_url', '"https://www.blueorigin.com/blue-ring"'::jsonb),
  ('blue_origin_source_be3pm_url', '"https://www.blueorigin.com/engines/be-3"'::jsonb),
  ('blue_origin_source_be3u_url', '"https://www.blueorigin.com/engines/be-3"'::jsonb),
  ('blue_origin_source_be4_url', '"https://www.blueorigin.com/engines/be-4"'::jsonb),
  ('blue_origin_source_be7_url', '"https://www.blueorigin.com/engines/be-7"'::jsonb),
  ('blue_origin_source_nasa_blue_moon_hls_url', '"https://www.nasa.gov/news-release/nasa-selects-blue-origin-as-second-artemis-lunar-lander-provider/"'::jsonb),
  ('blue_origin_source_nasa_blue_moon_viper_url', '"https://www.nasa.gov/news-release/nasa-selects-blue-origin-to-deliver-viper-rover-to-moons-south-pole/"'::jsonb),
  ('blue_origin_source_ussf_nssl_url', '"https://www.spaceforce.mil/News/Article/3806236/us-space-force-awards-national-security-space-launch-contracts/"'::jsonb),
  ('blue_origin_source_amazon_kuiper_url', '"https://press.aboutamazon.com/2022/4/amazon-secures-up-to-83-launches-from-arianespace-blue-origin-and-united-launch-alliance-for-project-kuiper"'::jsonb),
  ('blue_origin_source_fetch_retries', '4'::jsonb),
  ('blue_origin_source_fetch_backoff_ms', '900'::jsonb),
  ('blue_origin_source_fetch_timeout_ms', '20000'::jsonb),
  ('blue_origin_missions_backfill_limit', '400'::jsonb),
  ('blue_origin_news_backfill_limit', '400'::jsonb),
  ('blue_origin_media_backfill_limit', '400'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
