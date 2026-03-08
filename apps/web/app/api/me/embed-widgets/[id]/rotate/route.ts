import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function POST(_: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_widget_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('embed_widgets')
    .update({ token, updated_at: now })
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('embed widget rotate error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ widget: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

