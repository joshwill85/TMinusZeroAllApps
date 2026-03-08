import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional()
  })
  .strict()
  .optional();

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!viewer.capabilities.canUseSavedItems) return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('watchlists')
    .select('id, name, created_at, watchlist_rules(id, rule_type, rule_value, created_at)')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('watchlists fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ watchlists: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsed = createSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!viewer.capabilities.canUseSavedItems) return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { count, error: countError } = await supabase
    .from('watchlists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId);

  if (countError) {
    console.error('watchlist count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const watchlistLimit = viewer.limits.watchlistLimit;
  if ((count ?? 0) >= watchlistLimit) {
    return NextResponse.json({ error: 'limit_reached', limit: watchlistLimit }, { status: 409 });
  }

  const now = new Date().toISOString();
  const name = parsed.data?.name?.trim() ? parsed.data.name.trim() : 'My Launches';

  const { data, error } = await supabase
    .from('watchlists')
    .insert({ user_id: viewer.userId, name, created_at: now })
    .select('id, name, created_at')
    .single();

  if (error) {
    console.error('watchlist create error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ watchlist: data }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
