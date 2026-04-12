import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting, readNumberSetting } from '../_shared/settings.ts';

type Settings = {
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
  push_enabled?: boolean | null;
  notify_t_minus_60?: boolean | null;
  notify_t_minus_10?: boolean | null;
  notify_t_minus_5?: boolean | null;
  notify_status_change?: boolean | null;
  notify_net_change?: boolean | null;

  quiet_hours_enabled?: boolean | null;
  quiet_start_local?: string | null;
  quiet_end_local?: string | null;
};

type LaunchRow = {
  id: string;
  name: string;
  net: string;
  net_precision: string | null;
  status_name: string | null;
  tier_auto: string | null;
  tier_override: string | null;
  ll2_pad_id?: number | null;
  provider?: string | null;
  pad_name?: string | null;
  pad_location_name?: string | null;
  pad_short_code?: string | null;
  pad_state?: string | null;
  pad_country_code?: string | null;
};

type LaunchPrefRow = {
  user_id: string;
  launch_id: string;
  channel: 'push';
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

type AlertRuleRow = {
  user_id: string;
  kind: 'region_us' | 'state' | 'filter_preset' | 'follow';
  state?: string | null;
  filter_preset_id?: string | null;
  follow_rule_type?: 'launch' | 'pad' | 'provider' | 'tier' | null;
  follow_rule_value?: string | null;
  filters?: Record<string, unknown> | null;
};

type MobilePushInstallationRowV2 = {
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id: string;
  platform?: string | null;
  delivery_kind?: 'web_push' | 'mobile_push' | null;
  is_active?: boolean | null;
};

type MobilePushRuleRowV2 = {
  id: string;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id?: string | null;
  intent?: 'follow' | 'notifications_only' | null;
  visible_in_following?: boolean | null;
  enabled?: boolean | null;
  scope_kind: 'all_us' | 'state' | 'launch' | 'all_launches' | 'preset' | 'provider' | 'rocket' | 'pad' | 'launch_site' | 'tier' | 'filter';
  scope_key?: string | null;
  state?: string | null;
  launch_id?: string | null;
  provider?: string | null;
  rocket_id?: number | null;
  pad_key?: string | null;
  launch_site?: string | null;
  filter_preset_id?: string | null;
  filters?: Record<string, unknown> | null;
  tier?: string | null;
  channels?: string[] | null;
  timezone?: string | null;
  prelaunch_offsets_minutes?: number[] | null;
  daily_digest_local_time?: string | null;
  status_change_types?: string[] | null;
  notify_net_change?: boolean | null;
  launch_filter_presets?: { filters?: Record<string, unknown> | null } | { filters?: Record<string, unknown> | null }[] | null;
};

type MobilePushOutboxRowV2 = {
  id: number;
  owner_kind: 'guest' | 'user';
  user_id?: string | null;
  installation_id?: string | null;
  launch_id?: string | null;
  event_type?: string | null;
  scheduled_for: string;
  status?: string | null;
  payload?: Record<string, unknown> | null;
};

type SubscriptionStatusRow = {
  user_id: string;
  status: string | null;
};

type ProfileRoleRow = {
  user_id: string;
  role: string | null;
};

type AdminAccessOverrideRow = {
  user_id: string;
  effective_tier_override: string | null;
};

type DispatchResult = {
  queued: number;
  updated: number;
  usageUpdates: number;
  reason?: string;
};

const DEFAULT_SETTINGS: Settings = {
  push_enabled: true,
  push_monthly_cap_per_user: 400,
  push_daily_cap_per_user: 80,
  push_daily_cap_per_user_per_launch: 10,
  push_min_gap_minutes: 1,
  push_batch_window_minutes: 5,
  push_max_chars: 240
};

const NOTIFICATION_BRAND_NAME = Deno.env.get('BRAND_NAME') || 'T-Minus Zero';

function prefixNotificationWithBrand(body: string) {
  const trimmed = String(body || '').trim();
  if (!trimmed) return `${NOTIFICATION_BRAND_NAME}:`;
  const prefix = `${NOTIFICATION_BRAND_NAME}: `;
  if (trimmed.startsWith(prefix) || trimmed === `${NOTIFICATION_BRAND_NAME}:`) return trimmed;
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

  const pushResult = await dispatchPushNotifications(supabase, {
    settings,
    now,
    dayStart,
    monthStart,
    pushEligibleUserIds: [],
    webPushEligibleUserIds: [],
    prefsByUser: new Map(),
    quietByUser: new Map(),
    timeZoneByUser: new Map()
  });

  const emailResult = await dispatchLaunchDayEmailDigests(supabase, { now, monthStart, prefs: [] });

  const mobilePushV2Result: DispatchResult = settings.push_enabled
    ? await dispatchMobilePushV2(supabase, {
        settings,
        now
      })
    : { queued: 0, updated: 0, usageUpdates: 0, reason: 'push_disabled' };

  return {
    queued: emailResult.queued + pushResult.queued + mobilePushV2Result.queued,
    updated: emailResult.updated + pushResult.updated + mobilePushV2Result.updated,
    usageUpdates: emailResult.usageUpdates + pushResult.usageUpdates + mobilePushV2Result.usageUpdates,
    push: pushResult,
    email: emailResult,
    mobilePushV2: mobilePushV2Result
  };
}

function isMissingAdminAccessOverrideRelationCode(code: string | null | undefined) {
  return code === '42P01' || code === 'PGRST205';
}

function isSubscriptionActiveStatus(status?: string | null) {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'trialing';
}

async function loadPremiumAccessByUserIds(supabase: ReturnType<typeof createSupabaseAdminClient>, userIds: string[]) {
  if (!userIds.length) {
    return new Map<string, boolean>();
  }

  const [subsRes, profilesRes, adminOverridesRes] = await Promise.all([
    supabase.from('subscriptions').select('user_id, status').in('user_id', userIds),
    supabase.from('profiles').select('user_id, role').in('user_id', userIds),
    supabase.from('admin_access_overrides').select('user_id, effective_tier_override').in('user_id', userIds)
  ]);
  if (subsRes.error) throw subsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  if (adminOverridesRes.error) {
    const code = typeof adminOverridesRes.error.code === 'string' ? adminOverridesRes.error.code : '';
    if (isMissingAdminAccessOverrideRelationCode(code)) {
      console.warn('admin_access_overrides table unavailable; continuing without admin access overrides');
    } else {
      throw adminOverridesRes.error;
    }
  }

  const subscriptionByUser = new Map<string, SubscriptionStatusRow>();
  ((subsRes.data || []) as SubscriptionStatusRow[]).forEach((row) => subscriptionByUser.set(row.user_id, row));

  const roleByUser = new Map<string, string | null>();
  ((profilesRes.data || []) as ProfileRoleRow[]).forEach((row) => roleByUser.set(row.user_id, row.role ?? null));

  const adminOverrideByUser = new Map<string, 'anon' | 'premium' | null>();
  const adminOverrideRows = adminOverridesRes.error ? [] : ((adminOverridesRes.data || []) as AdminAccessOverrideRow[]);
  adminOverrideRows.forEach((row) => {
    const override = String(row.effective_tier_override || '').trim().toLowerCase();
    adminOverrideByUser.set(row.user_id, override === 'anon' || override === 'premium' ? (override as 'anon' | 'premium') : null);
  });

  const premiumAccessByUser = new Map<string, boolean>();
  userIds.forEach((userId) => {
    const adminOverride = adminOverrideByUser.get(userId) ?? null;
    const isAdmin = roleByUser.get(userId) === 'admin';
    const hasPremiumAccess =
      adminOverride != null ? adminOverride === 'premium' : isAdmin || isSubscriptionActiveStatus(subscriptionByUser.get(userId)?.status);
    premiumAccessByUser.set(userId, hasPremiumAccess);
  });

  return premiumAccessByUser;
}

async function dispatchPushNotifications(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    settings,
    now,
    dayStart,
    monthStart,
    pushEligibleUserIds,
    webPushEligibleUserIds,
    prefsByUser,
    quietByUser,
    timeZoneByUser
  }: {
    settings: Settings;
    now: Date;
    dayStart: string;
    monthStart: string;
    pushEligibleUserIds: string[];
    webPushEligibleUserIds: string[];
    prefsByUser: Map<string, PrefsRow>;
    quietByUser: Map<string, { enabled: boolean; start: string | null; end: string | null }>;
    timeZoneByUser: Map<string, string>;
  }
): Promise<DispatchResult> {
  void supabase;
  void settings;
  void now;
  void dayStart;
  void monthStart;
  void pushEligibleUserIds;
  void webPushEligibleUserIds;
  void prefsByUser;
  void quietByUser;
  void timeZoneByUser;
  return { queued: 0, updated: 0, usageUpdates: 0, reason: 'retired_native_mobile_push_only' };
}

async function dispatchMobilePushV2(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    settings,
    now
  }: {
    settings: Settings;
    now: Date;
  }
): Promise<DispatchResult> {
  const { data: installationsRes, error: installationsError } = await supabase
    .from('notification_push_destinations_v3')
    .select('owner_kind, user_id, installation_id, platform, delivery_kind, is_active')
    .eq('delivery_kind', 'mobile_push')
    .eq('is_active', true);
  if (installationsError) throw installationsError;

  const installations = (installationsRes || []) as MobilePushInstallationRowV2[];
  const guestInstallationIds = Array.from(
    new Set(installations.filter((row) => row.owner_kind === 'guest').map((row) => String(row.installation_id || '').trim()).filter(Boolean))
  );
  const userIds = Array.from(
    new Set(
      installations
        .filter((row) => row.owner_kind === 'user' && row.user_id)
        .map((row) => String(row.user_id || '').trim())
        .filter(Boolean)
    )
  );
  const premiumAccessByUser = await loadPremiumAccessByUserIds(supabase, userIds);

  if (!guestInstallationIds.length && !userIds.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_mobile_push_installations' };
  }

  const [guestRulesRes, userRulesRes, launchesRes] = await Promise.all([
    guestInstallationIds.length
      ? supabase
          .from('notification_rules_v3')
          .select(
            'id, owner_kind, user_id, installation_id, intent, visible_in_following, enabled, scope_kind, scope_key, state, launch_id, provider, rocket_id, pad_key, launch_site, filter_preset_id, filters, tier, channels, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, launch_filter_presets(filters)'
          )
          .eq('owner_kind', 'guest')
          .eq('enabled', true)
          .contains('channels', ['push'])
          .in('installation_id', guestInstallationIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? supabase
          .from('notification_rules_v3')
          .select(
            'id, owner_kind, user_id, installation_id, intent, visible_in_following, enabled, scope_kind, scope_key, state, launch_id, provider, rocket_id, pad_key, launch_site, filter_preset_id, filters, tier, channels, timezone, prelaunch_offsets_minutes, daily_digest_local_time, status_change_types, notify_net_change, launch_filter_presets(filters)'
          )
          .eq('owner_kind', 'user')
          .eq('enabled', true)
          .contains('channels', ['push'])
          .in('user_id', userIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('launches')
      .select(
        'id, name, net, net_precision, status_name, tier_auto, tier_override, ll2_pad_id, provider, pad_name, pad_location_name, pad_short_code, pad_state, pad_country_code'
      )
      .eq('hidden', false)
      .gte('net', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
      .order('net', { ascending: true })
      .limit(3000)
  ]);
  if (guestRulesRes.error) throw guestRulesRes.error;
  if (userRulesRes.error) throw userRulesRes.error;
  if (launchesRes.error) throw launchesRes.error;

  const launches: LaunchRow[] = (launchesRes.data || []) as any;
  const rules = filterDeliverableMobilePushRules(
    [...((guestRulesRes.data || []) as MobilePushRuleRowV2[]), ...((userRulesRes.data || []) as MobilePushRuleRowV2[])],
    launches,
    now,
    premiumAccessByUser
  );
  if (!rules.length) {
    return { queued: 0, updated: 0, usageUpdates: 0, reason: 'no_mobile_push_rules' };
  }

  const launchById = new Map<string, LaunchRow>();
  launches.forEach((launch) => launchById.set(launch.id, launch));
  const explicitLaunchIds = Array.from(
    new Set(rules.filter((rule) => rule.scope_kind === 'launch').map((rule) => String(rule.launch_id || '').trim()).filter(Boolean))
  );
  const allLaunchIds = Array.from(new Set([...launches.map((launch) => launch.id), ...explicitLaunchIds]));
  const updatesSince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [updatesRes, existingOutboxRes] = await Promise.all([
    allLaunchIds.length
      ? supabase
          .from('launch_updates')
          .select('id, launch_id, changed_fields, old_values, new_values, detected_at')
          .gte('detected_at', updatesSince)
          .in('launch_id', allLaunchIds)
          .order('detected_at', { ascending: false })
          .limit(2000)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('mobile_push_outbox_v2')
      .select('id, owner_kind, user_id, installation_id, launch_id, event_type, scheduled_for, status, payload')
      .gte('scheduled_for', updatesSince)
  ]);
  if (updatesRes.error) throw updatesRes.error;
  if (existingOutboxRes.error) throw existingOutboxRes.error;

  const existingOutbox = (existingOutboxRes.data || []) as MobilePushOutboxRowV2[];
  const existingUpdateKeys = new Set<string>();
  const existingUpdateRowsByKey = new Map<string, MobilePushOutboxRowV2>();
  const existingByKey = new Map<string, MobilePushOutboxRowV2>();
  existingOutbox.forEach((row) => {
    const key = mobilePushOutboxKey(row.owner_kind, row.user_id, row.installation_id, row.launch_id ?? null, String(row.event_type || ''));
    if (key) {
      const existing = existingByKey.get(key);
      if (!existing || existing.status !== 'queued' || row.status === 'queued') {
        existingByKey.set(key, row);
      }
    }

    const updateId = readUpdateId(row.payload || null);
    if (!updateId) return;
    const eventType = String(row.event_type || '');
    if (!isChangeEventType(eventType)) return;
    const changeKey = mobilePushOutboxUpdateKey(row.owner_kind, row.user_id, row.installation_id, row.launch_id ?? null, eventType, updateId);
    if (changeKey) {
      existingUpdateKeys.add(changeKey);
      const existing = existingUpdateRowsByKey.get(changeKey);
      if (!existing || existing.status !== 'queued' || row.status === 'queued') {
        existingUpdateRowsByKey.set(changeKey, row);
      }
    }
  });

  const matchedRulesByLaunch = new Map<string, MobilePushRuleRowV2[]>();
  const digestLaunchesByRule = new Map<string, LaunchRow[]>();

  for (const rule of rules) {
    for (const launch of launches) {
      if (!launchMatchesMobilePushRule(launch, rule)) continue;
      const existing = matchedRulesByLaunch.get(launch.id) || [];
      existing.push(rule);
      matchedRulesByLaunch.set(launch.id, existing);

      if (normalizeLocalTime(rule.daily_digest_local_time)) {
        const digestKey = mobileRuleIdentity(rule);
        const list = digestLaunchesByRule.get(digestKey) || [];
        list.push(launch);
        digestLaunchesByRule.set(digestKey, list);
      }
    }
  }

  const toInsert: any[] = [];
  const toUpdate = new Map<number, { id: number; scheduled_for: string; payload: Record<string, unknown> }>();

  for (const launch of launches) {
    const matchedRules = matchedRulesByLaunch.get(launch.id);
    if (!matchedRules?.length) continue;

    for (const rule of matchedRules) {
      const timeZone = normalizeTimeZone(rule.timezone || 'UTC');
      for (const offset of normalizeOffsetsForRule(rule.prelaunch_offsets_minutes)) {
        const eventAt = new Date(new Date(launch.net).getTime() - offset * 60 * 1000);
        const scheduledFor = resolveScheduledFor(eventAt, now, settings.push_batch_window_minutes);
        if (!scheduledFor) continue;

        const eventType = `t_minus_${offset}`;
        const key = mobilePushOutboxKey(rule.owner_kind, rule.user_id, rule.installation_id, launch.id, eventType);
        const existing = key ? existingByKey.get(key) : null;
        if (existing && existing.status === 'queued') {
          const payload = attachMobilePushPolicyMetadata(
            makeOutboxPayload(launch, { type: eventType, at: eventAt }, timeZone, settings.push_max_chars),
            rule,
            eventType
          );
          const existingAt = new Date(existing.scheduled_for);
          const diffMs = Number.isFinite(existingAt.getTime())
            ? Math.abs(existingAt.getTime() - scheduledFor.getTime())
            : Number.POSITIVE_INFINITY;
          if (diffMs > 30_000 || mobilePushPayloadNeedsPolicySync(existing.payload || null, rule, eventType)) {
            queueMobilePushOutboxUpdate(toUpdate, Number(existing.id), scheduledFor.toISOString(), payload);
          }
          continue;
        }

        toInsert.push({
          owner_kind: rule.owner_kind,
          user_id: rule.owner_kind === 'user' ? rule.user_id : null,
          installation_id: rule.owner_kind === 'guest' ? rule.installation_id : null,
          launch_id: launch.id,
          channel: 'push',
          event_type: eventType,
          payload: attachMobilePushPolicyMetadata(
            makeOutboxPayload(launch, { type: eventType, at: eventAt }, timeZone, settings.push_max_chars),
            rule,
            eventType
          ),
          status: 'queued',
          scheduled_for: scheduledFor.toISOString(),
          created_at: now.toISOString()
        });
      }
    }
  }

  for (const rule of rules) {
    const digestTime = normalizeLocalTime(rule.daily_digest_local_time);
    if (!digestTime) continue;
    const digestLaunches = (digestLaunchesByRule.get(mobileRuleIdentity(rule)) || []).sort((left, right) => Date.parse(left.net) - Date.parse(right.net));
    if (!digestLaunches.length) continue;

    const timeZone = normalizeTimeZone(rule.timezone || 'UTC');
    const digestWindow = resolveNextDailyDigestWindow(now, timeZone, digestTime);
    const matchingLaunches = digestLaunches.filter((launch) => {
      const launchMs = Date.parse(launch.net);
      return Number.isFinite(launchMs) && launchMs >= digestWindow.dayStart.getTime() && launchMs < digestWindow.dayEnd.getTime();
    });
    if (!matchingLaunches.length) continue;

    const eventType = `daily_digest_${digestWindow.dateKey}_${rule.id}`;
    const key = mobilePushOutboxKey(rule.owner_kind, rule.user_id, rule.installation_id, null, eventType);
    const existing = key ? existingByKey.get(key) : null;
    if (existing) {
      if (existing.status === 'queued') {
        const payload = attachMobilePushPolicyMetadata(
          buildMobileDailyDigestPayload(matchingLaunches, timeZone, digestWindow.dateKey, settings.push_max_chars),
          rule,
          eventType
        );
        if (mobilePushPayloadNeedsPolicySync(existing.payload || null, rule, eventType)) {
          queueMobilePushOutboxUpdate(toUpdate, Number(existing.id), existing.scheduled_for, payload);
        }
      }
      continue;
    }

    toInsert.push({
      owner_kind: rule.owner_kind,
      user_id: rule.owner_kind === 'user' ? rule.user_id : null,
      installation_id: rule.owner_kind === 'guest' ? rule.installation_id : null,
      launch_id: null,
      channel: 'push',
      event_type: eventType,
      payload: attachMobilePushPolicyMetadata(
        buildMobileDailyDigestPayload(matchingLaunches, timeZone, digestWindow.dateKey, settings.push_max_chars),
        rule,
        eventType
      ),
      status: 'queued',
      scheduled_for: digestWindow.scheduledFor.toISOString(),
      created_at: now.toISOString()
    });
  }

  const updates: LaunchUpdateRow[] = (updatesRes.data || []) as any;
  for (const update of updates) {
    const launch = launchById.get(update.launch_id);
    if (!launch) continue;

    const changed = Array.isArray(update.changed_fields) ? update.changed_fields.map((field) => String(field)) : [];
    const statusChanged = changed.some((field) => STATUS_CHANGE_FIELDS.has(field));
    const timingChanged = changed.some((field) => TIMING_CHANGE_FIELDS.has(field));
    if (!statusChanged && !timingChanged) continue;

    const matchedRules = matchedRulesByLaunch.get(update.launch_id);
    if (!matchedRules?.length) continue;

    const nextStatus = normalizeLaunchStatusKey(readFirstValueString(update.new_values, ['status_name', 'status_abbrev']) || launch.status_name);

    for (const rule of matchedRules) {
      const wantsStatus = statusChanged && ruleWantsStatusChange(rule, nextStatus);
      const wantsTiming = timingChanged && rule.notify_net_change === true;
      if (!wantsStatus && !wantsTiming) continue;

      const eventType = wantsStatus && wantsTiming ? 'status_net_change' : wantsStatus ? 'status_change' : 'net_change';
      const changeKey = mobilePushOutboxUpdateKey(rule.owner_kind, rule.user_id, rule.installation_id, launch.id, eventType, update.id);
      const payload = attachMobilePushPolicyMetadata(
        makeChangeOutboxPayload(launch, eventType, normalizeTimeZone(rule.timezone || 'UTC'), update, settings.push_max_chars),
        rule,
        eventType
      );
      const existingChangeRow = changeKey ? existingUpdateRowsByKey.get(changeKey) : null;
      if (existingChangeRow) {
        if (existingChangeRow.status === 'queued' && mobilePushPayloadNeedsPolicySync(existingChangeRow.payload || null, rule, eventType)) {
          queueMobilePushOutboxUpdate(toUpdate, Number(existingChangeRow.id), existingChangeRow.scheduled_for, payload);
        }
        continue;
      }

      if (changeKey && existingUpdateKeys.has(changeKey)) continue;

      toInsert.push({
        owner_kind: rule.owner_kind,
        user_id: rule.owner_kind === 'user' ? rule.user_id : null,
        installation_id: rule.owner_kind === 'guest' ? rule.installation_id : null,
        launch_id: launch.id,
        channel: 'push',
        event_type: eventType,
        payload,
        status: 'queued',
        scheduled_for: now.toISOString(),
        created_at: now.toISOString()
      });
      if (changeKey) existingUpdateKeys.add(changeKey);
    }
  }

  if (toInsert.length) {
    const { error } = await supabase.from('mobile_push_outbox_v2').insert(toInsert);
    if (error) throw error;
  }

  if (toUpdate.size) {
    for (const row of toUpdate.values()) {
      if (!Number.isFinite(row.id)) continue;
      const { error } = await supabase.from('mobile_push_outbox_v2').update({ scheduled_for: row.scheduled_for, payload: row.payload }).eq('id', row.id);
      if (error) console.warn('mobile_push_outbox_v2 reschedule warning', error.message);
    }
  }

  return {
    queued: toInsert.length,
    updated: toUpdate.size,
    usageUpdates: 0,
    reason: toInsert.length || toUpdate.size ? undefined : 'no_mobile_push_notifications'
  };
}

function hasPremiumMobilePushAccess(rule: MobilePushRuleRowV2, premiumAccessByUser: Map<string, boolean>) {
  if (rule.owner_kind !== 'user') {
    return false;
  }
  const userId = String(rule.user_id || '').trim();
  return userId.length > 0 && premiumAccessByUser.get(userId) === true;
}

function isBasicMobilePushScopeKind(scopeKind: string): scopeKind is 'all_us' | 'launch' {
  return scopeKind === 'all_us' || scopeKind === 'launch';
}

function basicMobilePushOwnerKey(rule: MobilePushRuleRowV2) {
  return rule.owner_kind === 'user' ? `user:${String(rule.user_id || '').trim().toLowerCase()}` : `guest:${String(rule.installation_id || '').trim().toLowerCase()}`;
}

function normalizeBasicRuleOffsets(scopeKind: 'all_us' | 'launch', values: number[] | null | undefined) {
  const allowedOffsets = new Set<number>([1, 5, 10, 60]);
  const maxOffsets = scopeKind === 'launch' ? 2 : 1;
  const fallbackOffsets = scopeKind === 'launch' ? [10, 60] : [60];
  const nextOffsets = normalizeOffsetsForRule(values)
    .filter((value) => allowedOffsets.has(value))
    .slice(0, maxOffsets);
  return nextOffsets.length ? nextOffsets : fallbackOffsets;
}

function applyBasicMobilePushRulePolicy(rule: MobilePushRuleRowV2): MobilePushRuleRowV2 {
  if (!isBasicMobilePushScopeKind(rule.scope_kind)) {
    return rule;
  }

  return {
    ...rule,
    prelaunch_offsets_minutes: normalizeBasicRuleOffsets(rule.scope_kind, rule.prelaunch_offsets_minutes),
    daily_digest_local_time: null,
    status_change_types: [],
    notify_net_change: false
  };
}

function filterDeliverableMobilePushRules(
  rules: MobilePushRuleRowV2[],
  launches: LaunchRow[],
  now: Date,
  premiumAccessByUser: Map<string, boolean>
) {
  const launchById = new Map<string, LaunchRow>();
  launches.forEach((launch) => launchById.set(launch.id, launch));

  const retainedBasicLaunchIds = new Map<string, string>();
  const basicLaunchCandidates = new Map<string, Array<{ launchId: string; netMs: number }>>();

  for (const rule of rules) {
    const basicOnlyOwner = rule.owner_kind === 'guest' || !hasPremiumMobilePushAccess(rule, premiumAccessByUser);
    if (!basicOnlyOwner || rule.scope_kind !== 'launch') {
      continue;
    }
    const ownerKey = basicMobilePushOwnerKey(rule);
    const launchId = String(rule.launch_id || '').trim();
    const launch = launchById.get(launchId);
    const netMs = launch ? Date.parse(launch.net) : Number.NaN;
    if (!ownerKey || !launch || !Number.isFinite(netMs) || netMs <= now.getTime()) {
      continue;
    }
    const next = basicLaunchCandidates.get(ownerKey) || [];
    next.push({ launchId, netMs });
    basicLaunchCandidates.set(ownerKey, next);
  }

  basicLaunchCandidates.forEach((candidates, ownerKey) => {
    candidates.sort((left, right) => left.netMs - right.netMs);
    if (candidates[0]) {
      retainedBasicLaunchIds.set(ownerKey, candidates[0].launchId);
    }
  });

  return rules
    .map((rule) => {
      const basicOnlyOwner = rule.owner_kind === 'guest' || !hasPremiumMobilePushAccess(rule, premiumAccessByUser);
      if (!basicOnlyOwner) {
        return rule;
      }

      if (!isBasicMobilePushScopeKind(rule.scope_kind)) {
        return null;
      }

      if (rule.scope_kind === 'launch') {
        const ownerKey = basicMobilePushOwnerKey(rule);
        const launchId = String(rule.launch_id || '').trim();
        if (!ownerKey || !launchId) {
          return null;
        }

        const launch = launchById.get(launchId);
        if (!launch) {
          return null;
        }

        const netMs = Date.parse(launch.net);
        if (!Number.isFinite(netMs) || netMs <= now.getTime()) {
          return null;
        }

        const retainedLaunchId = retainedBasicLaunchIds.get(ownerKey);
        if (retainedLaunchId !== launchId) {
          return null;
        }
      }

      return applyBasicMobilePushRulePolicy(rule);
    })
    .filter((rule): rule is MobilePushRuleRowV2 => rule !== null);
}

function normalizeOffsetsForRule(values: number[] | null | undefined) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => Math.trunc(Number(value))).filter((value) => Number.isInteger(value) && value >= 0))).sort(
    (left, right) => left - right
  );
}

function firstPresetFilters(value: MobilePushRuleRowV2['launch_filter_presets']) {
  if (Array.isArray(value)) {
    return value[0]?.filters ?? null;
  }
  return value?.filters ?? null;
}

function launchMatchesMobilePushRule(launch: LaunchRow, rule: MobilePushRuleRowV2) {
  if (rule.scope_kind === 'all_us') {
    return US_PAD_COUNTRY_CODES.has(String(launch.pad_country_code || '').trim().toUpperCase());
  }
  if (rule.scope_kind === 'state') {
    return normalizeComparableText(launch.pad_state) === normalizeComparableText(rule.state);
  }
  if (rule.scope_kind === 'launch') {
    return launch.id === String(rule.launch_id || '').trim();
  }
  if (rule.scope_kind === 'all_launches') {
    return true;
  }
  if (rule.scope_kind === 'preset') {
    return launchMatchesFilterPreset(launch, firstPresetFilters(rule.launch_filter_presets));
  }
  if (rule.scope_kind === 'provider') {
    return normalizeComparableText(launch.provider) === normalizeComparableText(rule.provider);
  }
  if (rule.scope_kind === 'pad') {
    const padKey = String(rule.pad_key || '').trim();
    if (!padKey) return false;
    if (padKey.startsWith('ll2:')) {
      return String(launch.ll2_pad_id || '') === padKey.slice(4);
    }
    return normalizeComparableText(launch.pad_short_code) === normalizeComparableText(padKey.replace(/^code:/, ''));
  }
  if (rule.scope_kind === 'rocket') {
    return false;
  }
  if (rule.scope_kind === 'launch_site') {
    return normalizeComparableText(launch.pad_location_name) === normalizeComparableText(rule.launch_site);
  }
  if (rule.scope_kind === 'tier') {
    const tier = String(launch.tier_override || launch.tier_auto || '').trim().toLowerCase();
    return tier.length > 0 && tier === String(rule.tier || '').trim().toLowerCase();
  }
  return false;
}

function ruleWantsStatusChange(rule: MobilePushRuleRowV2, nextStatus: string) {
  const types = Array.isArray(rule.status_change_types)
    ? Array.from(new Set(rule.status_change_types.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)))
    : [];
  if (!types.length) return false;
  if (types.includes('any')) return true;
  return types.includes(nextStatus);
}

function requiresPremiumForMobilePushEvent(rule: MobilePushRuleRowV2, eventType: string) {
  if (rule.owner_kind !== 'user') {
    return false;
  }

  if (!isBasicMobilePushScopeKind(rule.scope_kind)) {
    return true;
  }

  const normalizedEventType = String(eventType || '').trim();
  if (normalizedEventType.startsWith('daily_digest_') || normalizedEventType.startsWith('local_time_') || CHANGE_EVENT_TYPES.has(normalizedEventType)) {
    return true;
  }

  if (normalizedEventType.startsWith('t_minus_')) {
    const offsetMinutes = Number(normalizedEventType.slice('t_minus_'.length));
    return !Number.isFinite(offsetMinutes) || !new Set<number>([1, 5, 10, 60]).has(offsetMinutes);
  }

  return true;
}

function attachMobilePushPolicyMetadata(payload: Record<string, unknown>, rule: MobilePushRuleRowV2, eventType: string) {
  return {
    ...payload,
    source_rule_id: rule.id,
    source_scope_kind: rule.scope_kind,
    premium_required: requiresPremiumForMobilePushEvent(rule, eventType)
  };
}

function mobilePushPayloadNeedsPolicySync(
  payload: Record<string, unknown> | null | undefined,
  rule: MobilePushRuleRowV2,
  eventType: string
) {
  const expectedPremiumRequired = requiresPremiumForMobilePushEvent(rule, eventType);
  const payloadRuleId = typeof payload?.source_rule_id === 'string' ? String(payload.source_rule_id).trim() : '';
  const payloadScopeKind = typeof payload?.source_scope_kind === 'string' ? String(payload.source_scope_kind).trim() : '';
  return (
    typeof payload?.premium_required !== 'boolean' ||
    payload.premium_required !== expectedPremiumRequired ||
    payloadRuleId !== rule.id ||
    payloadScopeKind !== rule.scope_kind
  );
}

function queueMobilePushOutboxUpdate(
  updates: Map<number, { id: number; scheduled_for: string; payload: Record<string, unknown> }>,
  id: number,
  scheduledFor: string,
  payload: Record<string, unknown>
) {
  if (!Number.isFinite(id)) return;
  updates.set(id, { id, scheduled_for: scheduledFor, payload });
}

function mobileOwnerKey(ownerKind: 'guest' | 'user', userId: string | null | undefined, installationId: string | null | undefined) {
  return ownerKind === 'user' ? `user:${String(userId || '').trim()}` : `guest:${String(installationId || '').trim()}`;
}

function mobilePushOutboxKey(
  ownerKind: 'guest' | 'user',
  userId: string | null | undefined,
  installationId: string | null | undefined,
  launchId: string | null,
  eventType: string
) {
  const ownerKey = mobileOwnerKey(ownerKind, userId, installationId);
  const normalizedLaunchId = launchId ? String(launchId).trim() : 'none';
  const normalizedEventType = String(eventType || '').trim();
  if (!ownerKey || !normalizedEventType) return null;
  return `${ownerKey}:${normalizedLaunchId}:push:${normalizedEventType}`;
}

function mobilePushOutboxUpdateKey(
  ownerKind: 'guest' | 'user',
  userId: string | null | undefined,
  installationId: string | null | undefined,
  launchId: string | null,
  eventType: string,
  updateId: number | string
) {
  const base = mobilePushOutboxKey(ownerKind, userId, installationId, launchId, eventType);
  if (!base) return null;
  const normalizedUpdateId =
    typeof updateId === 'number'
      ? Number.isFinite(updateId)
        ? String(updateId)
        : ''
      : String(updateId || '').trim();
  if (!normalizedUpdateId) return null;
  return `${base}:update:${normalizedUpdateId}`;
}

function resolveNextDailyDigestWindow(now: Date, timeZone: string, localTime: string) {
  const [hourRaw, minuteRaw] = localTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const parts = getTimeZoneParts(now, timeZone);
  const today = { year: parts.year, month: parts.month, day: parts.day };
  const target = parts.hour < hour || (parts.hour === hour && parts.minute < minute) ? today : addDaysLocal(today, timeZone, 1);
  const scheduledFor = zonedTimeToUtcDate({ ...target, hour, minute }, timeZone);
  const dayStart = zonedTimeToUtcDate({ ...target, hour: 0, minute: 0 }, timeZone);
  const nextDay = addDaysLocal(target, timeZone, 1);
  const dayEnd = zonedTimeToUtcDate({ ...nextDay, hour: 0, minute: 0 }, timeZone);
  const dateKey = `${target.year}${pad2(target.month)}${pad2(target.day)}`;
  return { scheduledFor, dayStart, dayEnd, dateKey };
}

function buildMobileDailyDigestPayload(launches: LaunchRow[], timeZone: string, dateKey: string, maxChars?: number) {
  const launchCount = launches.length;
  const firstLaunch = launches[0];
  const firstTime = firstLaunch ? formatLocalTimeLabel(firstLaunch.net, timeZone) : '';
  let message =
    launchCount === 1 && firstLaunch
      ? `${firstLaunch.name} matches your alert rule today. Launch at ${firstTime}.`
      : `${launchCount} launches match your alert rule today. First launch at ${firstTime}.`;
  message = prefixNotificationWithBrand(message);
  if (maxChars && message.length > maxChars) {
    message = message.slice(0, maxChars - 3) + '...';
  }
  return {
    title: 'Today’s launch alerts',
    message,
    url: '/preferences',
    date_key: dateKey,
    launch_ids: launches.map((launch) => launch.id)
  };
}

function mobileRuleIdentity(rule: MobilePushRuleRowV2) {
  if (rule.owner_kind === 'user') {
    return `user:${String(rule.user_id || '').trim()}:${rule.id}`;
  }
  return `guest:${String(rule.installation_id || '').trim()}:${rule.id}`;
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
  void supabase;
  void now;
  void monthStart;
  void prefs;
  return { queued: 0, updated: 0, usageUpdates: 0, reason: 'launch_day_email_retired' };
}

const STATUS_CHANGE_FIELDS = new Set(['status_id', 'status_name', 'status_abbrev']);
const TIMING_CHANGE_FIELDS = new Set(['net', 'net_precision', 'window_start', 'window_end']);
const CHANGE_EVENT_TYPES = new Set(['status_change', 'net_change', 'status_net_change']);

const ALLOWED_T_MINUS_MINUTES = [5, 10, 15, 20, 30, 45, 60, 120] as const;
const US_PAD_COUNTRY_CODES = new Set(['US', 'USA']);

function normalizeAlertRuleRow(row: any): AlertRuleRow | null {
  const kind = String(row?.kind || '').trim();
  const userId = String(row?.user_id || '').trim();
  if (!userId) return null;

  const presetRelation = Array.isArray(row?.launch_filter_presets) ? row.launch_filter_presets[0] : row?.launch_filter_presets;
  const filters =
    presetRelation && typeof presetRelation === 'object' && presetRelation.filters && typeof presetRelation.filters === 'object'
      ? (presetRelation.filters as Record<string, unknown>)
      : null;

  if (kind === 'region_us') {
    return { user_id: userId, kind: 'region_us' };
  }
  if (kind === 'state') {
    const state = normalizeComparableText(row?.state);
    if (!state) return null;
    return { user_id: userId, kind: 'state', state };
  }
  if (kind === 'filter_preset') {
    const presetId = String(row?.filter_preset_id || '').trim();
    if (!presetId) return null;
    return { user_id: userId, kind: 'filter_preset', filter_preset_id: presetId, filters };
  }
  if (kind === 'follow') {
    const followRuleType = String(row?.follow_rule_type || '').trim() as AlertRuleRow['follow_rule_type'];
    const followRuleValue = String(row?.follow_rule_value || '').trim();
    if (!followRuleType || !followRuleValue) return null;
    return {
      user_id: userId,
      kind: 'follow',
      follow_rule_type: followRuleType,
      follow_rule_value: followRuleValue
    };
  }

  return null;
}

function buildDefaultPushAlertPref(userId: string, pref: PrefsRow | undefined, timeZone: string | undefined): LaunchPrefRow | null {
  if (!pref) return null;

  const tMinusMinutes: number[] = [];
  if (pref.notify_t_minus_60 !== false) tMinusMinutes.push(60);
  if (pref.notify_t_minus_10 !== false) tMinusMinutes.push(10);
  if (tMinusMinutes.length < 2 && pref.notify_t_minus_5 === true) tMinusMinutes.push(5);

  const notifyStatusChange = pref.notify_status_change !== false;
  const notifyNetChange = pref.notify_net_change !== false;
  if (!tMinusMinutes.length && !notifyStatusChange && !notifyNetChange) {
    return null;
  }

  return {
    user_id: userId,
    launch_id: '',
    channel: 'push',
    mode: 't_minus',
    timezone: safeTimeZone(timeZone),
    t_minus_minutes: tMinusMinutes.slice(0, 2),
    local_times: [],
    notify_status_change: notifyStatusChange,
    notify_net_change: notifyNetChange
  };
}

function launchMatchesAlertRule(launch: LaunchRow, rule: AlertRuleRow) {
  if (rule.kind === 'region_us') {
    return US_PAD_COUNTRY_CODES.has(String(launch.pad_country_code || '').trim().toUpperCase());
  }

  if (rule.kind === 'state') {
    return normalizeComparableText(launch.pad_state) === rule.state;
  }

  if (rule.kind === 'filter_preset') {
    return launchMatchesFilterPreset(launch, rule.filters || null);
  }

  return launchMatchesFollowRule(launch, rule.follow_rule_type, rule.follow_rule_value);
}

function launchMatchesFilterPreset(launch: LaunchRow, filters: Record<string, unknown> | null) {
  if (!filters) return false;

  const region = String(filters.region || '').trim().toLowerCase();
  if (region === 'us' && !US_PAD_COUNTRY_CODES.has(String(launch.pad_country_code || '').trim().toUpperCase())) return false;
  if (region === 'non-us' && US_PAD_COUNTRY_CODES.has(String(launch.pad_country_code || '').trim().toUpperCase())) return false;

  const location = normalizeComparableText(filters.location);
  if (location && normalizeComparableText(launch.pad_location_name) !== location) return false;

  const state = normalizeComparableText(filters.state);
  if (state && normalizeComparableText(launch.pad_state) !== state) return false;

  const pad = normalizeComparableText(filters.pad);
  if (pad) {
    const shortCode = normalizeComparableText(launch.pad_short_code);
    const padName = normalizeComparableText(launch.pad_name);
    if (pad !== shortCode && pad !== padName) return false;
  }

  const provider = normalizeComparableText(filters.provider);
  if (provider && normalizeComparableText(launch.provider) !== provider) return false;

  const status = String(filters.status || '').trim().toLowerCase();
  if (status && status !== 'all' && normalizeLaunchStatusKey(launch.status_name) !== status) return false;

  return true;
}

function launchMatchesFollowRule(
  launch: LaunchRow,
  ruleType: AlertRuleRow['follow_rule_type'],
  ruleValue: string | null | undefined
) {
  const normalizedRuleValue = String(ruleValue || '').trim();
  if (!ruleType || !normalizedRuleValue) return false;

  if (ruleType === 'launch') {
    return launch.id === normalizedRuleValue;
  }

  if (ruleType === 'provider') {
    return normalizeComparableText(launch.provider) === normalizeComparableText(normalizedRuleValue);
  }

  if (ruleType === 'tier') {
    const launchTier = String(launch.tier_override || launch.tier_auto || '').trim().toLowerCase();
    return launchTier === normalizedRuleValue.toLowerCase();
  }

  const lower = normalizedRuleValue.toLowerCase();
  if (lower.startsWith('ll2:')) {
    return Number(launch.ll2_pad_id || 0) === Number(lower.slice(4));
  }
  if (lower.startsWith('code:')) {
    return normalizeComparableText(launch.pad_short_code) === normalizeComparableText(normalizedRuleValue.slice(5));
  }
  if (/^\d+$/.test(normalizedRuleValue)) {
    return Number(launch.ll2_pad_id || 0) === Number(normalizedRuleValue);
  }

  return normalizeComparableText(launch.pad_short_code) === normalizeComparableText(normalizedRuleValue);
}

function normalizeComparableText(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeLaunchStatusKey(statusName: string | null | undefined) {
  const normalized = normalizeComparableText(statusName);
  if (normalized.includes('hold')) return 'hold';
  if (normalized.includes('scrub')) return 'scrubbed';
  if (normalized.includes('tbd')) return 'tbd';
  if (normalized.includes('go')) return 'go';
  return 'unknown';
}

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

function normalizeLocalTime(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
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
  const subject = `${NOTIFICATION_BRAND_NAME} launches today • ${subjectDate}`;

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
        <h1 style="margin:0 0 8px 0;font-size:18px">${escapeHtml(NOTIFICATION_BRAND_NAME)} launches today</h1>
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
  channel: 'email' | 'push',
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

  message = prefixNotificationWithBrand(message);

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

  message = prefixNotificationWithBrand(message);

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
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', ['push_enabled', 'push_monthly_cap_per_user', 'push_daily_cap_per_user', 'push_daily_cap_per_user_per_launch', 'push_min_gap_minutes', 'push_batch_window_minutes', 'push_max_chars']);
  if (error) {
    console.warn('loadSettings fallback to defaults', error.message);
    return DEFAULT_SETTINGS;
  }
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  (data || []).forEach((row: any) => {
    merged[row.key] = row.value;
  });

  return {
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
