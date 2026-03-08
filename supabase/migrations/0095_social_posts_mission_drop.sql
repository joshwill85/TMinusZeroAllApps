-- Scheduled mission-drop reply posts (X).

create unique index if not exists social_posts_mission_drop_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'mission_drop';

insert into public.system_settings (key, value)
values
  ('social_posts_mission_drop_enabled', 'true'::jsonb),
  ('social_posts_mission_drop_min_after_8_minutes', '60'::jsonb),
  ('social_posts_mission_drop_min_before_launch_minutes', '60'::jsonb)
on conflict (key) do nothing;
