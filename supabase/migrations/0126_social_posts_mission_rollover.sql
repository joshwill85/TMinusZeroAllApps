-- Make mission-drop / mission-brief replies scoped to the launch-day thread.

update public.social_posts
set base_day = (coalesce(scheduled_for, posted_at, created_at))::date
where post_type in ('mission_drop', 'mission_brief')
  and base_day is null;

drop index if exists public.social_posts_mission_drop_uidx;
drop index if exists public.social_posts_mission_brief_uidx;

create unique index if not exists social_posts_mission_drop_uidx
  on public.social_posts(launch_id, platform, base_day)
  where post_type = 'mission_drop';

create unique index if not exists social_posts_mission_brief_uidx
  on public.social_posts(launch_id, platform, base_day)
  where post_type = 'mission_brief';

alter table public.social_posts
  drop constraint if exists social_posts_launch_day_base_day_chk;

alter table public.social_posts
  drop constraint if exists social_posts_base_day_chk;

alter table public.social_posts
  add constraint social_posts_base_day_chk
  check (post_type not in ('launch_day', 'mission_drop', 'mission_brief') or base_day is not null);

