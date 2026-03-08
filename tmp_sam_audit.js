const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing env vars');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const settings = [
    'artemis_sam_quota_state',
    'artemis_sam_daily_quota_limit',
    'artemis_sam_daily_quota_reserve',
    'artemis_sam_max_requests_per_run',
    'artemis_contracts_job_enabled',
    'artemis_sam_disable_job_on_guardrail',
    'artemis_sam_stop_on_empty_or_error',
    'artemis_sam_probe_both_endpoints_first',
    'artemis_sam_contract_awards_api_url',
    'artemis_sam_opportunities_api_url'
  ];
  const { data: settingRows, error: sErr } = await supabase
    .from('system_settings')
    .select('key,value,updated_at')
    .in('key', settings);
  if (sErr) throw sErr;

  const settingMap = Object.fromEntries((settingRows || []).map((r) => [r.key, r.value]));
  console.log('settings', JSON.stringify({ settings: settingMap }, null, 2));

  const state = settingMap.artemis_sam_quota_state;
  const limit = Number(settingMap.artemis_sam_daily_quota_limit);
  const reserve = Number(settingMap.artemis_sam_daily_quota_reserve);
  const date = new Date().toISOString().slice(0, 10);
  const storedDate = state && state.date ? state.date : null;
  const storedUsed = Number(state && state.used);
  const used = state && state.date === date && Number.isFinite(storedUsed) ? storedUsed : 0;
  const maxUsable = Math.max(0, limit - reserve);
  const available = Math.max(0, maxUsable - used);
  console.log(
    'quota_snapshot',
    JSON.stringify({ date, storedDate, limit, reserve, storedUsed, usedToday: used, maxUsable, available, stateRaw: state }, null, 2)
  );

  const { data: procRows, error: pErr } = await supabase
    .from('artemis_procurement_awards')
    .select('id,usaspending_award_id,award_title,recipient,program_scope,mission_key,metadata,awarded_on')
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(12);
  if (pErr) throw pErr;

  console.log('sample_procurement_awards', JSON.stringify(procRows, null, 2));

  const { data: actionRows, error: aErr } = await supabase
    .from('artemis_contract_actions')
    .select('id,solicitation_id,contract_id,updated_at')
    .is('solicitation_id', null)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(20);
  if (aErr) throw aErr;

  const ids = [...new Set((actionRows || []).map((r) => r.contract_id).filter(Boolean))];
  const { data: contractRefs, error: cErr } = ids.length
    ? await supabase
        .from('artemis_contracts')
        .select('id,piid,mission_key,metadata,description,awardee_name')
        .in('id', ids)
    : { data: [], error: null };
  if (cErr) throw cErr;

  const contractById = new Map((contractRefs || []).map((row) => [row.id, row]));
  const scopeCounts = { artemis: 0, blueOrigin: 0, spacex: 0, other: 0, total: 0 };
  const sample = (actionRows || []).map((action) => {
    const contract = contractById.get(action.contract_id) || null;
    const md = contract && contract.metadata ? contract.metadata : {};
    let scope = String(md.programScope || md.program_scope || '').toLowerCase();
    if (scope !== 'artemis' && scope !== 'blue-origin' && scope !== 'spacex') scope = '';

    let inferred = 'other';
    const text = `${contract?.awardee_name || ''} ${contract?.description || ''} ${contract?.piid || ''}`.toLowerCase();
    if (/\bartemis\b|sls|orion|hls|gateway|lunar/.test(text)) inferred = 'artemis';
    else if (/\bblue\s*origin\b|\bblue\s*moon\b|\bnew\s*glenn\b/.test(text)) inferred = 'blueOrigin';
    else if (/\bspacex\b|space\s*x|starship|falcon|dragon/.test(text)) inferred = 'spacex';

    if (scope === 'artemis') inferred = 'artemis';
    else if (scope === 'blue-origin') inferred = 'blueOrigin';
    else if (scope === 'spacex') inferred = 'spacex';

    if (inferred === 'artemis') scopeCounts.artemis += 1;
    else if (inferred === 'blueOrigin') scopeCounts.blueOrigin += 1;
    else if (inferred === 'spacex') scopeCounts.spacex += 1;
    else scopeCounts.other += 1;
    scopeCounts.total += 1;

    return {
      actionId: action.id,
      contractId: action.contract_id,
      missionKey: contract?.mission_key || null,
      rawMetadataScope: scope || null,
      inferredScope: inferred,
      solicitationId: action.solicitation_id,
      updatedAt: action.updated_at
    };
  });
  console.log('missing_action_scope_counts', JSON.stringify(scopeCounts, null, 2));
  console.log('missing_action_sample', JSON.stringify(sample.slice(0, 12), null, 2));
})();
