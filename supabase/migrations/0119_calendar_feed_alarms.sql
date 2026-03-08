-- Optional calendar feed reminders (VALARM).

alter table public.calendar_feeds
  add column if not exists alarm_minutes_before integer;

alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_alarm_minutes_check;

alter table public.calendar_feeds
  add constraint calendar_feeds_alarm_minutes_check check (
    alarm_minutes_before is null
    or (alarm_minutes_before >= 0 and alarm_minutes_before <= 10080)
  );

