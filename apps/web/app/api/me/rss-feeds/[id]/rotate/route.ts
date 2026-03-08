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
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_feed_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('rss_feeds')
    .update({
      token,
      updated_at: now,
      cached_rss_xml: null,
      cached_rss_etag: null,
      cached_rss_generated_at: null,
      cached_atom_xml: null,
      cached_atom_etag: null,
      cached_atom_generated_at: null
    })
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id, name, token, filters, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('rss feed rotate error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ feed: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
