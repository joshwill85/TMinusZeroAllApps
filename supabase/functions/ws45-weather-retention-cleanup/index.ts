import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

const DEFAULTS = {
  liveRetentionHours: 72,
  planningRetentionDays: 30,
  batchLimit: 5000,
  maxBatches: 20
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'ws45_weather_retention_cleanup');
  const stats: Record<string, unknown> = {
    liveDeleted: 0,
    planningDeleted: 0,
    liveBatches: 0,
    planningBatches: 0,
    liveRetentionHours: DEFAULTS.liveRetentionHours,
    planningRetentionDays: DEFAULTS.planningRetentionDays,
    batchLimit: DEFAULTS.batchLimit
  };

  try {
    const settings = await getSettings(supabase, [
      'ws45_weather_retention_cleanup_enabled',
      'ws45_live_weather_retention_hours',
      'ws45_planning_forecast_retention_days',
      'ws45_weather_retention_cleanup_batch_limit'
    ]);
    const enabled = readBooleanSetting(settings.ws45_weather_retention_cleanup_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const liveRetentionHours = clampInt(
      readNumberSetting(settings.ws45_live_weather_retention_hours, DEFAULTS.liveRetentionHours),
      24,
      24 * 30
    );
    const planningRetentionDays = clampInt(
      readNumberSetting(settings.ws45_planning_forecast_retention_days, DEFAULTS.planningRetentionDays),
      7,
      365
    );
    const batchLimit = clampInt(
      readNumberSetting(settings.ws45_weather_retention_cleanup_batch_limit, DEFAULTS.batchLimit),
      100,
      50000
    );

    stats.liveRetentionHours = liveRetentionHours;
    stats.planningRetentionDays = planningRetentionDays;
    stats.batchLimit = batchLimit;

    const liveResult = await pruneInBatches({
      batchLimit,
      maxBatches: DEFAULTS.maxBatches,
      pruneOnce: async () => {
        const { data, error } = await supabase.rpc('prune_ws45_live_weather_snapshots', {
          retain_hours_in: liveRetentionHours,
          batch_limit_in: batchLimit
        });
        if (error) throw error;
        return Number(data || 0);
      }
    });

    const planningResult = await pruneInBatches({
      batchLimit,
      maxBatches: DEFAULTS.maxBatches,
      pruneOnce: async () => {
        const { data, error } = await supabase.rpc('prune_ws45_planning_forecasts', {
          retain_days_in: planningRetentionDays,
          batch_limit_in: batchLimit
        });
        if (error) throw error;
        return Number(data || 0);
      }
    });

    stats.liveDeleted = liveResult.deleted;
    stats.liveBatches = liveResult.batches;
    stats.planningDeleted = planningResult.deleted;
    stats.planningBatches = planningResult.batches;

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message, stats }, 500);
  }
});

async function pruneInBatches({
  batchLimit,
  maxBatches,
  pruneOnce
}: {
  batchLimit: number;
  maxBatches: number;
  pruneOnce: () => Promise<number>;
}) {
  let deleted = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const count = await pruneOnce();
    const normalized = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
    deleted += normalized;
    batches += 1;
    if (normalized < batchLimit) break;
  }

  return { deleted, batches };
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
