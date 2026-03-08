import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

const DEFAULTS = {
  retentionDays: 30,
  batchSize: 50000,
  maxBatches: 20
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_retention_cleanup');
  const stats: Record<string, unknown> = {
    deleted: 0,
    batches: 0,
    cutoff: null as string | null,
    batchSize: DEFAULTS.batchSize
  };

  try {
    const settings = await getSettings(supabase, ['celestrak_retention_cleanup_enabled', 'celestrak_orbit_elements_retention_days']);
    const enabled = readBooleanSetting(settings.celestrak_retention_cleanup_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const retentionDays = clampInt(readNumberSetting(settings.celestrak_orbit_elements_retention_days, DEFAULTS.retentionDays), 1, 3650);
    const cutoffIso = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    stats.cutoff = cutoffIso;

    let totalDeleted = 0;
    let batches = 0;

    while (batches < DEFAULTS.maxBatches) {
      const { data, error } = await supabase.rpc('purge_orbit_elements_before', {
        cutoff_in: cutoffIso,
        batch_size: DEFAULTS.batchSize
      });
      if (error) throw error;

      const deleted = Number(data || 0);
      totalDeleted += Number.isFinite(deleted) ? deleted : 0;
      batches += 1;
      if (!Number.isFinite(deleted) || deleted < DEFAULTS.batchSize) break;
    }

    stats.deleted = totalDeleted;
    stats.batches = batches;
    const ok = true;
    await finishIngestionRun(supabase, runId, ok, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message, stats }, 500);
  }
});

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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
