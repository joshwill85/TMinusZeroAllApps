const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
(async () => {
  const { data: runRows, error } = await supabase
    .from('ingestion_runs')
    .select('id,started_at,ended_at,success,error,stats')
    .eq('job_name', 'artemis_contracts_ingest')
    .order('started_at', { ascending: false })
    .limit(6);
  if (error) throw error;
  console.log('RUNS', JSON.stringify(runRows?.map(r => ({ id:r.id, started_at:r.started_at, ended_at:r.ended_at, success:r.success, error:r.error, stats:r.stats })), null, 2));

  for (const run of runRows || []) {
    if (!run.started_at) continue;
    const start = new Date(run.started_at).toISOString();
    const end = run.ended_at ? new Date(new Date(run.ended_at).getTime() + 120_000).toISOString() : new Date().toISOString();

    const { data: checkpoints, error: cpErr } = await supabase
      .from('artemis_ingest_checkpoints')
      .select('source_key,status,records_ingested,last_error,updated_at,metadata')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
      .gte('updated_at', start)
      .lte('updated_at', end)
      .order('updated_at', { ascending: true });
    if (cpErr) {
      console.log('cp error for run', run.id, cpErr.message);
      continue;
    }
    const filtered = (checkpoints || []).map((r) => ({
      runId: run.id,
      source: r.source_key,
      status: r.status,
      updated_at: r.updated_at,
      records_ingested: r.records_ingested,
      last_error: r.last_error,
      metadata: r.metadata
    }));
    console.log('CHECKPOINTS_FOR_RUN', JSON.stringify(filtered, null, 2));

    const { data: sourceDocs, error: srcErr } = await supabase
      .from('artemis_source_documents')
      .select('id,source_key,http_status,error,url,summary,fetched_at,raw')
      .in('source_key', ['sam_contract_awards', 'sam_opportunities'])
      .gte('fetched_at', start)
      .lte('fetched_at', end)
      .order('fetched_at', { ascending: true });
    if (srcErr) {
      console.log('source doc error', srcErr.message);
      continue;
    }

    console.log('DOCS_FOR_RUN', JSON.stringify(sourceDocs?.map((d) => {
      const body = d.raw?.body;
      return {
        runId: run.id,
        source: d.source_key,
        status: d.http_status,
        fetched_at: d.fetched_at,
        url: d.url,
        summary: d.summary,
        error: d.error,
        body_code: body && typeof body === 'object' ? body.errorCode || body.code || null : null,
        body_message: body && typeof body === 'object' ? body.errorMessage || body.message || body.detail || null : null,
        raw_contractKey: d.raw?.contractKey || null,
        raw_solicitationId: d.raw?.solicitationId || null,
        raw_rowCount: d.raw?.rowCount ?? null,
        raw_noticeCount: d.raw?.noticeCount ?? null
      };
    }), null, 2));
  }
})();
