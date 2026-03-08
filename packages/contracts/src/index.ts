import { z } from 'zod';

export const viewerSessionSchemaV1 = z.object({
  viewerId: z.string().uuid().nullable(),
  email: z.string().email().nullable(),
  role: z.enum(['guest', 'member', 'admin']),
  accessToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  authMode: z.enum(['guest', 'cookie', 'bearer'])
});

export const entitlementCapabilitiesSchemaV1 = z.object({
  canUseSavedItems: z.boolean(),
  canUseOneOffCalendar: z.boolean(),
  canUseLiveFeed: z.boolean(),
  canUseChangeLog: z.boolean(),
  canUseInstantAlerts: z.boolean(),
  canUseRecurringCalendarFeeds: z.boolean(),
  canUseRssFeeds: z.boolean(),
  canUseEmbedWidgets: z.boolean(),
  canUseArTrajectory: z.boolean(),
  canUseEnhancedForecastInsights: z.boolean(),
  canUseLaunchDayEmail: z.boolean()
});

export const entitlementLimitsSchemaV1 = z.object({
  presetLimit: z.number().int().nonnegative(),
  watchlistLimit: z.number().int().nonnegative(),
  watchlistRuleLimit: z.number().int().nonnegative()
});

export const entitlementSchemaV1 = z.object({
  tier: z.enum(['anon', 'free', 'premium']),
  status: z.string(),
  source: z.enum(['stub', 'guest', 'db', 'stripe_reconcile', 'none', 'stripe', 'apple', 'google', 'manual']),
  isPaid: z.boolean(),
  isAdmin: z.boolean(),
  isAuthed: z.boolean(),
  mode: z.enum(['public', 'live']),
  refreshIntervalSeconds: z.number().int().nonnegative(),
  capabilities: entitlementCapabilitiesSchemaV1,
  limits: entitlementLimitsSchemaV1,
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  reconciled: z.boolean(),
  reconcileThrottled: z.boolean()
});

export const launchCardSchemaV1 = z.object({
  id: z.string().uuid(),
  slug: z.string().nullable(),
  name: z.string(),
  net: z.string().nullable(),
  status: z.string().nullable(),
  provider: z.string().nullable(),
  imageUrl: z.string().url().nullable()
});

export const launchFeedSchemaV1 = z.object({
  launches: z.array(launchCardSchemaV1),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  freshness: z.string().nullable(),
  intervalMinutes: z.number().int().nonnegative().nullable()
});

export const searchResultSchemaV1 = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  summary: z.string().nullable(),
  href: z.string(),
  imageUrl: z.string().nullable(),
  badge: z.string().nullable(),
  publishedAt: z.string().nullable()
});

export const searchResponseSchemaV1 = z.object({
  query: z.string(),
  results: z.array(searchResultSchemaV1),
  tookMs: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean()
});

export const notificationPreferencesSchemaV1 = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  launchDayEmailEnabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietStartLocal: z.string().nullable(),
  quietEndLocal: z.string().nullable(),
  smsVerified: z.boolean(),
  smsPhone: z.string().nullable()
});

export const pushDeviceRegistrationSchemaV1 = z.object({
  platform: z.enum(['web', 'ios', 'android']),
  token: z.string(),
  appVersion: z.string().nullable(),
  deviceName: z.string().nullable(),
  pushProvider: z.enum(['expo', 'webpush']).nullable().optional(),
  registeredAt: z.string().nullable().optional()
});

export const profileSchemaV1 = z.object({
  viewerId: z.string().uuid(),
  email: z.string().email(),
  role: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  timezone: z.string().nullable(),
  emailConfirmedAt: z.string().nullable()
});

export const watchlistSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ruleCount: z.number().int().nonnegative(),
  createdAt: z.string().nullable().optional()
});

export const watchlistsSchemaV1 = z.object({
  watchlists: z.array(watchlistSchemaV1)
});

export const filterPresetSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  filters: z.record(z.unknown()),
  isDefault: z.boolean(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const filterPresetsSchemaV1 = z.object({
  presets: z.array(filterPresetSchemaV1)
});

export const launchNotificationPreferenceSchemaV1 = z.object({
  launchId: z.string().uuid(),
  channel: z.enum(['sms', 'push']),
  mode: z.enum(['t_minus', 'local_time']),
  timezone: z.string(),
  tMinusMinutes: z.array(z.number().int()),
  localTimes: z.array(z.string()),
  notifyStatusChange: z.boolean(),
  notifyNetChange: z.boolean()
});

export const launchNotificationPreferenceEnvelopeSchemaV1 = z.object({
  preference: launchNotificationPreferenceSchemaV1,
  enabled: z.boolean()
});

export const launchDetailEnrichmentSchemaV1 = z.object({
  firstStageCount: z.number().int().nonnegative(),
  recoveryCount: z.number().int().nonnegative(),
  externalContentCount: z.number().int().nonnegative(),
  hasJepScore: z.boolean(),
  faaAdvisoryCount: z.number().int().nonnegative()
});

export const launchDetailSchemaV1 = z.object({
  launch: launchCardSchemaV1.extend({
    mission: z.string().nullable(),
    padName: z.string().nullable(),
    padLocation: z.string().nullable(),
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
    weatherSummary: z.string().nullable(),
    launchStatusDescription: z.string().nullable(),
    rocketName: z.string().nullable()
  }),
  entitlements: entitlementSchemaV1,
  related: z.array(searchResultSchemaV1),
  enrichment: launchDetailEnrichmentSchemaV1
});

export type ViewerSessionV1 = z.infer<typeof viewerSessionSchemaV1>;
export type EntitlementCapabilitiesV1 = z.infer<typeof entitlementCapabilitiesSchemaV1>;
export type EntitlementLimitsV1 = z.infer<typeof entitlementLimitsSchemaV1>;
export type EntitlementsV1 = z.infer<typeof entitlementSchemaV1>;
export type LaunchCardV1 = z.infer<typeof launchCardSchemaV1>;
export type LaunchFeedV1 = z.infer<typeof launchFeedSchemaV1>;
export type SearchResultV1 = z.infer<typeof searchResultSchemaV1>;
export type LaunchDetailEnrichmentV1 = z.infer<typeof launchDetailEnrichmentSchemaV1>;
export type LaunchDetailV1 = z.infer<typeof launchDetailSchemaV1>;
export type SearchResponseV1 = z.infer<typeof searchResponseSchemaV1>;
export type NotificationPreferencesV1 = z.infer<typeof notificationPreferencesSchemaV1>;
export type PushDeviceRegistrationV1 = z.infer<typeof pushDeviceRegistrationSchemaV1>;
export type ProfileV1 = z.infer<typeof profileSchemaV1>;
export type WatchlistV1 = z.infer<typeof watchlistSchemaV1>;
export type WatchlistsV1 = z.infer<typeof watchlistsSchemaV1>;
export type FilterPresetV1 = z.infer<typeof filterPresetSchemaV1>;
export type FilterPresetsV1 = z.infer<typeof filterPresetsSchemaV1>;
export type LaunchNotificationPreferenceV1 = z.infer<typeof launchNotificationPreferenceSchemaV1>;
export type LaunchNotificationPreferenceEnvelopeV1 = z.infer<typeof launchNotificationPreferenceEnvelopeSchemaV1>;
