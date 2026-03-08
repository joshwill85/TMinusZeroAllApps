-- Temporarily pause notification workers and stop the completed LL2 payload backfill cron.
-- This reduces scheduler churn + pg_net writes while notifications are not in use.

insert into public.system_settings (key, value)
values
  ('notifications_dispatch_job_enabled', 'false'::jsonb),
  ('notifications_send_job_enabled', 'false'::jsonb),
  ('ll2_payload_backfill_job_enabled', 'false'::jsonb),
  -- Keep Artemis contract ingest off in the same rollout to avoid introducing new scheduler load.
  ('artemis_contracts_job_enabled', 'false'::jsonb)
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

  if exists (select 1 from cron.job where jobname = 'artemis_contracts_ingest') then
    perform cron.unschedule('artemis_contracts_ingest');
  end if;
end $$;
