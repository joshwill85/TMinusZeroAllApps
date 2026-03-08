-- Automated launch-day social posts (X).

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  platform text not null,
  post_type text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'async')),
  template_id text,
  reply_template_id text,
  post_text text,
  reply_text text,
  request_id text,
  external_id text,
  platform_results jsonb,
  scheduled_for timestamptz,
  posted_at timestamptz,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists social_posts_launch_platform_type_uidx
  on public.social_posts(launch_id, platform, post_type);

create index if not exists social_posts_status_idx
  on public.social_posts(status, scheduled_for);

alter table public.social_posts enable row level security;

drop policy if exists "admin manage social posts" on public.social_posts;
create policy "admin manage social posts"
  on public.social_posts for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.system_settings (key, value)
values
  ('social_posts_enabled', 'true'::jsonb),
  ('social_posts_dry_run', 'false'::jsonb),
  ('social_posts_platforms', '["x"]'::jsonb),
  ('social_posts_x_user', '"TMinusZero"'::jsonb),
  ('social_posts_site_url', '"https://www.tminuszero.app"'::jsonb),
  ('social_posts_horizon_hours', '48'::jsonb),
  ('social_posts_window_minutes', '20'::jsonb),
  ('social_posts_max_per_run', '6'::jsonb),
  ('social_posts_max_attempts', '3'::jsonb),
  ('social_posts_retry_window_hours', '6'::jsonb),
  ('social_posts_utm_source', '"x"'::jsonb),
  ('social_posts_utm_medium', '"organic_social"'::jsonb),
  ('social_posts_utm_campaign', '"launch-day"'::jsonb),
  ('social_posts_utm_content', '"launch-day"'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'social_posts_dispatch') then
    perform cron.unschedule('social_posts_dispatch');
  end if;
  perform cron.schedule(
    'social_posts_dispatch',
    '*/15 * * * *',
    $job$select public.invoke_edge_job('social-posts-dispatch');$job$
  );
end $$;
