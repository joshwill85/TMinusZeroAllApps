-- Follow-up: increase SAM opportunities recall and restore daily procurement cadence.

insert into public.system_settings (key, value)
values
  ('artemis_contracts_job_enabled', 'true'::jsonb),
  ('artemis_procurement_job_enabled', 'true'::jsonb),
  ('artemis_procurement_poll_interval_minutes', '1440'::jsonb),
  ('artemis_sam_stop_on_empty_or_error', 'false'::jsonb),
  ('artemis_sam_single_pass_per_endpoint', 'false'::jsonb),
  ('artemis_sam_probe_both_endpoints_first', 'false'::jsonb),
  ('artemis_sam_lookback_days', '364'::jsonb),
  ('artemis_sam_opportunities_partition_enabled', 'true'::jsonb),
  ('artemis_sam_opportunities_partition_days', '14'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_procurement_ingest') then
    perform cron.unschedule('artemis_procurement_ingest');
  end if;

  perform cron.schedule(
    'artemis_procurement_ingest',
    '47 4 * * *',
    $job$select public.invoke_edge_job('artemis-procurement-ingest');$job$
  );
end $$;
