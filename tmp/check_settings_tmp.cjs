const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();

const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const keys = [
  'artemis_contracts_job_enabled',
  'artemis_contracts_job_disabled_reason',
  'artemis_sam_disable_job_on_guardrail',
  'artemis_sam_stop_on_empty_or_error',
  'artemis_sam_probe_both_endpoints_first',
  'artemis_sam_single_pass_per_endpoint',
  'artemis_sam_max_requests_per_run',
  'artemis_sam_daily_quota_limit',
  'artemis_sam_daily_quota_reserve',
  'artemis_sam_quota_state',
  'jobs_auth_token'
];

(async()=>{
  const { data, error } = await client.from('system_settings').select('key,value,updated_at').in('key', keys).order('key', { ascending: true });
  if (error) throw error;
  console.log(JSON.stringify(data, null, 2));
})();
