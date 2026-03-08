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
    alarm_minutes_before: z.number().int().min(0).max(10080).nullable().optional()
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_feed_id' }, { status: 400 });

  const parsedBody = patchSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsedBody.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const updates = parsedBody.data;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'no_changes' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    updated_at: now,
    cached_ics: null,
    cached_ics_etag: null,
    cached_ics_generated_at: null
  };
  if (typeof updates.name === 'string') payload.name = updates.name;
  if (updates.filters) payload.filters = updates.filters;
  if (Object.prototype.hasOwnProperty.call(updates, 'alarm_minutes_before')) {
    payload.alarm_minutes_before = updates.alarm_minutes_before ?? null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('calendar_feeds')
    .update(payload)
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('calendar feed update error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ feed: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = idSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_feed_id' }, { status: 400 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  if (!viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('calendar_feeds')
    .delete()
    .eq('id', parsedId.data)
    .eq('user_id', viewer.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('calendar feed delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}
