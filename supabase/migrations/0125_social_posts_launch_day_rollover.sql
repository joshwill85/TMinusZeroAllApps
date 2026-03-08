-- Allow a new launch-day base post when a launch slips across days.

alter table public.social_posts
  add column if not exists base_day date;

-- Backfill existing base posts so the new uniqueness rule works immediately.
-- (Launch-day base posts are scheduled around 8:00 AM local pad time for US pads; UTC date matches local date.)
update public.social_posts
set base_day = (coalesce(scheduled_for, posted_at, created_at))::date
where post_type = 'launch_day'
  and base_day is null;

alter table public.social_posts
  drop constraint if exists social_posts_launch_day_base_day_chk;

alter table public.social_posts
  add constraint social_posts_launch_day_base_day_chk
  check (post_type <> 'launch_day' or base_day is not null);

-- Replace the old "one launch_day per launch" uniqueness with "one launch_day per launch-day per platform".
drop index if exists public.social_posts_launch_root_uidx;

create unique index if not exists social_posts_launch_root_uidx
  on public.social_posts(launch_id, platform, base_day)
  where post_type = 'launch_day';

