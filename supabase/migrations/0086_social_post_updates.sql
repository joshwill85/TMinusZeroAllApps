-- Support automated launch update replies for social posts.

alter table public.social_posts
  add column if not exists launch_update_id bigint references public.launch_updates(id) on delete cascade;

drop index if exists social_posts_launch_platform_type_uidx;

create unique index if not exists social_posts_launch_root_uidx
  on public.social_posts(launch_id, platform, post_type)
  where post_type = 'launch_day';

create unique index if not exists social_posts_update_uidx
  on public.social_posts(launch_update_id, platform, post_type)
  where launch_update_id is not null;

create index if not exists social_posts_launch_update_idx
  on public.social_posts(launch_update_id);

insert into public.system_settings (key, value)
values
  ('social_posts_updates_enabled', 'true'::jsonb),
  ('social_posts_updates_max_per_run', '10'::jsonb),
  ('social_posts_updates_min_gap_minutes', '10'::jsonb),
  ('social_posts_updates_cursor', '0'::jsonb)
on conflict (key) do nothing;
