import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ token: null, source: 'stub' }, { status: 200 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });

  const supabase = createSupabaseServerClient();
  const userId = viewer.userId;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('profiles').select('calendar_token').eq('user_id', userId).maybeSingle();
  if (error) {
    console.error('calendar token fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const existing = data?.calendar_token ?? null;
  if (existing) return NextResponse.json({ token: existing, source: 'db' }, { status: 200 });

  const next = crypto.randomUUID();
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ calendar_token: next })
    .eq('user_id', userId)
    .select('calendar_token')
    .single();
  if (updateError) {
    console.error('calendar token update error', updateError);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ token: updated.calendar_token, source: 'generated' }, { status: 200 });
}
