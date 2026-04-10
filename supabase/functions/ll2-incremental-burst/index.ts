import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  resolveLaunchRefreshCadence
} from '../_shared/launchRefreshPolicy.ts';
import { getSettings, readBooleanSetting, readNumberSetting, readStringSetting } from '../_shared/settings.ts';
import { runLl2IncrementalOnce, type Ll2IncrementalResult } from '../_shared/ll2Incremental.ts';

const DEFAULTS = {
  callsPerMinute: 4,
  intervalSeconds: 15,
  lockTtlSecondsMin: 60,
  lockTtlSecondsMax: 3600
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = (await requireJobAuth(req, supabase)) || isServiceRoleRequest(req);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const lockId = crypto.randomUUID();

  try {
    const settings = await getSettings(supabase, [
      'll2_incremental_job_enabled',
      'll2_incremental_calls_per_minute',
      'll2_incremental_interval_seconds',
      'll2_incremental_last_attempt_at',
      'll2_incremental_last_success_at'
    ]);

    const enabled = readBooleanSetting(settings.ll2_incremental_job_enabled, true);
    if (!enabled) {
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const configuredIntervalSeconds = clampInt(
      readNumberSetting(settings.ll2_incremental_interval_seconds, DEFAULTS.intervalSeconds),
      1,
      60
    );
    const maxCallsPerMinute = Math.floor(55 / configuredIntervalSeconds) + 1;
    const callsPerMinuteRaw = clampInt(
      readNumberSetting(settings.ll2_incremental_calls_per_minute, DEFAULTS.callsPerMinute),
      1,
      20
    );
    const configuredCallsPerMinute = Math.max(1, Math.min(callsPerMinuteRaw, maxCallsPerMinute));
    const cadence = await resolveLaunchRefreshCadence(supabase, startedAt);
    const intervalSeconds = cadence.isHotWindow ? configuredIntervalSeconds : PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS;
    const callsPerMinute = cadence.isHotWindow ? configuredCallsPerMinute : 1;

    if (!cadence.isHotWindow) {
      const lastAttemptAt = readStringSetting(settings.ll2_incremental_last_attempt_at, '');
      const lastSuccessAt = readStringSetting(settings.ll2_incremental_last_success_at, '');
      const throttleReferenceMs = coalesceIsoMs(lastAttemptAt, lastSuccessAt);
      const sinceLastAttemptMs = Number.isFinite(throttleReferenceMs) ? startedAt - throttleReferenceMs : Number.POSITIVE_INFINITY;
      const minIntervalMs = PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS * 1000;
      if (sinceLastAttemptMs < minIntervalMs) {
        return jsonResponse({
          ok: true,
          skipped: true,
          reason: 'default_cadence_wait',
          intervalSeconds,
          cadenceReason: cadence.cadenceReason,
          cadenceAnchorNet: cadence.cadenceAnchorNet,
          throttleReference: lastAttemptAt ? 'last_attempt_at' : (lastSuccessAt ? 'last_success_at' : 'none'),
          waitMsRemaining: Math.max(0, minIntervalMs - sinceLastAttemptMs),
          elapsedMs: Date.now() - startedAt
        });
      }
    }

    const lockTtlSeconds = clampInt(
      callsPerMinute * intervalSeconds + 60,
      DEFAULTS.lockTtlSecondsMin,
      DEFAULTS.lockTtlSecondsMax
    );

    const { data: acquired, error: lockError } = await supabase.rpc('try_acquire_job_lock', {
      lock_name_in: 'll2_incremental_burst',
      ttl_seconds_in: lockTtlSeconds,
      locked_by_in: lockId
    });
    if (lockError) throw lockError;
    if (!acquired) {
      return jsonResponse({ ok: true, skipped: true, reason: 'locked', elapsedMs: Date.now() - startedAt });
    }

    await upsertSetting(supabase, 'll2_incremental_last_attempt_at', new Date(startedAt).toISOString());

    const intervalMs = intervalSeconds * 1000;
    const baseMs = Date.now();

    const results: Array<{ i: number; result: Ll2IncrementalResult }> = [];
    let failures = 0;
    let upsertedTotal = 0;

    for (let i = 0; i < callsPerMinute; i += 1) {
      const targetMs = baseMs + i * intervalMs;
      const waitMs = targetMs - Date.now();
      if (waitMs > 0) await delay(waitMs);

      const result = await runLl2IncrementalOnce(supabase);
      results.push({ i: i + 1, result });

      if (!result.ok) {
        failures += 1;
        break;
      }

      if (result.ok && !('skipped' in result) && typeof (result as any).upserted === 'number') {
        upsertedTotal += (result as any).upserted as number;
      }
    }

    try {
      await supabase.rpc('release_job_lock', { lock_name_in: 'll2_incremental_burst', locked_by_in: lockId });
    } catch {
      // ignore (TTL will expire)
    }

    const ok = failures === 0;
    return jsonResponse({
      ok,
      calls: callsPerMinute,
      intervalSeconds,
      cadenceReason: cadence.cadenceReason,
      cadenceAnchorNet: cadence.cadenceAnchorNet,
      hotWindow: cadence.isHotWindow,
      upsertedTotal,
      failures,
      last: results.length ? results[results.length - 1].result : null,
      elapsedMs: Date.now() - startedAt
    }, ok ? 200 : 502);
  } catch (err) {
    try {
      await supabase.rpc('release_job_lock', { lock_name_in: 'll2_incremental_burst', locked_by_in: lockId });
    } catch {
      // ignore
    }
    const message = stringifyError(err);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt }, 500);
  }
});

function delay(ms: number) {
  const safeMs = Math.max(0, Math.trunc(ms));
  return new Promise((resolve) => setTimeout(resolve, safeMs));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function coalesceIsoMs(...values: string[]) {
  for (const value of values) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.POSITIVE_INFINITY;
}

async function upsertSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  value: unknown
) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

function isServiceRoleRequest(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth.trim();
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length < 2) return false;

  try {
    const payloadRaw = base64UrlDecode(parts[1]);
    const payload = JSON.parse(payloadRaw);
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

function base64UrlDecode(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function stringifyError(err: unknown) {
  if (!err) return 'unknown_error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || 'error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
