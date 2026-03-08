import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { loadSmsSystemEnabled } from '@/lib/server/smsSystem';
import { getViewerTier } from '@/lib/server/viewerTier';
export const dynamic = 'force-dynamic';

const DEFAULT_PREFS = {
  mode: 't_minus' as const,
  timezone: 'UTC',
  t_minus_minutes: [] as number[],
  local_times: [] as string[],
  notify_status_change: false,
  notify_net_change: false
};

const launchIdSchema = z.string().uuid();

function parseChannel(request: Request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('channel') || '').trim().toLowerCase();
  if (raw === 'push') return 'push' as const;
  return 'sms' as const;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const channel = parseChannel(request);

  if (!isSupabaseConfigured()) {
    if (channel === 'push') {
      return NextResponse.json(
        {
          channel: 'push',
          preferences: DEFAULT_PREFS,
          push: { enabled: false, subscribed: false },
          source: 'stub'
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        channel: 'sms',
        preferences: DEFAULT_PREFS,
        sms: { enabled: false, verified: false, phone: null },
        smsSystemEnabled: false,
        source: 'stub'
      },
      { status: 200 }
    );
  }

  const parsedId = launchIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (channel === 'push') {
    const [prefsRes, subsRes, launchRes] = await Promise.all([
      supabase.from('notification_preferences').select('push_enabled').eq('user_id', user.id).maybeSingle(),
      supabase.from('push_subscriptions').select('id').eq('user_id', user.id).limit(1),
      supabase
        .from('launch_notification_preferences')
        .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
        .eq('user_id', user.id)
        .eq('launch_id', parsedId.data)
        .eq('channel', 'push')
        .maybeSingle()
    ]);

    if (prefsRes.error || subsRes.error || launchRes.error) {
      console.error('push launch prefs fetch error', prefsRes.error || subsRes.error || launchRes.error);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }

    return NextResponse.json({
      channel: 'push',
      preferences: launchRes.data ?? DEFAULT_PREFS,
      push: { enabled: prefsRes.data?.push_enabled === true, subscribed: (subsRes.data || []).length > 0 },
      source: launchRes.data ? 'db' : 'default'
    });
  }

  const { data: prefsRow } = await supabase
    .from('notification_preferences')
    .select('sms_enabled, sms_verified, sms_phone_e164')
    .eq('user_id', user.id)
    .maybeSingle();

  const smsSystemEnabled = await loadSmsSystemEnabled();

  const { data, error } = await supabase
    .from('launch_notification_preferences')
    .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .eq('user_id', user.id)
    .eq('launch_id', parsedId.data)
    .eq('channel', 'sms')
    .maybeSingle();

  if (error) {
    console.error('launch notification prefs fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({
    channel: 'sms',
    preferences: data ?? DEFAULT_PREFS,
    sms: {
      enabled: !!prefsRow?.sms_enabled,
      verified: !!prefsRow?.sms_verified,
      phone: prefsRow?.sms_phone_e164 ?? null
    },
    smsSystemEnabled,
    source: data ? 'db' : 'default'
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: 'supabase_not_configured' }, { status: 501 });

  const parsedId = launchIdSchema.safeParse(params.id);
  if (!parsedId.success) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  const tMinusSchema = z
    .array(z.number().int())
    .max(2)
    .transform((values) => Array.from(new Set(values)).sort((a, b) => a - b));

  const timeSchema = z
    .string()
    .trim()
    .regex(/^(\d{2}):(\d{2})(?::\d{2})?$/)
    .transform((value) => value.slice(0, 5));

  const schema = z.object({
    channel: z.enum(['sms', 'email', 'push']).optional(),
    mode: z.enum(['t_minus', 'local_time']),
    timezone: z.string().trim().min(1).max(64).optional(),
    t_minus_minutes: tMinusSchema.optional(),
    local_times: z.array(timeSchema).max(2).optional(),
    notify_status_change: z.boolean().optional(),
    notify_net_change: z.boolean().optional()
  });
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const channel = parsed.data.channel ?? 'sms';
  if (channel !== 'sms' && channel !== 'push') {
    return NextResponse.json({ error: 'channel_not_supported' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const allowedTMinus = new Set([5, 10, 15, 20, 30, 45, 60, 120]);
  const normalizedMode = parsed.data.mode;
  const normalizedTimezone = (parsed.data.timezone || 'UTC').trim() || 'UTC';
  const normalizedTMinus = (parsed.data.t_minus_minutes || []).filter((m) => allowedTMinus.has(m)).slice(0, 2);
  const normalizedLocalTimes = Array.from(new Set((parsed.data.local_times || []).map((t) => t.slice(0, 5))))
    .sort()
    .slice(0, 2);
  const notifyStatusChange = !!parsed.data.notify_status_change;
  const notifyNetChange = !!parsed.data.notify_net_change;

  if (normalizedMode === 't_minus' && (parsed.data.t_minus_minutes || []).some((m) => !allowedTMinus.has(m))) {
    return NextResponse.json({ error: 'invalid_t_minus' }, { status: 400 });
  }

  const payload = {
    user_id: user.id,
    launch_id: parsedId.data,
    channel,
    mode: normalizedMode,
    timezone: normalizedTimezone,
    t_minus_minutes: normalizedMode === 't_minus' ? normalizedTMinus : [],
    local_times: normalizedMode === 'local_time' ? normalizedLocalTimes : [],
    notify_status_change: notifyStatusChange,
    notify_net_change: notifyNetChange,
    updated_at: new Date().toISOString()
  };

  const allOff =
    payload.t_minus_minutes.length === 0 &&
    payload.local_times.length === 0 &&
    !payload.notify_status_change &&
    !payload.notify_net_change;
  const desiredEventTypes = new Set<string>(buildManagedEventTypes(payload.mode, payload.t_minus_minutes, payload.local_times));

  if (allOff) {
    const { error } = await supabase
      .from('launch_notification_preferences')
      .delete()
      .eq('user_id', user.id)
      .eq('launch_id', parsedId.data)
      .eq('channel', channel);
    if (error) {
      console.error('launch notification prefs delete error', error);
      return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
    }

    if (isSupabaseAdminConfigured()) {
      const admin = createSupabaseAdminClient();
      await deleteManagedQueuedOutbox(admin, user.id, parsedId.data, channel, desiredEventTypes);
    }
    return NextResponse.json({ channel, preferences: DEFAULT_PREFS });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed || !viewer.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (viewer.tier !== 'premium') return NextResponse.json({ error: 'subscription_required' }, { status: 402 });

  if (channel === 'push') {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });
    }

    const admin = createSupabaseAdminClient();
    const [pushPrefsRes, subsRes] = await Promise.all([
      supabase.from('notification_preferences').select('push_enabled').eq('user_id', user.id).maybeSingle(),
      supabase.from('push_subscriptions').select('id').eq('user_id', user.id).limit(1)
    ]);

    if (pushPrefsRes.error || subsRes.error) {
      console.error('push launch notification setup error', pushPrefsRes.error || subsRes.error);
      return NextResponse.json({ error: 'failed_to_check_subscription' }, { status: 500 });
    }

    if (!pushPrefsRes.data?.push_enabled) {
      return NextResponse.json({ error: 'push_not_enabled' }, { status: 409 });
    }

    if (!subsRes.data?.length) {
      return NextResponse.json({ error: 'push_not_subscribed' }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('launch_notification_preferences')
      .upsert(payload, { onConflict: 'user_id,launch_id,channel' })
      .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
      .single();

    if (error) {
      console.error('push launch notification prefs upsert error', error);
      return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
    }

    await deleteManagedQueuedOutbox(admin, user.id, parsedId.data, channel, desiredEventTypes);

    return NextResponse.json({ channel, preferences: data ?? payload });
  }

  const smsSystemEnabled = await loadSmsSystemEnabled();
  if (!smsSystemEnabled) {
    return NextResponse.json({ error: 'sms_system_disabled' }, { status: 503 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'billing_not_configured' }, { status: 501 });
  }

  const admin = createSupabaseAdminClient();
  const prefsRes = await supabase.from('notification_preferences').select('sms_enabled, sms_verified').eq('user_id', user.id).maybeSingle();

  if (prefsRes.error) {
    console.error('launch notification setup error', prefsRes.error);
    return NextResponse.json({ error: 'failed_to_check_subscription' }, { status: 500 });
  }

  if (!prefsRes.data?.sms_verified) {
    return NextResponse.json({ error: 'sms_not_verified' }, { status: 409 });
  }

  if (!prefsRes.data?.sms_enabled) {
    return NextResponse.json({ error: 'sms_not_enabled' }, { status: 409 });
  }

  const { data, error } = await supabase
    .from('launch_notification_preferences')
    .upsert(payload, { onConflict: 'user_id,launch_id,channel' })
    .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .single();

  if (error) {
    console.error('launch notification prefs upsert error', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }

  await deleteManagedQueuedOutbox(admin, user.id, parsedId.data, channel, desiredEventTypes);

  return NextResponse.json({ channel, preferences: data ?? payload });
}

function buildManagedEventTypes(mode: 't_minus' | 'local_time', tMinusMinutes: number[], localTimes: string[]) {
  if (mode === 't_minus') {
    return tMinusMinutes.map((m) => `t_minus_${m}`);
  }
  return localTimes.map((t) => `local_time_${t.replace(':', '')}`);
}

function isManagedEventType(eventType: string) {
  return eventType.startsWith('t_minus_') || eventType.startsWith('local_time_');
}

async function deleteManagedQueuedOutbox(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  launchId: string,
  channel: string,
  desiredEventTypes: Set<string>
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('notifications_outbox')
    .select('id, event_type')
    .eq('user_id', userId)
    .eq('launch_id', launchId)
    .eq('channel', channel)
    .eq('status', 'queued')
    .gt('scheduled_for', nowIso);

  if (error) {
    console.warn('outbox lookup warning', error.message);
    return;
  }

  const idsToDelete = (data || [])
    .filter((row: any) => isManagedEventType(String(row.event_type || '')) && !desiredEventTypes.has(String(row.event_type || '')))
    .map((row: any) => row.id)
    .filter((id: any) => id != null);

  if (!idsToDelete.length) return;

  const deleteRes = await admin.from('notifications_outbox').delete().in('id', idsToDelete as any);
  if (deleteRes.error) {
    console.warn('outbox cleanup warning', deleteRes.error.message);
  }
}

// loadSmsSystemEnabled lives in lib/server/smsSystem.ts
