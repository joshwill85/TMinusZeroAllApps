-- Hourly ingestion of NAVCEN District 7 Broadcast Notice to Mariners (BNM) hazard areas via GovDelivery RSS.

insert into public.system_settings (key, value)
values ('navcen_bnm_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_feed_url', to_jsonb('https://public.govdelivery.com/topics/USDHSCG_422/feed.rss'::text))
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_lookback_hours', '72'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_item_limit', '60'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_recheck_days', '30'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_recheck_limit', '20'::jsonb)
on conflict (key) do nothing;

insert into public.system_settings (key, value)
values ('navcen_bnm_match_horizon_days', '21'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'navcen_bnm_ingest') then
    perform cron.unschedule('navcen_bnm_ingest');
  end if;

  perform cron.schedule(
    'navcen_bnm_ingest',
    '33 * * * *',
    $job$select public.invoke_edge_job('navcen-bnm-ingest');$job$
  );
end $$;

