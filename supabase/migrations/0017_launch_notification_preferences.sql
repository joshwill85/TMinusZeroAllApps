create table if not exists public.launch_notification_preferences (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  launch_id uuid not null references public.launches(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email', 'push')),
  notify_status_change boolean not null default false,
  notify_net_change boolean not null default false,
  notify_t_minus_60 boolean not null default false,
  notify_t_minus_5 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, launch_id, channel)
);

create index if not exists launch_notification_prefs_launch_idx on public.launch_notification_preferences(launch_id);
create index if not exists launch_notification_prefs_user_idx on public.launch_notification_preferences(user_id);

alter table public.launch_notification_preferences enable row level security;

create policy "user owns launch notification prefs"
on public.launch_notification_preferences
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
