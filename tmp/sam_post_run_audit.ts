const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const from = `${today}T00:00:00.000Z`;

  const runs = await client
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .gte('started_at', from)
    .order('started_at', { ascending: false })
    .limit(20);

  console.log('runsToday', JSON.stringify(runs.data || [], null, 2));

  const run = await client
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('id', 202605)
    .single();
  const runData = run.data || null;
  console.log('run202605', JSON.stringify(runData, null, 2));

  const token = (runData?.stats && typeof runData.stats === 'object' ? (runData.stats as any).samSessionToken : null);
  console.log('samSessionToken', token);

  const recentDocs = await client
    .from('artemis_source_documents')
    .select('id,source_key,fetched_at,http_status,url,summary,raw->>samSessionToken')
    .in('source_key', ['sam_opportunities', 'sam_contract_awards', 'sam_manual_audit'])
    .order('fetched_at', { ascending: false })
    .limit(20);
  console.log('recentSamSourceDocs', JSON.stringify(recentDocs.data || [], null, 2));

  if (token) {
    const tokenEsc = token.toString().replace(/'/g, `\\'`);
    const docsByToken = await client
      .from('artemis_source_documents')
      .select('id,source_key,fetched_at,http_status,url,raw')
      .or(`raw->>samSessionToken.eq.${tokenEsc},raw->>samSessionToken.eq.${tokenEsc}`)
      .order('fetched_at', { ascending: true });
    console.log('docsByToken', JSON.stringify(docsByToken.data || [], null, 2));

    const cpk = await client
      .from('artemis_ingest_checkpoints')
      .select('source_key,status,records_ingested,metadata,updated_at')
      .in('source_key', ['sam_opportunities', 'sam_contract_awards'])
      .or(`metadata->>samSessionToken.eq.${tokenEsc},metadata->>samSessionToken.eq.${tokenEsc}`)
      .order('updated_at', { ascending: true });
    console.log('checkpointsByToken', JSON.stringify(cpk.data || [], null, 2));
  }

  const settings = await client
    .from('system_settings')
    .select('key,value,updated_at')
    .in('key', [
      'artemis_sam_quota_state',
      'artemis_sam_daily_quota_limit',
      'artemis_sam_daily_quota_reserve',
      'artemis_contracts_job_enabled',
      'artemis_contracts_job_disabled_reason',
      'artemis_sam_disable_job_on_guardrail'
    ])
    .order('key', { ascending: true });
  console.log('settings', JSON.stringify(settings.data || [], null, 2));
})();
