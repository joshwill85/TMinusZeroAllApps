const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const tables = [
    'artemis_procurement_awards',
    'artemis_contracts',
    'artemis_contract_actions',
    'artemis_contract_budget_map',
    'artemis_sam_contract_award_rows'
  ];

  for (const table of tables) {
    const sample = await client.from(table).select('*').limit(1);
    if (sample.error) {
      console.log(`\n${table}: sample error`, sample.error.message);
      continue;
    }
    console.log(`\n${table}: sample keys`, sample.data && sample.data[0] ? Object.keys(sample.data[0]) : []);

    const count = await client.from(table).select('id', { count: 'exact', head: true });
    console.log(`${table}: count`, count.count, count.error ? count.error.message : 'ok');
  }
})();
