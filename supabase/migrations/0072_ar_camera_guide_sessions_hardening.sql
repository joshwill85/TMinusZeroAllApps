-- Hardening for Camera Guide telemetry:
-- - add useful indexes
-- - add coarse client buckets (no full UA)
-- - add retention cleanup (keep table bounded)

alter table public.ar_camera_guide_sessions
  add column if not exists client_env text
    check (client_env is null or client_env in (
      'ios_safari',
      'ios_chrome',
      'ios_firefox',
      'android_chrome',
      'android_firefox',
      'android_other',
      'desktop_chrome',
      'desktop_safari',
      'desktop_firefox',
      'desktop_edge',
      'desktop_other',
      'unknown'
    )),
  add column if not exists screen_bucket text
    check (screen_bucket is null or screen_bucket in ('xs','sm','md','lg','unknown')),
  add column if not exists event_tap_count int
    check (event_tap_count is null or event_tap_count >= 0);

create index if not exists ar_camera_guide_sessions_launch_created_at_idx
  on public.ar_camera_guide_sessions (launch_id, created_at desc);

create or replace function public.cleanup_ar_camera_guide_sessions(retention_days int default 90)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ar_camera_guide_sessions
  where created_at < now() - make_interval(days => retention_days);
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup_ar_camera_guide_sessions') then
    perform cron.unschedule('cleanup_ar_camera_guide_sessions');
  end if;
  perform cron.schedule(
    'cleanup_ar_camera_guide_sessions',
    '17 4 * * *',
    $job$select public.cleanup_ar_camera_guide_sessions(90);$job$
  );
end $$;

