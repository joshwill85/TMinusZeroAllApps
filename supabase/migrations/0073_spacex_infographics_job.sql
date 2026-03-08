-- Daily ingestion of SpaceX launch page mission infographic images (mission profile visuals).

insert into public.system_settings (key, value)
values ('spacex_infographics_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('spacex_infographics_limit', '30'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('spacex_infographics_horizon_days', '90'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'spacex_infographics_ingest') then
    perform cron.unschedule('spacex_infographics_ingest');
  end if;
  perform cron.schedule(
    'spacex_infographics_ingest',
    '12 5 * * *',
    $job$select public.invoke_edge_job('spacex-infographics-ingest');$job$
  );
end $$;

