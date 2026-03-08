-- Snapshot latest @SpaceX X post for launch-day embeds.

alter table public.launches
  add column if not exists spacex_x_post_id text,
  add column if not exists spacex_x_post_url text,
  add column if not exists spacex_x_post_captured_at timestamptz,
  add column if not exists spacex_x_post_for_date date;

alter table public.launches_public_cache
  add column if not exists spacex_x_post_id text,
  add column if not exists spacex_x_post_url text,
  add column if not exists spacex_x_post_captured_at timestamptz,
  add column if not exists spacex_x_post_for_date date;

insert into public.system_settings (key, value)
values
  ('spacex_x_snapshot_enabled', 'true'::jsonb),
  ('spacex_x_snapshot_timezone', '"America/New_York"'::jsonb),
  ('spacex_x_snapshot_hour', '8'::jsonb),
  ('spacex_x_snapshot_minute', '0'::jsonb),
  ('spacex_x_snapshot_max_per_run', '10'::jsonb),
  ('spacex_x_snapshot_lookback_hours', '18'::jsonb),
  ('spacex_x_snapshot_horizon_days', '4'::jsonb),
  ('spacex_x_snapshot_screen_name', '"SpaceX"'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'spacex_x_post_snapshot') then
    perform cron.unschedule('spacex_x_post_snapshot');
  end if;
  perform cron.schedule(
    'spacex_x_post_snapshot',
    '*/15 * * * *',
    $job$select public.invoke_edge_job('spacex-x-post-snapshot');$job$
  );
end $$;

