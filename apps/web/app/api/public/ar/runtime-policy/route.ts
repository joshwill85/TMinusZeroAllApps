import { subDays } from 'date-fns';
import { NextResponse } from 'next/server';
import { summarizeArRuntimePolicies, type ArRuntimePolicyTelemetryRow } from '@/lib/ar/runtimePolicyTelemetry';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 14;
const SAMPLE_LIMIT = 800;
const MAX_AGE_SECONDS = 300;

export async function GET() {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        windowDays: WINDOW_DAYS,
        sampledSessions: 0,
        sampleLimit: SAMPLE_LIMIT,
        truncated: false,
        maxAgeSeconds: MAX_AGE_SECONDS,
        overrides: []
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, s-maxage=${MAX_AGE_SECONDS}, stale-while-revalidate=900`
        }
      }
    );
  }

  const supabase = createSupabaseAdminClient();
  const windowStartIso = subDays(new Date(), WINDOW_DAYS).toISOString();
  const { data, error } = await supabase
    .from('ar_camera_guide_sessions')
    .select(
      [
        'client_profile',
        'client_env',
        'screen_bucket',
        'pose_mode',
        'xr_supported',
        'xr_used',
        'xr_error_bucket',
        'fallback_reason',
        'mode_entered',
        'time_to_lock_bucket',
        'lock_on_attempted',
        'lock_on_acquired',
        'lock_loss_count',
        'vision_backend',
        'runtime_degradation_tier',
        'loop_restart_count',
        'render_tier',
        'dropped_frame_bucket'
      ].join(', ')
    )
    .gte('started_at', windowStartIso)
    .order('started_at', { ascending: false })
    .limit(SAMPLE_LIMIT);

  if (error) {
    console.error('runtime policy telemetry query failed', error);
    return NextResponse.json({ error: 'failed_to_load_runtime_policy' }, { status: 500 });
  }

  const rows = (Array.isArray(data) ? data : []) as unknown as ArRuntimePolicyTelemetryRow[];
  const summary = summarizeArRuntimePolicies(rows, { sampleLimit: SAMPLE_LIMIT });

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      sampledSessions: summary.sampledSessions,
      sampleLimit: summary.sampleLimit,
      truncated: summary.truncated,
      maxAgeSeconds: MAX_AGE_SECONDS,
      overrides: summary.overrides
    },
    {
      headers: {
        'Cache-Control': `public, max-age=${MAX_AGE_SECONDS}, s-maxage=${MAX_AGE_SECONDS}, stale-while-revalidate=900`
      }
    }
  );
}
