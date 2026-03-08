import { createClient } from '@supabase/supabase-js';

const IDS = [
  '4632c5c5-84cf-4d57-a78c-6b70fed80f8c',
  '2c7c8393-980e-4c96-aefc-ce82c9c5e123',
  '8408623a-a859-4425-ad24-67984bd23f3c',
  '52e73186-0944-43f7-b262-2c88454ac800',
  '7be4e38f-5207-41db-a4cf-45087c4bfec3',
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
    .select('*')
    .in('id', IDS)
    .order('announced_time', { ascending: true, nullsFirst: false });

  if (error) throw error;

  console.log(JSON.stringify(data || [], null, 2));
}

void main();
