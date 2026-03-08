-- Social posts: Facebook Page configuration.

insert into public.system_settings (key, value)
values
  -- Required when posting to Facebook via Upload-Post `upload_text`.
  ('social_posts_facebook_page_id', '""'::jsonb)
on conflict (key) do nothing;

