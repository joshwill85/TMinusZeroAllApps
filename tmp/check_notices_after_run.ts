const { config } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
config({ path: '.env.local' });
config();
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

(async () => {
  const sourceDoc = '3a6acb12-1d75-40dd-b313-a7be77e438fd';

  const byDoc = await client
    .from('artemis_opportunity_notices')
    .select('id,notice_id,solicitation_id,title,posted_date,source_document_id,updated_at')
    .eq('source_document_id', sourceDoc)
    .limit(5);
  console.log('noticeByDoc', JSON.stringify(byDoc.data || [], null, 2), byDoc.error ? byDoc.error.message : null);

  const latest = await client
    .from('artemis_opportunity_notices')
    .select('id,notice_id,solicitation_id,title,posted_date,updated_at')
    .order('updated_at', { ascending: false })
    .limit(20);
  console.log('latestNotices', JSON.stringify((latest.data || []).slice(0, 5), null, 2));

  const cnt = await client.from('artemis_opportunity_notices').select('id', { count: 'exact', head: true });
  console.log('opportunityNoticesCount', cnt.count, cnt.error ? cnt.error.message : null);
})();
