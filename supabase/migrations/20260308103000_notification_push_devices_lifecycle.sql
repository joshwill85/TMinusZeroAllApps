alter table if exists public.notification_push_devices
  add column if not exists installation_id text,
  add column if not exists is_active boolean not null default true,
  add column if not exists disabled_at timestamptz,
  add column if not exists last_registered_at timestamptz,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_receipt_at timestamptz,
  add column if not exists last_failure_reason text;

update public.notification_push_devices
set
  installation_id = coalesce(nullif(installation_id, ''), md5(coalesce(token, id::text))),
  is_active = coalesce(is_active, true),
  last_registered_at = coalesce(last_registered_at, updated_at)
where installation_id is null
   or installation_id = ''
   or last_registered_at is null
   or is_active is null;

alter table if exists public.notification_push_devices
  alter column installation_id set not null;

create unique index if not exists notification_push_devices_user_platform_installation_idx
  on public.notification_push_devices(user_id, platform, installation_id);

create index if not exists notification_push_devices_active_user_updated_idx
  on public.notification_push_devices(user_id, is_active, updated_at desc);
