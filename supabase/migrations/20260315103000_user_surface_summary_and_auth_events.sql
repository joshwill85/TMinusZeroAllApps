create table if not exists public.user_surface_summary (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_mobile_platform text check (first_mobile_platform in ('ios', 'android')),
  last_sign_in_platform text check (last_sign_in_platform in ('web', 'ios', 'android')),
  ever_used_web boolean not null default false,
  ever_used_ios boolean not null default false,
  ever_used_android boolean not null default false,
  last_mobile_sign_in_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_sign_in_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('email_password', 'apple', 'google', 'email_link', 'unknown')),
  platform text not null check (platform in ('web', 'ios', 'android')),
  event_type text not null check (event_type in ('sign_in', 'sign_up', 'oauth_callback', 'password_reset', 'session_restore', 'sign_out')),
  display_name text,
  avatar_url text,
  email_is_private_relay boolean not null default false,
  app_version text,
  build_profile text,
  result text not null default 'success',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_surface_summary_last_sign_in_idx
  on public.user_surface_summary(last_sign_in_platform, updated_at desc);

create index if not exists user_sign_in_events_user_created_at_idx
  on public.user_sign_in_events(user_id, created_at desc);

create index if not exists user_sign_in_events_platform_created_at_idx
  on public.user_sign_in_events(platform, created_at desc);

alter table public.user_surface_summary enable row level security;
alter table public.user_sign_in_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_surface_summary'
      and policyname = 'user_surface_summary_self_select'
  ) then
    execute 'create policy user_surface_summary_self_select on public.user_surface_summary for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_surface_summary'
      and policyname = 'user_surface_summary_self_insert'
  ) then
    execute 'create policy user_surface_summary_self_insert on public.user_surface_summary for insert with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_surface_summary'
      and policyname = 'user_surface_summary_self_update'
  ) then
    execute 'create policy user_surface_summary_self_update on public.user_surface_summary for update using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_sign_in_events'
      and policyname = 'user_sign_in_events_self_select'
  ) then
    execute 'create policy user_sign_in_events_self_select on public.user_sign_in_events for select using (auth.uid() = user_id)';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_sign_in_events'
      and policyname = 'user_sign_in_events_self_insert'
  ) then
    execute 'create policy user_sign_in_events_self_insert on public.user_sign_in_events for insert with check (auth.uid() = user_id)';
  end if;
end
$$;
