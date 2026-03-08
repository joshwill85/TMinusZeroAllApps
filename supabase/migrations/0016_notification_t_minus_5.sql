alter table public.notification_preferences
  add column if not exists notify_t_minus_5 boolean not null default true;

update public.notification_preferences
set notify_t_minus_5 = true
where notify_t_minus_5 is null;
