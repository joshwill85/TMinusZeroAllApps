const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: '.env.local' });
config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const { data } = await supabase
    .from('ingestion_runs')
    .select('id,started_at,stats,success,error')
    .eq('job_name', 'artemis_contracts_ingest')
    .order('started_at', { ascending: false })
    .limit(120);

  const rows = (data || []).map((r) => ({
    id: r.id,
    started: r.started_at,
    stop: (r.stats || {}).samRequestStopReason || null,
    skipped: (r.stats || {}).samSkippedReason || null,
    stopReasons: (r.stats || {}).samStopReasons || null,
    attempt: (r.stats || {}).samRequestsAttempted || 0,
    granted: (r.stats || {}).samRequestsGranted || 0,
    opportunitiesAttempt: (r.stats || {}).samOpportunitiesRequestsAttempted || 0,
    opportunitiesGranted: (r.stats || {}).samOpportunitiesRequestsGranted || 0,
    opportunitiesIngested: (r.stats || {}).samNoticesUpserted || 0,
    awardsIngested: (r.stats || {}).samAwardsRowsUpserted || 0,
    lookupSource: (r.stats || {}).samLookupSource || null
  }));

  const noDataCandidates = rows.filter((row) => {
    const reason = String(row.stop || row.skipped || '');
    return reason.includes('sam_no_new_data') || reason.includes('sam_no_candidates') || reason.includes('sam_quota') || reason.includes('sam_run_cap') || reason.includes('probe');
  });

  console.log('NO_OR_QUOTA_REASONS', JSON.stringify(noDataCandidates.slice(0, 40), null, 2));
})();
