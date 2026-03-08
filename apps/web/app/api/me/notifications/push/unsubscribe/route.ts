import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const schema = z.object({
    endpoint: z.string().url()
  });
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', parsed.data.endpoint);
  if (error) {
    console.error('push subscription delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

