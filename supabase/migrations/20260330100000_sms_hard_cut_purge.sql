-- Hard-cut SMS purge.
-- Remove live SMS data, schema, and configuration without archival.

delete from public.system_settings
where key in (
  'sms_enabled',
  'sms_allowed_tiers',
  'sms_monthly_cap_per_user',
  'sms_daily_cap_per_user',
  'sms_daily_cap_per_user_per_launch',
  'sms_min_gap_minutes',
  'sms_batch_window_minutes',
  'sms_max_chars'
);

delete from public.launch_notification_preferences
where channel <> 'push';

delete from public.notifications_outbox
where channel = 'sms';

delete from public.notification_usage_monthly
where channel = 'sms';

update public.notification_rules_v3
set channels = array_remove(channels, 'sms'),
    updated_at = now()
where channels @> array['sms']::text[];

drop table if exists public.sms_consent_events cascade;

alter table public.notification_preferences
  drop column if exists sms_enabled,
  drop column if exists sms_phone_e164,
  drop column if exists sms_verified,
  drop column if exists sms_opt_in_at,
  drop column if exists sms_opt_out_at;

do $$
begin
  if to_regclass('public.launch_notification_preferences') is not null then
    alter table public.launch_notification_preferences
      drop constraint if exists launch_notification_preferences_channel_check;
    alter table public.launch_notification_preferences
      add constraint launch_notification_preferences_channel_check
      check (channel in ('push'));
  end if;

  if to_regclass('public.notifications_outbox') is not null then
    alter table public.notifications_outbox
      drop constraint if exists notifications_outbox_channel_check;
    alter table public.notifications_outbox
      add constraint notifications_outbox_channel_check
      check (channel in ('email', 'push'));
  end if;

  if to_regclass('public.notification_usage_monthly') is not null then
    alter table public.notification_usage_monthly
      drop constraint if exists notification_usage_monthly_channel_check;
    alter table public.notification_usage_monthly
      add constraint notification_usage_monthly_channel_check
      check (channel in ('email', 'push'));
  end if;

  if to_regclass('public.notification_rules_v3') is not null then
    alter table public.notification_rules_v3
      drop constraint if exists notification_rules_v3_channels_check;
    alter table public.notification_rules_v3
      add constraint notification_rules_v3_channels_check
      check (channels <@ array['push', 'email']::text[]);
  end if;
end $$;

create or replace function public.claim_notifications_outbox(
  batch_size int,
  channel_filter text default 'push',
  max_attempts int default 5
)
returns setof public.notifications_outbox
language plpgsql
security definer
as $$
begin
  return query
  with candidates as (
    select id
    from public.notifications_outbox
    where status = 'queued'
      and channel = channel_filter
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for asc
    for update skip locked
    limit batch_size
  )
  update public.notifications_outbox
  set status = 'sending',
      locked_at = now(),
      attempts = attempts + 1,
      error = null
  where id in (select id from candidates)
  returning *;
end;
$$;

alter function public.claim_notifications_outbox(int, text, int) set search_path = public;
