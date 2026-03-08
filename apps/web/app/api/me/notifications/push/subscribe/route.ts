import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed || !viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'subscription_required' }, { status: 402 });

  const userId = viewer.userId;
  const supabase = createSupabaseServerClient();

  const schema = z.object({
    endpoint: z.string().url(),
    p256dh: z.string().min(1),
    auth: z.string().min(1),
    user_agent: z.string().max(500).optional()
  });

  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
        user_agent: parsed.data.user_agent ?? null
      },
      { onConflict: 'user_id,endpoint' }
    )
    .select('id, endpoint, created_at')
    .single();

  if (error) {
    console.error('push subscription upsert error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  const MAX_SUBSCRIPTIONS_PER_USER = 10;
  const { data: allSubs, error: allError } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (!allError && Array.isArray(allSubs) && allSubs.length > MAX_SUBSCRIPTIONS_PER_USER) {
    const idsToRemove = allSubs
      .slice(MAX_SUBSCRIPTIONS_PER_USER)
      .map((row: any) => row.id)
      .filter((id: any) => typeof id === 'string' && id.length > 0);
    if (idsToRemove.length) {
      const { error: cleanupError } = await supabase.from('push_subscriptions').delete().in('id', idsToRemove as any);
      if (cleanupError) console.warn('push subscription cleanup warning', cleanupError.message);
    }
  }

  return NextResponse.json({ subscription: data });
}
