-- Add render-loop runtime telemetry buckets for AR session diagnostics.

alter table public.ar_camera_guide_sessions
  add column if not exists ar_loop_active_ms int
    check (ar_loop_active_ms is null or ar_loop_active_ms >= 0),
  add column if not exists sky_compass_loop_active_ms int
    check (sky_compass_loop_active_ms is null or sky_compass_loop_active_ms >= 0),
  add column if not exists loop_restart_count int
    check (loop_restart_count is null or loop_restart_count >= 0);
