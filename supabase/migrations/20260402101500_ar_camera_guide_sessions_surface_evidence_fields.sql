-- Persist release-evidence labeling and native readiness timing/state for AR telemetry.

alter table public.ar_camera_guide_sessions
  add column if not exists release_profile text
    check (release_profile is null or char_length(release_profile) <= 64),
  add column if not exists location_permission text,
  add column if not exists location_accuracy text,
  add column if not exists location_fix_state text,
  add column if not exists alignment_ready boolean,
  add column if not exists time_to_usable_ms int
    check (time_to_usable_ms is null or (time_to_usable_ms >= 0 and time_to_usable_ms <= 21600000));

alter table public.ar_camera_guide_sessions
  drop constraint if exists ar_camera_guide_sessions_motion_status_check,
  drop constraint if exists ar_camera_guide_sessions_heading_source_check,
  drop constraint if exists ar_camera_guide_sessions_pose_source_check,
  drop constraint if exists ar_camera_guide_sessions_pose_mode_check,
  drop constraint if exists ar_camera_guide_sessions_vision_backend_check,
  drop constraint if exists ar_camera_guide_sessions_location_permission_check,
  drop constraint if exists ar_camera_guide_sessions_location_accuracy_check,
  drop constraint if exists ar_camera_guide_sessions_location_fix_state_check;

alter table public.ar_camera_guide_sessions
  add constraint ar_camera_guide_sessions_motion_status_check
    check (motion_status is null or motion_status in ('granted', 'denied', 'prompt', 'error', 'not_applicable')),
  add constraint ar_camera_guide_sessions_heading_source_check
    check (
      heading_source is null
      or heading_source in (
        'webxr',
        'webkit_compass',
        'deviceorientation_absolute',
        'deviceorientation_tilt_comp',
        'deviceorientation_relative',
        'arkit_world',
        'core_location_heading',
        'unknown'
      )
    ),
  add constraint ar_camera_guide_sessions_pose_source_check
    check (pose_source is null or pose_source in ('webxr', 'deviceorientation', 'deviceorientationabsolute', 'sky_compass', 'arkit_world_tracking')),
  add constraint ar_camera_guide_sessions_pose_mode_check
    check (pose_mode is null or pose_mode in ('webxr', 'sensor_fused', 'arkit_world_tracking')),
  add constraint ar_camera_guide_sessions_vision_backend_check
    check (vision_backend is null or vision_backend in ('worker_roi', 'main_thread_roi', 'none', 'vision_native')),
  add constraint ar_camera_guide_sessions_location_permission_check
    check (location_permission is null or location_permission in ('granted', 'denied', 'prompt', 'error', 'not_applicable')),
  add constraint ar_camera_guide_sessions_location_accuracy_check
    check (location_accuracy is null or location_accuracy in ('full', 'reduced', 'unknown')),
  add constraint ar_camera_guide_sessions_location_fix_state_check
    check (location_fix_state is null or location_fix_state in ('unavailable', 'acquiring', 'timeout', 'coarse', 'ready'));

create index if not exists ar_camera_guide_sessions_release_profile_created_at_idx
  on public.ar_camera_guide_sessions (release_profile, created_at desc)
  where release_profile is not null;
