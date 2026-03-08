const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRun(startedAfterIso, runId) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    let row = null;
    if (runId != null) {
      const byId = await admin
        .from('ingestion_runs')
        .select('id,started_at,ended_at,success,error,stats')
        .eq('job_name', 'artemis_contracts_ingest')
        .eq('id', String(runId))
        .maybeSingle();
      if (byId.error) throw byId.error;
      row = byId.data || null;
    }
    if (!row) {
      const latest = await admin
        .from('ingestion_runs')
        .select('id,started_at,ended_at,success,error,stats')
        .eq('job_name', 'artemis_contracts_ingest')
        .gte('started_at', startedAfterIso)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw latest.error;
      row = latest.data || null;
    }
    if (row && row.ended_at) return row;
    await sleep(2500);
  }
  return null;
}

(async () => {
  const out = { startedAtUtc: new Date().toISOString(), run: null, phaseSummary: null, errors: [] };
  try {
    const settings = await admin.from('system_settings').select('key,value').in('key', [
      'jobs_auth_token',
      'artemis_contracts_job_enabled',
      'artemis_sam_disable_job_on_guardrail',
      'artemis_sam_probe_both_endpoints_first',
      'artemis_sam_stop_on_empty_or_error'
    ]);
    if (settings.error) throw settings.error;
    const map = {};
    for (const row of settings.data || []) map[row.key] = row.value;
    const token = String(map.jobs_auth_token || '').split(',').map((s) => s.trim()).filter(Boolean)[0] || null;
    if (!token) throw new Error('jobs_auth_token missing');

    const prep = await admin.from('system_settings').upsert([
      { key: 'artemis_contracts_job_enabled', value: true },
      { key: 'artemis_sam_disable_job_on_guardrail', value: false },
      { key: 'artemis_sam_probe_both_endpoints_first', value: false },
      { key: 'artemis_sam_stop_on_empty_or_error', value: false }
    ], { onConflict: 'key' });
    if (prep.error) throw prep.error;

    const startedAfterIso = new Date().toISOString();
    const invoke = await admin.functions.invoke('artemis-contracts-ingest', {
      method: 'POST',
      headers: { 'x-job-token': token },
      body: {
        mode: 'incremental',
        stage: 'all',
        samSessionToken: 'verify-phase-' + Date.now(),
        samMaxRequestsPerRun: 0,
        samSinglePassPerEndpoint: false,
        samStopOnEmptyOrError: false
      }
    });

    const invokeData = invoke.data && typeof invoke.data === 'object' ? invoke.data : {};
    const runId = Object.prototype.hasOwnProperty.call(invokeData, 'runId') ? invokeData.runId : null;
    const run = await waitForRun(startedAfterIso, runId);
    out.run = run;

    const stats = run && run.stats && typeof run.stats === 'object' ? run.stats : {};
    const phaseTrace = Array.isArray(stats.runPhaseTrace) ? stats.runPhaseTrace : [];
    const durations = stats.runPhaseDurationsMs && typeof stats.runPhaseDurationsMs === 'object'
      ? stats.runPhaseDurationsMs
      : {};

    out.phaseSummary = {
      runCurrentPhase: stats.runCurrentPhase || null,
      runLastCompletedPhase: stats.runLastCompletedPhase || null,
      runLastProgressAt: stats.runLastProgressAt || null,
      phaseTraceEntries: phaseTrace.length,
      phaseTraceTail: phaseTrace.slice(-8),
      runPhaseDurationsMs: durations
    };
  } catch (error) {
    out.errors.push(error instanceof Error ? error.message : String(error));
  }

  console.log(JSON.stringify(out, null, 2));
  if (out.errors.length) process.exit(1);
})();
