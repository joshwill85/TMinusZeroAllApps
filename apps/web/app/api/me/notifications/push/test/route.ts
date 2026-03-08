import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { BRAND_NAME } from '@/lib/brand';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });
  if (!isSupabaseAdminConfigured()) return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });

  const viewer = await getViewerTier();
  if (!viewer.isAuthed || !viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'subscription_required' }, { status: 402 });

  const userId = viewer.userId;
  const admin = createSupabaseAdminClient();

  const prefsRes = await admin.from('notification_preferences').select('push_enabled').eq('user_id', userId).maybeSingle();
  if (prefsRes.error) {
    console.error('push prefs error', prefsRes.error);
    return NextResponse.json({ error: 'failed_to_load_preferences' }, { status: 500 });
  }
  const pushEnabled = prefsRes.data?.push_enabled === true;
  if (!pushEnabled) return NextResponse.json({ error: 'push_not_enabled' }, { status: 409 });

  const subsRes = await admin.from('push_subscriptions').select('id').eq('user_id', userId).limit(1);
  if (subsRes.error) {
    console.error('push subscriptions lookup error', subsRes.error);
    return NextResponse.json({ error: 'failed_to_check_subscription' }, { status: 500 });
  }
  if (!subsRes.data?.length) return NextResponse.json({ error: 'push_not_subscribed' }, { status: 409 });

  const nowIso = new Date().toISOString();
  const recentIso = new Date(Date.now() - 60_000).toISOString();
  const throttleRes = await admin
    .from('notifications_outbox')
    .select('id')
    .eq('user_id', userId)
    .eq('channel', 'push')
    .eq('event_type', 'test')
    .gte('scheduled_for', recentIso)
    .limit(1);
  if (!throttleRes.error && throttleRes.data?.length) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const insertRes = await admin.from('notifications_outbox').insert({
    user_id: userId,
    launch_id: null,
    channel: 'push',
    event_type: 'test',
    payload: {
      title: BRAND_NAME,
      message: `Test notification from ${BRAND_NAME}.`,
      url: '/me/preferences'
    },
    status: 'queued',
    scheduled_for: nowIso,
    created_at: nowIso
  });

  if (insertRes.error) {
    console.error('push test enqueue error', insertRes.error);
    return NextResponse.json({ error: 'failed_to_queue' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, queued_at: nowIso });
}
