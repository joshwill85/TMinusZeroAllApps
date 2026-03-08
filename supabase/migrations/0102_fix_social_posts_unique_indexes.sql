-- Drop overly broad unique index that blocks launch update posts.

drop index if exists public.social_posts_launch_platform_type_uidx;

-- Ensure per-type uniqueness remains for base and reply posts.
create unique index if not exists social_posts_launch_root_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'launch_day';

create unique index if not exists social_posts_mission_drop_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'mission_drop';

create unique index if not exists social_posts_mission_brief_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'mission_brief';

-- Ensure update posts remain unique per launch update.
create unique index if not exists social_posts_update_uidx
  on public.social_posts(launch_update_id, platform, post_type);
