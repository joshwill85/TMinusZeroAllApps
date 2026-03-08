const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

config({ path: '.env.local' });
config();

const runId = process.argv[2];
if (!runId) throw new Error('runId required');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const { data: run } = await supabase
    .from('ingestion_runs')
    .select('id,started_at,ended_at,stats')
    .eq('job_name','artemis_contracts_ingest')
    .eq('id', runId)
    .single();

  if (!run) {
    console.error('No run');
    process.exit(1);
  }

  const started = run.started_at;
  const ended = run.ended_at || new Date().toISOString();
  const { data: docs } = await supabase
    .from('artemis_source_documents')
    .select('id,source_key,source_type,http_status,raw,fetched_at,title')
    .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
    .gte('fetched_at', started)
    .lte('fetched_at', new Date(new Date(ended).getTime() + 90_000).toISOString())
    .order('fetched_at', { ascending: true });

  console.log(JSON.stringify({
    runId: run.id,
    started: run.started_at,
    ended: run.ended_at,
    stats: run.stats,
    docs: (docs || []).map((d) => {
      const raw = (d.raw || {});
      return {
        id: d.id,
        source_key: d.source_key,
        status: d.http_status,
        fetched_at: d.fetched_at,
        title: d.title,
        code: (raw.body && raw.body.code) || (raw.body && raw.body.error && raw.body.error.code) || null,
        message: (raw.body && raw.body.message) || (raw.body && raw.body.error && raw.body.error.message) || null,
        rowCount: raw.rowCount || raw.paging?.totalRecords || null,
        noticeCount: raw.noticeCount || null,
        solicitationId: raw.solicitationId || null,
        contractKey: raw.contractKey || null
      };
    })
  }, null, 2));
})();
