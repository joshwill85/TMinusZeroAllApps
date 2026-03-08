-- Remove legacy launch feed experience preferences (premium views/themes).
-- These were used to store a per-user home feed renderer + settings.

alter table public.profiles
  drop constraint if exists profiles_launch_feed_view_check;

alter table public.profiles
  drop column if exists launch_feed_view_settings,
  drop column if exists launch_feed_view;

