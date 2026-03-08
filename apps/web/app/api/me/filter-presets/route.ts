import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const filterSchema = z
  .object({
    range: z.enum(['today', '7d', 'month', 'year', 'past', 'all']).optional(),
    sort: z.enum(['soonest', 'latest', 'changed']).optional(),
    region: z.enum(['us', 'non-us', 'all']).optional(),
    location: z.string().trim().min(1).max(180).optional(),
    state: z.string().trim().min(1).max(60).optional(),
    pad: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown', 'all']).optional()
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: filterSchema,
    is_default: z.boolean().optional()
  })
  .strict();

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
    .from('launch_filter_presets')
    .select('id, name, filters, is_default, created_at, updated_at')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('filter presets fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ presets: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
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
    .from('launch_filter_presets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId);

  if (countError) {
    console.error('filter preset count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  const presetLimit = viewer.limits.presetLimit;
  if ((count ?? 0) >= presetLimit) {
    return NextResponse.json({ error: 'limit_reached', limit: presetLimit }, { status: 409 });
  }

  const now = new Date().toISOString();
  const shouldSetDefault = parsed.data.is_default === true;

  if (shouldSetDefault) {
    const { error: clearError } = await supabase
      .from('launch_filter_presets')
      .update({ is_default: false, updated_at: now })
      .eq('user_id', viewer.userId)
      .eq('is_default', true);

    if (clearError) {
      console.error('filter preset default clear error', clearError);
      return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
    }
  }

  const payload = {
    user_id: viewer.userId,
    name: parsed.data.name,
    filters: parsed.data.filters,
    is_default: shouldSetDefault,
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from('launch_filter_presets')
    .insert(payload)
    .select('id, name, filters, is_default, created_at, updated_at')
    .single();

  if (error) {
    console.error('filter preset create error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ preset: data }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
