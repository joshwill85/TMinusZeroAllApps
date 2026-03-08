-- Reduce Supabase egress:
-- - Slow OG prewarm cadence from every 5 minutes to every 6 hours.
-- - Pause LL2 backfill (no longer needed).

-- OG prewarm: run every 6 hours.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'og_prewarm') then
    perform cron.unschedule('og_prewarm');
  end if;
  perform cron.schedule('og_prewarm', '13 */6 * * *', $job$select public.invoke_edge_job('og-prewarm');$job$);
end $$;

-- LL2 backfill: disable and unschedule.
insert into public.system_settings (key, value)
values ('ll2_backfill_job_enabled', 'false'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_backfill') then
    perform cron.unschedule('ll2_backfill');
  end if;
end $$;
