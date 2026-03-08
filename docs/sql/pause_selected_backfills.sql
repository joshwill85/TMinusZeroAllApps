-- Pause/unschedule high-IO backfills (kept as admin-manual triggers).
--
-- IMPORTANT:
-- - Do NOT disable/unschedule `ll2_payload_backfill` if you are currently backfilling the
--   spacecraft/payload manifest tables (migrations 0133/0135). That backfill is implemented by
--   the `ll2-payload-backfill` Edge Function.

insert into public.system_settings (key, value)
values
  ('ll2_backfill_job_enabled', 'false'::jsonb),
  ('rocket_media_backfill_job_enabled', 'false'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_backfill') then
    perform cron.unschedule('ll2_backfill');
  end if;

  if exists (select 1 from cron.job where jobname = 'rocket_media_backfill') then
    perform cron.unschedule('rocket_media_backfill');
  end if;
end $$;
