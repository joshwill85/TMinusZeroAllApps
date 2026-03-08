import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting } from '../_shared/settings.ts';

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  let force = false;
  try {
    const body = await req.json().catch(() => ({}));
    force = Boolean((body as any)?.force);
  } catch {
    force = false;
  }

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'rocket_media_backfill');

  try {
    const settings = await getSettings(supabase, ['rocket_media_backfill_job_enabled']);
    const enabled = readBooleanSetting(settings.rocket_media_backfill_job_enabled, true);
    if (!enabled && !force) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    const { data, error } = await supabase.rpc('backfill_rocket_media');
    if (error) throw error;

    const launchesUpdated = typeof (data as any)?.launchesUpdated === 'number' ? (data as any).launchesUpdated : 0;
    const cacheUpdated = typeof (data as any)?.cacheUpdated === 'number' ? (data as any).cacheUpdated : 0;

    const stats = { launchesUpdated, cacheUpdated };
    await finishIngestionRun(supabase, runId, true, stats);

    return jsonResponse({ ok: true, ...stats, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt }, 500);
  }
});

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

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}
