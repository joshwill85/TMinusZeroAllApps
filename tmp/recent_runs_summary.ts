const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const q = await c
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats,job_name')
    .eq('job_name', 'artemis_contracts_ingest')
    .order('started_at', { ascending: false })
    .limit(20);

  const rows = q.data || [];
  for (const r of rows) {
    const s = (r.stats && typeof r.stats === 'object') ? r.stats : {};
    const granted = `${s.samOpportunitiesRequestsGranted || 0}/${s.samContractAwardsRequestsGranted || 0}`;
    const upserted = `${s.samNoticesUpserted || 0}/${s.samAwardsRowsUpserted || 0}`;
    const stop = s.samRequestStopReason || s.samSkippedReason || s.samGuardrailReason || 'none';
    console.log(`${r.id}\t${r.started_at}\t${r.success}\t${s.stage || ''}\t${granted}\t${upserted}\t${stop}`);
  }
})();
