-- LL2 catalog ingest job settings + schedule.

insert into public.system_settings (key, value)
values
  ('ll2_catalog_job_enabled', 'true'::jsonb),
  ('ll2_catalog_page_limit', '100'::jsonb),
  ('ll2_catalog_pages_per_run', '1'::jsonb),
  ('ll2_catalog_agencies_offset', '0'::jsonb),
  ('ll2_catalog_astronauts_offset', '0'::jsonb),
  ('ll2_catalog_space_stations_offset', '0'::jsonb),
  ('ll2_catalog_expeditions_offset', '0'::jsonb),
  ('ll2_catalog_docking_events_offset', '0'::jsonb),
  ('ll2_catalog_launcher_configurations_offset', '0'::jsonb),
  ('ll2_catalog_launchers_offset', '0'::jsonb),
  ('ll2_catalog_spacecraft_configurations_offset', '0'::jsonb),
  ('ll2_catalog_locations_offset', '0'::jsonb),
  ('ll2_catalog_pads_offset', '0'::jsonb),
  ('ll2_catalog_events_offset', '0'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_catalog') then
    perform cron.unschedule('ll2_catalog');
  end if;
  perform cron.schedule('ll2_catalog', '*/20 * * * *', $job$select public.invoke_edge_job('ll2-catalog');$job$);
end $$;
