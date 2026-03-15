alter table public.ar_camera_guide_sessions
  add column if not exists runtime_family text
    check (runtime_family is null or runtime_family in ('web', 'ios_native')),
  add column if not exists tracking_state text
    check (tracking_state is null or tracking_state in ('not_available', 'limited', 'normal')),
  add column if not exists tracking_reason text,
  add column if not exists world_alignment text
    check (world_alignment is null or world_alignment in ('gravity', 'gravity_and_heading', 'camera')),
  add column if not exists world_mapping_status text
    check (world_mapping_status is null or world_mapping_status in ('not_available', 'limited', 'extending', 'mapped')),
  add column if not exists lidar_available boolean,
  add column if not exists scene_depth_enabled boolean,
  add column if not exists scene_reconstruction_enabled boolean,
  add column if not exists geo_tracking_state text
    check (geo_tracking_state is null or geo_tracking_state in ('not_available', 'initializing', 'localizing', 'localized')),
  add column if not exists geo_tracking_accuracy text
    check (geo_tracking_accuracy is null or geo_tracking_accuracy in ('unknown', 'low', 'medium', 'high')),
  add column if not exists occlusion_mode text
    check (occlusion_mode is null or occlusion_mode in ('none', 'scene_depth', 'mesh')),
  add column if not exists relocalization_count int
    check (relocalization_count is null or relocalization_count >= 0),
  add column if not exists high_res_capture_attempted boolean,
  add column if not exists high_res_capture_succeeded boolean;

create index if not exists ar_camera_guide_sessions_runtime_family_created_at_idx
  on public.ar_camera_guide_sessions (runtime_family, created_at desc);
