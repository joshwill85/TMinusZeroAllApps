const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: '.env.local' });
config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function run() {
  const settingsKeys = [
    'artemis_sam_quota_state',
    'artemis_sam_daily_quota_limit',
    'artemis_sam_daily_quota_reserve',
    'artemis_sam_max_requests_per_run',
    'artemis_contracts_job_enabled',
    'artemis_contracts_job_disabled_reason',
    'artemis_sam_disable_job_on_guardrail',
    'artemis_sam_stop_on_empty_or_error',
    'artemis_sam_probe_both_endpoints_first',
    'artemis_sam_contract_awards_api_url',
    'artemis_sam_opportunities_api_url',
    'artemis_sam_lookback_days'
  ];

  const { data: settingsRows, error: settingsErr } = await supabase
    .from('system_settings')
    .select('key,value,updated_at')
    .in('key', settingsKeys);
  if (settingsErr) throw new Error(`settings fetch error: ${settingsErr.message}`);

  const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
  console.log('SETTINGS', JSON.stringify({
    settings
  }, null, 2));

  const now = new Date();
  const nowDate = now.toISOString().slice(0, 10);
  const state = settings.artemis_sam_quota_state || {};
  const limit = Number(settings.artemis_sam_daily_quota_limit || 0);
  const reserve = Number(settings.artemis_sam_daily_quota_reserve || 0);
  const storedDate = state.date || null;
  const used = storedDate === nowDate ? Number(state.used || 0) : 0;
  const available = Math.max(0, Math.max(0, limit - reserve) - used);

  console.log('QUOTA_SNAPSHOT', JSON.stringify({
    utcNow: now.toISOString(),
    date: nowDate,
    state,
    limit,
    reserve,
    usedToday: used,
    maxUsable: Math.max(0, limit - reserve),
    availableToday: available
  }, null, 2));

  const { data: runRows, error: runErr } = await supabase
    .from('ingestion_runs')
    .select('id,job_name,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .order('started_at', { ascending: false })
    .limit(8);
  if (runErr) throw new Error(`run fetch error: ${runErr.message}`);

  const compactRuns = (runRows || []).map((r) => ({
    id: r.id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    success: r.success,
    error: r.error,
    samRequestsAttempted: Number((r.stats || {}).samRequestsAttempted || 0),
    samRequestsGranted: Number((r.stats || {}).samRequestsGranted || 0),
    samRunRequestsRemaining: Number((r.stats || {}).samRunRequestsRemaining || 0),
    samContractRows: Number((r.stats || {}).samAwardsRowsUpserted || 0),
    samNoticeRows: Number((r.stats || {}).samNoticesUpserted || 0),
    samRequestStopReason: (r.stats || {}).samRequestStopReason || null,
    samSkippedReason: (r.stats || {}).samSkippedReason || null,
    samProbeStopReasons: (r.stats || {}).samProbeStopReasons || null,
    samLookupSource: (r.stats || {}).samLookupSource || null,
    jobAutoDisabledReason: (r.stats || {}).jobAutoDisabledReason || null,
    contractRunCapRequested: Number((r.stats || {}).samRunRequestCapRequested || 0),
    contractRunRemaining: Number((r.stats || {}).samRunRequestsRemaining || 0),
    opportunitiesRunAttempted: Number((r.stats || {}).samOpportunitiesRequestsAttempted || 0),
    opportunitiesRunGranted: Number((r.stats || {}).samOpportunitiesRequestsGranted || 0)
  }));
  console.log('RECENT_RUNS', JSON.stringify(compactRuns, null, 2));

  if (runRows && runRows.length) {
    const latest = runRows[0];
    const started = latest.started_at || new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ended = latest.ended_at || new Date().toISOString();

    const { data: sourceDocs, error: srcErr } = await supabase
      .from('artemis_source_documents')
      .select('id,source_key,source_type,http_status,error,fetched_at,url,title,summary,raw')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities', 'sam_manual_audit'])
      .gte('fetched_at', started)
      .lte('fetched_at', new Date(new Date(ended).getTime() + 90_000).toISOString())
      .order('fetched_at', { ascending: true });

    if (srcErr) {
      console.log('source docs fetch error', srcErr.message);
    } else {
      const compactSrc = (sourceDocs || []).map((row) => {
        const raw = row.raw || {};
        const body = raw.body;
        const bodyObj = typeof body === 'object' && body !== null ? body : {};
        return {
          id: row.id,
          source_key: row.source_key,
          fetched_at: row.fetched_at,
          http_status: row.http_status,
          error: row.error,
          title: row.title,
          url: row.url,
          summary: row.summary,
          solicitationId: raw.solicitationId || null,
          contractKey: raw.contractKey || null,
          piid: raw.piid || null,
          rowCount: raw.rowCount || null,
          noticeCount: raw.noticeCount || null,
          body_code: bodyObj.code || bodyObj.errorCode || null,
          body_message: bodyObj.message || bodyObj.errorMessage || null,
          body_nextAccessTime: bodyObj.nextAccessTime || null
        };
      });
      console.log('LATEST_SOURCE_DOCS', JSON.stringify(compactSrc, null, 2));
    }

  const { data: checkpoints, error: cpErr } = await supabase
    .from('artemis_ingest_checkpoints')
    .select('source_key,status,records_ingested,last_error,updated_at,metadata')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .order('updated_at', { ascending: true });
  if (cpErr) {
    console.log('checkpoint fetch error', cpErr.message);
  } else {
    const recent = checkpoints.slice(-20);
    console.log('CHECKPOINTS', JSON.stringify(recent, null, 2));
  }
  }

  const { data: scopeCounts, error: scopeErr } = await supabase
    .from('artemis_sam_contract_award_rows')
    .select('program_scope', { count: 'exact', head: true })
    .not('program_scope', 'is', null);
  if (scopeErr) {
    console.log('scope count error', scopeErr.message);
  }

  const { data: rows, error: rowErr } = await supabase
    .from('artemis_sam_contract_award_rows')
    .select('id,program_scope,solicitation_id,piid,referenced_idv_piid,created_at,source_document_id')
    .order('created_at', { ascending: false })
    .limit(25);
  if (rowErr) throw new Error(`award rows fetch error: ${rowErr.message}`);
  console.log('RECENT_AWARD_ROWS', JSON.stringify(rows || [], null, 2));

  const { data: noticeRows, error: noticeErr } = await supabase
    .from('artemis_opportunity_notices')
    .select('id,notice_id,solicitation_id,ptype,title,posted_date,created_at,source_document_id')
    .order('created_at', { ascending: false })
    .limit(20);
  if (noticeErr) throw new Error(`notices fetch error: ${noticeErr.message}`);
  console.log('RECENT_OPPORTUNITY_NOTICES', JSON.stringify(noticeRows || [], null, 2));
}

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
