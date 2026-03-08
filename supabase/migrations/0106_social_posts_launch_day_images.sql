-- Launch-day base posts: upload the current OG/share image as media.

insert into public.system_settings (key, value)
values
  ('social_posts_launch_day_images_enabled', 'true'::jsonb),
  ('social_posts_launch_day_image_timeout_ms', '12000'::jsonb)
on conflict (key) do nothing;

