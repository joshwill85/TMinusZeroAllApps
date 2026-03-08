-- Restore per-launch status/timing change toggles (kept for SMS per-launch opt-ins).

alter table public.launch_notification_preferences
  add column if not exists notify_status_change boolean not null default false;

alter table public.launch_notification_preferences
  add column if not exists notify_net_change boolean not null default false;

