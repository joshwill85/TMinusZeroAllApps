-- Move Artemis budget + procurement ingest to weekly server-side cadence.
-- Jobs remain pg_cron -> public.invoke_edge_job() only.

insert into public.system_settings (key, value)
values
  ('artemis_budget_poll_interval_minutes', '10080'::jsonb),
  ('artemis_procurement_poll_interval_minutes', '10080'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'artemis_budget_ingest') then
    perform cron.unschedule('artemis_budget_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'artemis_procurement_ingest') then
    perform cron.unschedule('artemis_procurement_ingest');
  end if;

  perform cron.schedule(
    'artemis_budget_ingest',
    '17 4 * * 1',
    $job$select public.invoke_edge_job('artemis-budget-ingest');$job$
  );

  perform cron.schedule(
    'artemis_procurement_ingest',
    '47 4 * * 1',
    $job$select public.invoke_edge_job('artemis-procurement-ingest');$job$
  );
end $$;
