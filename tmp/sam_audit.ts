import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing env');

const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

type Row = { id: unknown; started_at: string | null; ended_at: string | null; success: boolean | null; error: string | null; stats: unknown };

function asString(v: unknown): string { return typeof v === 'string' ? v : ''; }

(async () => {
  const since = process.env.T0 || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .gte('started_at', since)
    .order('started_at', { ascending: false });

  if (error) throw error;

  const runs = (data || []) as Row[];
  let totalGranted = 0;

  for (const run of runs) {
    const stats = (run.stats || {}) as Record<string, unknown>;
    const granted = Number(stats.samRequestsGranted || 0);
    const requested = Number(stats.samRunRequestCapRequested || 0);
    const remaining = Number(stats.samRunRequestsRemaining || 0);
    const runStopped = String(stats.samRunStopReason || stats.samRequestStopReason || stats.samSkippedReason || 'none');
    const runGuardrail = String(stats.samGuardrailReason || '');
    const runSinglePass = String(stats.samSinglePassPerEndpoint || false);
    const runCap = String(stats.samRunCapReached || false);
    totalGranted += granted;

    console.log(`RUN ${run.id} started=${run.started_at} success=${run.success} requested=${requested} granted=${granted} remaining=${remaining} capReached=${runCap} singlePass=${runSinglePass} runStop=${runStopped} guardrail=${runGuardrail}`);
    if (run.error) console.log(`  error=${run.error}`);

    const { data: docs, error: docErr } = await client
      .from('artemis_source_documents')
      .select('source_key,http_status,error,raw')
      .eq('source_key', 'sam_contract_awards')
      .eq('source_type', 'procurement')
      .gte('fetched_at', run.started_at || '')
      .lt('fetched_at', run.ended_at || new Date().toISOString())
      .order('fetched_at', { ascending: true });
    if (docErr) throw docErr;

    const docsByKey = ((docs || []) as Array<{source_key:string; http_status:number; error:string|null; raw:Record<string, unknown>}>) ;
    const summary: Record<string, { rows: number; successes: number; errors: number; maxRowCount: number; sampleRowCounts: number[]; codes: Set<string> }> = {};

    for (const d of docsByKey) {
      const raw = (d.raw || {}) as Record<string, unknown>;
      const source = String(d.source_key);
      if (!summary[source]) summary[source] = { rows:0, successes:0, errors:0, maxRowCount:0, sampleRowCounts:[], codes: new Set() };
      const bucket = summary[source];
      bucket.rows += 1;
      if (d.error) bucket.errors += 1; else bucket.successes += 1;
      const code = asString(raw?.body && (raw.body as Record<string, unknown>).code) || asString(raw?.errorCode);
      if (code) bucket.codes.add(code);
      const rc = raw?.body ? Number((raw as Record<string, unknown>).body?.rowCount || 0) : Number((raw as Record<string, unknown>).rowCount || 0);
      if (Number.isFinite(rc)) {
        if (rc > bucket.maxRowCount) bucket.maxRowCount = rc;
        bucket.sampleRowCounts.push(rc);
      }
    }

    for (const [source, s] of Object.entries(summary)) {
      const codes = [...s.codes].join(',') || 'none';
      console.log(`  ${source}: rows=${s.rows} ok=${s.successes} err=${s.errors} maxRows=${s.maxRowCount} codes=${codes} samples=${s.sampleRowCounts.slice(0,4).join(',')}`);
    }
  }

  console.log(`totalGranted=${totalGranted}`);
})();
