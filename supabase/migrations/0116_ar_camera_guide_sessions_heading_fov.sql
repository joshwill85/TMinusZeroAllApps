-- Add heading/FOV provenance telemetry for Camera Guide sessions.
-- Notes:
-- - Values are coarse, session-level, and avoid storing raw sensor/location data.

alter table public.ar_camera_guide_sessions
  add column if not exists heading_source text
    check (
      heading_source is null
      or heading_source in (
        'webxr',
        'webkit_compass',
        'deviceorientation_absolute',
        'deviceorientation_tilt_comp',
        'deviceorientation_relative',
        'unknown'
      )
    ),
  add column if not exists declination_applied boolean,
  add column if not exists fov_source text
    check (
      fov_source is null
      or fov_source in (
        'xr',
        'preset',
        'saved',
        'inferred',
        'default',
        'unknown'
      )
    );

