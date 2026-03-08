import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();

export async function DELETE(
  _: Request,
  {
    params
  }: {
    params: { id: string; ruleId: string };
  }
) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const watchlistId = uuidSchema.safeParse(params.id);
  if (!watchlistId.success) return NextResponse.json({ error: 'invalid_watchlist_id' }, { status: 400 });

  const ruleId = uuidSchema.safeParse(params.ruleId);
  if (!ruleId.success) return NextResponse.json({ error: 'invalid_rule_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!viewer.capabilities.canUseSavedItems) return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('watchlist_rules')
    .delete()
    .eq('id', ruleId.data)
    .eq('watchlist_id', watchlistId.data)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('watchlist rule delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
