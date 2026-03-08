create table if not exists public.notification_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('web', 'ios', 'android')),
  push_provider text not null check (push_provider in ('expo', 'webpush')),
  token text not null,
  app_version text,
  device_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists notification_push_devices_user_platform_token_idx
  on public.notification_push_devices(user_id, platform, token);

create index if not exists notification_push_devices_user_updated_idx
  on public.notification_push_devices(user_id, updated_at desc);

alter table public.notification_push_devices enable row level security;

drop policy if exists "user owns notification push devices" on public.notification_push_devices;
create policy "user owns notification push devices"
  on public.notification_push_devices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
