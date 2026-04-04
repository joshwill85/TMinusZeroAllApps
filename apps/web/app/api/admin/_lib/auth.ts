import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

type AdminRequestContext = {
  user: User;
  supabase: ReturnType<typeof createSupabaseServerClient>;
  admin: ReturnType<typeof createSupabaseAdminClient> | null;
};

type AdminRequestResult =
  | { ok: true; context: AdminRequestContext }
  | { ok: false; response: NextResponse };

export async function requireAdminRequest({
  requireServiceRole = false
}: {
  requireServiceRole?: boolean;
} = {}): Promise<AdminRequestResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, response: NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 }) };
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  if (requireServiceRole && !admin) {
    return { ok: false, response: NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 }) };
  }

  return { ok: true, context: { user, supabase, admin } };
}
