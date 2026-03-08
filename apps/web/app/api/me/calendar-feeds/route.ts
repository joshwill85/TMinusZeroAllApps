import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

const FEED_LIMIT = 10;

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
    alarm_minutes_before: z.number().int().min(0).max(10080).nullable().optional()
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
    .from('calendar_feeds')
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false })
    .limit(FEED_LIMIT);

  if (error) {
    console.error('calendar feeds fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({ feeds: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsed = createSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { count, error: countError } = await supabase
    .from('calendar_feeds')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', viewer.userId);

  if (countError) {
    console.error('calendar feed count error', countError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  if ((count ?? 0) >= FEED_LIMIT) {
    return NextResponse.json({ error: 'limit_reached', limit: FEED_LIMIT }, { status: 409 });
  }

  const now = new Date().toISOString();
  const payload = {
    user_id: viewer.userId,
    name: parsed.data.name,
    filters: parsed.data.filters ?? {},
    alarm_minutes_before: parsed.data.alarm_minutes_before ?? null,
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from('calendar_feeds')
    .insert(payload)
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .single();

  if (error) {
    console.error('calendar feed create error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  return NextResponse.json({ feed: data }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
}
