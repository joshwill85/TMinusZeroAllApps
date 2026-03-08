import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const WIDGET_LIMIT = 10;

const filterSchema = z
  .object({
    range: z.enum(['today', '7d', 'month', 'year', 'past', 'all']).optional(),
    sort: z.enum(['soonest', 'latest', 'changed']).optional(),
    region: z.enum(['us', 'non-us', 'all']).optional(),
    state: z.string().trim().min(1).max(60).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown', 'all']).optional()
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: filterSchema.optional(),
    preset_id: z.string().uuid().optional(),
    watchlist_id: z.string().uuid().optional()
  })
  .strict();

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('embed_widgets')
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false })
    .limit(WIDGET_LIMIT);

  if (error) {
    console.error('embed widgets fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ widgets: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsed = createSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (parsed.data.preset_id && parsed.data.watchlist_id) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const { count, error: countError } = await supabase
    .from('embed_widgets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId);

  if (countError) {
    console.error('embed widgets count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  if ((count ?? 0) >= WIDGET_LIMIT) {
    return NextResponse.json({ error: 'limit_reached', limit: WIDGET_LIMIT }, { status: 409 });
  }

  const resolvedPresetId: string | null = parsed.data.preset_id ?? null;
  const resolvedWatchlistId: string | null = parsed.data.watchlist_id ?? null;
  let resolvedFilters = parsed.data.filters ?? {};

  if (resolvedPresetId) {
    const { data: preset, error: presetError } = await supabase
      .from('launch_filter_presets')
      .select('id, filters')
      .eq('id', resolvedPresetId)
      .eq('user_id', viewer.userId)
      .maybeSingle();
    if (presetError) {
      console.error('embed widget preset lookup error', presetError);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }
    if (!preset) return NextResponse.json({ error: 'preset_not_found' }, { status: 404 });
    if (!parsed.data.filters) {
      resolvedFilters = (preset as any).filters ?? {};
    }
  }

  if (resolvedWatchlistId) {
    const { data: watchlist, error: watchlistError } = await supabase
      .from('watchlists')
      .select('id')
      .eq('id', resolvedWatchlistId)
      .eq('user_id', viewer.userId)
      .maybeSingle();
    if (watchlistError) {
      console.error('embed widget watchlist lookup error', watchlistError);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }
    if (!watchlist) return NextResponse.json({ error: 'watchlist_not_found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const payload = {
    user_id: viewer.userId,
    name: parsed.data.name,
    widget_type: 'next_launch_card',
    filters: resolvedFilters,
    preset_id: resolvedPresetId,
    watchlist_id: resolvedWatchlistId,
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from('embed_widgets')
    .insert(payload)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .single();

  if (error) {
    console.error('embed widget create error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ widget: data }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
