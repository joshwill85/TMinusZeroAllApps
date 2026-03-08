-- Add lock-on telemetry buckets for AR in-flight guidance diagnostics.

alter table public.ar_camera_guide_sessions
  add column if not exists lock_on_attempted boolean,
  add column if not exists lock_on_acquired boolean,
  add column if not exists time_to_lock_bucket text
    check (
      time_to_lock_bucket is null
      or time_to_lock_bucket in ('<2s', '2..5s', '5..10s', '10..20s', '20..60s', '60s+')
    ),
  add column if not exists lock_loss_count int
    check (lock_loss_count is null or lock_loss_count >= 0);
