const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const since = '2026-02-25T01:54:33.987+00:00';

  async function countSince(table, col='updated_at') {
    const r = await client
      .from(table)
      .select(`${col}`, { count: 'exact', head: true })
      .gte(col, since);
    return { table, count: r.count || 0, err: r.error?.message || null };
  }

  const tables = [
    { table: 'artemis_procurement_awards', col: 'updated_at' },
    { table: 'artemis_contracts', col: 'updated_at' },
    { table: 'artemis_contract_actions', col: 'updated_at' },
    { table: 'artemis_contract_budget_map', col: 'updated_at' },
    { table: 'artemis_sam_contract_award_rows', col: 'created_at' }
  ];

  for (const item of tables) {
    const result = await countSince(item.table, item.col);
    console.log(JSON.stringify(result));
  }
})();
