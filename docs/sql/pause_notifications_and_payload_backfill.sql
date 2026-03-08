-- Temporarily pause notifications + LL2 payload backfill scheduler jobs.
-- Safe when:
-- - notifications are not in active use, and
-- - payload backfill is complete (`ll2_payload_backfill_done=true`) or intentionally paused.

insert into public.system_settings (key, value)
values
  ('notifications_dispatch_job_enabled', 'false'::jsonb),
  ('notifications_send_job_enabled', 'false'::jsonb),
  ('ll2_payload_backfill_job_enabled', 'false'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notifications_dispatch') then
    perform cron.unschedule('notifications_dispatch');
  end if;

  if exists (select 1 from cron.job where jobname = 'notifications_send') then
    perform cron.unschedule('notifications_send');
  end if;

  if exists (select 1 from cron.job where jobname = 'll2_payload_backfill') then
    perform cron.unschedule('ll2_payload_backfill');
  end if;
end $$;
