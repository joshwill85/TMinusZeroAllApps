-- Launch-day email notifications (8AM local time) preferences.

alter table public.notification_preferences
  add column if not exists launch_day_email_enabled boolean not null default false,
  add column if not exists launch_day_email_providers text[] not null default '{}'::text[],
  add column if not exists launch_day_email_states text[] not null default '{}'::text[];

alter table public.notification_preferences
  drop constraint if exists launch_day_email_filter_limits;

alter table public.notification_preferences
  add constraint launch_day_email_filter_limits check (
    cardinality(launch_day_email_providers) <= 80
    and cardinality(launch_day_email_states) <= 80
  );

