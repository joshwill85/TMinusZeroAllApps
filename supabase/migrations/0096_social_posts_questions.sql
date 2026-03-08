-- Engagement questions for automated social posts.

alter table public.social_posts
  add column if not exists question_id text;

insert into public.system_settings (key, value)
values
  ('social_posts_questions_enabled', 'true'::jsonb),
  ('social_posts_questions_probability', '0.333'::jsonb),
  ('social_posts_no_repeat_depth', '12'::jsonb)
on conflict (key) do nothing;
