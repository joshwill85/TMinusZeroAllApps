-- X thread segmentation support for long social posts.

alter table public.social_posts
  add column if not exists thread_segment_index int not null default 1,
  add column if not exists reply_to_social_post_id uuid references public.social_posts(id) on delete set null;

-- Keep one root/segment uniqueness per event identity.
drop index if exists public.social_posts_launch_platform_type_uidx;

drop index if exists public.social_posts_launch_root_uidx;
create unique index if not exists social_posts_launch_root_uidx
  on public.social_posts(launch_id, platform, base_day, thread_segment_index)
  where post_type = 'launch_day';

drop index if exists public.social_posts_mission_drop_uidx;
create unique index if not exists social_posts_mission_drop_uidx
  on public.social_posts(launch_id, platform, base_day, thread_segment_index)
  where post_type = 'mission_drop';

drop index if exists public.social_posts_mission_brief_uidx;
create unique index if not exists social_posts_mission_brief_uidx
  on public.social_posts(launch_id, platform, base_day, thread_segment_index)
  where post_type = 'mission_brief';

drop index if exists public.social_posts_no_launch_day_uidx;
create unique index if not exists social_posts_no_launch_day_uidx
  on public.social_posts(platform, base_day, thread_segment_index)
  where post_type = 'no_launch_day';

drop index if exists public.social_posts_update_uidx;
create unique index if not exists social_posts_update_uidx
  on public.social_posts(launch_update_id, platform, post_type, thread_segment_index)
  where launch_update_id is not null;

create index if not exists social_posts_reply_parent_idx
  on public.social_posts(reply_to_social_post_id, status);

insert into public.system_settings (key, value)
values
  ('social_posts_x_max_chars', '25000'::jsonb)
on conflict (key) do nothing;
