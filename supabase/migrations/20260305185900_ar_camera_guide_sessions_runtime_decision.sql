-- Capture runtime decision and shared trajectory evidence state for AR telemetry.

alter table public.ar_camera_guide_sessions
  add column if not exists pose_mode text
    check (pose_mode is null or pose_mode in ('webxr', 'sensor_fused')),
  add column if not exists overlay_mode text
    check (overlay_mode is null or overlay_mode in ('precision', 'guided', 'search', 'recover')),
  add column if not exists vision_backend text
    check (vision_backend is null or vision_backend in ('worker_roi', 'main_thread_roi', 'none')),
  add column if not exists runtime_degradation_tier int
    check (runtime_degradation_tier is null or (runtime_degradation_tier >= 0 and runtime_degradation_tier <= 3)),
  add column if not exists trajectory_authority_tier text
    check (
      trajectory_authority_tier is null
      or trajectory_authority_tier in (
        'partner_feed',
        'official_numeric',
        'regulatory_constrained',
        'supplemental_ephemeris',
        'public_metadata',
        'model_prior'
      )
    ),
  add column if not exists trajectory_quality_state text
    check (trajectory_quality_state is null or trajectory_quality_state in ('precision', 'guided', 'search', 'pad_only'));
