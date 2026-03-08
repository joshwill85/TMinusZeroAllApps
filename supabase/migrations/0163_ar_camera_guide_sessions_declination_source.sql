-- Track declination model provenance for heading correction telemetry.

alter table public.ar_camera_guide_sessions
  add column if not exists declination_source text
    check (declination_source is null or declination_source in ('wmm', 'approx', 'none'));
