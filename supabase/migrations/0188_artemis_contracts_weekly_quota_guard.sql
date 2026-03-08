-- Re-enable Artemis contract-story ingestion with a weekly cadence and strict SAM per-run guardrails.
-- Keeps SAM traffic bounded even when opportunistic/manual runs occur on the same UTC day.

insert into public.system_settings (key, value)
values
  ('artemis_contracts_job_enabled', 'true'::jsonb),
  ('artemis_contracts_poll_interval_minutes', '10080'::jsonb),
  ('artemis_sam_max_requests_per_run', '6'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_contracts_ingest') then
    perform cron.unschedule('artemis_contracts_ingest');
  end if;

  perform cron.schedule(
    'artemis_contracts_ingest',
    '17 5 * * 1',
    $job$select public.invoke_edge_job('artemis-contracts-ingest');$job$
  );
end $$;
