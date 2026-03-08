-- Backfill launch-linked social matches from existing launch source URLs.

insert into public.system_settings (key, value)
values
  ('launch_social_link_backfill_enabled', 'true'::jsonb),
  ('launch_social_link_backfill_scope', '"artemis"'::jsonb),
  ('launch_social_link_backfill_max_per_run', '200'::jsonb),
  ('launch_social_link_backfill_lookback_days', '3650'::jsonb),
  ('launch_social_link_backfill_horizon_days', '3650'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'launch_social_link_backfill') then
    perform cron.unschedule('launch_social_link_backfill');
  end if;

  perform cron.schedule(
    'launch_social_link_backfill',
    '27 */4 * * *',
    $job$select public.invoke_edge_job('launch-social-link-backfill');$job$
  );
end $$;
