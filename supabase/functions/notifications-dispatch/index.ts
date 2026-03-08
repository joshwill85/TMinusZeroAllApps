import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

type Settings = {
  sms_enabled: boolean;
  sms_monthly_cap_per_user: number;
  sms_daily_cap_per_user: number;
  sms_daily_cap_per_user_per_launch: number;
  sms_min_gap_minutes: number;
  sms_batch_window_minutes: number;
  sms_max_chars: number;

  push_enabled: boolean;
  push_monthly_cap_per_user: number;
  push_daily_cap_per_user: number;
  push_daily_cap_per_user_per_launch: number;
  push_min_gap_minutes: number;
  push_batch_window_minutes: number;
  push_max_chars: number;
};

type PrefsRow = {
  user_id: string;
  email_enabled?: boolean | null;
  sms_enabled: boolean;
  sms_verified: boolean;
  push_enabled?: boolean | null;

  quiet_hours_enabled?: boolean | null;
  quiet_start_local?: string | null;
  quiet_end_local?: string | null;
  launch_day_email_enabled?: boolean | null;
  launch_day_email_providers?: string[] | null;
  launch_day_email_states?: string[] | null;
};

type LaunchRow = {
  id: string;
  name: string;
  net: string;
  net_precision: string | null;
  status_name: string | null;
  tier_auto: string | null;
  tier_override: string | null;
  provider?: string | null;
  pad_name?: string | null;
  pad_short_code?: string | null;
  pad_state?: string | null;
};

type LaunchPrefRow = {
  user_id: string;
  launch_id: string;
  channel: 'sms' | 'push';
  mode: 't_minus' | 'local_time';
  timezone: string | null;
  t_minus_minutes: number[] | null;
  local_times: string[] | null;
  notify_status_change?: boolean | null;
  notify_net_change?: boolean | null;
};

type LaunchEvent = {
  type: string;
  at: Date;
};

type LaunchUpdateRow = {
  id: number;
  launch_id: string;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  detected_at: string;
};

type DispatchResult = {
  queued: number;
  updated: number;
  usageUpdates: number;
  reason?: string;
};

const DEFAULT_SETTINGS: Settings = {
  sms_enabled: true,
  sms_monthly_cap_per_user: 20,
  sms_daily_cap_per_user: 10,
  sms_daily_cap_per_user_per_launch: 3,
  sms_min_gap_minutes: 10,
  sms_batch_window_minutes: 10,
  sms_max_chars: 160,

  push_enabled: true,
  push_monthly_cap_per_user: 400,
  push_daily_cap_per_user: 80,
  push_daily_cap_per_user_per_launch: 10,
  push_min_gap_minutes: 1,
  push_batch_window_minutes: 5,
  push_max_chars: 240
};

const SMS_BRAND_NAME = Deno.env.get('BRAND_NAME') || 'T-Minus Zero';

function prefixSmsWithBrand(body: string) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return `${SMS_BRAND_NAME}:`;
  const prefix = `${SMS_BRAND_NAME}: `;
  if (trimmed.startsWith(prefix) || trimmed === `${SMS_BRAND_NAME}:`) return trimmed;
  return `${prefix}${trimmed}`;
}

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'notifications_dispatch');

  try {
    const result = await dispatchNotifications(supabase);
    await finishIngestionRun(supabase, runId, true, result);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, result });
  } catch (err) {
    const message = stringifyError(err);
    await finishIngestionRun(supabase, runId, false, undefined, message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

async function dispatchNotifications(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const settings = await loadSettings(supabase);
  const now = new Date();
  const dayStart = startOfDayUtc(now).toISOString();
  const monthStart = startOfMonthUtc(now).toISOString().slice(0, 10);

  const premiumUserIds = await loadPremiumUserIds(supabase);
  if (!premiumUserIds.length) {
    const empty: DispatchResult = { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_premium_users' };
    return { queued: 0, updated: 0, usageUpdates: 0, sms: empty, email: empty, push: empty };
  }

  const [prefsRes, profilesRes] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select(
        'user_id, email_enabled, sms_enabled, sms_verified, push_enabled, quiet_hours_enabled, quiet_start_local, quiet_end_local, launch_day_email_enabled, launch_day_email_providers, launch_day_email_states'
      )
      .in('user_id', premiumUserIds),
    supabase.from('profiles').select('user_id, timezone').in('user_id', premiumUserIds)
  ]);
  if (prefsRes.error) throw prefsRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const prefs = prefsRes.data || [];
  const quietByUser = new Map<string, { enabled: boolean; start: string | null; end: string | null }>();
  prefs.forEach((row: PrefsRow) => {
    const start = normalizeLocalTime(String(row.quiet_start_local || ''));
    const end = normalizeLocalTime(String(row.quiet_end_local || ''));
    quietByUser.set(row.user_id, {
      enabled: row.quiet_hours_enabled === true,
      start,
      end
    });
  });

  const timeZoneByUser = new Map<string, string>();
  (profilesRes.data || []).forEach((row: any) => {
    if (row?.user_id) timeZoneByUser.set(String(row.user_id), String(row.timezone || '').trim() || 'UTC');
  });

  const smsEligibleUserIds = (prefs || [])
    .filter((row: PrefsRow) => row.sms_enabled && row.sms_verified)
    .map((row: PrefsRow) => row.user_id);

  const pushEligibleUserIds = (prefs || [])
    .filter((row: PrefsRow) => row.push_enabled === true)
    .map((row: PrefsRow) => row.user_id);

  const emailEligiblePrefs = (prefs || []).filter(
    (row: PrefsRow) => row.email_enabled !== false && row.launch_day_email_enabled === true
  );

  const smsResult: DispatchResult = !settings.sms_enabled
    ? { queued: 0, updated: 0, usageUpdates: 0, reason: 'sms_disabled' }
    : smsEligibleUserIds.length
      ? await dispatchSmsNotifications(supabase, { settings, now, dayStart, monthStart, smsEligibleUserIds, quietByUser, timeZoneByUser })
      : { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_sms_opted_users' };

  const pushResult: DispatchResult = !settings.push_enabled
    ? { queued: 0, updated: 0, usageUpdates: 0, reason: 'push_disabled' }
    : pushEligibleUserIds.length
      ? await dispatchPushNotifications(supabase, { settings, now, dayStart, monthStart, pushEligibleUserIds, quietByUser, timeZoneByUser })
      : { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_push_opted_users' };

  const emailResult: DispatchResult = emailEligiblePrefs.length
    ? await dispatchLaunchDayEmailDigests(supabase, { now, monthStart, prefs: emailEligiblePrefs })
    : { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_email_opted_users' };

  return {
    queued: smsResult.queued + emailResult.queued + pushResult.queued,
    updated: smsResult.updated + emailResult.updated + pushResult.updated,
    usageUpdates: smsResult.usageUpdates + emailResult.usageUpdates + pushResult.usageUpdates,
    sms: smsResult,
    push: pushResult,
    email: emailResult
  };
}

async function loadPremiumUserIds(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const [subsRes, adminsRes] = await Promise.all([
    supabase.from('subscriptions').select('user_id, status').in('status', ['active', 'trialing']),
    supabase.from('profiles').select('user_id').eq('role', 'admin')
  ]);
  if (subsRes.error) throw subsRes.error;
  if (adminsRes.error) throw adminsRes.error;

  const paidUserIds = new Set<string>();
  (subsRes.data || []).forEach((row) => paidUserIds.add(row.user_id));
  (adminsRes.data || []).forEach((row) => paidUserIds.add(row.user_id));
  return Array.from(paidUserIds);
}

async function dispatchSmsNotifications(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    settings,
    now,
    dayStart,
    monthStart,
    smsEligibleUserIds,
    quietByUser,
    timeZoneByUser
  }: {
    settings: Settings;
    now: Date;
    dayStart: string;
    monthStart: string;
    smsEligibleUserIds: string[];
    quietByUser: Map<string, { enabled: boolean; start: string | null; end: string | null }>;
    timeZoneByUser: Map<string, string>;
  }
): Promise<DispatchResult> {
  const { data: launchPrefs, error: launchPrefsError } = await supabase
    .from('launch_notification_preferences')
    .select('user_id, launch_id, channel, mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .in('user_id', smsEligibleUserIds)
    .eq('channel', 'sms');
  if (launchPrefsError) throw launchPrefsError;

  if (!launchPrefs?.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_launch_prefs' };
  }

  const launchIds = Array.from(new Set(launchPrefs.map((row: LaunchPrefRow) => row.launch_id)));
  const updatesSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [launchesRes, updatesRes, existingOutboxRes, usageRes] = await Promise.all([
    supabase
      .from('launches')
      .select('id, name, net, net_precision, status_name, tier_auto, tier_override, provider, pad_name, pad_short_code, pad_state')
      .eq('hidden', false)
      .in('id', launchIds),
    supabase
      .from('launch_updates')
      .select('id, launch_id, changed_fields, old_values, new_values, detected_at')
      .gte('detected_at', updatesSince)
      .in('launch_id', launchIds)
      .order('detected_at', { ascending: false })
      .limit(2000),
    supabase
      .from('notifications_outbox')
      .select('id, user_id, launch_id, channel, event_type, scheduled_for, status, payload')
      .gte('scheduled_for', updatesSince)
      .in('launch_id', launchIds),
    supabase
      .from('notification_usage_monthly')
      .select('user_id, month_start, messages_sent')
      .eq('month_start', monthStart)
      .eq('channel', 'sms')
  ]);

  if (launchesRes.error) throw launchesRes.error;
  if (updatesRes.error) throw updatesRes.error;
  if (existingOutboxRes.error) throw existingOutboxRes.error;
  if (usageRes.error) throw usageRes.error;

  const prefsByLaunch = new Map<string, LaunchPrefRow[]>();
  (launchPrefs || []).forEach((row: LaunchPrefRow) => {
    const list = prefsByLaunch.get(row.launch_id) || [];
    list.push(row);
    prefsByLaunch.set(row.launch_id, list);
  });

  const launches: LaunchRow[] = (launchesRes.data || []) as any;
  const launchById = new Map<string, LaunchRow>();
  launches.forEach((launch) => launchById.set(launch.id, launch));
  const updates: LaunchUpdateRow[] = (updatesRes.data || []) as any;
  const existingOutbox = existingOutboxRes.data || [];
  const usageByUser = new Map<string, number>();
  (usageRes.data || []).forEach((row: any) => usageByUser.set(row.user_id, row.messages_sent ?? 0));

  const smsCounters = buildSmsCounters(existingOutbox, usageByUser, dayStart);

  const existingByKey = new Map<string, any>();
  const existingUpdateKeys = new Set<string>();
  (existingOutbox || []).forEach((row: any) => {
    const key = outboxKey(String(row.user_id || ''), String(row.launch_id || ''), String(row.channel || ''), String(row.event_type || ''));
    if (!key) return;
    if (!existingByKey.has(key)) existingByKey.set(key, row);

    const updateId = readUpdateId(row.payload);
    if (!updateId) return;
    const eventType = String(row.event_type || '');
    if (!isChangeEventType(eventType)) return;
    const changeKey = outboxUpdateKey(String(row.user_id || ''), String(row.launch_id || ''), String(row.channel || ''), eventType, updateId);
    if (changeKey) existingUpdateKeys.add(changeKey);
  });

  const toInsert: any[] = [];
  const toUpdate: Array<{ id: number; scheduled_for: string; payload: Record<string, unknown> }> = [];
  const smsUsageIncrements = new Map<string, number>();

  for (const launch of launches) {
    const prefsForLaunch = prefsByLaunch.get(launch.id);
    if (!prefsForLaunch || !prefsForLaunch.length) continue;

    for (const pref of prefsForLaunch) {
      const tz = normalizeTimeZone(pref.timezone);
      const events = buildScheduledEventsForPref(launch, pref);

      for (const evt of events) {
        const scheduledFor = resolveScheduledFor(evt.at, now, settings.sms_batch_window_minutes);
        if (!scheduledFor) continue;

        const quiet = quietByUser.get(pref.user_id);
        const quietTimeZone = safeTimeZone(timeZoneByUser.get(pref.user_id));
        const quietAdjustedFor = applyQuietHours(scheduledFor, quiet, quietTimeZone);

        const key = outboxKey(pref.user_id, launch.id, 'sms', evt.type);
        const existing = key ? existingByKey.get(key) : null;

        if (existing) {
          if (existing.status === 'queued') {
            const existingAt = new Date(existing.scheduled_for);
            const diffMs = Number.isFinite(existingAt.getTime())
              ? Math.abs(existingAt.getTime() - quietAdjustedFor.getTime())
              : Number.POSITIVE_INFINITY;
            if (diffMs > 30_000) {
              const payload = makeOutboxPayload(launch, evt, tz, settings.sms_max_chars);
              toUpdate.push({ id: Number(existing.id), scheduled_for: quietAdjustedFor.toISOString(), payload });
              existing.scheduled_for = quietAdjustedFor.toISOString();
              existing.payload = payload;
            }
          }
          continue;
        }

        if (smsCounters.canSend(pref.user_id, launch.id, quietAdjustedFor, evt.type, settings)) {
          toInsert.push(makeOutboxRow(pref.user_id, launch.id, 'sms', evt, quietAdjustedFor, launch, now, tz, settings.sms_max_chars));
          smsCounters.increment(pref.user_id, launch.id, quietAdjustedFor, evt.type);
          smsUsageIncrements.set(pref.user_id, (smsUsageIncrements.get(pref.user_id) || 0) + 1);
        }
      }
    }
  }

  for (const update of updates) {
    const launch = launchById.get(update.launch_id);
    if (!launch) continue;

    const changed = Array.isArray(update.changed_fields) ? update.changed_fields.map((f) => String(f)) : [];
    const statusChanged = changed.some((f) => STATUS_CHANGE_FIELDS.has(f));
    const timingChanged = changed.some((f) => TIMING_CHANGE_FIELDS.has(f));
    if (!statusChanged && !timingChanged) continue;

    const prefsForLaunch = prefsByLaunch.get(update.launch_id);
    if (!prefsForLaunch || !prefsForLaunch.length) continue;

    for (const pref of prefsForLaunch) {
      const wantsStatus = Boolean(pref.notify_status_change);
      const wantsTiming = Boolean(pref.notify_net_change);
      const sendStatus = statusChanged && wantsStatus;
      const sendTiming = timingChanged && wantsTiming;
      if (!sendStatus && !sendTiming) continue;

      const eventType = sendStatus && sendTiming ? 'status_net_change' : sendStatus ? 'status_change' : 'net_change';
      const changeKey = outboxUpdateKey(pref.user_id, launch.id, 'sms', eventType, update.id);
      if (changeKey && existingUpdateKeys.has(changeKey)) continue;

      const quiet = quietByUser.get(pref.user_id);
      const quietTimeZone = safeTimeZone(timeZoneByUser.get(pref.user_id));
      const quietAdjustedFor = applyQuietHours(now, quiet, quietTimeZone);

      if (!smsCounters.canSend(pref.user_id, launch.id, quietAdjustedFor, eventType, settings)) continue;

      const tz = normalizeTimeZone(pref.timezone);
      const payload = makeChangeOutboxPayload(launch, eventType, tz, update, settings.sms_max_chars);

      toInsert.push({
        user_id: pref.user_id,
        launch_id: launch.id,
        channel: 'sms',
        event_type: eventType,
        payload,
        status: 'queued',
        scheduled_for: quietAdjustedFor.toISOString(),
        created_at: now.toISOString()
      });
      smsCounters.increment(pref.user_id, launch.id, quietAdjustedFor, eventType);
      smsUsageIncrements.set(pref.user_id, (smsUsageIncrements.get(pref.user_id) || 0) + 1);
      if (changeKey) existingUpdateKeys.add(changeKey);
    }
  }

  if (!toInsert.length && !toUpdate.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_notifications' };
  }

  if (toInsert.length) {
    const { error: insertError } = await supabase.from('notifications_outbox').insert(toInsert);
    if (insertError) throw insertError;
  }

  if (toUpdate.length) {
    for (const row of toUpdate) {
      if (!Number.isFinite(row.id)) continue;
      const { error: updateError } = await supabase
        .from('notifications_outbox')
        .update({ scheduled_for: row.scheduled_for, payload: row.payload })
        .eq('id', row.id);
      if (updateError) console.warn('outbox reschedule warning', updateError.message);
    }
  }

  let usageUpdates = 0;
  if (smsUsageIncrements.size > 0) {
    const usageRows = Array.from(smsUsageIncrements.entries()).map(([userId, inc]) => ({
      user_id: userId,
      month_start: monthStart,
      channel: 'sms',
      messages_sent: (usageByUser.get(userId) || 0) + inc,
      segments_sent: (usageByUser.get(userId) || 0) + inc
    }));
    const { error: usageError } = await supabase
      .from('notification_usage_monthly')
      .upsert(usageRows, { onConflict: 'user_id,month_start,channel' });
    if (usageError) console.warn('usage upsert warning', usageError.message);
    usageUpdates = usageRows.length;
  }

  return { queued: toInsert.length, updated: toUpdate.length, usageUpdates };
}

async function dispatchPushNotifications(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    settings,
    now,
    dayStart,
    monthStart,
    pushEligibleUserIds,
    quietByUser,
    timeZoneByUser
  }: {
    settings: Settings;
    now: Date;
    dayStart: string;
    monthStart: string;
    pushEligibleUserIds: string[];
    quietByUser: Map<string, { enabled: boolean; start: string | null; end: string | null }>;
    timeZoneByUser: Map<string, string>;
  }
): Promise<DispatchResult> {
  const { data: pushSubs, error: pushSubsError } = await supabase.from('push_subscriptions').select('user_id').in('user_id', pushEligibleUserIds);
  if (pushSubsError) throw pushSubsError;

  const subscribedUserIds = new Set<string>();
  (pushSubs || []).forEach((row: any) => {
    if (row?.user_id) subscribedUserIds.add(String(row.user_id));
  });

  const eligibleUserIds = pushEligibleUserIds.filter((id) => subscribedUserIds.has(id));
  if (!eligibleUserIds.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_push_subscriptions' };
  }

  const { data: launchPrefs, error: launchPrefsError } = await supabase
    .from('launch_notification_preferences')
    .select('user_id, launch_id, channel, mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .in('user_id', eligibleUserIds)
    .eq('channel', 'push');
  if (launchPrefsError) throw launchPrefsError;

  if (!launchPrefs?.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_launch_prefs' };
  }

  const launchIds = Array.from(new Set(launchPrefs.map((row: LaunchPrefRow) => row.launch_id)));
  const updatesSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [launchesRes, updatesRes, existingOutboxRes, usageRes] = await Promise.all([
    supabase
      .from('launches')
      .select('id, name, net, net_precision, status_name, tier_auto, tier_override, provider, pad_name, pad_short_code, pad_state')
      .eq('hidden', false)
      .in('id', launchIds),
    supabase
      .from('launch_updates')
      .select('id, launch_id, changed_fields, old_values, new_values, detected_at')
      .gte('detected_at', updatesSince)
      .in('launch_id', launchIds)
      .order('detected_at', { ascending: false })
      .limit(2000),
    supabase
      .from('notifications_outbox')
      .select('id, user_id, launch_id, channel, event_type, scheduled_for, status, payload')
      .gte('scheduled_for', updatesSince)
      .in('launch_id', launchIds),
    supabase
      .from('notification_usage_monthly')
      .select('user_id, month_start, messages_sent')
      .eq('month_start', monthStart)
      .eq('channel', 'push')
  ]);

  if (launchesRes.error) throw launchesRes.error;
  if (updatesRes.error) throw updatesRes.error;
  if (existingOutboxRes.error) throw existingOutboxRes.error;
  if (usageRes.error) throw usageRes.error;

  const prefsByLaunch = new Map<string, LaunchPrefRow[]>();
  (launchPrefs || []).forEach((row: LaunchPrefRow) => {
    const list = prefsByLaunch.get(row.launch_id) || [];
    list.push(row);
    prefsByLaunch.set(row.launch_id, list);
  });

  const launches: LaunchRow[] = (launchesRes.data || []) as any;
  const launchById = new Map<string, LaunchRow>();
  launches.forEach((launch) => launchById.set(launch.id, launch));
  const updates: LaunchUpdateRow[] = (updatesRes.data || []) as any;
  const existingOutbox = existingOutboxRes.data || [];
  const usageByUser = new Map<string, number>();
  (usageRes.data || []).forEach((row: any) => usageByUser.set(row.user_id, row.messages_sent ?? 0));

  const pushCounters = buildPushCounters(existingOutbox, usageByUser, dayStart);

  const existingByKey = new Map<string, any>();
  const existingUpdateKeys = new Set<string>();
  (existingOutbox || []).forEach((row: any) => {
    const key = outboxKey(String(row.user_id || ''), String(row.launch_id || ''), String(row.channel || ''), String(row.event_type || ''));
    if (!key) return;
    if (!existingByKey.has(key)) existingByKey.set(key, row);

    const updateId = readUpdateId(row.payload);
    if (!updateId) return;
    const eventType = String(row.event_type || '');
    if (!isChangeEventType(eventType)) return;
    const changeKey = outboxUpdateKey(String(row.user_id || ''), String(row.launch_id || ''), String(row.channel || ''), eventType, updateId);
    if (changeKey) existingUpdateKeys.add(changeKey);
  });

  const toInsert: any[] = [];
  const toUpdate: Array<{ id: number; scheduled_for: string; payload: Record<string, unknown> }> = [];
  const pushUsageIncrements = new Map<string, number>();

  for (const launch of launches) {
    const prefsForLaunch = prefsByLaunch.get(launch.id);
    if (!prefsForLaunch || !prefsForLaunch.length) continue;

    for (const pref of prefsForLaunch) {
      const tz = normalizeTimeZone(pref.timezone);
      const events = buildScheduledEventsForPref(launch, pref);

      for (const evt of events) {
        const scheduledFor = resolveScheduledFor(evt.at, now, settings.push_batch_window_minutes);
        if (!scheduledFor) continue;

        const quiet = quietByUser.get(pref.user_id);
        const quietTimeZone = safeTimeZone(timeZoneByUser.get(pref.user_id));
        const quietAdjustedFor = applyQuietHours(scheduledFor, quiet, quietTimeZone);

        const key = outboxKey(pref.user_id, launch.id, 'push', evt.type);
        const existing = key ? existingByKey.get(key) : null;

        if (existing) {
          if (existing.status === 'queued') {
            const existingAt = new Date(existing.scheduled_for);
            const diffMs = Number.isFinite(existingAt.getTime())
              ? Math.abs(existingAt.getTime() - quietAdjustedFor.getTime())
              : Number.POSITIVE_INFINITY;
            if (diffMs > 30_000) {
              const payload = makeOutboxPayload(launch, evt, tz, settings.push_max_chars);
              toUpdate.push({ id: Number(existing.id), scheduled_for: quietAdjustedFor.toISOString(), payload });
              existing.scheduled_for = quietAdjustedFor.toISOString();
              existing.payload = payload;
            }
          }
          continue;
        }

        if (pushCounters.canSend(pref.user_id, launch.id, quietAdjustedFor, evt.type, settings)) {
          toInsert.push(makeOutboxRow(pref.user_id, launch.id, 'push', evt, quietAdjustedFor, launch, now, tz, settings.push_max_chars));
          pushCounters.increment(pref.user_id, launch.id, quietAdjustedFor, evt.type);
          pushUsageIncrements.set(pref.user_id, (pushUsageIncrements.get(pref.user_id) || 0) + 1);
        }
      }
    }
  }

  for (const update of updates) {
    const launch = launchById.get(update.launch_id);
    if (!launch) continue;

    const changed = Array.isArray(update.changed_fields) ? update.changed_fields.map((f) => String(f)) : [];
    const statusChanged = changed.some((f) => STATUS_CHANGE_FIELDS.has(f));
    const timingChanged = changed.some((f) => TIMING_CHANGE_FIELDS.has(f));
    if (!statusChanged && !timingChanged) continue;

    const prefsForLaunch = prefsByLaunch.get(update.launch_id);
    if (!prefsForLaunch || !prefsForLaunch.length) continue;

    for (const pref of prefsForLaunch) {
      const wantsStatus = Boolean(pref.notify_status_change);
      const wantsTiming = Boolean(pref.notify_net_change);
      const sendStatus = statusChanged && wantsStatus;
      const sendTiming = timingChanged && wantsTiming;
      if (!sendStatus && !sendTiming) continue;

      const eventType = sendStatus && sendTiming ? 'status_net_change' : sendStatus ? 'status_change' : 'net_change';
      const changeKey = outboxUpdateKey(pref.user_id, launch.id, 'push', eventType, update.id);
      if (changeKey && existingUpdateKeys.has(changeKey)) continue;

      const quiet = quietByUser.get(pref.user_id);
      const quietTimeZone = safeTimeZone(timeZoneByUser.get(pref.user_id));
      const quietAdjustedFor = applyQuietHours(now, quiet, quietTimeZone);

      if (!pushCounters.canSend(pref.user_id, launch.id, quietAdjustedFor, eventType, settings)) continue;

      const tz = normalizeTimeZone(pref.timezone);
      const payload = makeChangeOutboxPayload(launch, eventType, tz, update, settings.push_max_chars);

      toInsert.push({
        user_id: pref.user_id,
        launch_id: launch.id,
        channel: 'push',
        event_type: eventType,
        payload,
        status: 'queued',
        scheduled_for: quietAdjustedFor.toISOString(),
        created_at: now.toISOString()
      });
      pushCounters.increment(pref.user_id, launch.id, quietAdjustedFor, eventType);
      pushUsageIncrements.set(pref.user_id, (pushUsageIncrements.get(pref.user_id) || 0) + 1);
      if (changeKey) existingUpdateKeys.add(changeKey);
    }
  }

  if (!toInsert.length && !toUpdate.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_notifications' };
  }

  if (toInsert.length) {
    const { error: insertError } = await supabase.from('notifications_outbox').insert(toInsert);
    if (insertError) throw insertError;
  }

  if (toUpdate.length) {
    for (const row of toUpdate) {
      if (!Number.isFinite(row.id)) continue;
      const { error: updateError } = await supabase
        .from('notifications_outbox')
        .update({ scheduled_for: row.scheduled_for, payload: row.payload })
        .eq('id', row.id);
      if (updateError) console.warn('outbox reschedule warning', updateError.message);
    }
  }

  let usageUpdates = 0;
  if (pushUsageIncrements.size > 0) {
    const usageRows = Array.from(pushUsageIncrements.entries()).map(([userId, inc]) => ({
      user_id: userId,
      month_start: monthStart,
      channel: 'push',
      messages_sent: (usageByUser.get(userId) || 0) + inc,
      segments_sent: (usageByUser.get(userId) || 0) + inc
    }));
    const { error: usageError } = await supabase
      .from('notification_usage_monthly')
      .upsert(usageRows, { onConflict: 'user_id,month_start,channel' });
    if (usageError) console.warn('usage upsert warning', usageError.message);
    usageUpdates = usageRows.length;
  }

  return { queued: toInsert.length, updated: toUpdate.length, usageUpdates };
}

async function dispatchLaunchDayEmailDigests(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    now,
    monthStart,
    prefs
  }: {
    now: Date;
    monthStart: string;
    prefs: PrefsRow[];
  }
): Promise<DispatchResult> {
  const userIds = prefs.map((row) => row.user_id);
  if (!userIds.length) return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_email_opted_users' };

  const [profilesRes, usageRes] = await Promise.all([
    supabase.from('profiles').select('user_id, email, timezone').in('user_id', userIds),
    supabase
      .from('notification_usage_monthly')
      .select('user_id, month_start, messages_sent')
      .eq('month_start', monthStart)
      .eq('channel', 'email')
      .in('user_id', userIds)
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (usageRes.error) throw usageRes.error;

  const profileByUser = new Map<string, any>();
  (profilesRes.data || []).forEach((row: any) => profileByUser.set(row.user_id, row));

  type LaunchDayEmailUser = {
    userId: string;
    email: string;
    timeZone: string;
    providers: string[];
    states: string[];
  };

  const users: LaunchDayEmailUser[] = [];

  for (const row of prefs) {
    const profile = profileByUser.get(row.user_id);
    const email = String(profile?.email || '').trim();
    if (!email) continue;
    const timeZone = safeTimeZone(profile?.timezone);
    users.push({
      userId: row.user_id,
      email,
      timeZone,
      providers: normalizeStringList(row.launch_day_email_providers),
      states: normalizeStringList(row.launch_day_email_states)
    });
  }

  if (!users.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_email_recipients' };
  }

  const existingWindowStart = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const existingWindowEnd = new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  const { data: existingOutbox, error: existingError } = await supabase
    .from('notifications_outbox')
    .select('id, user_id, event_type, status, scheduled_for')
    .eq('channel', 'email')
    .in('user_id', users.map((u) => u.userId))
    .gte('scheduled_for', existingWindowStart)
    .lt('scheduled_for', existingWindowEnd);
  if (existingError) throw existingError;

  const existingByKey = new Map<string, any>();
  (existingOutbox || []).forEach((row: any) => {
    const eventType = String(row.event_type || '');
    if (!eventType.startsWith('launch_day_digest_')) return;
    existingByKey.set(`${row.user_id}:${eventType}`, row);
  });

  const usageByUser = new Map<string, number>();
  (usageRes.data || []).forEach((row: any) => usageByUser.set(row.user_id, row.messages_sent ?? 0));

  const usersByTz = new Map<string, LaunchDayEmailUser[]>();
  users.forEach((u) => {
    const list = usersByTz.get(u.timeZone) || [];
    list.push(u);
    usersByTz.set(u.timeZone, list);
  });

  const siteUrl = getSiteUrl();
  const queuedRows: any[] = [];
  const updateRows: Array<{ id: number; payload: Record<string, unknown> }> = [];
  const deleteIds: number[] = [];
  const emailUsageIncrements = new Map<string, number>();

  for (const [timeZone, tzUsers] of usersByTz.entries()) {
    const window = resolveNextLocalEightAmWindow(now, timeZone);
    const { data: launches, error: launchesError } = await supabase
      .from('launches')
      .select('id, name, net, provider, pad_name, pad_short_code, pad_state, status_name')
      .eq('hidden', false)
      .gte('net', window.dayStart.toISOString())
      .lt('net', window.dayEnd.toISOString())
      .order('net', { ascending: true })
      .limit(500);
    if (launchesError) throw launchesError;

    const list: LaunchRow[] = (launches || []) as any;

    for (const user of tzUsers) {
      const matches = list.filter((launch) => matchesEmailFilters(launch, user.providers, user.states));
      const eventType = `launch_day_digest_${window.dateKey}`;
      const key = `${user.userId}:${eventType}`;
      const existing = existingByKey.get(key) || null;

      if (!matches.length) {
        if (existing && existing.status === 'queued') {
          deleteIds.push(Number(existing.id));
        }
        continue;
      }

      const payload = buildLaunchDayDigestPayload({
        launches: matches,
        timeZone,
        dateKey: window.dateKey,
        providers: user.providers,
        states: user.states,
        siteUrl
      });

      if (existing) {
        if (existing.status === 'queued') {
          updateRows.push({ id: Number(existing.id), payload });
        }
        continue;
      }

      queuedRows.push({
        user_id: user.userId,
        launch_id: null,
        channel: 'email',
        event_type: eventType,
        payload,
        status: 'queued',
        scheduled_for: window.scheduledFor.toISOString(),
        created_at: now.toISOString()
      });
      emailUsageIncrements.set(user.userId, (emailUsageIncrements.get(user.userId) || 0) + 1);
    }
  }

  if (!queuedRows.length && !updateRows.length && !deleteIds.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_notifications' };
  }

  if (queuedRows.length) {
    const { error: insertError } = await supabase.from('notifications_outbox').insert(queuedRows);
    if (insertError) throw insertError;
  }

  if (updateRows.length) {
    for (const row of updateRows) {
      if (!Number.isFinite(row.id)) continue;
      const { error: updateError } = await supabase.from('notifications_outbox').update({ payload: row.payload }).eq('id', row.id);
      if (updateError) console.warn('email digest payload update warning', updateError.message);
    }
  }

  if (deleteIds.length) {
    const ids = deleteIds.filter((id) => Number.isFinite(id));
    if (ids.length) {
      const { error: deleteError } = await supabase.from('notifications_outbox').delete().in('id', ids as any);
      if (deleteError) console.warn('email digest delete warning', deleteError.message);
    }
  }

  let usageUpdates = 0;
  if (emailUsageIncrements.size > 0) {
    const usageRows = Array.from(emailUsageIncrements.entries()).map(([userId, inc]) => ({
      user_id: userId,
      month_start: monthStart,
      channel: 'email',
      messages_sent: (usageByUser.get(userId) || 0) + inc,
      segments_sent: (usageByUser.get(userId) || 0) + inc
    }));
    const { error: usageError } = await supabase
      .from('notification_usage_monthly')
      .upsert(usageRows, { onConflict: 'user_id,month_start,channel' });
    if (usageError) console.warn('email usage upsert warning', usageError.message);
    usageUpdates = usageRows.length;
  }

  return { queued: queuedRows.length, updated: updateRows.length, usageUpdates };
}

const STATUS_CHANGE_FIELDS = new Set(['status_id', 'status_name', 'status_abbrev']);
const TIMING_CHANGE_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const CHANGE_EVENT_TYPES = new Set(['status_change', 'net_change', 'status_net_change']);

const ALLOWED_T_MINUS_MINUTES = [5, 10, 15, 20, 30, 45, 60, 120] as const;

function buildScheduledEventsForPref(launch: LaunchRow, pref: LaunchPrefRow): LaunchEvent[] {
  const net = new Date(launch.net);
  if (Number.isNaN(net.getTime())) return [];

  const mode = pref.mode === 'local_time' ? 'local_time' : 't_minus';

  if (mode === 't_minus') {
    const precision = (launch.net_precision || '').toLowerCase();
    if (precision !== 'minute' && precision !== 'hour') return [];
    const minutes = normalizeTMinusMinutes(pref.t_minus_minutes);
    return minutes.map((m) => ({ type: `t_minus_${m}`, at: addMinutes(net, -m) }));
  }

  const tz = normalizeTimeZone(pref.timezone);
  const localTimes = normalizeLocalTimes(pref.local_times);
  if (!localTimes.length) return [];

  const parts = getTimeZoneParts(net, tz);
  const isTimeKnown = ['minute', 'hour'].includes(String(launch.net_precision || '').toLowerCase());
  const events: LaunchEvent[] = [];
  for (const t of localTimes) {
    const hm = parseLocalTime(t);
    if (!hm) continue;
    const at = zonedTimeToUtcDate(
      {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: hm.hour,
        minute: hm.minute
      },
      tz
    );
    if (isTimeKnown && at.getTime() >= net.getTime()) continue;
    events.push({ type: `local_time_${t.replace(':', '')}`, at });
  }
  return events;
}

function normalizeTMinusMinutes(value: number[] | null) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value))
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .filter((v) => ALLOWED_T_MINUS_MINUTES.includes(v as any))
    .sort((a, b) => a - b)
    .slice(0, 2);
}

function normalizeLocalTimes(value: string[] | null) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((t) => normalizeLocalTime(String(t))).filter(Boolean) as string[]))
    .sort()
    .slice(0, 2);
}

function normalizeLocalTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseLocalTime(value: string): { hour: number; minute: number } | null {
  const normalized = normalizeLocalTime(value);
  if (!normalized) return null;
  return { hour: Number(normalized.slice(0, 2)), minute: Number(normalized.slice(3, 5)) };
}

function applyQuietHours(
  scheduledFor: Date,
  quiet: { enabled: boolean; start: string | null; end: string | null } | undefined,
  timeZone: string
) {
  if (!quiet?.enabled) return scheduledFor;

  const start = parseLocalTime(quiet.start || '');
  const end = parseLocalTime(quiet.end || '');
  if (!start || !end) return scheduledFor;

  const tz = safeTimeZone(timeZone);
  const parts = getTimeZoneParts(scheduledFor, tz);

  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  if (startMinutes === endMinutes) return scheduledFor;

  const localMinutes = parts.hour * 60 + parts.minute;
  const crossesMidnight = startMinutes > endMinutes;
  const inQuiet = crossesMidnight
    ? localMinutes >= startMinutes || localMinutes < endMinutes
    : localMinutes >= startMinutes && localMinutes < endMinutes;

  if (!inQuiet) return scheduledFor;

  let targetDate = { year: parts.year, month: parts.month, day: parts.day };
  if (crossesMidnight && localMinutes >= startMinutes) {
    targetDate = addDaysLocal(targetDate, tz, 1);
  }

  let quietEndUtc = zonedTimeToUtcDate({ ...targetDate, hour: end.hour, minute: end.minute }, tz);
  if (!Number.isFinite(quietEndUtc.getTime())) return scheduledFor;

  if (quietEndUtc.getTime() <= scheduledFor.getTime()) {
    const nextDay = addDaysLocal(targetDate, tz, 1);
    quietEndUtc = zonedTimeToUtcDate({ ...nextDay, hour: end.hour, minute: end.minute }, tz);
  }

  return quietEndUtc;
}

function outboxKey(userId: string, launchId: string, channel: string, eventType: string) {
  const u = (userId || '').trim();
  const l = (launchId || '').trim();
  const c = (channel || '').trim();
  const e = (eventType || '').trim();
  if (!u || !l || !c || !e) return null;
  return `${u}:${l}:${c}:${e}`;
}

function outboxUpdateKey(userId: string, launchId: string, channel: string, eventType: string, updateId: number | string) {
  const base = outboxKey(userId, launchId, channel, eventType);
  if (!base) return null;
  const id = typeof updateId === 'number' ? String(updateId) : String(updateId || '').trim();
  if (!id) return null;
  return `${base}:${id}`;
}

function isChangeEventType(eventType: string) {
  return CHANGE_EVENT_TYPES.has((eventType || '').trim());
}

function readUpdateId(payload: any) {
  const raw = payload?.update_id;
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function normalizeTimeZone(value: string | null) {
  const tz = typeof value === 'string' ? value.trim() : '';
  return tz || 'UTC';
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function zonedTimeToUtcDate(
  value: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
) {
  let guess = new Date(Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, 0, 0));
  for (let i = 0; i < 3; i++) {
    const parts = getTimeZoneParts(guess, timeZone);
    const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    const desiredAsIfUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, 0, 0);
    const diffMs = desiredAsIfUtc - asIfUtc;
    if (!diffMs) break;
    guess = new Date(guess.getTime() + diffMs);
  }
  return guess;
}

function safeTimeZone(value: string | null | undefined) {
  const raw = typeof value === 'string' ? value : null;
  const tz = normalizeTimeZone(raw);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'UTC';
  }
}

function normalizeStringList(values: string[] | null | undefined) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function addDaysLocal(date: { year: number; month: number; day: number }, timeZone: string, days: number) {
  const baseNoonUtc = zonedTimeToUtcDate({ ...date, hour: 12, minute: 0 }, timeZone);
  const moved = new Date(baseNoonUtc.getTime() + days * 24 * 60 * 60 * 1000);
  const parts = getTimeZoneParts(moved, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function resolveNextLocalEightAmWindow(now: Date, timeZone: string) {
  const parts = getTimeZoneParts(now, timeZone);
  const today = { year: parts.year, month: parts.month, day: parts.day };
  const target = parts.hour < 8 ? today : addDaysLocal(today, timeZone, 1);
  const scheduledFor = zonedTimeToUtcDate({ ...target, hour: 8, minute: 0 }, timeZone);
  const dayStart = zonedTimeToUtcDate({ ...target, hour: 0, minute: 0 }, timeZone);
  const nextDay = addDaysLocal(target, timeZone, 1);
  const dayEnd = zonedTimeToUtcDate({ ...nextDay, hour: 0, minute: 0 }, timeZone);
  const dateKey = `${target.year}${pad2(target.month)}${pad2(target.day)}`;
  return { scheduledFor, dayStart, dayEnd, dateKey };
}

function matchesEmailFilters(launch: LaunchRow, providers: string[], states: string[]) {
  const provider = String(launch.provider || '').trim();
  const state = String(launch.pad_state || '').trim();
  if (providers.length && !providers.includes(provider)) return false;
  if (states.length && !states.includes(state)) return false;
  return true;
}

function buildLaunchDayDigestPayload({
  launches,
  timeZone,
  dateKey,
  providers,
  states,
  siteUrl
}: {
  launches: LaunchRow[];
  timeZone: string;
  dateKey: string;
  providers: string[];
  states: string[];
  siteUrl: string;
}): Record<string, unknown> {
  const subjectDate = formatLocalDateLabel(launches[0]?.net || new Date().toISOString(), timeZone);
  const subject = `${SMS_BRAND_NAME} launches today • ${subjectDate}`;

  const providersLabel = providers.length ? providers.join(', ') : 'All providers';
  const statesLabel = states.length ? states.join(', ') : 'All locations';
  const accountUrl = siteUrl ? `${siteUrl}/account` : '';

  const lines: string[] = [];
  lines.push(`Launches today (${subjectDate})`);
  lines.push('');
  lines.push(`Filters: ${providersLabel} • ${statesLabel}`);
  lines.push('');

  for (const launch of launches) {
    const netLabel = formatLocalTimeLabel(launch.net, timeZone);
    const provider = String(launch.provider || '').trim();
    const location = formatLocationLabel(launch);
    lines.push(`- ${netLabel} — ${launch.name}${provider ? ` • ${provider}` : ''}${location ? ` • ${location}` : ''}`);
    if (siteUrl) {
      lines.push(`${siteUrl}/launches/${launch.id}`);
    }
  }

  lines.push('');
  lines.push('Times are subject to change.');
  if (accountUrl) {
    lines.push(`Manage email alerts: ${accountUrl}`);
  }

  const text = lines.join('\n');
  const html = buildLaunchDayDigestHtml({
    launches,
    subjectDate,
    providersLabel,
    statesLabel,
    timeZone,
    siteUrl,
    accountUrl
  });

  return {
    kind: 'launch_day_digest',
    date_key: dateKey,
    time_zone: timeZone,
    subject,
    text,
    html,
    launch_ids: launches.map((launch) => launch.id)
  };
}

function formatLocalDateLabel(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatLocalTimeLabel(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(date);
}

function escapeHtml(input: string) {
  return String(input || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatLocationLabel(launch: LaunchRow) {
  const primary = String(launch.pad_short_code || launch.pad_name || '').trim();
  const state = String(launch.pad_state || '').trim();
  if (primary && state) return `${primary}, ${state}`;
  if (primary) return primary;
  if (state) return state;
  return '';
}

function buildLaunchDayDigestHtml({
  launches,
  subjectDate,
  providersLabel,
  statesLabel,
  timeZone,
  siteUrl,
  accountUrl
}: {
  launches: LaunchRow[];
  subjectDate: string;
  providersLabel: string;
  statesLabel: string;
  timeZone: string;
  siteUrl: string;
  accountUrl: string;
}) {
  const listItems = launches
    .map((launch) => {
      const time = escapeHtml(formatLocalTimeLabel(launch.net, timeZone));
      const name = escapeHtml(launch.name);
      const provider = String(launch.provider || '').trim();
      const location = formatLocationLabel(launch);
      const url = siteUrl ? `${siteUrl}/launches/${launch.id}` : '';
      const link = url ? `<a href="${escapeHtml(url)}" style="color:#22d3ee;text-decoration:none">${name}</a>` : name;
      const details = [provider, location].filter(Boolean).join(' • ');
      return `<li style="margin:0 0 10px 0"><strong>${time}</strong> — ${link}${details ? ` <span style="color:#B9C6E8">• ${escapeHtml(details)}</span>` : ''}</li>`;
    })
    .join('');

  const manage = accountUrl ? `<p style="margin:16px 0 0 0"><a href="${escapeHtml(accountUrl)}" style="color:#22d3ee">Manage email alerts</a></p>` : '';

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.45;color:#EAF0FF;background:#05060A;padding:24px">
      <div style="max-width:560px;margin:0 auto">
        <h1 style="margin:0 0 8px 0;font-size:18px">${escapeHtml(SMS_BRAND_NAME)} launches today</h1>
        <p style="margin:0 0 12px 0;color:#B9C6E8">${escapeHtml(subjectDate)}</p>
        <p style="margin:0 0 16px 0;color:#B9C6E8">Filters: ${escapeHtml(providersLabel)} • ${escapeHtml(statesLabel)}</p>
        <ul style="padding-left:18px;margin:0">${listItems}</ul>
        <p style="margin:16px 0 0 0;color:#B9C6E8">Times are subject to change.</p>
        ${manage}
      </div>
    </div>
  `.trim();
}

function getSiteUrl() {
  const explicit = String(Deno.env.get('SITE_URL') || Deno.env.get('NEXT_PUBLIC_SITE_URL') || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercelUrl = String(Deno.env.get('VERCEL_URL') || '').trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, '')}`;
  return '';
}

function makeOutboxRow(
  userId: string,
  launchId: string,
  channel: 'email' | 'sms' | 'push',
  evt: LaunchEvent,
  scheduledFor: Date,
  launch: LaunchRow,
  now: Date,
  timeZone: string,
  maxChars?: number
) {
  const payload = makeOutboxPayload(launch, evt, timeZone, maxChars);
  return {
    user_id: userId,
    launch_id: launchId,
    channel,
    event_type: evt.type,
    payload,
    status: 'queued',
    scheduled_for: scheduledFor.toISOString(),
    created_at: now.toISOString()
  };
}

function makeOutboxPayload(launch: LaunchRow, evt: LaunchEvent, timeZone: string, maxChars?: number) {
  const message = buildMessage(launch, evt, timeZone, maxChars);
  return {
    message,
    launch_name: launch.name,
    net: launch.net,
    status: launch.status_name
  };
}

function makeChangeOutboxPayload(
  launch: LaunchRow,
  eventType: string,
  timeZone: string,
  update: LaunchUpdateRow,
  maxChars?: number
): Record<string, unknown> {
  const message = buildChangeMessage(launch, eventType, timeZone, update, maxChars);
  const payload: Record<string, unknown> = {
    message,
    launch_name: launch.name,
    net: launch.net,
    status: launch.status_name,
    update_id: update.id,
    update_detected_at: update.detected_at
  };

  const netOld = readValueString(update.old_values, 'net');
  const netNew = readValueString(update.new_values, 'net');
  if (netOld) payload.net_old = netOld;
  if (netNew) payload.net_new = netNew;

  const statusOld = readFirstValueString(update.old_values, ['status_name', 'status_abbrev']);
  const statusNew = readFirstValueString(update.new_values, ['status_name', 'status_abbrev']);
  if (statusOld) payload.status_old = statusOld;
  if (statusNew) payload.status_new = statusNew;

  return payload;
}

function buildMessage(launch: LaunchRow, evt: LaunchEvent, timeZone: string, maxChars?: number) {
  const status = launch.status_name ?? 'TBD';
  const netLabel = formatNetTime(launch.net, timeZone);

  let message = '';
  if (evt.type.startsWith('t_minus_')) {
    const raw = evt.type.slice('t_minus_'.length);
    const minutes = Number(raw);
    const label = minutes === 120 ? 'T-2h' : Number.isFinite(minutes) ? `T-${minutes}` : 'T-?';
    message = `${launch.name} ${label}. Launch at ${netLabel}. Status: ${status}`;
  } else if (evt.type.startsWith('local_time_')) {
    message = `${launch.name} reminder. Launch at ${netLabel}. Status: ${status}`;
  } else {
    message = `${launch.name} alert. Launch at ${netLabel}. Status: ${status}`;
  }

  message = prefixSmsWithBrand(message);

  if (maxChars && message.length > maxChars) {
    message = message.slice(0, maxChars - 3) + '...';
  }
  return message;
}

function buildChangeMessage(launch: LaunchRow, eventType: string, timeZone: string, update: LaunchUpdateRow, maxChars?: number) {
  const statusNow = launch.status_name ?? 'TBD';
  const netLabel = formatNetTime(launch.net, timeZone);

  const statusOld = readFirstValueString(update.old_values, ['status_name', 'status_abbrev']);
  const statusNew = readFirstValueString(update.new_values, ['status_name', 'status_abbrev']) || statusNow;

  const changed = Array.isArray(update.changed_fields) ? update.changed_fields.map((f) => String(f)) : [];
  const netChanged = changed.includes('net');
  const windowChanged = changed.includes('window_start') || changed.includes('window_end');
  const precisionChanged = changed.includes('net_precision');

  const oldNetRaw = readValueString(update.old_values, 'net');
  const newNetRaw = readValueString(update.new_values, 'net') || launch.net;
  const oldNetLabel = oldNetRaw ? formatNetTime(oldNetRaw, timeZone) : null;
  const newNetLabel = newNetRaw ? formatNetTime(newNetRaw, timeZone) : netLabel;

  let message = '';
  if (eventType === 'status_change') {
    message = `${launch.name} status update: ${statusNew}${statusOld ? ` (was ${statusOld})` : ''}. Launch at ${netLabel}.`;
  } else if (eventType === 'net_change') {
    if (netChanged) {
      message = `${launch.name} time updated: ${newNetLabel}${oldNetLabel ? ` (was ${oldNetLabel})` : ''}. Status: ${statusNow}.`;
    } else if (windowChanged) {
      message = `${launch.name} launch window updated. Launch at ${netLabel}. Status: ${statusNow}.`;
    } else if (precisionChanged) {
      message = `${launch.name} timing updated. Launch at ${netLabel}. Status: ${statusNow}.`;
    } else {
      message = `${launch.name} timing updated. Launch at ${netLabel}. Status: ${statusNow}.`;
    }
  } else if (eventType === 'status_net_change') {
    message = `${launch.name} update: ${statusNew}. Launch at ${newNetLabel}${oldNetLabel ? ` (was ${oldNetLabel})` : ''}.`;
  } else {
    message = `${launch.name} update. Launch at ${netLabel}. Status: ${statusNow}.`;
  }

  message = prefixSmsWithBrand(message);

  if (maxChars && message.length > maxChars) {
    message = message.slice(0, maxChars - 3) + '...';
  }
  return message;
}

function readValueString(obj: Record<string, unknown> | null, key: string) {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readFirstValueString(obj: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = readValueString(obj, key);
    if (value) return value;
  }
  return null;
}

function formatNetTime(netIso: string, timeZone = 'UTC') {
  const date = new Date(netIso);
  if (Number.isNaN(date.getTime())) return netIso;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short'
  }).format(date);
}

function buildSmsCounters(existing: any[], usageByUser: Map<string, number>, dayStartIso: string) {
  const dayCounts = new Map<string, number>();
  const perLaunchCounts = new Map<string, number>();
  const lastGapEventAt = new Map<string, Date>();
  const dayStartMs = new Date(dayStartIso).getTime();

  existing
    .filter((r) => r.channel === 'sms')
    .forEach((row) => {
      const key = `${row.user_id}`;
      const launchKey = `${row.user_id}:${row.launch_id}`;
      const at = new Date(row.scheduled_for);
      if (Number.isFinite(at.getTime()) && at.getTime() >= dayStartMs) {
        dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
        perLaunchCounts.set(launchKey, (perLaunchCounts.get(launchKey) || 0) + 1);
      }
      const eventType = String(row.event_type || '').trim();
      if (eventType && !isScheduledEventType(eventType)) {
        if (!lastGapEventAt.has(row.user_id) || lastGapEventAt.get(row.user_id)! < at) {
          lastGapEventAt.set(row.user_id, at);
        }
      }
    });

  return {
    canSend(userId: string, launchId: string, scheduledAt: Date, eventType: string, settings: Settings) {
      const monthCount = usageByUser.get(userId) || 0;
      if (monthCount >= settings.sms_monthly_cap_per_user) return false;
      const dayCount = dayCounts.get(userId) || 0;
      if (dayCount >= settings.sms_daily_cap_per_user) return false;
      const perLaunch = perLaunchCounts.get(`${userId}:${launchId}`) || 0;
      const perLaunchCap = Math.max(4, settings.sms_daily_cap_per_user_per_launch);
      if (perLaunch >= perLaunchCap) return false;

      const normalizedType = String(eventType || '').trim();
      if (normalizedType && !isScheduledEventType(normalizedType)) {
        const minGapMinutes = Math.max(0, settings.sms_min_gap_minutes);
        if (minGapMinutes > 0) {
          const last = lastGapEventAt.get(userId);
          if (last && Math.abs(scheduledAt.getTime() - last.getTime()) < minGapMinutes * 60 * 1000) return false;
        }
      }
      return true;
    },
    increment(userId: string, launchId: string, scheduledAt: Date, eventType: string) {
      dayCounts.set(userId, (dayCounts.get(userId) || 0) + 1);
      perLaunchCounts.set(`${userId}:${launchId}`, (perLaunchCounts.get(`${userId}:${launchId}`) || 0) + 1);
      const normalizedType = String(eventType || '').trim();
      if (normalizedType && !isScheduledEventType(normalizedType)) {
        lastGapEventAt.set(userId, scheduledAt);
      }
      usageByUser.set(userId, (usageByUser.get(userId) || 0) + 1);
    }
  };
}

function buildPushCounters(existing: any[], usageByUser: Map<string, number>, dayStartIso: string) {
  const dayCounts = new Map<string, number>();
  const perLaunchCounts = new Map<string, number>();
  const lastGapEventAt = new Map<string, Date>();
  const dayStartMs = new Date(dayStartIso).getTime();

  existing
    .filter((r) => r.channel === 'push')
    .forEach((row) => {
      const key = `${row.user_id}`;
      const launchKey = `${row.user_id}:${row.launch_id}`;
      const at = new Date(row.scheduled_for);
      if (Number.isFinite(at.getTime()) && at.getTime() >= dayStartMs) {
        dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
        perLaunchCounts.set(launchKey, (perLaunchCounts.get(launchKey) || 0) + 1);
      }
      const eventType = String(row.event_type || '').trim();
      if (eventType && !isScheduledEventType(eventType)) {
        if (!lastGapEventAt.has(row.user_id) || lastGapEventAt.get(row.user_id)! < at) {
          lastGapEventAt.set(row.user_id, at);
        }
      }
    });

  return {
    canSend(userId: string, launchId: string, scheduledAt: Date, eventType: string, settings: Settings) {
      const monthCount = usageByUser.get(userId) || 0;
      if (monthCount >= settings.push_monthly_cap_per_user) return false;
      const dayCount = dayCounts.get(userId) || 0;
      if (dayCount >= settings.push_daily_cap_per_user) return false;
      const perLaunch = perLaunchCounts.get(`${userId}:${launchId}`) || 0;
      const perLaunchCap = Math.max(10, settings.push_daily_cap_per_user_per_launch);
      if (perLaunch >= perLaunchCap) return false;

      const normalizedType = String(eventType || '').trim();
      if (normalizedType && !isScheduledEventType(normalizedType)) {
        const minGapMinutes = Math.max(0, settings.push_min_gap_minutes);
        if (minGapMinutes > 0) {
          const last = lastGapEventAt.get(userId);
          if (last && Math.abs(scheduledAt.getTime() - last.getTime()) < minGapMinutes * 60 * 1000) return false;
        }
      }
      return true;
    },
    increment(userId: string, launchId: string, scheduledAt: Date, eventType: string) {
      dayCounts.set(userId, (dayCounts.get(userId) || 0) + 1);
      perLaunchCounts.set(`${userId}:${launchId}`, (perLaunchCounts.get(`${userId}:${launchId}`) || 0) + 1);
      const normalizedType = String(eventType || '').trim();
      if (normalizedType && !isScheduledEventType(normalizedType)) {
        lastGapEventAt.set(userId, scheduledAt);
      }
      usageByUser.set(userId, (usageByUser.get(userId) || 0) + 1);
    }
  };
}

function isScheduledEventType(eventType: string) {
  return eventType.startsWith('t_minus_') || eventType.startsWith('local_time_');
}

async function loadSettings(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<Settings> {
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', [
    'sms_enabled',
    'sms_monthly_cap_per_user',
    'sms_daily_cap_per_user',
    'sms_daily_cap_per_user_per_launch',
    'sms_min_gap_minutes',
    'sms_batch_window_minutes',
    'sms_max_chars',
    'push_enabled',
    'push_monthly_cap_per_user',
    'push_daily_cap_per_user',
    'push_daily_cap_per_user_per_launch',
    'push_min_gap_minutes',
    'push_batch_window_minutes',
    'push_max_chars'
  ]);
  if (error) {
    console.warn('loadSettings fallback to defaults', error.message);
    return DEFAULT_SETTINGS;
  }
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  (data || []).forEach((row: any) => {
    merged[row.key] = row.value;
  });

  return {
    sms_enabled: readBooleanSetting(merged.sms_enabled, DEFAULT_SETTINGS.sms_enabled),
    sms_monthly_cap_per_user: readNumberSetting(merged.sms_monthly_cap_per_user, DEFAULT_SETTINGS.sms_monthly_cap_per_user),
    sms_daily_cap_per_user: readNumberSetting(merged.sms_daily_cap_per_user, DEFAULT_SETTINGS.sms_daily_cap_per_user),
    sms_daily_cap_per_user_per_launch: readNumberSetting(
      merged.sms_daily_cap_per_user_per_launch,
      DEFAULT_SETTINGS.sms_daily_cap_per_user_per_launch
    ),
    sms_min_gap_minutes: readNumberSetting(merged.sms_min_gap_minutes, DEFAULT_SETTINGS.sms_min_gap_minutes),
    sms_batch_window_minutes: readNumberSetting(merged.sms_batch_window_minutes, DEFAULT_SETTINGS.sms_batch_window_minutes),
    sms_max_chars: readNumberSetting(merged.sms_max_chars, DEFAULT_SETTINGS.sms_max_chars),

    push_enabled: readBooleanSetting(merged.push_enabled, DEFAULT_SETTINGS.push_enabled),
    push_monthly_cap_per_user: readNumberSetting(merged.push_monthly_cap_per_user, DEFAULT_SETTINGS.push_monthly_cap_per_user),
    push_daily_cap_per_user: readNumberSetting(merged.push_daily_cap_per_user, DEFAULT_SETTINGS.push_daily_cap_per_user),
    push_daily_cap_per_user_per_launch: readNumberSetting(
      merged.push_daily_cap_per_user_per_launch,
      DEFAULT_SETTINGS.push_daily_cap_per_user_per_launch
    ),
    push_min_gap_minutes: readNumberSetting(merged.push_min_gap_minutes, DEFAULT_SETTINGS.push_min_gap_minutes),
    push_batch_window_minutes: readNumberSetting(merged.push_batch_window_minutes, DEFAULT_SETTINGS.push_batch_window_minutes),
    push_max_chars: readNumberSetting(merged.push_max_chars, DEFAULT_SETTINGS.push_max_chars)
  };
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
}

function startOfDayUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfMonthUtc(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function resolveScheduledFor(eventAt: Date, now: Date, batchWindowMinutes: number) {
  if (!Number.isFinite(eventAt.getTime())) return null;
  const nowMs = now.getTime();
  const eventMs = eventAt.getTime();
  if (eventMs > nowMs) return eventAt;

  const windowMinutes = Number.isFinite(batchWindowMinutes) ? Math.max(0, batchWindowMinutes) : 0;
  if (windowMinutes <= 0) return null;

  const cutoffMs = nowMs - windowMinutes * 60 * 1000;
  if (eventMs < cutoffMs) return null;
  return now;
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
