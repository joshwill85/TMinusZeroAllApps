-- Hourly Artemis content materialization job (authority-ranked cards).

insert into public.artemis_ingest_checkpoints (source_key, source_type, status, records_ingested, updated_at)
values ('artemis_content_hourly', 'technical', 'complete', 0, now())
on conflict (source_key) do update set
  source_type = excluded.source_type,
  status = excluded.status,
  updated_at = now();

insert into public.system_settings (key, value)
values
  ('artemis_content_job_enabled', 'true'::jsonb),
  ('artemis_content_poll_interval_minutes', '60'::jsonb),
  ('artemis_content_write_score_history', 'false'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_content_ingest') then
    perform cron.unschedule('artemis_content_ingest');
  end if;

  perform cron.schedule(
    'artemis_content_ingest',
    '32 * * * *',
    $job$select public.invoke_edge_job('artemis-content-ingest');$job$
  );
end $$;
