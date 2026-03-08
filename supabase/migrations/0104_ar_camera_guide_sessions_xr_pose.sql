-- Add WebXR + pose source telemetry to Camera Guide sessions.
-- Notes:
-- - Keep values coarse (privacy + queryability).
-- - "pose_source" captures the primary pose stream used for guidance.

alter table public.ar_camera_guide_sessions
  add column if not exists pose_source text
    check (pose_source is null or pose_source in ('webxr','deviceorientation','deviceorientationabsolute','sky_compass')),
  add column if not exists xr_supported boolean,
  add column if not exists xr_used boolean,
  add column if not exists xr_error_bucket text
    check (xr_error_bucket is null or xr_error_bucket in ('not_available','unsupported','webgl','permission','session_error','unknown'));

