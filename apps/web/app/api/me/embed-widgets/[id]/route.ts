import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

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

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: filterSchema.optional(),
    preset_id: z.string().uuid().nullable().optional(),
    watchlist_id: z.string().uuid().nullable().optional()
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_widget_id' }, { status: 400 });

  const parsedBody = patchSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const updates = parsedBody.data;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (updates.preset_id && updates.watchlist_id) {
    return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: now };

  const supabase = createSupabaseServerClient();

  if (typeof updates.name === 'string') payload.name = updates.name;
  if (updates.filters) payload.filters = updates.filters;

  if (updates.preset_id !== undefined) {
    if (updates.preset_id === null) {
      payload.preset_id = null;
    } else {
      const { data: preset, error: presetError } = await supabase
        .from('launch_filter_presets')
        .select('id')
        .eq('id', updates.preset_id)
        .eq('user_id', viewer.userId)
        .maybeSingle();
      if (presetError) {
        console.error('embed widget preset lookup error', presetError);
        return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
      }
      if (!preset) return NextResponse.json({ error: 'preset_not_found' }, { status: 404 });
      payload.preset_id = updates.preset_id;
    }
  }

  if (updates.watchlist_id !== undefined) {
    if (updates.watchlist_id === null) {
      payload.watchlist_id = null;
    } else {
      const { data: watchlist, error: watchlistError } = await supabase
        .from('watchlists')
        .select('id')
        .eq('id', updates.watchlist_id)
        .eq('user_id', viewer.userId)
        .maybeSingle();
      if (watchlistError) {
        console.error('embed widget watchlist lookup error', watchlistError);
        return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
      }
      if (!watchlist) return NextResponse.json({ error: 'watchlist_not_found' }, { status: 404 });
      payload.watchlist_id = updates.watchlist_id;
    }
  }

  const { data, error } = await supabase
    .from('embed_widgets')
    .update(payload)
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('embed widget update error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ widget: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_widget_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('embed_widgets')
    .delete()
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('embed widget delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

