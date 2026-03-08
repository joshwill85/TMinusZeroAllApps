const { createClient } = require('@supabase/supabase-js');
const { config } = require('dotenv');

config({ path: '.env.local' });
config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const started = `${today}T00:00:00.000Z`;
  const ended = `${today}T23:59:59.999Z`;

  const [docsResult, runsResult] = await Promise.all([
    supabase
      .from('artemis_source_documents')
      .select('id,source_key,http_status,fetched_at,url')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
      .gte('fetched_at', started)
      .lte('fetched_at', ended)
      .order('fetched_at', { ascending: true }),
    supabase
      .from('ingestion_runs')
      .select('id,started_at,ended_at,stats')
      .eq('job_name', 'artemis_contracts_ingest')
      .gte('started_at', started)
      .lte('started_at', ended)
      .order('started_at', { ascending: false })
  ]);

  if (docsResult.error) throw new Error(`source docs: ${docsResult.error.message}`);
  if (runsResult.error) throw new Error(`runs: ${runsResult.error.message}`);

  const docs = docsResult.data || [];
  const runs = runsResult.data || [];

  const counts = docs.reduce((acc, row) => {
    const key = row.source_key || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const statusCounts = docs.reduce((acc, row) => {
    const key = `${row.source_key || 'unknown'}|${row.http_status || 'null'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const grantTotals = runs.reduce((acc, run) => {
    const stats = (run.stats && typeof run.stats === 'object' ? run.stats : {});
    acc.attempted += Number(stats.samRequestsAttempted || 0);
    acc.granted += Number(stats.samRequestsGranted || 0);
    return acc;
  }, { attempted: 0, granted: 0 });

  const runsWithAnyActivity = runs.filter((run) => {
    const stats = (run.stats && typeof run.stats === 'object' ? run.stats : {});
    return Number(stats.samRequestsAttempted || 0) > 0;
  }).length;

  const byRun = runs
    .map((run) => {
      const stats = (run.stats && typeof run.stats === 'object' ? run.stats : {});
      return {
        id: run.id,
        started_at: run.started_at,
        ended_at: run.ended_at,
        samRequestsAttempted: Number(stats.samRequestsAttempted || 0),
        samRequestsGranted: Number(stats.samRequestsGranted || 0),
        samRequestStopReason: stats.samRequestStopReason || null,
        samStopReasons: stats.samStopReasons || null
      };
    })
    .slice(0, 12);

  console.log('DATE', today);
  console.log('ENDPOINT_SOURCE_DOC_COUNTS', JSON.stringify(counts, null, 2));
  console.log('ENDPOINT_STATUS_COUNTS', JSON.stringify(statusCounts, null, 2));
  console.log('DAILY_TOTAL_DOC_CALLS', docs.length);
  console.log('DAILY_ATTEMPTED_GRANTED', JSON.stringify(grantTotals, null, 2));
  console.log('RUNS_WITH_SAM_ACTIVITY', runsWithAnyActivity);
  console.log('RECENT_DAILY_RUNS', JSON.stringify(byRun, null, 2));
})();
