-- Add sensor-fusion telemetry for Camera Guide sessions.
-- Notes:
-- - Values are coarse, session-level, and avoid storing raw sensor/location data.

alter table public.ar_camera_guide_sessions
  add column if not exists fusion_enabled boolean,
  add column if not exists fusion_used boolean,
  add column if not exists fusion_fallback_reason text
    check (
      fusion_fallback_reason is null
      or fusion_fallback_reason in (
        'no_gyro',
        'no_gravity',
        'gravity_unreliable',
        'not_initialized'
      )
    );

