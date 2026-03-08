const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async()=>{
  const { data: runs, error: re } = await client
    .from('ingestion_runs')
    .select('id,started_at,stats')
    .eq('job_name','artemis_contracts_ingest')
    .order('started_at',{ascending:false})
    .limit(10);
  if (re) throw re;

  const runIds = (runs || []).map((r)=>r.id);
  const { data: docs, error: de } = await client
    .from('artemis_source_documents')
    .select('id,source_key,http_status,raw,fetched_at')
    .in('source_key',['sam_contract_awards','sam_opportunities'])
    .in('raw->>samSessionToken', runIds.map(() => null));

  if (de) throw de;

  const sampleRuns = (runs || []).slice(0,6).map(r => {
    const s = (r.stats || {});
    return {
      id: r.id,
      started: r.started_at,
      requested: s.samRunRequestCapRequested || null,
      granted: s.samRequestsGranted || null,
      remaining: s.samRunRequestsRemaining || null,
      runStop: s.samRequestStopReason || s.samSkippedReason || s.samRunStopReason || null,
      opportunities: s.samOpportunitiesRequestsGranted || 0,
      awards: s.samAwardsRequestsGranted || 0,
      opportunitiesGrants: s.samNoticesUpserted || 0,
      awardsUpserts: s.samAwardsRowsUpserted || 0,
      stepTraceLast: Array.isArray(s.samStepTrace) ? s.samStepTrace.slice(-2) : []
    };
  });

  console.log('recentRuns', JSON.stringify(sampleRuns, null, 2));

  const { data: latestState, error: qs } = await client
    .from('system_settings')
    .select('key,value')
    .eq('key','artemis_sam_quota_state')
    .single();
  if (qs) throw qs;
  console.log('quotaState', latestState.value);
})();
