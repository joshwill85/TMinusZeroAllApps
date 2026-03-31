-- Push-only notification cutover.
-- Keep the historical rows and tables intact while normalizing live state away from SMS,
-- notification email, and legacy web push.

update public.system_settings
set value = 'false'::jsonb,
    updated_at = now()
where key = 'sms_enabled';

update public.notification_preferences
set email_enabled = false,
    sms_enabled = false,
    push_enabled = false,
    launch_day_email_enabled = false,
    launch_day_email_providers = '{}'::text[],
    launch_day_email_states = '{}'::text[],
    updated_at = now()
where email_enabled is distinct from false
   or sms_enabled is distinct from false
   or push_enabled is distinct from false
   or launch_day_email_enabled is distinct from false
   or coalesce(cardinality(launch_day_email_providers), 0) <> 0
   or coalesce(cardinality(launch_day_email_states), 0) <> 0;

update public.notification_push_destinations_v3
set is_active = false,
    disabled_at = coalesce(disabled_at, now()),
    updated_at = now()
where delivery_kind = 'web_push'
  and is_active = true;

update public.notification_rules_v3
set channels = case
    when array_remove(array_remove(channels, 'email'), 'sms') = '{}'::text[] then '{}'::text[]
    else array_remove(array_remove(channels, 'email'), 'sms')
  end,
    updated_at = now()
where channels && array['email', 'sms']::text[];

update public.notifications_outbox
set status = 'skipped',
    provider_message_id = null,
    error = 'retired_native_mobile_push_only',
    processed_at = coalesce(processed_at, now()),
    locked_at = null
where channel in ('email', 'sms', 'push')
  and status in ('queued', 'sending');
