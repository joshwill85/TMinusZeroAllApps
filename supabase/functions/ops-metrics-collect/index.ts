import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

const JOB_NAME = 'ops_metrics_collect';

const METRIC_KEYS = new Set([
  'node_disk_reads_completed_total',
  'node_disk_writes_completed_total',
  'node_disk_read_bytes_total',
  'node_disk_written_bytes_total',
  'node_disk_io_time_seconds_total',
  'node_disk_io_now',
  'node_cpu_seconds_total',
  'node_filesystem_size_bytes',
  'node_filesystem_avail_bytes',
  'node_filesystem_free_bytes',
  'pg_stat_bgwriter_checkpoints_timed_total',
  'pg_stat_bgwriter_checkpoints_req_total',
  'pg_stat_bgwriter_checkpoint_write_time_total',
  'pg_stat_bgwriter_checkpoint_sync_time_total',
  'pg_stat_bgwriter_buffers_checkpoint_total',
  'pg_stat_bgwriter_buffers_clean_total',
  'pg_stat_bgwriter_buffers_backend_total',
  'pg_stat_bgwriter_buffers_backend_fsync_total',
  'pg_stat_bgwriter_buffers_alloc_total',
  'pg_stat_database_xact_commit_total',
  'pg_stat_database_xact_rollback_total',
  'pg_stat_database_deadlocks_total',
  'pg_stat_database_num_backends',
  'pg_database_size_mb',
  'pg_up'
]);

const LABEL_ALLOWLIST = new Set([
  'supabase_project_ref',
  'supabase_identifier',
  'instance',
  'device',
  'mode',
  'datname',
  'mountpoint',
  'fstype'
]);

type ParsedMetric = {
  metricKey: string;
  labels: Record<string, string>;
  value: number;
};

serve(async (req) => {
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const { runId } = await startIngestionRun(supabase, JOB_NAME);
  const stats: Record<string, unknown> = {};

  try {
    const settings = await getSettings(supabase, [
      'ops_metrics_collection_enabled',
      'ops_metrics_scrape_timeout_ms'
    ]);

    const enabled = readBooleanSetting(settings.ops_metrics_collection_enabled, false);
    stats.enabled = enabled;
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled' });
    }

    const timeoutMs = clampInt(readNumberSetting(settings.ops_metrics_scrape_timeout_ms, 8000), 1000, 30000);
    const endpoint = resolveMetricsEndpoint();
    const authHeader = resolveMetricsAuthHeader();
    stats.endpoint = endpoint;
    stats.timeoutMs = timeoutMs;

    const body = await fetchMetricsBody(endpoint, authHeader, timeoutMs);
    const parsed = parsePrometheusText(body);
    stats.metricsParsed = parsed.length;

    const sampledAt = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    const rows = parsed.map((row) => ({
      sampled_at: sampledAt,
      metric_key: row.metricKey,
      labels: row.labels,
      value: row.value,
      source: 'supabase_metrics',
      collected_at: new Date().toISOString()
    }));

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from('ops_metrics_samples_1m')
        .upsert(chunk, { onConflict: 'sampled_at,metric_key,labels' });
      if (error) throw new Error(`ops_metrics_samples_1m upsert failed: ${error.message}`);
      upserted += chunk.length;
    }

    stats.metricsStored = upserted;
    stats.sampledAt = sampledAt;

    const { data: rollupResult, error: rollupError } = await supabase.rpc('ops_metrics_rollup_5m');
    if (rollupError) {
      stats.rollupError = rollupError.message;
    } else {
      stats.rollup = rollupResult ?? null;
    }

    const { data: pruneResult, error: pruneError } = await supabase.rpc('ops_metrics_prune');
    if (pruneError) {
      stats.pruneError = pruneError.message;
    } else {
      stats.prune = pruneResult ?? null;
    }

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, stored: upserted, sampledAt });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, { ...stats, error: message }, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

function resolveMetricsEndpoint() {
  const explicit = Deno.env.get('OPS_METRICS_ENDPOINT')?.trim();
  if (explicit) return explicit;

  const projectRef =
    Deno.env.get('SUPABASE_PROJECT_REF')?.trim() ||
    extractProjectRef(Deno.env.get('SUPABASE_URL')?.trim() || '') ||
    extractProjectRef(Deno.env.get('SUPABASE_PROJECT_URL')?.trim() || '') ||
    '';
  if (!projectRef) throw new Error('Missing SUPABASE_PROJECT_REF (or SUPABASE_URL) for metrics endpoint resolution.');

  return `https://${projectRef}.supabase.co/customer/v1/privileged/metrics`;
}

function resolveMetricsAuthHeader() {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || Deno.env.get('SERVICE_ROLE_KEY')?.trim() || '';
  if (!serviceRole) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for metrics authentication.');
  const token = btoa(`service_role:${serviceRole}`);
  return `Basic ${token}`;
}

async function fetchMetricsBody(endpoint: string, authHeader: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
        Authorization: authHeader
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Metrics fetch failed: ${res.status} ${res.statusText}${text ? ` (${text.slice(0, 240)})` : ''}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parsePrometheusText(payload: string) {
  const out: ParsedMetric[] = [];
  const lines = payload.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)$/);
    if (!match) continue;

    const metricKey = match[1];
    if (!METRIC_KEYS.has(metricKey)) continue;

    const labels = parseLabels(match[3] || '');
    const value = Number(match[4]);
    if (!Number.isFinite(value)) continue;

    out.push({ metricKey, labels, value });
  }
  return out;
}

function parseLabels(input: string) {
  const labels: Record<string, string> = {};
  if (!input) return labels;

  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(input)) != null) {
    const key = m[1];
    if (!LABEL_ALLOWLIST.has(key)) continue;
    const value = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    labels[key] = value;
  }

  return labels;
}

function extractProjectRef(urlLike: string) {
  if (!urlLike) return '';
  try {
    const url = new URL(urlLike);
    const host = url.hostname || '';
    const [candidate] = host.split('.');
    return /^[a-z]{20}$/.test(candidate || '') ? candidate : '';
  } catch {
    return '';
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

function clampInt(value: number, min: number, max: number) {
  const safe = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.min(max, Math.max(min, safe));
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
