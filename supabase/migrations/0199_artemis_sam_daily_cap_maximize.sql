-- Maximize non-federal SAM throughput for Artemis-first contract backfill.
-- Target behavior: consume up to the full 10/day cap with no reserve holdback.

insert into public.system_settings (key, value)
values
  ('artemis_contracts_job_enabled', 'true'::jsonb),
  ('artemis_contracts_poll_interval_minutes', '1440'::jsonb),
  ('artemis_sam_daily_quota_limit', '10'::jsonb),
  ('artemis_sam_daily_quota_reserve', '0'::jsonb),
  ('artemis_sam_max_requests_per_run', '10'::jsonb),
  (
    'artemis_sam_quota_state',
    jsonb_build_object(
      'date',
      null,
      'used',
      0,
      'limit',
      10,
      'reserve',
      0
    )
  )
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
    '17 5 * * *',
    $job$select public.invoke_edge_job('artemis-contracts-ingest');$job$
  );
end $$;
