import { NextResponse } from 'next/server';
import { startOfMinute } from 'date-fns';
import { arTelemetrySessionEventSchemaV1 } from '@tminuszero/contracts';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { resolveViewerSession } from '@/lib/server/viewerSession';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8_000;
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_DURATION_MS = 6 * 60 * 60 * 1000;

async function readJsonLimited(request: Request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) return { ok: false as const, error: 'body_too_large' as const };
  }

  const text = await request.text().catch(() => '');
  if (!text) return { ok: false as const, error: 'invalid_body' as const };
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > MAX_BODY_BYTES) return { ok: false as const, error: 'body_too_large' as const };

  try {
    return { ok: true as const, json: JSON.parse(text) };
  } catch {
    return { ok: false as const, error: 'invalid_body' as const };
  }
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  }

  const session = await resolveViewerSession(request);
  const viewer = await getViewerTier({ session });
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  const raw = await readJsonLimited(request);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.error === 'body_too_large' ? 413 : 400 });

  const parsed = arTelemetrySessionEventSchemaV1.safeParse(raw.json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const nowMs = Date.now();
  const startedAtMs = Date.parse(parsed.data.payload.startedAt);
  if (!Number.isFinite(startedAtMs)) return NextResponse.json({ error: 'invalid_started_at' }, { status: 400 });
  if (startedAtMs < nowMs - MAX_SESSION_AGE_MS || startedAtMs > nowMs + 5 * 60 * 1000) {
    return NextResponse.json({ error: 'started_at_out_of_range' }, { status: 400 });
  }

  const endedAtMs = parsed.data.payload.endedAt ? Date.parse(parsed.data.payload.endedAt) : null;
  if (parsed.data.type === 'end') {
    if (!parsed.data.payload.endedAt || endedAtMs == null || !Number.isFinite(endedAtMs)) {
      return NextResponse.json({ error: 'invalid_ended_at' }, { status: 400 });
    }
  }
  if (endedAtMs != null) {
    if (endedAtMs < startedAtMs) return NextResponse.json({ error: 'ended_before_started' }, { status: 400 });
    if (endedAtMs - startedAtMs > MAX_SESSION_DURATION_MS) {
      return NextResponse.json({ error: 'session_too_long' }, { status: 400 });
    }
  }

  const eligible = await fetchArEligibleLaunches({ nowMs });
  if (!eligible.some((entry) => entry.launchId === parsed.data.payload.launchId)) {
    return NextResponse.json({ error: 'not_eligible' }, { status: 404 });
  }

  const supabase = createSupabaseAdminClient();
  const windowStart = startOfMinute(new Date(nowMs)).toISOString();
  const { data: allowed, error: rateError } = await supabase.rpc('try_increment_api_rate', {
    provider_name: 'ar_telemetry_minute',
    window_start_in: windowStart,
    window_seconds_in: 60,
    limit_in: 1200
  });

  if (rateError) {
    console.error('v1 ar telemetry rate limit error', rateError);
    return NextResponse.json({ error: 'rate_limit_failed' }, { status: 500 });
  }
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const p = parsed.data.payload;
  const row: Record<string, unknown> = {
    id: p.sessionId,
    launch_id: p.launchId,
    started_at: p.startedAt,
    runtime_family: p.runtimeFamily,
    client_env: p.clientEnv,
    client_profile: p.clientProfile,
    screen_bucket: p.screenBucket,

    camera_status: p.cameraStatus,
    motion_status: p.motionStatus,
    heading_status: p.headingStatus,
    heading_source: p.headingSource,
    declination_applied: p.declinationApplied,
    declination_source: p.declinationSource,
    declination_mag_bucket: p.declinationMagBucket,
    fusion_enabled: p.fusionEnabled,
    fusion_used: p.fusionUsed,
    fusion_fallback_reason: p.fusionFallbackReason,
    pose_source: p.poseSource,
    pose_mode: p.poseMode,
    overlay_mode: p.overlayMode,
    vision_backend: p.visionBackend,
    runtime_degradation_tier: p.degradationTier,
    xr_supported: p.xrSupported,
    xr_used: p.xrUsed,
    xr_error_bucket: p.xrErrorBucket,

    tracking_state: p.trackingState,
    tracking_reason: p.trackingReason,
    world_alignment: p.worldAlignment,
    world_mapping_status: p.worldMappingStatus,
    lidar_available: p.lidarAvailable,
    scene_depth_enabled: p.sceneDepthEnabled,
    scene_reconstruction_enabled: p.sceneReconstructionEnabled,
    geo_tracking_state: p.geoTrackingState,
    geo_tracking_accuracy: p.geoTrackingAccuracy,
    occlusion_mode: p.occlusionMode,
    relocalization_count: p.relocalizationCount,
    high_res_capture_attempted: p.highResCaptureAttempted,
    high_res_capture_succeeded: p.highResCaptureSucceeded,

    render_loop_running: p.renderLoopRunning,
    canvas_hidden: p.canvasHidden,
    pose_update_rate_bucket: p.poseUpdateRateBucket,
    ar_loop_active_ms: p.arLoopActiveMs,
    sky_compass_loop_active_ms: p.skyCompassLoopActiveMs,
    loop_restart_count: p.loopRestartCount,

    mode_entered: p.modeEntered,
    fallback_reason: p.fallbackReason ?? undefined,
    retry_count: p.retryCount,

    used_scrub: p.usedScrub,
    scrub_seconds_total: p.scrubSecondsTotal,
    event_tap_count: p.eventTapCount,

    lens_preset: p.lensPreset,
    corridor_mode: p.corridorMode,
    lock_on_mode: p.lockOnMode,
    lock_on_attempted: p.lockOnAttempted,
    lock_on_acquired: p.lockOnAcquired,
    time_to_lock_bucket: p.timeToLockBucket,
    lock_loss_count: p.lockLossCount,

    yaw_offset_bucket: p.yawOffsetBucket,
    pitch_level_bucket: p.pitchLevelBucket,
    hfov_bucket: p.hfovBucket,
    vfov_bucket: p.vfovBucket,
    fov_source: p.fovSource,

    trajectory_quality: p.tier,
    trajectory_version: p.trajectoryVersion,
    trajectory_duration_s: p.durationS,
    trajectory_step_s: p.stepS,
    avg_sigma_deg: p.avgSigmaDeg,
    confidence_tier_seen: p.confidenceTierSeen,
    contract_tier: p.contractTier,
    trajectory_authority_tier: p.trajectoryAuthorityTier,
    trajectory_quality_state: p.trajectoryQualityState,
    render_tier: p.renderTier,
    dropped_frame_bucket: p.droppedFrameBucket
  };

  if (p.endedAt) row.ended_at = p.endedAt;
  if (typeof p.durationMs === 'number') row.duration_ms = p.durationMs;

  const { error } = await supabase.from('ar_camera_guide_sessions').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('v1 ar telemetry upsert error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
}
