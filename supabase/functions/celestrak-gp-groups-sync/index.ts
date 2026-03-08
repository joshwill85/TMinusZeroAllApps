import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';
import {
  CELESTRAK_CURRENT_GP_PAGE,
  DEFAULT_CELESTRAK_USER_AGENT,
  fetchTextWithRetries,
  parseCurrentGpGroups
} from '../_shared/celestrak.ts';

const USER_AGENT = Deno.env.get('CELESTRAK_USER_AGENT') || DEFAULT_CELESTRAK_USER_AGENT;

const DEFAULTS = {
  gpMinIntervalSeconds: 7200,
  satcatMinIntervalSeconds: 86400
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'celestrak_gp_groups_sync');
  const stats: Record<string, unknown> = {
    url: CELESTRAK_CURRENT_GP_PAGE,
    groupsFound: 0,
    gpRowsInserted: 0,
    satcatRowsInserted: 0,
    gpRowsUpserted: 0,
    satcatRowsUpserted: 0
  };

  try {
    const settings = await getSettings(supabase, [
      'celestrak_gp_groups_sync_enabled',
      'celestrak_gp_default_min_interval_seconds',
      'celestrak_satcat_default_min_interval_seconds'
    ]);

    const enabled = readBooleanSetting(settings.celestrak_gp_groups_sync_enabled, true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const gpMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_gp_default_min_interval_seconds, DEFAULTS.gpMinIntervalSeconds),
      7200,
      86400 * 14
    );
    const satcatMinIntervalSeconds = clampInt(
      readNumberSetting(settings.celestrak_satcat_default_min_interval_seconds, DEFAULTS.satcatMinIntervalSeconds),
      7200,
      86400 * 30
    );

    const htmlRes = await fetchTextWithRetries(
      CELESTRAK_CURRENT_GP_PAGE,
      { headers: { 'User-Agent': USER_AGENT, accept: 'text/html' } },
      { retries: 3, backoffMs: 1000 }
    );
    if (!htmlRes.ok) {
      throw new Error(`celestrak_current_gp_${htmlRes.status || htmlRes.error}`);
    }

    const groups = parseCurrentGpGroups(htmlRes.text);
    stats.groupsFound = groups.length;

    if (!groups.length) {
      await finishIngestionRun(supabase, runId, false, { ...stats, error: 'no_groups_parsed' }, 'no_groups_parsed');
      return jsonResponse({ ok: false, error: 'no_groups_parsed' }, 500);
    }

    const { data: existing, error: existingError } = await supabase
      .from('celestrak_datasets')
      .select('dataset_key')
      .in('dataset_type', ['gp', 'satcat']);
    if (existingError) throw existingError;

    const existingKeys = new Set((existing || []).map((row: any) => String(row.dataset_key)));
    const nowIso = new Date().toISOString();

    const gpAll = groups.map((g) => ({
      dataset_key: `gp:${g.code}`,
      dataset_type: 'gp',
      code: g.code,
      label: g.label,
      query: { GROUP: g.code },
      updated_at: nowIso
    }));

    const satcatAll = groups.map((g) => ({
      dataset_key: `satcat:${g.code}`,
      dataset_type: 'satcat',
      code: g.code,
      label: g.label,
      query: { GROUP: g.code, ONORBIT: 1 },
      updated_at: nowIso
    }));

    const gpMissing = gpAll
      .filter((row) => !existingKeys.has(row.dataset_key))
      .map((row) => ({ ...row, enabled: true, min_interval_seconds: gpMinIntervalSeconds }));
    const satcatMissing = satcatAll
      .filter((row) => !existingKeys.has(row.dataset_key))
      .map((row) => ({ ...row, enabled: true, min_interval_seconds: satcatMinIntervalSeconds }));

    stats.gpRowsInserted = gpMissing.length;
    stats.satcatRowsInserted = satcatMissing.length;

    await upsertInChunks(supabase, 'celestrak_datasets', gpMissing, { ignoreDuplicates: true });
    await upsertInChunks(supabase, 'celestrak_datasets', satcatMissing, { ignoreDuplicates: true });

    stats.gpRowsUpserted = gpAll.length;
    stats.satcatRowsUpserted = satcatAll.length;

    await upsertInChunks(supabase, 'celestrak_datasets', gpAll, { ignoreDuplicates: false });
    await upsertInChunks(supabase, 'celestrak_datasets', satcatAll, { ignoreDuplicates: false });

    await upsertSetting(supabase, 'celestrak_gp_groups_last_synced_at', nowIso);
    await upsertSetting(supabase, 'celestrak_gp_groups_last_synced_count', groups.length);

    await finishIngestionRun(supabase, runId, true, { ...stats, elapsedMs: Date.now() - startedAt });
    return jsonResponse({ ok: true, stats });
  } catch (err) {
    const message = stringifyError(err);
    await upsertSetting(supabase, 'celestrak_gp_groups_last_error', message);
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

async function upsertSetting(supabase: ReturnType<typeof createSupabaseAdminClient>, key: string, value: unknown) {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function upsertInChunks(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  rows: any[],
  { ignoreDuplicates }: { ignoreDuplicates: boolean }
) {
  if (!rows.length) return;
  const chunks = chunkArray(rows, 250);
  for (const chunk of chunks) {
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'dataset_key', ignoreDuplicates });
    if (error) throw error;
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
