-- FAA airspace ingestion/matching jobs (server-side Edge jobs via pg_cron).

insert into public.system_settings (key, value)
values
  ('faa_job_enabled', 'true'::jsonb),
  ('faa_job_hourly_limit', '500'::jsonb),
  ('faa_job_match_horizon_days', '21'::jsonb),

  ('faa_tfr_list_url', to_jsonb('https://tfr.faa.gov/tfrapi/getTfrList'::text)),
  ('faa_tfr_noshape_url', to_jsonb('https://tfr.faa.gov/tfrapi/noShapeTfrList'::text)),
  ('faa_tfr_shapes_url', to_jsonb('https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=TFR:V_TFR_LOC&maxFeatures=500&outputFormat=application/json&srsname=EPSG:4326'::text)),
  ('faa_tfr_notam_text_url', to_jsonb('https://tfr.faa.gov/tfrapi/getNotamText'::text)),
  ('faa_tfr_web_text_url', to_jsonb('https://tfr.faa.gov/tfrapi/getWebText'::text)),

  ('faa_job_cursor_mod_abs_time', to_jsonb(''::text)),
  ('faa_tfr_ingest_last_success_at', 'null'::jsonb),
  ('faa_tfr_ingest_last_error', to_jsonb(''::text)),

  ('faa_notam_detail_job_enabled', 'true'::jsonb),
  ('faa_notam_detail_limit', '80'::jsonb),
  ('faa_notam_detail_refresh_hours', '6'::jsonb),
  ('faa_notam_detail_last_success_at', 'null'::jsonb),
  ('faa_notam_detail_last_error', to_jsonb(''::text)),

  ('faa_match_job_enabled', 'true'::jsonb),
  ('faa_match_candidate_limit', '250'::jsonb),
  ('faa_match_record_limit', '400'::jsonb),
  ('faa_match_last_success_at', 'null'::jsonb),
  ('faa_match_last_error', to_jsonb(''::text))
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'faa_tfr_ingest') then
    perform cron.unschedule('faa_tfr_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'faa_notam_detail_ingest') then
    perform cron.unschedule('faa_notam_detail_ingest');
  end if;

  if exists (select 1 from cron.job where jobname = 'faa_launch_match') then
    perform cron.unschedule('faa_launch_match');
  end if;

  perform cron.schedule(
    'faa_tfr_ingest',
    '7 * * * *',
    $job$select public.invoke_edge_job('faa-tfr-ingest');$job$
  );

  perform cron.schedule(
    'faa_notam_detail_ingest',
    '17 * * * *',
    $job$select public.invoke_edge_job('faa-notam-detail-ingest');$job$
  );

  perform cron.schedule(
    'faa_launch_match',
    '27 * * * *',
    $job$select public.invoke_edge_job('faa-launch-match');$job$
  );
end $$;
