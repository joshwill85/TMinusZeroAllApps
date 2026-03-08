-- Mission brief scheduled replies (once per thread).

insert into public.system_settings (key, value)
values
  ('social_posts_mission_brief_enabled', 'true'::jsonb),
  ('social_posts_mission_brief_start_hour_local', '9'::jsonb),
  ('social_posts_mission_brief_min_before_launch_minutes', '60'::jsonb)
on conflict (key) do nothing;
