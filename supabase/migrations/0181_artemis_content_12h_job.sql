-- Shift Artemis content materialization cadence from hourly to every 12 hours.
-- Keep ingestion low-IO: metadata-only records, external media URLs, no binary storage.

insert into public.system_settings (key, value)
values ('artemis_content_poll_interval_minutes', '720'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_content_ingest') then
    perform cron.unschedule('artemis_content_ingest');
  end if;

  perform cron.schedule(
    'artemis_content_ingest',
    '32 */12 * * *',
    $job$select public.invoke_edge_job('artemis-content-ingest');$job$
  );
end $$;
