import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  upsertSetting,
  upsertSettingIfChanged
} from '../_shared/celestrakDb.ts';
import {
  DEFAULT_CELESTRAK_USER_AGENT,
} from '../_shared/celestrak.ts';
import {
  DEFAULT_CELESTRAK_SUPGP_SYNC_OPTIONS,
  syncCelestrakSupgpDatasets
} from '../_shared/celestrakSupgpSync.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_supgp_sync');
  const stats: Record<string, unknown> = {
    url: null as string | null,
    datasetsFound: 0,
    familyFeedsFound: 0,
    launchFilesFound: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnchanged: 0,
    rowsUpserted: 0,
    staleLaunchRowsDisabled: 0
  };

  try {
    const settings = await getSettings(supabase, [
      'celestrak_supgp_sync_enabled',
      'celestrak_supgp_family_min_interval_seconds',
      'celestrak_supgp_launch_min_interval_seconds',
      'celestrak_supgp_launch_retention_hours'
    ]);

    const enabled = readBooleanSetting(settings.celestrak_supgp_sync_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const familyMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_supgp_family_min_interval_seconds, DEFAULT_CELESTRAK_SUPGP_SYNC_OPTIONS.familyMinIntervalSeconds),
      900,
      86400 * 7
    );
    const launchMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_supgp_launch_min_interval_seconds, DEFAULT_CELESTRAK_SUPGP_SYNC_OPTIONS.launchMinIntervalSeconds),
      300,
      21_600
    );
    const launchRetentionHours = clampInt(
      readNumberSetting(settings.celestrak_supgp_launch_retention_hours, DEFAULT_CELESTRAK_SUPGP_SYNC_OPTIONS.launchRetentionHours),
      6,
      24 * 14
    );

    const syncStats = await syncCelestrakSupgpDatasets({
      supabase,
      userAgent: USER_AGENT,
      familyMinIntervalSeconds,
      launchMinIntervalSeconds,
      launchRetentionHours
    });
    Object.assign(stats, syncStats);

    const nowIso = new Date().toISOString();
    await upsertSetting(supabase, 'celestrak_supgp_last_synced_at', nowIso);
    await upsertSettingIfChanged(supabase, 'celestrak_supgp_last_synced_count', Number(stats.datasetsFound || 0));

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    await upsertSetting(supabase, 'celestrak_supgp_last_error', message);
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
