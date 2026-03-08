-- Ensure social_posts upserts have matching unique constraints.

drop index if exists public.social_posts_update_uidx;

create unique index if not exists social_posts_update_uidx
  on public.social_posts(launch_update_id, platform, post_type);

create unique index if not exists social_posts_launch_platform_type_uidx
  on public.social_posts(launch_id, platform, post_type);
