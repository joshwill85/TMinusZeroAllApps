-- Ensure mission brief scheduled replies are only queued once per thread.

create unique index if not exists social_posts_mission_brief_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'mission_brief';

