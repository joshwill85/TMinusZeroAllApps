import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startOfMinute } from 'date-fns';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { fetchArEligibleLaunches } from '@/lib/server/arEligibility';
import { AR_CLIENT_PROFILE_VALUES } from '@/lib/ar/clientProfile';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 6_000;
const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SESSION_DURATION_MS = 6 * 60 * 60 * 1000;

const bodySchema = z.object({
  type: z.enum(['start', 'update', 'end']),
  payload: z.object({
    sessionId: z.string().uuid(),
    launchId: z.string().uuid(),

    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    runtimeFamily: z.enum(['web', 'ios_native', 'android_native']).optional(),

    clientEnv: z
      .enum([
        'ios_safari',
        'ios_chrome',
        'ios_firefox',
        'android_chrome',
        'android_firefox',
        'android_other',
        'desktop_chrome',
        'desktop_safari',
        'desktop_firefox',
        'desktop_edge',
        'desktop_other',
        'unknown'
      ])
      .optional(),
    clientProfile: z.enum(AR_CLIENT_PROFILE_VALUES).optional(),
    screenBucket: z.enum(['xs', 'sm', 'md', 'lg', 'unknown']).optional(),

    cameraStatus: z.enum(['granted', 'denied', 'prompt', 'error']).optional(),
    motionStatus: z.enum(['granted', 'denied', 'prompt', 'error']).optional(),
    headingStatus: z.enum(['ok', 'unavailable', 'noisy', 'unknown']).optional(),
    headingSource: z
      .enum([
        'webxr',
        'webkit_compass',
        'deviceorientation_absolute',
        'deviceorientation_tilt_comp',
        'deviceorientation_relative',
        'unknown'
      ])
      .optional(),
    declinationApplied: z.boolean().optional(),
    declinationSource: z.enum(['wmm', 'approx', 'none']).optional(),
    declinationMagBucket: z.string().max(32).optional(),
    fusionEnabled: z.boolean().optional(),
    fusionUsed: z.boolean().optional(),
    fusionFallbackReason: z.enum(['no_gyro', 'no_gravity', 'gravity_unreliable', 'not_initialized']).nullable().optional(),
    poseSource: z.enum(['webxr', 'deviceorientation', 'deviceorientationabsolute', 'sky_compass']).optional(),
    poseMode: z.enum(['webxr', 'sensor_fused']).optional(),
    overlayMode: z.enum(['precision', 'guided', 'search', 'recover']).optional(),
    visionBackend: z.enum(['worker_roi', 'main_thread_roi', 'none']).optional(),
    degradationTier: z.number().int().min(0).max(3).optional(),
    xrSupported: z.boolean().optional(),
    xrUsed: z.boolean().optional(),
    xrErrorBucket: z.enum(['not_available', 'unsupported', 'webgl', 'permission', 'session_error', 'unknown']).optional(),

    renderLoopRunning: z.boolean().optional(),
    canvasHidden: z.boolean().optional(),
    poseUpdateRateBucket: z.string().max(32).optional(),
    arLoopActiveMs: z.number().int().nonnegative().max(MAX_SESSION_DURATION_MS).optional(),
    skyCompassLoopActiveMs: z.number().int().nonnegative().max(MAX_SESSION_DURATION_MS).optional(),
    loopRestartCount: z.number().int().nonnegative().max(10_000).optional(),

    modeEntered: z.enum(['ar', 'sky_compass']).optional(),
    fallbackReason: z.enum(['camera_denied', 'motion_denied', 'no_heading', 'camera_error']).nullable().optional(),
    retryCount: z.number().int().nonnegative().optional(),

    usedScrub: z.boolean().optional(),
    scrubSecondsTotal: z.number().int().nonnegative().optional(),
    eventTapCount: z.number().int().nonnegative().optional(),

    lensPreset: z.enum(['0.5x', '1x', '2x', '3x', 'custom']).optional(),
    corridorMode: z.enum(['tight', 'normal', 'wide']).optional(),
    lockOnMode: z.enum(['auto', 'manual_debug']).optional(),
    lockOnAttempted: z.boolean().optional(),
    lockOnAcquired: z.boolean().optional(),
    timeToLockBucket: z.enum(['<2s', '2..5s', '5..10s', '10..20s', '20..60s', '60s+']).optional(),
    lockLossCount: z.number().int().nonnegative().optional(),

    yawOffsetBucket: z.string().max(32).optional(),
    pitchLevelBucket: z.string().max(32).optional(),
    hfovBucket: z.string().max(32).optional(),
    vfovBucket: z.string().max(32).optional(),
    fovSource: z.enum(['xr', 'preset', 'saved', 'inferred', 'default', 'unknown']).optional(),
    zoomSupported: z.boolean().optional(),
    zoomRatioBucket: z.string().max(32).optional(),
    zoomControlPath: z.enum(['native_camera', 'track_constraints', 'preset_fallback', 'unsupported']).optional(),
    zoomApplyLatencyBucket: z.string().max(32).optional(),
    zoomProjectionSyncLatencyBucket: z.string().max(32).optional(),
    projectionSource: z.enum(['intrinsics_frame', 'projection_matrix', 'inferred_fov', 'preset']).optional(),

    tier: z.number().int().min(0).max(3).optional(),
    trajectoryVersion: z.string().max(64).optional(),
    durationS: z.number().int().min(0).max(7200).optional(),
    stepS: z.number().int().min(0).max(120).optional(),
    avgSigmaDeg: z.number().min(0).max(90).optional(),
    confidenceTierSeen: z.enum(['A', 'B', 'C', 'D']).optional(),
    contractTier: z.enum(['A', 'B', 'C', 'D']).optional(),
    trajectoryAuthorityTier: z
      .enum([
        'partner_feed',
        'official_numeric',
        'regulatory_constrained',
        'supplemental_ephemeris',
        'public_metadata',
        'model_prior'
      ])
      .optional(),
    trajectoryQualityState: z.enum(['precision', 'guided', 'search', 'pad_only']).optional(),
    renderTier: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
    droppedFrameBucket: z.string().max(32).optional()
  })
});

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

  const raw = await readJsonLimited(request);
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.error === 'body_too_large' ? 413 : 400 });

  const parsed = bodySchema.safeParse(raw.json);
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
    console.error('telemetry rate limit error', rateError);
    return NextResponse.json({ error: 'rate_limit_failed' }, { status: 500 });
  }
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const p = parsed.data.payload;
  const row: Record<string, unknown> = {
    id: p.sessionId,
    launch_id: p.launchId,
    started_at: p.startedAt,
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
    zoom_supported: p.zoomSupported,
    zoom_ratio_bucket: p.zoomRatioBucket,
    zoom_control_path: p.zoomControlPath,
    zoom_apply_latency_bucket: p.zoomApplyLatencyBucket,
    zoom_projection_sync_latency_bucket: p.zoomProjectionSyncLatencyBucket,
    projection_source: p.projectionSource,

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
    console.error('telemetry upsert error', error);
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
