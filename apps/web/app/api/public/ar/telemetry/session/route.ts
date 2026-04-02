import { NextResponse } from 'next/server';
import { startOfMinute } from 'date-fns';
import { arTelemetrySessionEventSchemaV1 } from '@tminuszero/contracts';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { buildArTelemetrySessionRow } from '@/lib/server/arTelemetrySession';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
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
    console.error('telemetry rate limit error', rateError);
    return NextResponse.json({ error: 'rate_limit_failed' }, { status: 500 });
  }
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const row = buildArTelemetrySessionRow(parsed.data.payload);

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
