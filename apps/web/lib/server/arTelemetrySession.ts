import type { ArTelemetrySessionEventV1 } from '@tminuszero/contracts';

export function buildArTelemetrySessionRow(payload: ArTelemetrySessionEventV1['payload']): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: payload.sessionId,
    launch_id: payload.launchId,
    started_at: payload.startedAt,
    runtime_family: payload.runtimeFamily,
    client_env: payload.clientEnv,
    client_profile: payload.clientProfile,
    release_profile: payload.releaseProfile,
    screen_bucket: payload.screenBucket,

    camera_status: payload.cameraStatus,
    motion_status: payload.motionStatus,
    location_permission: payload.locationPermission,
    location_accuracy: payload.locationAccuracy,
    location_fix_state: payload.locationFixState,
    alignment_ready: payload.alignmentReady,
    heading_status: payload.headingStatus,
    heading_source: payload.headingSource,
    declination_applied: payload.declinationApplied,
    declination_source: payload.declinationSource,
    declination_mag_bucket: payload.declinationMagBucket,
    fusion_enabled: payload.fusionEnabled,
    fusion_used: payload.fusionUsed,
    fusion_fallback_reason: payload.fusionFallbackReason,
    pose_source: payload.poseSource,
    pose_mode: payload.poseMode,
    overlay_mode: payload.overlayMode,
    vision_backend: payload.visionBackend,
    runtime_degradation_tier: payload.degradationTier,
    xr_supported: payload.xrSupported,
    xr_used: payload.xrUsed,
    xr_error_bucket: payload.xrErrorBucket,

    tracking_state: payload.trackingState,
    tracking_reason: payload.trackingReason,
    world_alignment: payload.worldAlignment,
    world_mapping_status: payload.worldMappingStatus,
    lidar_available: payload.lidarAvailable,
    scene_depth_enabled: payload.sceneDepthEnabled,
    scene_reconstruction_enabled: payload.sceneReconstructionEnabled,
    geo_tracking_state: payload.geoTrackingState,
    geo_tracking_accuracy: payload.geoTrackingAccuracy,
    occlusion_mode: payload.occlusionMode,
    relocalization_count: payload.relocalizationCount,
    high_res_capture_attempted: payload.highResCaptureAttempted,
    high_res_capture_succeeded: payload.highResCaptureSucceeded,

    render_loop_running: payload.renderLoopRunning,
    canvas_hidden: payload.canvasHidden,
    time_to_usable_ms: payload.timeToUsableMs,
    pose_update_rate_bucket: payload.poseUpdateRateBucket,
    ar_loop_active_ms: payload.arLoopActiveMs,
    sky_compass_loop_active_ms: payload.skyCompassLoopActiveMs,
    loop_restart_count: payload.loopRestartCount,

    mode_entered: payload.modeEntered,
    fallback_reason: payload.fallbackReason ?? undefined,
    retry_count: payload.retryCount,

    used_scrub: payload.usedScrub,
    scrub_seconds_total: payload.scrubSecondsTotal,
    event_tap_count: payload.eventTapCount,

    lens_preset: payload.lensPreset,
    corridor_mode: payload.corridorMode,
    lock_on_mode: payload.lockOnMode,
    lock_on_attempted: payload.lockOnAttempted,
    lock_on_acquired: payload.lockOnAcquired,
    time_to_lock_bucket: payload.timeToLockBucket,
    lock_loss_count: payload.lockLossCount,

    yaw_offset_bucket: payload.yawOffsetBucket,
    pitch_level_bucket: payload.pitchLevelBucket,
    hfov_bucket: payload.hfovBucket,
    vfov_bucket: payload.vfovBucket,
    fov_source: payload.fovSource,
    zoom_supported: payload.zoomSupported,
    zoom_ratio_bucket: payload.zoomRatioBucket,
    zoom_control_path: payload.zoomControlPath,
    zoom_apply_latency_bucket: payload.zoomApplyLatencyBucket,
    zoom_projection_sync_latency_bucket: payload.zoomProjectionSyncLatencyBucket,
    projection_source: payload.projectionSource,

    trajectory_quality: payload.tier,
    trajectory_version: payload.trajectoryVersion,
    trajectory_duration_s: payload.durationS,
    trajectory_step_s: payload.stepS,
    avg_sigma_deg: payload.avgSigmaDeg,
    confidence_tier_seen: payload.confidenceTierSeen,
    contract_tier: payload.contractTier,
    trajectory_authority_tier: payload.trajectoryAuthorityTier,
    trajectory_quality_state: payload.trajectoryQualityState,
    render_tier: payload.renderTier,
    dropped_frame_bucket: payload.droppedFrameBucket
  };

  if (payload.endedAt) row.ended_at = payload.endedAt;
  if (typeof payload.durationMs === 'number') row.duration_ms = payload.durationMs;

  return row;
}
