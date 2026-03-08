-- Prewarm OG images for the next 5 upcoming launches (US feed) so social unfurls hit cache.

insert into public.system_settings (key, value)
values
  ('og_prewarm_enabled', 'true'::jsonb),
  ('og_prewarm_limit', '5'::jsonb),
  ('og_prewarm_timeout_ms', '12000'::jsonb),
  ('og_prewarm_site_url', '"https://www.tminuszero.app"'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'og_prewarm') then
    perform cron.unschedule('og_prewarm');
  end if;
  perform cron.schedule('og_prewarm', '*/5 * * * *', $job$select public.invoke_edge_job('og-prewarm');$job$);
end $$;

