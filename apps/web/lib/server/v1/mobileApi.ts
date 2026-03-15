import { createApiClient } from '@tminuszero/api-client';
import { z } from 'zod';
import {
  accountExportSchemaV1,
  alertRuleCreateSchemaV1,
  alertRuleEnvelopeSchemaV1,
  alertRulesSchemaV1,
  authContextUpsertSchemaV1,
  calendarFeedCreateSchemaV1,
  calendarFeedEnvelopeSchemaV1,
  calendarFeedsSchemaV1,
  calendarFeedUpdateSchemaV1,
  embedWidgetCreateSchemaV1,
  embedWidgetEnvelopeSchemaV1,
  embedWidgetsSchemaV1,
  embedWidgetUpdateSchemaV1,
  entitlementSchemaV1,
  filterPresetCreateSchemaV1,
  filterPresetEnvelopeSchemaV1,
  filterPresetsSchemaV1,
  filterPresetUpdateSchemaV1,
  launchDetailSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  launchNotificationPreferenceUpdateSchemaV1,
  marketingEmailSchemaV1,
  marketingEmailUpdateSchemaV1,
  notificationPreferencesSchemaV1,
  notificationPreferencesUpdateSchemaV1,
  privacyPreferencesSchemaV1,
  privacyPreferencesUpdateSchemaV1,
  profileSchemaV1,
  profileUpdateSchemaV1,
  pushDeliveryTestSchemaV1,
  pushDeviceRegistrationSchemaV1,
  pushDeviceRemovalSchemaV1,
  searchResponseSchemaV1,
  smsVerificationCheckSchemaV1,
  smsVerificationRequestSchemaV1,
  smsVerificationStatusSchemaV1,
  successResponseSchemaV1,
  viewerSessionSchemaV1,
  rssFeedCreateSchemaV1,
  rssFeedEnvelopeSchemaV1,
  rssFeedsSchemaV1,
  rssFeedUpdateSchemaV1,
  watchlistCreateSchemaV1,
  watchlistEnvelopeSchemaV1,
  watchlistRuleCreateSchemaV1,
  watchlistRuleEnvelopeSchemaV1,
  watchlistRuleTypeSchemaV1,
  watchlistUpdateSchemaV1,
  watchlistsSchemaV1
} from '@tminuszero/contracts';
import { loadArTrajectorySummary } from '@/lib/server/arTrajectory';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import { fetchLaunchFaaAirspace } from '@/lib/server/faaAirspace';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import { buildStatusFilterOrClause, parseLaunchStatusFilter } from '@/lib/server/launchStatus';
import { fetchLaunchDetailEnrichment } from '@/lib/server/launchDetailEnrichment';
import { parseSiteSearchInput, parseSiteSearchTypesParam, type SearchResultType } from '@tminuszero/domain';
import { loadSmsSystemEnabled } from '@/lib/server/smsSystem';
import { parseUsPhone } from '@/lib/notifications/phone';
import { buildSmsOptInConfirmationMessage } from '@/lib/notifications/smsProgram';
import {
  checkSmsVerification,
  isTwilioSmsConfigured,
  isTwilioVerifyConfigured,
  sendSmsMessage,
  startSmsVerification as startTwilioSmsVerification
} from '@/lib/notifications/twilio';
import { logSmsConsentEvent } from '@/lib/server/smsConsentEvents';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabasePublicClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { stripe } from '@/lib/api/stripe';
import { recordBillingEvent } from '@/lib/server/billingEvents';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { loadVersionedLaunchFeedPayload } from '@/lib/server/v1/launchFeedApi';

type PrivilegedClient =
  | ReturnType<typeof createSupabaseAccessTokenClient>
  | ReturnType<typeof createSupabaseAdminClient>
  | ReturnType<typeof createSupabaseServerClient>;

type SearchRpcRow = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  subtitle?: unknown;
  summary?: unknown;
  url?: unknown;
  image_url?: unknown;
  published_at?: unknown;
  badge?: unknown;
};

type RelatedNewsRow = {
  snapi_uid?: string | null;
  title?: string | null;
  summary?: string | null;
  url?: string | null;
  news_site?: string | null;
  image_url?: string | null;
  published_at?: string | null;
};

type RelatedEventRow = {
  ll2_event_id?: number | null;
  name?: string | null;
  description?: string | null;
  type_name?: string | null;
  date?: string | null;
  location_name?: string | null;
  url?: string | null;
  image_url?: string | null;
};

type AlertRuleRow = {
  id?: string | null;
  kind?: 'region_us' | 'state' | 'filter_preset' | 'follow' | null;
  state?: string | null;
  filter_preset_id?: string | null;
  follow_rule_type?: z.infer<typeof watchlistRuleTypeSchemaV1> | null;
  follow_rule_value?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  launch_filter_presets?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

const SAVED_INTEGRATION_LIMIT = 10;

const DEFAULT_NOTIFICATION_PREFERENCES = {
  pushEnabled: false,
  emailEnabled: true,
  smsEnabled: false,
  launchDayEmailEnabled: false,
  launchDayEmailProviders: [] as string[],
  launchDayEmailStates: [] as string[],
  quietHoursEnabled: false,
  quietStartLocal: null,
  quietEndLocal: null,
  smsVerified: false,
  smsPhone: null,
  smsSystemEnabled: null
};

const DEFAULT_LAUNCH_NOTIFICATION_PREFERENCE = {
  enabled: false,
  preference: {
    launchId: '',
    channel: 'push' as const,
    mode: 't_minus' as const,
    timezone: 'UTC',
    tMinusMinutes: [],
    localTimes: [],
    notifyStatusChange: false,
    notifyNetChange: false
  }
};

const pushDeviceRemovalInputSchema = pushDeviceRemovalSchemaV1.pick({
  platform: true,
  installationId: true
});

const tMinusMinutesSchema = z.array(z.number().int()).max(2).transform((values) =>
  Array.from(new Set(values)).sort((left, right) => left - right)
);

const localTimeSchema = z
  .string()
  .trim()
  .regex(/^(\d{2}):(\d{2})(?::\d{2})?$/)
  .transform((value) => value.slice(0, 5));

const deleteAccountSchema = z.object({
  confirm: z.string().min(1)
});

export class MobileApiRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'MobileApiRouteError';
    this.status = status;
    this.code = code;
  }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number) {
  const value = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function mapWatchlistRulePayload(data: any) {
  return watchlistRuleEnvelopeSchemaV1.shape.rule.parse({
    id: String(data?.id || ''),
    ruleType: data?.rule_type ?? 'launch',
    ruleValue: String(data?.rule_value || ''),
    createdAt: normalizeText(data?.created_at)
  });
}

function mapWatchlistPayload(data: any) {
  const rules = Array.isArray(data?.watchlist_rules) ? data.watchlist_rules.map(mapWatchlistRulePayload) : [];

  return watchlistEnvelopeSchemaV1.shape.watchlist.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    ruleCount: rules.length,
    createdAt: normalizeText(data?.created_at),
    rules
  });
}

function mapFilterPresetPayload(data: any) {
  return filterPresetEnvelopeSchemaV1.shape.preset.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    filters: (data?.filters as Record<string, unknown>) || {},
    isDefault: data?.is_default === true,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function normalizeAlertRuleStateValue(value: string) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function formatFollowAlertLabel(ruleType: z.infer<typeof watchlistRuleTypeSchemaV1>, ruleValue: string) {
  if (ruleType === 'provider') return `Followed provider: ${ruleValue}`;
  if (ruleType === 'pad') return `Followed pad: ${ruleValue}`;
  if (ruleType === 'tier') return `Followed tier: ${ruleValue}`;
  return `Followed launch: ${ruleValue}`;
}

function mapAlertRulePayload(data: AlertRuleRow) {
  const id = String(data?.id || '');
  const createdAt = normalizeText(data?.created_at);
  const updatedAt = normalizeText(data?.updated_at);
  const kind = data?.kind;

  if (kind === 'state') {
    const state = normalizeAlertRuleStateValue(String(data?.state || ''));
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      state,
      label: `State launches: ${state}`,
      createdAt,
      updatedAt
    });
  }

  if (kind === 'filter_preset') {
    const presetId = String(data?.filter_preset_id || '');
    const presetName = normalizeText(data?.launch_filter_presets?.name) ?? 'Saved filter';
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      presetId,
      label: `Saved filter: ${presetName}`,
      createdAt,
      updatedAt
    });
  }

  if (kind === 'follow') {
    const followRuleType = data?.follow_rule_type ?? 'provider';
    const followRuleValue = String(data?.follow_rule_value || '');
    return alertRuleEnvelopeSchemaV1.shape.rule.parse({
      id,
      kind,
      followRuleType,
      followRuleValue,
      label: formatFollowAlertLabel(followRuleType, followRuleValue),
      createdAt,
      updatedAt
    });
  }

  return alertRuleEnvelopeSchemaV1.shape.rule.parse({
    id,
    kind: 'region_us',
    label: 'All US launches',
    createdAt,
    updatedAt
  });
}

function mapCalendarFeedPayload(data: any) {
  return calendarFeedEnvelopeSchemaV1.shape.feed.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    filters: (data?.filters as Record<string, unknown>) || {},
    alarmMinutesBefore:
      typeof data?.alarm_minutes_before === 'number' && Number.isFinite(data.alarm_minutes_before)
        ? Math.trunc(data.alarm_minutes_before)
        : data?.alarm_minutes_before == null
          ? null
          : null,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function mapRssFeedPayload(data: any) {
  return rssFeedEnvelopeSchemaV1.shape.feed.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    filters: (data?.filters as Record<string, unknown>) || {},
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function mapEmbedWidgetPayload(data: any) {
  return embedWidgetEnvelopeSchemaV1.shape.widget.parse({
    id: String(data?.id || ''),
    name: String(data?.name || 'Untitled'),
    token: String(data?.token || ''),
    widgetType: String(data?.widget_type || 'next_launch_card'),
    filters: (data?.filters as Record<string, unknown>) || {},
    presetId: normalizeText(data?.preset_id),
    watchlistId: normalizeText(data?.watchlist_id),
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function buildManagedEventTypes(mode: 't_minus' | 'local_time', tMinusMinutes: number[], localTimes: string[]) {
  if (mode === 't_minus') {
    return tMinusMinutes.map((value) => `t_minus_${value}`);
  }
  return localTimes.map((value) => `local_time_${value.replace(':', '')}`);
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

function parseUuidOrThrow(value: string, code: string) {
  const normalized = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new MobileApiRouteError(400, code);
  }
  return normalized;
}

function normalizeWatchlistRule(
  ruleType: 'launch' | 'pad' | 'provider' | 'tier',
  ruleValue: string
): { rule_type: 'launch' | 'pad' | 'provider' | 'tier'; rule_value: string } | null {
  const trimmed = String(ruleValue || '').trim();
  if (!trimmed) return null;

  if (ruleType === 'launch') {
    try {
      return {
        rule_type: 'launch',
        rule_value: parseUuidOrThrow(trimmed, 'invalid_rule_value').toLowerCase()
      };
    } catch {
      return null;
    }
  }

  if (ruleType === 'pad') {
    const lower = trimmed.toLowerCase();
    if (lower.startsWith('ll2:')) {
      const rest = trimmed.slice(4).trim();
      if (!/^\d{1,10}$/.test(rest)) return null;
      return { rule_type: 'pad', rule_value: `ll2:${String(Number(rest))}` };
    }
    if (lower.startsWith('code:')) {
      const rest = trimmed.slice(5).trim();
      if (!rest) return null;
      return { rule_type: 'pad', rule_value: `code:${rest}` };
    }
    if (/^\d{1,10}$/.test(trimmed)) {
      return { rule_type: 'pad', rule_value: `ll2:${String(Number(trimmed))}` };
    }
    return { rule_type: 'pad', rule_value: `code:${trimmed}` };
  }

  if (ruleType === 'tier') {
    const normalized = trimmed.toLowerCase();
    if (!['major', 'notable', 'routine'].includes(normalized)) return null;
    return { rule_type: 'tier', rule_value: normalized };
  }

  return { rule_type: 'provider', rule_value: trimmed };
}

function mapNotificationPreferencesPayload(data: any) {
  return notificationPreferencesSchemaV1.parse({
    pushEnabled: data?.push_enabled === true,
    emailEnabled: data?.email_enabled !== false,
    smsEnabled: data?.sms_enabled === true,
    launchDayEmailEnabled: data?.launch_day_email_enabled === true,
    launchDayEmailProviders: normalizeStringList(data?.launch_day_email_providers, 80),
    launchDayEmailStates: normalizeStringList(data?.launch_day_email_states, 80),
    quietHoursEnabled: data?.quiet_hours_enabled === true,
    quietStartLocal: normalizeText(data?.quiet_start_local),
    quietEndLocal: normalizeText(data?.quiet_end_local),
    smsVerified: data?.sms_verified === true,
    smsPhone: normalizeText(data?.sms_phone_e164),
    smsSystemEnabled: typeof data?.sms_system_enabled === 'boolean' ? data.sms_system_enabled : null
  });
}

function mapPrivacyPreferencesPayload(data: any) {
  return privacyPreferencesSchemaV1.parse({
    optOutSaleShare: data?.opt_out_sale_share === true,
    limitSensitive: data?.limit_sensitive === true,
    blockThirdPartyEmbeds: data?.block_third_party_embeds === true,
    gpcEnabled: data?.gpc_enabled === true,
    createdAt: normalizeText(data?.created_at),
    updatedAt: normalizeText(data?.updated_at)
  });
}

function normalizeStringList(values: unknown, max: number) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .slice(0, max)
    .sort((left, right) => left.localeCompare(right));
}

function mapPushDevicePayload(data: any, fallback: any) {
  return pushDeviceRegistrationSchemaV1.parse({
    platform: data?.platform ?? fallback.platform,
    installationId: data?.installation_id ?? fallback.installationId,
    token: data?.token ?? fallback.token,
    appVersion: data?.app_version ?? fallback.appVersion ?? null,
    deviceName: data?.device_name ?? fallback.deviceName ?? null,
    pushProvider: data?.push_provider ?? fallback.pushProvider ?? null,
    active: data?.is_active ?? fallback.active ?? true,
    registeredAt: normalizeText(data?.last_registered_at) ?? normalizeText(data?.updated_at) ?? fallback.registeredAt ?? null,
    lastSentAt: normalizeText(data?.last_sent_at),
    lastReceiptAt: normalizeText(data?.last_receipt_at),
    lastFailureReason: normalizeText(data?.last_failure_reason),
    disabledAt: normalizeText(data?.disabled_at)
  });
}

function sortByPublishedAtDesc<T extends { publishedAt: string | null }>(items: T[]) {
  return items.sort((left, right) => {
    const leftMs = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
    const rightMs = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
    return rightMs - leftMs;
  });
}

function buildWeatherSummary(launch: ReturnType<typeof mapPublicCacheRow>) {
  if (!Array.isArray(launch.weatherConcerns) || launch.weatherConcerns.length === 0) {
    return null;
  }
  return launch.weatherConcerns.map((entry) => String(entry || '').trim()).filter(Boolean).join(' • ') || null;
}

function mapLaunchCardPayload(launch: ReturnType<typeof mapPublicCacheRow>) {
  return {
    id: launch.id,
    slug: launch.slug ?? null,
    name: launch.name,
    net: launch.net ?? null,
    status: launch.statusText ?? null,
    provider: launch.provider ?? null,
    imageUrl: launch.image.full || launch.image.thumbnail || null
  };
}

function getPrivilegedClient(session: ResolvedViewerSession): PrivilegedClient | null {
  if (isSupabaseAdminConfigured()) {
    return createSupabaseAdminClient();
  }

  if (session.authMode === 'bearer' && session.accessToken) {
    return createSupabaseAccessTokenClient(session.accessToken);
  }

  if (session.authMode === 'cookie') {
    return createSupabaseServerClient();
  }

  return null;
}

async function requirePremiumNotificationAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (!entitlement.isAdmin && !entitlement.isPaid) {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requireAuthedEntitlement(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  return entitlement;
}

async function requireSavedItemsAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (!entitlement.capabilities.canUseSavedItems) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  return entitlement;
}

async function requireBasicAlertRuleAccess(session: ResolvedViewerSession) {
  const entitlement = await requireAuthedEntitlement(session);
  if (!entitlement.capabilities.canUseBasicAlertRules) {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requireAdvancedAlertRuleAccess(session: ResolvedViewerSession) {
  const entitlement = await requireBasicAlertRuleAccess(session);
  if (!entitlement.capabilities.canUseAdvancedAlertRules) {
    throw new MobileApiRouteError(402, 'subscription_required');
  }
  return entitlement;
}

async function requirePremiumIntegrationsAccess(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new MobileApiRouteError(401, 'unauthorized');
  }
  if (!entitlement.isPaid && !entitlement.isAdmin) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  return entitlement;
}

async function loadPushDestinationStatus(client: PrivilegedClient, userId: string) {
  const [mobileRes, webRes] = await Promise.all([
    client
      .from('notification_push_devices')
      .select('id, platform')
      .eq('user_id', userId)
      .eq('is_active', true)
      .in('platform', ['ios', 'android']),
    client.from('push_subscriptions').select('id').eq('user_id', userId).limit(1)
  ]);

  if (mobileRes.error) {
    throw mobileRes.error;
  }
  if (webRes.error) {
    throw webRes.error;
  }

  return {
    hasMobile: Array.isArray(mobileRes.data) && mobileRes.data.length > 0,
    hasWeb: Array.isArray(webRes.data) && webRes.data.length > 0
  };
}

function assertAlertRuleCreationAccess(
  entitlement: Awaited<ReturnType<typeof requireAuthedEntitlement>>,
  kind: z.infer<typeof alertRuleCreateSchemaV1>['kind']
) {
  if (kind === 'region_us' || kind === 'state') {
    if (!entitlement.capabilities.canUseBasicAlertRules) {
      throw new MobileApiRouteError(402, 'payment_required');
    }
    return;
  }

  if (!entitlement.capabilities.canUseAdvancedAlertRules) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
}

export async function recordAuthContextPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = authContextUpsertSchemaV1.parse(await request.json().catch(() => undefined));
  const now = new Date().toISOString();
  const { data: existingSummary, error: summaryLoadError } = await client
    .from('user_surface_summary')
    .select('first_mobile_platform, ever_used_web, ever_used_ios, ever_used_android, last_mobile_sign_in_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (summaryLoadError) {
    throw summaryLoadError;
  }

  const firstMobilePlatform =
    existingSummary?.first_mobile_platform ??
    (parsedBody.platform === 'ios' || parsedBody.platform === 'android' ? parsedBody.platform : null);

  const { error: summaryUpsertError } = await client.from('user_surface_summary').upsert(
    {
      user_id: session.userId,
      first_mobile_platform: firstMobilePlatform,
      last_sign_in_platform: parsedBody.platform,
      ever_used_web: (existingSummary?.ever_used_web ?? false) || parsedBody.platform === 'web',
      ever_used_ios: (existingSummary?.ever_used_ios ?? false) || parsedBody.platform === 'ios',
      ever_used_android: (existingSummary?.ever_used_android ?? false) || parsedBody.platform === 'android',
      last_mobile_sign_in_at:
        parsedBody.platform === 'ios' || parsedBody.platform === 'android'
          ? now
          : (existingSummary?.last_mobile_sign_in_at ?? null),
      updated_at: now
    },
    { onConflict: 'user_id' }
  );

  if (summaryUpsertError) {
    throw summaryUpsertError;
  }

  const { error: eventInsertError } = await client.from('user_sign_in_events').insert({
    user_id: session.userId,
    provider: parsedBody.provider,
    platform: parsedBody.platform,
    event_type: parsedBody.eventType,
    display_name: normalizeText(parsedBody.displayName),
    avatar_url: normalizeText(parsedBody.avatarUrl),
    email_is_private_relay: parsedBody.emailIsPrivateRelay === true,
    app_version: normalizeText(parsedBody.appVersion),
    build_profile: normalizeText(parsedBody.buildProfile),
    result: 'success',
    created_at: now
  });

  if (eventInsertError) {
    throw eventInsertError;
  }

  return successResponseSchemaV1.parse({ ok: true });
}

async function loadRelatedLaunchResults(launchId: string) {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const [newsJoinRes, eventJoinRes] = await Promise.all([
    supabase.from('snapi_item_launches').select('snapi_uid').eq('launch_id', launchId),
    supabase.from('ll2_event_launches').select('ll2_event_id').eq('launch_id', launchId)
  ]);

  if (newsJoinRes.error) throw newsJoinRes.error;
  if (eventJoinRes.error) throw eventJoinRes.error;

  const newsIds = Array.from(new Set((newsJoinRes.data || []).map((row: any) => normalizeText(row.snapi_uid)).filter(Boolean)));
  const eventIds = Array.from(new Set((eventJoinRes.data || []).map((row: any) => row.ll2_event_id).filter((value) => Number.isFinite(value))));

  const [newsRes, eventRes] = await Promise.all([
    newsIds.length
      ? supabase
          .from('snapi_items')
          .select('snapi_uid, title, summary, url, news_site, image_url, published_at')
          .in('snapi_uid', newsIds)
          .order('published_at', { ascending: false })
          .limit(8)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? supabase
          .from('ll2_events')
          .select('ll2_event_id, name, description, type_name, date, location_name, url, image_url')
          .in('ll2_event_id', eventIds)
          .limit(8)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (newsRes.error) throw newsRes.error;
  if (eventRes.error) throw eventRes.error;

  const newsResults = ((newsRes.data || []) as RelatedNewsRow[]).map((row) => ({
    id: String(row.snapi_uid || ''),
    type: 'news',
    title: String(row.title || 'Untitled article'),
    subtitle: normalizeText(row.news_site),
    summary: normalizeText(row.summary),
    href: String(row.url || '/news'),
    imageUrl: normalizeText(row.image_url),
    badge: 'News',
    publishedAt: normalizeText(row.published_at)
  }));

  const eventResults = ((eventRes.data || []) as RelatedEventRow[]).map((row) => ({
    id: String(row.ll2_event_id || ''),
    type: 'page',
    title: String(row.name || 'Related event'),
    subtitle: [normalizeText(row.type_name), normalizeText(row.location_name)].filter(Boolean).join(' • ') || null,
    summary: normalizeText(row.description),
    href: String(row.url || '/'),
    imageUrl: normalizeText(row.image_url),
    badge: 'Event',
    publishedAt: normalizeText(row.date)
  }));

  return sortByPublishedAtDesc([...newsResults, ...eventResults]).slice(0, 10);
}

export async function buildViewerSessionPayload(session: ResolvedViewerSession) {
  return viewerSessionSchemaV1.parse({
    viewerId: session.userId,
    email: session.email,
    role: session.role,
    accessToken: session.authMode === 'bearer' ? session.accessToken : null,
    expiresAt: session.expiresAt,
    authMode: session.authMode
  });
}

export async function buildViewerEntitlementPayload(session: ResolvedViewerSession) {
  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  return entitlementSchemaV1.parse({
    tier: entitlement.tier,
    status: entitlement.status,
    source: entitlement.source,
    isPaid: entitlement.isPaid,
    isAdmin: entitlement.isAdmin,
    isAuthed: entitlement.isAuthed,
    mode: entitlement.mode,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    stripePriceId: entitlement.stripePriceId,
    reconciled: entitlement.reconciled,
    reconcileThrottled: entitlement.reconcileThrottled
  });
}

export async function loadLaunchFeedPayload(request: Request) {
  return loadVersionedLaunchFeedPayload(request);
}

export async function loadLaunchDetailPayload(id: string, session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(id);
  if (!parsedLaunch) {
    return null;
  }

  const { data, error } = await createSupabasePublicClient()
    .from('launches_public_cache')
    .select('*')
    .eq('launch_id', parsedLaunch.launchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const launch = mapPublicCacheRow(data);
  const [entitlements, related, enrichment, jepScore, faaAirspace, arTrajectory] = await Promise.all([
    buildViewerEntitlementPayload(session),
    loadRelatedLaunchResults(launch.id),
    fetchLaunchDetailEnrichment(launch.id, launch.ll2Id),
    fetchLaunchJepScore(launch.id, { viewerIsAdmin: session.role === 'admin' }),
    fetchLaunchFaaAirspace({ launchId: launch.id, limit: 4 }),
    loadArTrajectorySummary(launch.id)
  ]);
  const launchData = {
    ...launch,
    imageUrl: launch.image.full || launch.image.thumbnail || null,
    missionSummary: launch.mission?.description ?? launch.mission?.name ?? null,
    padName: launch.pad?.name ?? null,
    padLocation: launch.pad?.locationName ?? null,
    windowStart: launch.windowStart ?? null,
    windowEnd: launch.windowEnd ?? null,
    weatherSummary: buildWeatherSummary(launch),
    launchStatusDescription: launch.statusText ?? null,
    rocketName: launch.rocket?.fullName ?? launch.vehicle ?? null
  };

  return launchDetailSchemaV1.parse({
    launch: {
      ...mapLaunchCardPayload(launch),
      mission: launchData.missionSummary,
      padName: launchData.padName,
      padLocation: launchData.padLocation,
      windowStart: launchData.windowStart,
      windowEnd: launchData.windowEnd,
      weatherSummary: launchData.weatherSummary,
      launchStatusDescription: launchData.launchStatusDescription,
      rocketName: launchData.rocketName
    },
    launchData,
    arTrajectory,
    entitlements,
    related,
    enrichment: {
      firstStageCount: enrichment.firstStages.length,
      recoveryCount: enrichment.recovery.length,
      externalContentCount: enrichment.externalContent.length,
      hasJepScore: Boolean(jepScore),
      faaAdvisoryCount: faaAirspace?.advisories.length ?? 0,
      firstStages: enrichment.firstStages,
      recovery: enrichment.recovery,
      externalContent: enrichment.externalContent,
      faaAdvisories: faaAirspace?.advisories ?? []
    }
  });
}

export async function searchPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const limit = clampInt(searchParams.get('limit'), 8, 1, 25);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000);

  if (!isSupabaseConfigured()) {
    return searchResponseSchemaV1.parse({
      query: String(query || ''),
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const parsed = parseSiteSearchInput(query);
  const requestedTypes = parseSiteSearchTypesParam(searchParams.get('types'));
  const types = [...new Set<SearchResultType>([...parsed.types, ...requestedTypes])];

  if (!parsed.query || !parsed.hasPositiveTerms) {
    return searchResponseSchemaV1.parse({
      query: parsed.query || '',
      results: [],
      tookMs: 0,
      limit,
      offset,
      hasMore: false
    });
  }

  const startedAt = Date.now();
  const { data, error } = await createSupabasePublicClient().rpc('search_public_documents', {
    q_in: parsed.query,
    limit_n: limit + 1,
    offset_n: offset,
    types_in: types.length ? types : null
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? (data as SearchRpcRow[]) : [];
  const results = rows.slice(0, limit).map((row) => ({
    id: String(row.id || ''),
    type: String(row.type || 'page'),
    title: String(row.title || ''),
    subtitle: normalizeText(row.subtitle),
    summary: normalizeText(row.summary),
    href: String(row.url || '/search'),
    imageUrl: normalizeText(row.image_url),
    badge: normalizeText(row.badge),
    publishedAt: normalizeText(row.published_at)
  }));

  return searchResponseSchemaV1.parse({
    query: parsed.query,
    results,
    tookMs: Math.max(0, Date.now() - startedAt),
    limit,
    offset,
    hasMore: rows.length > limit
  });
}

export async function loadPrivacyPreferencesPayload(session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('privacy_preferences')
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapPrivacyPreferencesPayload(data);
}

export async function updatePrivacyPreferencesPayload(session: ResolvedViewerSession, request: Request) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const rawBody = await request.json().catch(() => undefined);
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new MobileApiRouteError(400, 'invalid_body');
  }
  if (Object.keys(rawBody).length === 0) {
    throw new MobileApiRouteError(400, 'no_changes');
  }

  const parsedBodyResult = privacyPreferencesUpdateSchemaV1.safeParse(rawBody);
  if (!parsedBodyResult.success) {
    throw new MobileApiRouteError(400, 'invalid_body');
  }

  const parsedBody = parsedBodyResult.data;
  const payload: Record<string, unknown> = {
    user_id: session.userId,
    updated_at: new Date().toISOString()
  };

  if (parsedBody.optOutSaleShare !== undefined) payload.opt_out_sale_share = parsedBody.optOutSaleShare;
  if (parsedBody.limitSensitive !== undefined) payload.limit_sensitive = parsedBody.limitSensitive;
  if (parsedBody.blockThirdPartyEmbeds !== undefined) payload.block_third_party_embeds = parsedBody.blockThirdPartyEmbeds;
  if (parsedBody.gpcEnabled !== undefined) payload.gpc_enabled = parsedBody.gpcEnabled;
  if (parsedBody.gpcEnabled === true) {
    payload.opt_out_sale_share = true;
  }

  const { data, error } = await client
    .from('privacy_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return mapPrivacyPreferencesPayload(data);
}

export async function loadAccountExportPayload(session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    throw new MobileApiRouteError(503, 'supabase_not_configured');
  }
  if (!session.userId || !session.user) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  const db = admin ?? client;

  const [profileRes, prefsRes, privacyPrefsRes, launchPrefsRes, alertRulesRes, pushRes, subscriptionRes, smsConsentRes] = await Promise.all([
    db.from('profiles').select('user_id, email, role, first_name, last_name, timezone, created_at, updated_at').eq('user_id', session.userId).maybeSingle(),
    db
      .from('notification_preferences')
      .select(
        'email_enabled, sms_enabled, push_enabled, quiet_hours_enabled, quiet_start_local, quiet_end_local, notify_t_minus_60, notify_t_minus_10, notify_t_minus_5, notify_liftoff, notify_status_change, notify_net_change, sms_phone_e164, sms_verified, sms_opt_in_at, sms_opt_out_at, created_at, updated_at'
      )
      .eq('user_id', session.userId)
      .maybeSingle(),
    db
      .from('privacy_preferences')
      .select('opt_out_sale_share, limit_sensitive, block_third_party_embeds, gpc_enabled, created_at, updated_at')
      .eq('user_id', session.userId)
      .maybeSingle(),
    db
      .from('launch_notification_preferences')
      .select(
        'user_id, launch_id, channel, mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change, created_at, updated_at'
      )
      .eq('user_id', session.userId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    db
      .from('notification_alert_rules')
      .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at')
      .eq('user_id', session.userId)
      .order('updated_at', { ascending: false })
      .limit(1000),
    db.from('push_subscriptions').select('id, endpoint, user_agent, created_at').eq('user_id', session.userId).order('created_at', { ascending: false }),
    db
      .from('subscriptions')
      .select('status, stripe_price_id, cancel_at_period_end, current_period_end, created_at, updated_at')
      .eq('user_id', session.userId)
      .maybeSingle(),
    db
      .from('sms_consent_events')
      .select('id, phone_e164, action, source, consent_version, ip, user_agent, request_url, meta, created_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(1000)
  ]);

  const stripeCustomer = admin
    ? (
        await admin.from('stripe_customers').select('stripe_customer_id, created_at').eq('user_id', session.userId).maybeSingle()
      ).data ?? null
    : null;

  return accountExportSchemaV1.parse({
    generated_at: new Date().toISOString(),
    auth: {
      user_id: session.userId,
      email: session.user.email ?? null,
      created_at: session.user.created_at ?? null,
      user_metadata: session.user.user_metadata ?? {}
    },
    profile: profileRes.data ?? null,
    notification_preferences: prefsRes.data ?? null,
    sms_consent_events: smsConsentRes.data ?? [],
    privacy_preferences: privacyPrefsRes.data ?? null,
    launch_notification_preferences: launchPrefsRes.data ?? [],
    notification_alert_rules: alertRulesRes.data ?? [],
    push_subscriptions: pushRes.data ?? [],
    subscription: subscriptionRes.data ?? null,
    stripe_customer: stripeCustomer,
    warnings: admin ? [] : ['stripe_customer_id_unavailable_without_service_role']
  });
}

export async function loadProfilePayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('user_id, email, role, first_name, last_name, timezone, created_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const metadata = (session.user?.user_metadata || {}) as Record<string, unknown>;

  return profileSchemaV1.parse({
    viewerId: session.userId,
    email: String(data?.email || session.email || ''),
    role: data?.role ?? null,
    firstName: data?.first_name ?? normalizeText(metadata.first_name),
    lastName: data?.last_name ?? normalizeText(metadata.last_name),
    timezone: data?.timezone ?? null,
    emailConfirmedAt: normalizeText((session.user as any)?.email_confirmed_at),
    createdAt: normalizeText(data?.created_at) ?? normalizeText(session.user?.created_at)
  });
}

export async function updateProfilePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = profileUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (parsedBody.firstName !== undefined) payload.first_name = parsedBody.firstName;
  if (parsedBody.lastName !== undefined) payload.last_name = parsedBody.lastName;
  if (parsedBody.timezone !== undefined) payload.timezone = parsedBody.timezone;

  const { error } = await client.from('profiles').update(payload).eq('user_id', session.userId);
  if (error) {
    throw error;
  }

  if (parsedBody.firstName !== undefined || parsedBody.lastName !== undefined) {
    const metadata: Record<string, string> = {};
    if (parsedBody.firstName !== undefined) metadata.first_name = parsedBody.firstName;
    if (parsedBody.lastName !== undefined) metadata.last_name = parsedBody.lastName;

    if (session.authMode === 'cookie') {
      const serverClient = createSupabaseServerClient();
      const { error: authError } = await serverClient.auth.updateUser({ data: metadata });
      if (authError) {
        console.warn('profile metadata update warning', authError.message);
      }
    }
  }

  return loadProfilePayload(session);
}

export async function loadMarketingEmailPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return marketingEmailSchemaV1.parse({
    marketingEmailOptIn: data?.marketing_email_opt_in === true,
    updatedAt: normalizeText(data?.marketing_email_opt_in_updated_at)
  });
}

export async function updateMarketingEmailPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = marketingEmailUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();
  const { data, error } = await client
    .from('profiles')
    .update({
      marketing_email_opt_in: parsedBody.marketingEmailOptIn,
      marketing_email_opt_in_updated_at: updatedAt,
      updated_at: updatedAt
    })
    .eq('user_id', session.userId)
    .select('marketing_email_opt_in, marketing_email_opt_in_updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return marketingEmailSchemaV1.parse({
    marketingEmailOptIn: data?.marketing_email_opt_in === true,
    updatedAt: normalizeText(data?.marketing_email_opt_in_updated_at) ?? updatedAt
  });
}

export async function loadWatchlistsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('watchlists')
    .select('id, name, created_at, watchlist_rules(id, rule_type, rule_value, created_at)')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return watchlistsSchemaV1.parse({
    watchlists: (data || []).map(mapWatchlistPayload)
  });
}

export async function createWatchlistPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const parsedBody = watchlistCreateSchemaV1.parse(await request.json().catch(() => ({})));
  const { count, error: countError } = await client
    .from('watchlists')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }

  const watchlistLimit = entitlement.limits.watchlistLimit;
  if ((count ?? 0) >= watchlistLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const createdAt = new Date().toISOString();
  const { data, error } = await client
    .from('watchlists')
    .insert({
      user_id: session.userId,
      name: parsedBody.name?.trim() ? parsedBody.name.trim() : 'My Launches',
      created_at: createdAt
    })
    .select('id, name, created_at')
    .single();

  if (error) {
    throw error;
  }

  return watchlistEnvelopeSchemaV1.parse({
    watchlist: mapWatchlistPayload(data)
  });
}

export async function updateWatchlistPayload(session: ResolvedViewerSession, watchlistId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const parsedBody = watchlistUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const { data, error } = await client
    .from('watchlists')
    .update({ name: parsedBody.name })
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .select('id, name, created_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return watchlistEnvelopeSchemaV1.parse({
    watchlist: mapWatchlistPayload(data)
  });
}

export async function deleteWatchlistPayload(session: ResolvedViewerSession, watchlistId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const { data, error } = await client
    .from('watchlists')
    .delete()
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function createWatchlistRulePayload(session: ResolvedViewerSession, watchlistId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const parsedBody = watchlistRuleCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const normalizedRule = normalizeWatchlistRule(parsedBody.ruleType, parsedBody.ruleValue);
  if (!normalizedRule) {
    throw new MobileApiRouteError(400, 'invalid_rule_value');
  }

  const { data: watchlist, error: watchlistError } = await client
    .from('watchlists')
    .select('id')
    .eq('id', normalizedWatchlistId)
    .eq('user_id', session.userId)
    .maybeSingle();

  if (watchlistError) {
    throw watchlistError;
  }
  if (!watchlist) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  const { data: existing, error: existingError } = await client
    .from('watchlist_rules')
    .select('id, rule_type, rule_value, created_at')
    .eq('watchlist_id', normalizedWatchlistId)
    .eq('rule_type', normalizedRule.rule_type)
    .eq('rule_value', normalizedRule.rule_value)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    return watchlistRuleEnvelopeSchemaV1.parse({
      rule: mapWatchlistRulePayload(existing),
      source: 'existing'
    });
  }

  let ruleCount = 0;
  if (entitlement.tier === 'free') {
    const { data: watchlists, error: watchlistsError } = await client.from('watchlists').select('id').eq('user_id', session.userId);
    if (watchlistsError) {
      throw watchlistsError;
    }

    const watchlistIds = (watchlists ?? []).map((entry) => entry.id).filter((value): value is string => typeof value === 'string' && value.length > 0);
    const scopedWatchlistIds = watchlistIds.length > 0 ? watchlistIds : [normalizedWatchlistId];
    const { count, error: countError } = await client
      .from('watchlist_rules')
      .select('id', { count: 'exact', head: true })
      .in('watchlist_id', scopedWatchlistIds);
    if (countError) {
      throw countError;
    }
    ruleCount = count ?? 0;
  } else {
    const { count, error: countError } = await client
      .from('watchlist_rules')
      .select('id', { count: 'exact', head: true })
      .eq('watchlist_id', normalizedWatchlistId);
    if (countError) {
      throw countError;
    }
    ruleCount = count ?? 0;
  }

  if (ruleCount >= entitlement.limits.watchlistRuleLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const createdAt = new Date().toISOString();
  const { data, error } = await client
    .from('watchlist_rules')
    .insert({
      watchlist_id: normalizedWatchlistId,
      rule_type: normalizedRule.rule_type,
      rule_value: normalizedRule.rule_value,
      created_at: createdAt
    })
    .select('id, rule_type, rule_value, created_at')
    .single();

  if (error) {
    throw error;
  }

  return watchlistRuleEnvelopeSchemaV1.parse({
    rule: mapWatchlistRulePayload(data),
    source: 'created'
  });
}

export async function deleteWatchlistRulePayload(session: ResolvedViewerSession, watchlistId: string, ruleId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedWatchlistId = parseUuidOrThrow(watchlistId, 'invalid_watchlist_id');
  const normalizedRuleId = parseUuidOrThrow(ruleId, 'invalid_rule_id');
  const { data, error } = await client
    .from('watchlist_rules')
    .delete()
    .eq('id', normalizedRuleId)
    .eq('watchlist_id', normalizedWatchlistId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadFilterPresetsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('launch_filter_presets')
    .select('id, name, filters, is_default, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return filterPresetsSchemaV1.parse({
    presets: (data || []).map(mapFilterPresetPayload)
  });
}

export async function createFilterPresetPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireSavedItemsAccess(session);
  const parsedBody = filterPresetCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const { count, error: countError } = await client
    .from('launch_filter_presets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }

  if ((count ?? 0) >= entitlement.limits.presetLimit) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const updatedAt = new Date().toISOString();
  if (parsedBody.isDefault === true) {
    const { error: clearError } = await client
      .from('launch_filter_presets')
      .update({ is_default: false, updated_at: updatedAt })
      .eq('user_id', session.userId)
      .eq('is_default', true);
    if (clearError) {
      throw clearError;
    }
  }

  const { data, error } = await client
    .from('launch_filter_presets')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: parsedBody.filters,
      is_default: parsedBody.isDefault === true,
      created_at: updatedAt,
      updated_at: updatedAt
    })
    .select('id, name, filters, is_default, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return filterPresetEnvelopeSchemaV1.parse({
    preset: mapFilterPresetPayload(data)
  });
}

export async function updateFilterPresetPayload(session: ResolvedViewerSession, presetId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedPresetId = parseUuidOrThrow(presetId, 'invalid_preset_id');
  const parsedBody = filterPresetUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const updatedAt = new Date().toISOString();

  if (parsedBody.isDefault === true) {
    const { error: clearError } = await client
      .from('launch_filter_presets')
      .update({ is_default: false, updated_at: updatedAt })
      .eq('user_id', session.userId)
      .eq('is_default', true);
    if (clearError) {
      throw clearError;
    }
  }

  const payload: Record<string, unknown> = { updated_at: updatedAt };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;
  if (parsedBody.isDefault !== undefined) payload.is_default = parsedBody.isDefault;

  const { data, error } = await client
    .from('launch_filter_presets')
    .update(payload)
    .eq('id', normalizedPresetId)
    .eq('user_id', session.userId)
    .select('id, name, filters, is_default, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return filterPresetEnvelopeSchemaV1.parse({
    preset: mapFilterPresetPayload(data)
  });
}

export async function deleteFilterPresetPayload(session: ResolvedViewerSession, presetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireSavedItemsAccess(session);
  const normalizedPresetId = parseUuidOrThrow(presetId, 'invalid_preset_id');
  const { data, error } = await client
    .from('launch_filter_presets')
    .delete()
    .eq('id', normalizedPresetId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

async function requireOwnedPreset(client: PrivilegedClient, userId: string, presetId: string) {
  const { data, error } = await client
    .from('launch_filter_presets')
    .select('id, filters')
    .eq('id', presetId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'preset_not_found');
  }
  return data;
}

async function requireOwnedWatchlist(client: PrivilegedClient, userId: string, watchlistId: string) {
  const { data, error } = await client
    .from('watchlists')
    .select('id')
    .eq('id', watchlistId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'watchlist_not_found');
  }
  return data;
}

async function requireUserOwnedFollowRule(
  client: PrivilegedClient,
  userId: string,
  ruleType: z.infer<typeof watchlistRuleTypeSchemaV1>,
  ruleValue: string
) {
  const { data: watchlists, error: watchlistsError } = await client.from('watchlists').select('id').eq('user_id', userId);
  if (watchlistsError) {
    throw watchlistsError;
  }

  const watchlistIds = (watchlists ?? []).map((entry) => entry.id).filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (!watchlistIds.length) {
    throw new MobileApiRouteError(404, 'follow_not_found');
  }

  const { data, error } = await client
    .from('watchlist_rules')
    .select('id')
    .eq('rule_type', ruleType)
    .eq('rule_value', ruleValue)
    .in('watchlist_id', watchlistIds)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'follow_not_found');
  }

  return data;
}

export async function loadAlertRulesPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('notification_alert_rules')
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .eq('user_id', session.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  return alertRulesSchemaV1.parse({
    rules: (data ?? []).map((row) => mapAlertRulePayload(row as AlertRuleRow))
  });
}

export async function createAlertRulePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const entitlement = await requireAuthedEntitlement(session);
  const parsedBody = alertRuleCreateSchemaV1.parse(await request.json().catch(() => undefined));
  assertAlertRuleCreationAccess(entitlement, parsedBody.kind);

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    user_id: session.userId,
    kind: parsedBody.kind,
    updated_at: now
  };
  let existingQuery: any = client
    .from('notification_alert_rules')
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .eq('user_id', session.userId)
    .limit(1);

  if (parsedBody.kind === 'region_us') {
    existingQuery = existingQuery.eq('kind', 'region_us');
  } else if (parsedBody.kind === 'state') {
    const normalizedState = normalizeAlertRuleStateValue(parsedBody.state);
    payload.state = normalizedState;
    existingQuery = existingQuery.eq('kind', 'state').eq('state', normalizedState);
  } else if (parsedBody.kind === 'filter_preset') {
    await requireOwnedPreset(client, session.userId, parsedBody.presetId);
    payload.filter_preset_id = parsedBody.presetId;
    existingQuery = existingQuery.eq('kind', 'filter_preset').eq('filter_preset_id', parsedBody.presetId);
  } else {
    const normalizedFollow = normalizeWatchlistRule(parsedBody.followRuleType, parsedBody.followRuleValue);
    if (!normalizedFollow) {
      throw new MobileApiRouteError(400, 'invalid_rule_value');
    }
    await requireUserOwnedFollowRule(client, session.userId, normalizedFollow.rule_type, normalizedFollow.rule_value);
    payload.follow_rule_type = normalizedFollow.rule_type;
    payload.follow_rule_value = normalizedFollow.rule_value;
    existingQuery = existingQuery
      .eq('kind', 'follow')
      .eq('follow_rule_type', normalizedFollow.rule_type)
      .eq('follow_rule_value', normalizedFollow.rule_value);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    throw existingError;
  }
  if (existing) {
    return alertRuleEnvelopeSchemaV1.parse({
      rule: mapAlertRulePayload(existing as AlertRuleRow),
      source: 'existing'
    });
  }

  const { data, error } = await client
    .from('notification_alert_rules')
    .insert({
      ...payload,
      created_at: now
    })
    .select('id, kind, state, filter_preset_id, follow_rule_type, follow_rule_value, created_at, updated_at, launch_filter_presets(id, name)')
    .single();

  if (error) {
    throw error;
  }

  return alertRuleEnvelopeSchemaV1.parse({
    rule: mapAlertRulePayload(data as AlertRuleRow),
    source: 'created'
  });
}

export async function deleteAlertRulePayload(session: ResolvedViewerSession, ruleId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requireAuthedEntitlement(session);
  const normalizedRuleId = parseUuidOrThrow(ruleId, 'invalid_rule_id');
  const { data, error } = await client
    .from('notification_alert_rules')
    .delete()
    .eq('id', normalizedRuleId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadCalendarFeedsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const { data, error } = await client
    .from('calendar_feeds')
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return calendarFeedsSchemaV1.parse({
    feeds: (data || []).map(mapCalendarFeedPayload)
  });
}

export async function createCalendarFeedPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = calendarFeedCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const { count, error: countError } = await client
    .from('calendar_feeds')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('calendar_feeds')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: parsedBody.filters ?? {},
      alarm_minutes_before: parsedBody.alarmMinutesBefore ?? null,
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function updateCalendarFeedPayload(session: ResolvedViewerSession, feedId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const parsedBody = calendarFeedUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    cached_ics: null,
    cached_ics_etag: null,
    cached_ics_generated_at: null
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;
  if (Object.prototype.hasOwnProperty.call(parsedBody, 'alarmMinutesBefore')) {
    payload.alarm_minutes_before = parsedBody.alarmMinutesBefore ?? null;
  }

  const { data, error } = await client
    .from('calendar_feeds')
    .update(payload)
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function deleteCalendarFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('calendar_feeds')
    .delete()
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateCalendarFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('calendar_feeds')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      cached_ics: null,
      cached_ics_etag: null,
      cached_ics_generated_at: null
    })
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, alarm_minutes_before, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return calendarFeedEnvelopeSchemaV1.parse({
    feed: mapCalendarFeedPayload(data)
  });
}

export async function loadRssFeedsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const { data, error } = await client
    .from('rss_feeds')
    .select('id, name, token, filters, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return rssFeedsSchemaV1.parse({
    feeds: (data || []).map(mapRssFeedPayload)
  });
}

export async function createRssFeedPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = rssFeedCreateSchemaV1.parse(await request.json().catch(() => undefined));
  const { count, error: countError } = await client.from('rss_feeds').select('id', { count: 'exact', head: true }).eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('rss_feeds')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      filters: parsedBody.filters ?? {},
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, filters, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function updateRssFeedPayload(session: ResolvedViewerSession, feedId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const parsedBody = rssFeedUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    cached_rss_xml: null,
    cached_rss_etag: null,
    cached_rss_generated_at: null,
    cached_atom_xml: null,
    cached_atom_etag: null,
    cached_atom_generated_at: null
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;

  const { data, error } = await client
    .from('rss_feeds')
    .update(payload)
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function deleteRssFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('rss_feeds')
    .delete()
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateRssFeedPayload(session: ResolvedViewerSession, feedId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedFeedId = parseUuidOrThrow(feedId, 'invalid_feed_id');
  const { data, error } = await client
    .from('rss_feeds')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      cached_rss_xml: null,
      cached_rss_etag: null,
      cached_rss_generated_at: null,
      cached_atom_xml: null,
      cached_atom_etag: null,
      cached_atom_generated_at: null
    })
    .eq('id', normalizedFeedId)
    .eq('user_id', session.userId)
    .select('id, name, token, filters, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return rssFeedEnvelopeSchemaV1.parse({
    feed: mapRssFeedPayload(data)
  });
}

export async function loadEmbedWidgetsPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const { data, error } = await client
    .from('embed_widgets')
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })
    .limit(SAVED_INTEGRATION_LIMIT);

  if (error) {
    throw error;
  }

  return embedWidgetsSchemaV1.parse({
    widgets: (data || []).map(mapEmbedWidgetPayload)
  });
}

export async function createEmbedWidgetPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const parsedBody = embedWidgetCreateSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.presetId && parsedBody.watchlistId) {
    throw new MobileApiRouteError(400, 'invalid_scope');
  }

  const { count, error: countError } = await client
    .from('embed_widgets')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', session.userId);

  if (countError) {
    throw countError;
  }
  if ((count ?? 0) >= SAVED_INTEGRATION_LIMIT) {
    throw new MobileApiRouteError(409, 'limit_reached');
  }

  let resolvedFilters = parsedBody.filters ?? {};
  const resolvedPresetId: string | null = parsedBody.presetId ?? null;
  const resolvedWatchlistId: string | null = parsedBody.watchlistId ?? null;

  if (resolvedPresetId) {
    const preset = await requireOwnedPreset(client, session.userId, resolvedPresetId);
    if (parsedBody.filters === undefined) {
      resolvedFilters = (preset.filters as Record<string, unknown>) || {};
    }
  }

  if (resolvedWatchlistId) {
    await requireOwnedWatchlist(client, session.userId, resolvedWatchlistId);
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('embed_widgets')
    .insert({
      user_id: session.userId,
      name: parsedBody.name,
      widget_type: 'next_launch_card',
      filters: resolvedFilters,
      preset_id: resolvedPresetId,
      watchlist_id: resolvedWatchlistId,
      created_at: now,
      updated_at: now
    })
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function updateEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const parsedBody = embedWidgetUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.presetId && parsedBody.watchlistId) {
    throw new MobileApiRouteError(400, 'invalid_scope');
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (parsedBody.name !== undefined) payload.name = parsedBody.name;
  if (parsedBody.filters !== undefined) payload.filters = parsedBody.filters;

  if (parsedBody.presetId !== undefined) {
    if (parsedBody.presetId === null) {
      payload.preset_id = null;
    } else {
      await requireOwnedPreset(client, session.userId, parsedBody.presetId);
      payload.preset_id = parsedBody.presetId;
    }
  }

  if (parsedBody.watchlistId !== undefined) {
    if (parsedBody.watchlistId === null) {
      payload.watchlist_id = null;
    } else {
      await requireOwnedWatchlist(client, session.userId, parsedBody.watchlistId);
      payload.watchlist_id = parsedBody.watchlistId;
    }
  }

  const { data, error } = await client
    .from('embed_widgets')
    .update(payload)
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function deleteEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const { data, error } = await client
    .from('embed_widgets')
    .delete()
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function rotateEmbedWidgetPayload(session: ResolvedViewerSession, widgetId: string) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  await requirePremiumIntegrationsAccess(session);
  const normalizedWidgetId = parseUuidOrThrow(widgetId, 'invalid_widget_id');
  const { data, error } = await client
    .from('embed_widgets')
    .update({
      token: crypto.randomUUID(),
      updated_at: new Date().toISOString()
    })
    .eq('id', normalizedWidgetId)
    .eq('user_id', session.userId)
    .select('id, name, token, widget_type, filters, preset_id, watchlist_id, created_at, updated_at')
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    throw new MobileApiRouteError(404, 'not_found');
  }

  return embedWidgetEnvelopeSchemaV1.parse({
    widget: mapEmbedWidgetPayload(data)
  });
}

export async function loadNotificationPreferencesPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const [prefsRes, smsSystemEnabled] = await Promise.all([
    client
      .from('notification_preferences')
      .select(
        'push_enabled, email_enabled, sms_enabled, launch_day_email_enabled, launch_day_email_providers, launch_day_email_states, quiet_hours_enabled, quiet_start_local, quiet_end_local, sms_verified, sms_phone_e164'
      )
      .eq('user_id', session.userId)
      .maybeSingle(),
    loadSmsSystemEnabled()
  ]);

  if (prefsRes.error) {
    throw prefsRes.error;
  }

  return mapNotificationPreferencesPayload({
    ...(prefsRes.data ?? DEFAULT_NOTIFICATION_PREFERENCES),
    sms_system_enabled: smsSystemEnabled
  });
}

export async function updateNotificationPreferencesPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = notificationPreferencesUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const wantsSms = parsedBody.smsEnabled === true;
  const wantsLaunchDayEmail = parsedBody.launchDayEmailEnabled === true;
  const wantsPush = parsedBody.pushEnabled === true;
  if (wantsSms || wantsLaunchDayEmail) {
    if (!isSupabaseAdminConfigured()) {
      throw new MobileApiRouteError(501, 'billing_not_configured');
    }
    await requirePremiumNotificationAccess(session);
  }
  if (wantsPush) {
    const entitlement = await requireAuthedEntitlement(session);
    if (!entitlement.capabilities.canUseBasicAlertRules) {
      throw new MobileApiRouteError(402, 'payment_required');
    }
  }

  const { data: existing, error: existingError } = await client
    .from('notification_preferences')
    .select('sms_verified, sms_phone_e164, sms_enabled, sms_opt_in_at, sms_opt_out_at')
    .eq('user_id', session.userId)
    .maybeSingle();
  if (existingError) {
    throw existingError;
  }

  const providedPhone = existing?.sms_phone_e164 ?? null;
  if (parsedBody.smsEnabled === true && !providedPhone) {
    throw new MobileApiRouteError(400, 'phone_required');
  }
  if (parsedBody.smsEnabled === true && !existing?.sms_verified) {
    throw new MobileApiRouteError(409, 'sms_not_verified');
  }

  const prevSmsEnabled = existing?.sms_enabled === true;
  const nextSmsEnabled = parsedBody.smsEnabled;
  const updatedAt = new Date().toISOString();
  const prevOptInAt = existing?.sms_opt_in_at ?? null;
  const shouldStampOptIn = nextSmsEnabled === true && !prevSmsEnabled;
  const shouldStampOptOut = nextSmsEnabled === false && prevSmsEnabled;
  const shouldClearOptOut = nextSmsEnabled === true;

  if (shouldStampOptIn) {
    const smsSystemEnabled = await loadSmsSystemEnabled();
    if (!smsSystemEnabled) {
      throw new MobileApiRouteError(503, 'sms_system_disabled');
    }
  }

  if (shouldStampOptIn && parsedBody.smsConsent !== true) {
    throw new MobileApiRouteError(400, 'sms_consent_required');
  }

  const payload = {
    user_id: session.userId,
    ...(parsedBody.pushEnabled !== undefined ? { push_enabled: parsedBody.pushEnabled } : {}),
    ...(parsedBody.emailEnabled !== undefined ? { email_enabled: parsedBody.emailEnabled } : {}),
    ...(parsedBody.smsEnabled !== undefined ? { sms_enabled: parsedBody.smsEnabled } : {}),
    ...(parsedBody.launchDayEmailEnabled !== undefined ? { launch_day_email_enabled: parsedBody.launchDayEmailEnabled } : {}),
    ...(parsedBody.launchDayEmailProviders !== undefined
      ? { launch_day_email_providers: normalizeStringList(parsedBody.launchDayEmailProviders, 80) }
      : {}),
    ...(parsedBody.launchDayEmailStates !== undefined
      ? { launch_day_email_states: normalizeStringList(parsedBody.launchDayEmailStates, 80) }
      : {}),
    ...(parsedBody.quietHoursEnabled !== undefined ? { quiet_hours_enabled: parsedBody.quietHoursEnabled } : {}),
    ...(parsedBody.quietStartLocal !== undefined ? { quiet_start_local: parsedBody.quietStartLocal } : {}),
    ...(parsedBody.quietEndLocal !== undefined ? { quiet_end_local: parsedBody.quietEndLocal } : {}),
    ...(shouldStampOptIn ? { sms_opt_in_at: updatedAt } : {}),
    ...(shouldStampOptOut ? { sms_opt_out_at: updatedAt } : {}),
    ...(shouldClearOptOut ? { sms_opt_out_at: null } : {}),
    updated_at: updatedAt
  };

  const { data, error } = await client
    .from('notification_preferences')
    .upsert(payload, { onConflict: 'user_id' })
    .select(
      'push_enabled, email_enabled, sms_enabled, launch_day_email_enabled, launch_day_email_providers, launch_day_email_states, quiet_hours_enabled, quiet_start_local, quiet_end_local, sms_verified, sms_phone_e164'
    )
    .single();

  if (error) {
    throw error;
  }

  if (shouldStampOptIn && providedPhone) {
    await logSmsConsentEvent(client, {
      userId: session.userId,
      phoneE164: providedPhone,
      action: 'web_opt_in',
      request,
      source: 'v1_notification_preferences'
    });

    if (isTwilioSmsConfigured()) {
      try {
        await sendSmsMessage(providedPhone, buildSmsOptInConfirmationMessage());
      } catch (error: any) {
        const code = typeof error?.code === 'number' ? error.code : null;
        const message = String(error?.message || '');
        const isOptedOut =
          code === 21610 || message.toLowerCase().includes('has replied with stop') || message.toLowerCase().includes('opted out');
        if (isOptedOut) {
          const rollbackAt = new Date().toISOString();
          await client
            .from('notification_preferences')
            .update({
              sms_enabled: false,
              sms_opt_in_at: prevOptInAt,
              sms_opt_out_at: rollbackAt,
              updated_at: rollbackAt
            })
            .eq('user_id', session.userId);
          await logSmsConsentEvent(client, {
            userId: session.userId,
            phoneE164: providedPhone,
            action: 'twilio_opt_out_error',
            request,
            source: 'v1_notification_preferences',
            meta: { code, message }
          });
          throw new MobileApiRouteError(409, 'sms_reply_start_required');
        }
        console.warn('sms opt-in confirmation send warning', error);
      }
    }
  }

  if (shouldStampOptOut && providedPhone) {
    await logSmsConsentEvent(client, {
      userId: session.userId,
      phoneE164: providedPhone,
      action: 'web_opt_out',
      request,
      source: 'v1_notification_preferences'
    });
  }

  const smsSystemEnabled = await loadSmsSystemEnabled();
  return mapNotificationPreferencesPayload({
    ...data,
    sms_system_enabled: smsSystemEnabled
  });
}

export async function startSmsVerificationPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const smsSystemEnabled = await loadSmsSystemEnabled();
  if (!smsSystemEnabled) {
    throw new MobileApiRouteError(503, 'sms_system_disabled');
  }
  if (!isTwilioVerifyConfigured()) {
    throw new MobileApiRouteError(501, 'twilio_verify_not_configured');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new MobileApiRouteError(501, 'billing_not_configured');
  }

  await requirePremiumNotificationAccess(session);

  const parsedBody = smsVerificationRequestSchemaV1.parse(await request.json().catch(() => undefined));
  if (parsedBody.smsConsent !== true) {
    throw new MobileApiRouteError(400, 'sms_consent_required');
  }

  const phone = parseUsPhone(parsedBody.phone)?.e164 ?? null;
  if (!phone) {
    throw new MobileApiRouteError(400, 'invalid_phone');
  }

  try {
    await startTwilioSmsVerification(phone);
  } catch (error) {
    console.error('sms verify send error', error);
    throw new MobileApiRouteError(500, 'sms_verification_failed');
  }

  const updatedAt = new Date().toISOString();
  const { error } = await client.from('notification_preferences').upsert(
    {
      user_id: session.userId,
      sms_phone_e164: phone,
      sms_verified: false,
      sms_enabled: false,
      sms_opt_in_at: null,
      updated_at: updatedAt
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    throw error;
  }

  await logSmsConsentEvent(client, {
    userId: session.userId,
    phoneE164: phone,
    action: 'verify_requested',
    request,
    source: 'v1_sms_verify'
  });

  return smsVerificationStatusSchemaV1.parse({
    status: 'sent'
  });
}

export async function completeSmsVerificationPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const smsSystemEnabled = await loadSmsSystemEnabled();
  if (!smsSystemEnabled) {
    throw new MobileApiRouteError(503, 'sms_system_disabled');
  }
  if (!isTwilioVerifyConfigured()) {
    throw new MobileApiRouteError(501, 'twilio_verify_not_configured');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new MobileApiRouteError(501, 'billing_not_configured');
  }

  await requirePremiumNotificationAccess(session);

  const parsedBody = smsVerificationCheckSchemaV1.parse(await request.json().catch(() => undefined));
  const phone = parseUsPhone(parsedBody.phone)?.e164 ?? null;
  if (!phone) {
    throw new MobileApiRouteError(400, 'invalid_phone');
  }

  try {
    const result = await checkSmsVerification(phone, parsedBody.code);
    if (result.status !== 'approved') {
      throw new MobileApiRouteError(400, 'invalid_code');
    }
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      throw error;
    }
    console.error('sms verify check error', error);
    throw new MobileApiRouteError(500, 'sms_verification_failed');
  }

  const updatedAt = new Date().toISOString();
  const { error } = await client.from('notification_preferences').upsert(
    {
      user_id: session.userId,
      sms_phone_e164: phone,
      sms_verified: true,
      sms_enabled: false,
      sms_opt_in_at: null,
      updated_at: updatedAt
    },
    { onConflict: 'user_id' }
  );
  if (error) {
    throw error;
  }

  await logSmsConsentEvent(client, {
    userId: session.userId,
    phoneE164: phone,
    action: 'verify_approved',
    request,
    source: 'v1_sms_verify_check'
  });

  return smsVerificationStatusSchemaV1.parse({
    status: 'verified'
  });
}

export async function deleteAccountPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }
  if (!isSupabaseAdminConfigured()) {
    throw new MobileApiRouteError(501, 'supabase_service_role_missing');
  }

  const parsedBody = deleteAccountSchema.parse(await request.json().catch(() => undefined));
  if (parsedBody.confirm.trim().toUpperCase() !== 'DELETE') {
    throw new MobileApiRouteError(400, 'confirm_required');
  }

  const admin = createSupabaseAdminClient();
  const { data: subscription, error: subscriptionError } = await admin
    .from('subscriptions')
    .select('status, stripe_subscription_id')
    .eq('user_id', session.userId)
    .maybeSingle();

  if (subscriptionError) {
    throw subscriptionError;
  }

  if (isSubscriptionActive(subscription)) {
    if (!isStripeConfigured() || !subscription?.stripe_subscription_id) {
      throw new MobileApiRouteError(409, 'active_subscription');
    }

    try {
      const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true });
      const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
      await recordBillingEvent({
        admin,
        userId: session.userId,
        email: session.email ?? null,
        eventType: 'subscription_cancel_requested',
        source: 'account_delete',
        stripeSubscriptionId: updated.id,
        status: updated.status || 'unknown',
        cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
        currentPeriodEnd,
        sendEmail: false
      });
    } catch (error) {
      console.error('account delete stripe cancel error', error);
      throw new MobileApiRouteError(502, 'failed_to_cancel_subscription');
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(session.userId);
  if (deleteError) {
    throw deleteError;
  }

  return successResponseSchemaV1.parse({ ok: true });
}

export async function loadLaunchNotificationPreferencePayload(
  session: ResolvedViewerSession,
  launchId: string,
  channel: 'sms' | 'push'
) {
  if (!session.userId) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(launchId);
  if (!parsedLaunch) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const baseQuery = client
    .from('launch_notification_preferences')
    .select('mode, timezone, t_minus_minutes, local_times, notify_status_change, notify_net_change')
    .eq('user_id', session.userId)
    .eq('launch_id', parsedLaunch.launchId)
    .eq('channel', channel)
    .maybeSingle();

  if (channel === 'push') {
    const [launchRes, pushPrefsRes, destinationStatus, entitlement] = await Promise.all([
      baseQuery,
      client.from('notification_preferences').select('push_enabled').eq('user_id', session.userId).maybeSingle(),
      loadPushDestinationStatus(client, session.userId),
      requireAuthedEntitlement(session)
    ]);

    if (launchRes.error) {
      throw launchRes.error;
    }
    if (pushPrefsRes.error) {
      throw pushPrefsRes.error;
    }

    return launchNotificationPreferenceEnvelopeSchemaV1.parse({
      enabled: Boolean(launchRes.data),
      preference: {
        launchId: parsedLaunch.launchId,
        channel,
        mode: launchRes.data?.mode === 'local_time' ? 'local_time' : 't_minus',
        timezone: String(launchRes.data?.timezone || 'UTC'),
        tMinusMinutes: Array.isArray(launchRes.data?.t_minus_minutes) ? launchRes.data.t_minus_minutes : [],
        localTimes: Array.isArray(launchRes.data?.local_times) ? launchRes.data.local_times : [],
        notifyStatusChange: normalizeBoolean(launchRes.data?.notify_status_change),
        notifyNetChange: normalizeBoolean(launchRes.data?.notify_net_change)
      },
      pushStatus: {
        enabled: normalizeBoolean(pushPrefsRes.data?.push_enabled),
        subscribed: entitlement.capabilities.canUseBrowserLaunchAlerts
          ? destinationStatus.hasMobile || destinationStatus.hasWeb
          : destinationStatus.hasMobile
      }
    });
  }

  const [launchRes, smsPrefsRes, smsSystemEnabled] = await Promise.all([
    baseQuery,
    client
      .from('notification_preferences')
      .select('sms_enabled, sms_verified')
      .eq('user_id', session.userId)
      .maybeSingle(),
    loadSmsSystemEnabled()
  ]);

  if (launchRes.error) {
    throw launchRes.error;
  }
  if (smsPrefsRes.error) {
    throw smsPrefsRes.error;
  }

  return launchNotificationPreferenceEnvelopeSchemaV1.parse({
    enabled: Boolean(launchRes.data),
    preference: {
      launchId: parsedLaunch.launchId,
      channel,
      mode: launchRes.data?.mode === 'local_time' ? 'local_time' : 't_minus',
      timezone: String(launchRes.data?.timezone || 'UTC'),
      tMinusMinutes: Array.isArray(launchRes.data?.t_minus_minutes) ? launchRes.data.t_minus_minutes : [],
      localTimes: Array.isArray(launchRes.data?.local_times) ? launchRes.data.local_times : [],
      notifyStatusChange: normalizeBoolean(launchRes.data?.notify_status_change),
      notifyNetChange: normalizeBoolean(launchRes.data?.notify_net_change)
    },
    smsStatus: {
      enabled: normalizeBoolean(smsPrefsRes.data?.sms_enabled),
      verified: normalizeBoolean(smsPrefsRes.data?.sms_verified),
      systemEnabled: smsSystemEnabled
    }
  });
}

export async function updateLaunchNotificationPreferencePayload(
  session: ResolvedViewerSession,
  launchId: string,
  request: Request
) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedLaunch = parseLaunchParam(launchId);
  if (!parsedLaunch) {
    throw new MobileApiRouteError(400, 'invalid_launch_id');
  }

  const parsedBody = launchNotificationPreferenceUpdateSchemaV1.parse(await request.json().catch(() => undefined));
  const channel = parsedBody.channel ?? 'push';
  const allowedTMinus = new Set([5, 10, 15, 20, 30, 45, 60, 120]);
  const requestedTMinus = tMinusMinutesSchema.parse(parsedBody.tMinusMinutes ?? []);
  if (requestedTMinus.some((value) => !allowedTMinus.has(value))) {
    throw new MobileApiRouteError(400, 'invalid_t_minus');
  }

  const localTimes = Array.from(new Set((parsedBody.localTimes ?? []).map((value) => localTimeSchema.parse(value)))).sort().slice(0, 2);
  const payload = {
    user_id: session.userId,
    launch_id: parsedLaunch.launchId,
    channel,
    mode: parsedBody.mode,
    timezone: (parsedBody.timezone || 'UTC').trim() || 'UTC',
    t_minus_minutes: parsedBody.mode === 't_minus' ? requestedTMinus : [],
    local_times: parsedBody.mode === 'local_time' ? localTimes : [],
    notify_status_change: normalizeBoolean(parsedBody.notifyStatusChange),
    notify_net_change: normalizeBoolean(parsedBody.notifyNetChange),
    updated_at: new Date().toISOString()
  };

  const allOff =
    payload.t_minus_minutes.length === 0 &&
    payload.local_times.length === 0 &&
    !payload.notify_status_change &&
    !payload.notify_net_change;
  const desiredEventTypes = new Set<string>(buildManagedEventTypes(payload.mode, payload.t_minus_minutes, payload.local_times));

  if (allOff) {
    const { error } = await client
      .from('launch_notification_preferences')
      .delete()
      .eq('user_id', session.userId)
      .eq('launch_id', parsedLaunch.launchId)
      .eq('channel', channel);

    if (error) {
      throw error;
    }

    if (isSupabaseAdminConfigured()) {
      await deleteManagedQueuedOutbox(createSupabaseAdminClient(), session.userId, parsedLaunch.launchId, channel, desiredEventTypes);
    }

    return loadLaunchNotificationPreferencePayload(session, parsedLaunch.launchId, channel);
  }

  if (channel === 'push') {
    const entitlement = await requireAuthedEntitlement(session);
    if (!entitlement.capabilities.canUseBasicAlertRules) {
      throw new MobileApiRouteError(402, 'payment_required');
    }

    const [pushPrefsRes, destinationStatus] = await Promise.all([
      client.from('notification_preferences').select('push_enabled').eq('user_id', session.userId).maybeSingle(),
      loadPushDestinationStatus(client, session.userId)
    ]);

    if (pushPrefsRes.error) {
      throw pushPrefsRes.error;
    }
    if (!pushPrefsRes.data?.push_enabled) {
      throw new MobileApiRouteError(409, 'push_not_enabled');
    }
    const hasAllowedDestination = entitlement.capabilities.canUseBrowserLaunchAlerts
      ? destinationStatus.hasMobile || destinationStatus.hasWeb
      : destinationStatus.hasMobile;
    if (!hasAllowedDestination) {
      throw new MobileApiRouteError(409, 'push_not_subscribed');
    }
  } else {
    await requirePremiumNotificationAccess(session);
    const smsSystemEnabled = await loadSmsSystemEnabled();
    if (!smsSystemEnabled) {
      throw new MobileApiRouteError(503, 'sms_system_disabled');
    }
    if (!isSupabaseAdminConfigured()) {
      throw new MobileApiRouteError(501, 'billing_not_configured');
    }

    const { data, error } = await client
      .from('notification_preferences')
      .select('sms_enabled, sms_verified')
      .eq('user_id', session.userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data?.sms_verified) {
      throw new MobileApiRouteError(409, 'sms_not_verified');
    }
    if (!data?.sms_enabled) {
      throw new MobileApiRouteError(409, 'sms_not_enabled');
    }
  }

  const { error } = await client.from('launch_notification_preferences').upsert(payload, {
    onConflict: 'user_id,launch_id,channel'
  });

  if (error) {
    throw error;
  }

  if (isSupabaseAdminConfigured()) {
    await deleteManagedQueuedOutbox(createSupabaseAdminClient(), session.userId, parsedLaunch.launchId, channel, desiredEventTypes);
  }

  return loadLaunchNotificationPreferencePayload(session, parsedLaunch.launchId, channel);
}

export async function registerPushDevicePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = pushDeviceRegistrationSchemaV1.parse(await request.json().catch(() => undefined));
  const registeredAt = new Date().toISOString();
  const pushProvider = parsedBody.platform === 'web' ? 'webpush' : 'expo';

  const { data, error } = await client
    .from('notification_push_devices')
    .upsert(
      {
        user_id: session.userId,
        platform: parsedBody.platform,
        installation_id: parsedBody.installationId,
        token: parsedBody.token,
        push_provider: pushProvider,
        app_version: parsedBody.appVersion,
        device_name: parsedBody.deviceName,
        is_active: true,
        disabled_at: null,
        last_failure_reason: null,
        last_registered_at: registeredAt,
        updated_at: registeredAt
      },
      { onConflict: 'user_id,platform,installation_id' }
    )
    .select(
      'platform, installation_id, token, push_provider, app_version, device_name, is_active, last_registered_at, last_sent_at, last_receipt_at, last_failure_reason, disabled_at, updated_at'
    )
    .maybeSingle();

  if (error) {
    throw error;
  }

  return mapPushDevicePayload(data, {
    ...parsedBody,
    pushProvider,
    active: true,
    registeredAt
  });
}

export async function removePushDevicePayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    return null;
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const parsedBody = pushDeviceRemovalInputSchema.parse(await request.json().catch(() => undefined));
  const removedAt = new Date().toISOString();
  const { data, error } = await client
    .from('notification_push_devices')
    .update({
      is_active: false,
      disabled_at: removedAt,
      last_failure_reason: 'device_removed',
      updated_at: removedAt
    })
    .eq('user_id', session.userId)
    .eq('platform', parsedBody.platform)
    .eq('installation_id', parsedBody.installationId)
    .eq('is_active', true)
    .select('id')
    .maybeSingle();

  if (error) {
    throw error;
  }

  return pushDeviceRemovalSchemaV1.parse({
    platform: parsedBody.platform,
    installationId: parsedBody.installationId,
    removed: Boolean(data?.id),
    removedAt
  });
}

export async function enqueuePushDeviceTestPayload(session: ResolvedViewerSession) {
  if (!session.userId) {
    return null;
  }

  const entitlement = await requireAuthedEntitlement(session);
  if (!entitlement.capabilities.canUseBasicAlertRules) {
    throw new MobileApiRouteError(402, 'payment_required');
  }
  if (!isSupabaseAdminConfigured()) {
    throw new MobileApiRouteError(501, 'notifications_not_configured');
  }

  const client = getPrivilegedClient(session);
  if (!client) {
    return null;
  }

  const admin = createSupabaseAdminClient();

  const prefs = await loadNotificationPreferencesPayload(session);
  if (!prefs?.pushEnabled) {
    throw new MobileApiRouteError(409, 'push_not_enabled');
  }

  const [deviceRes, webPushRes] = await Promise.all([
    admin
      .from('notification_push_devices')
      .select('id')
      .eq('user_id', session.userId)
      .eq('is_active', true)
      .in('platform', ['ios', 'android'])
      .limit(1),
    admin.from('push_subscriptions').select('id').eq('user_id', session.userId).limit(1)
  ]);

  if (deviceRes.error) throw deviceRes.error;
  if (webPushRes.error) throw webPushRes.error;

  const hasAllowedDestination = entitlement.capabilities.canUseBrowserLaunchAlerts
    ? Boolean(deviceRes.data?.length || webPushRes.data?.length)
    : Boolean(deviceRes.data?.length);
  if (!hasAllowedDestination) {
    throw new MobileApiRouteError(409, 'push_not_registered');
  }

  const queuedAt = new Date().toISOString();
  const { error } = await admin.from('notifications_outbox').insert({
    user_id: session.userId,
    launch_id: null,
    channel: 'push',
    event_type: 'test',
    payload: {
      title: 'T-Minus Zero',
      message: 'Test notification from T-Minus Zero.',
      url: '/preferences',
      eventType: 'test'
    },
    status: 'queued',
    scheduled_for: queuedAt,
    created_at: queuedAt
  });

  if (error) {
    throw error;
  }

  return pushDeliveryTestSchemaV1.parse({
    ok: true,
    queuedAt
  });
}

// Keep the typed client import live so shared transport stays wired into the monorepo task graph.
export const sharedApiClient = createApiClient;
