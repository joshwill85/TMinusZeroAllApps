-- Add declination + lightweight perf buckets for Camera Guide sessions.
-- Notes:
-- - Values are coarse, session-level, and avoid storing raw sensor/location data.

alter table public.ar_camera_guide_sessions
  add column if not exists declination_mag_bucket text,
  add column if not exists render_loop_running boolean,
  add column if not exists canvas_hidden boolean,
  add column if not exists pose_update_rate_bucket text;

