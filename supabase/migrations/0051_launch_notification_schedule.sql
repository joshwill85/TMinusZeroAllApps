-- Replace per-launch boolean alert toggles with a 2-slot scheduler.

alter table public.launch_notification_preferences
  add column if not exists mode text not null default 't_minus' check (mode in ('t_minus', 'local_time'));

alter table public.launch_notification_preferences
  add column if not exists timezone text not null default 'UTC';

alter table public.launch_notification_preferences
  add column if not exists t_minus_minutes smallint[] not null default '{}'::smallint[];

alter table public.launch_notification_preferences
  add column if not exists local_times time[] not null default '{}'::time[];

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'launch_notification_preferences'
      and column_name = 'notify_t_minus_60'
  ) then
    update public.launch_notification_preferences
    set
      mode = 't_minus',
      timezone = coalesce(nullif(timezone, ''), 'UTC'),
      t_minus_minutes = (
        select coalesce(array_agg(val)::smallint[], '{}'::smallint[])
        from (
          values
            (case when notify_t_minus_60 then 60 else null end),
            (case when notify_t_minus_5 then 5 else null end)
        ) v(val)
        where val is not null
      )
    where channel = 'sms';
  end if;
end;
$$;

alter table public.launch_notification_preferences
  drop column if exists notify_t_minus_60,
  drop column if exists notify_t_minus_5;

alter table public.launch_notification_preferences
  drop constraint if exists launch_notification_prefs_t_minus_len,
  drop constraint if exists launch_notification_prefs_t_minus_allowed,
  drop constraint if exists launch_notification_prefs_local_times_len,
  drop constraint if exists launch_notification_prefs_mode_arrays;

alter table public.launch_notification_preferences
  add constraint launch_notification_prefs_t_minus_len check (cardinality(t_minus_minutes) <= 2);

alter table public.launch_notification_preferences
  add constraint launch_notification_prefs_t_minus_allowed check (
    t_minus_minutes <@ array[5, 10, 15, 20, 30, 45, 60, 120]::smallint[]
  );

alter table public.launch_notification_preferences
  add constraint launch_notification_prefs_local_times_len check (cardinality(local_times) <= 2);

alter table public.launch_notification_preferences
  add constraint launch_notification_prefs_mode_arrays check (
    (mode = 't_minus' and cardinality(local_times) = 0)
    or (mode = 'local_time' and cardinality(t_minus_minutes) = 0)
  );
