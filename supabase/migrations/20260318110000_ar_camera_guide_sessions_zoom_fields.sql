alter table public.ar_camera_guide_sessions
  add column if not exists zoom_supported boolean,
  add column if not exists zoom_ratio_bucket text,
  add column if not exists zoom_control_path text
    check (
      zoom_control_path is null
      or zoom_control_path in ('native_camera', 'track_constraints', 'preset_fallback', 'unsupported')
    ),
  add column if not exists zoom_apply_latency_bucket text,
  add column if not exists zoom_projection_sync_latency_bucket text,
  add column if not exists projection_source text
    check (
      projection_source is null
      or projection_source in ('intrinsics_frame', 'projection_matrix', 'inferred_fov', 'preset')
    );

alter table public.ar_camera_guide_sessions
  drop constraint if exists ar_camera_guide_sessions_runtime_family_check;

alter table public.ar_camera_guide_sessions
  add constraint ar_camera_guide_sessions_runtime_family_check
  check (runtime_family is null or runtime_family in ('web', 'ios_native', 'android_native'));
