import { createClient } from '@supabase/supabase-js';

const IDS = [
  '400a05cb-ed14-42a4-9d78-f78dd91708b4',
  '8da228b4-bab4-459a-a808-de99a88747fa',
  '9645fe13-5a05-4c27-a86d-3d9bf1087bfe',
  '9300cb1d-2ff5-4522-b896-2f757f00c25e'
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing supabase env vars');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('artemis_timeline_events')
    .select('id,title,summary,source_type,source_url,is_superseded,supersedes_event_id,announced_time,updated_at')
    .in('id', IDS)
    .order('announced_time', { ascending: true, nullsFirst: false });

  if (error) throw error;
  console.log(JSON.stringify(data || [], null, 2));
}

void main();
