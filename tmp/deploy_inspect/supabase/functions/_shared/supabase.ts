import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function createSupabaseAdminClient() {
  const url =
    Deno.env.get('SUPABASE_URL') ||
    Deno.env.get('SUPABASE_PROJECT_URL') ||
    Deno.env.get('SUPABASE_API_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY');

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SERVICE_ROLE_KEY for Edge Function.');
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}
