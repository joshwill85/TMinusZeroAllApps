import assert from 'node:assert/strict';
import { createApiClient } from '@tminuszero/api-client';
import {
  entitlementSchemaV1,
  filterPresetsSchemaV1,
  launchDetailSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  notificationPreferencesSchemaV1,
  profileSchemaV1,
  pushDeviceRegistrationSchemaV1,
  searchResponseSchemaV1,
  viewerSessionSchemaV1,
  watchlistsSchemaV1
} from '@tminuszero/contracts';

const client = createApiClient();

assert.equal(typeof client.getViewerSession, 'function');
assert.equal(typeof client.getViewerEntitlements, 'function');
assert.equal(typeof client.getLaunchFeed, 'function');
assert.equal(typeof client.getLaunchDetail, 'function');
assert.equal(typeof client.search, 'function');
assert.equal(typeof client.getProfile, 'function');
assert.equal(typeof client.getWatchlists, 'function');
assert.equal(typeof client.getFilterPresets, 'function');
assert.equal(typeof client.getNotificationPreferences, 'function');
assert.equal(typeof client.getLaunchNotificationPreference, 'function');
assert.equal(typeof client.registerPushDevice, 'function');

viewerSessionSchemaV1.parse({
  viewerId: null,
  email: null,
  role: 'guest',
  accessToken: null,
  expiresAt: null,
  authMode: 'guest'
});

entitlementSchemaV1.parse({
  tier: 'anon',
  status: 'none',
  source: 'guest',
  isPaid: false,
  isAdmin: false,
  isAuthed: false,
  mode: 'public',
  refreshIntervalSeconds: 900,
  capabilities: {
    canUseSavedItems: false,
    canUseOneOffCalendar: true,
    canUseLiveFeed: false,
    canUseChangeLog: false,
    canUseInstantAlerts: false,
    canUseRecurringCalendarFeeds: false,
    canUseRssFeeds: false,
    canUseEmbedWidgets: false,
    canUseArTrajectory: false,
    canUseEnhancedForecastInsights: false,
    canUseLaunchDayEmail: false
  },
  limits: {
    presetLimit: 0,
    watchlistLimit: 0,
    watchlistRuleLimit: 0
  },
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  stripePriceId: null,
  reconciled: false,
  reconcileThrottled: false
});

launchFeedSchemaV1.parse({
  launches: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'sample-launch',
      name: 'Sample Launch',
      net: '2026-03-08T12:00:00.000Z',
      status: 'Go',
      provider: 'Sample Provider',
      imageUrl: 'https://example.com/launch.jpg'
    }
  ],
  nextCursor: null,
  hasMore: false,
  freshness: 'public-cache-db',
  intervalMinutes: 15
});

searchResponseSchemaV1.parse({
  query: 'falcon',
  results: [
    {
      id: 'launch:1',
      type: 'launch',
      title: 'Falcon 9',
      subtitle: 'SpaceX',
      summary: 'Upcoming launch.',
      href: '/launches/falcon-9',
      imageUrl: 'https://example.com/falcon.jpg',
      badge: 'Launch',
      publishedAt: '2026-03-08T12:00:00.000Z'
    }
  ],
  tookMs: 12,
  limit: 8,
  offset: 0,
  hasMore: false
});

notificationPreferencesSchemaV1.parse({
  pushEnabled: false,
  emailEnabled: true,
  smsEnabled: false,
  launchDayEmailEnabled: false,
  quietHoursEnabled: false,
  quietStartLocal: null,
  quietEndLocal: null,
  smsVerified: false,
  smsPhone: null
});

profileSchemaV1.parse({
  viewerId: '11111111-1111-4111-8111-111111111111',
  email: 'viewer@example.com',
  role: 'member',
  firstName: 'Ada',
  lastName: 'Lovelace',
  timezone: 'America/New_York',
  emailConfirmedAt: '2026-03-08T12:00:00.000Z'
});

watchlistsSchemaV1.parse({
  watchlists: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'My Launches',
      ruleCount: 2,
      createdAt: '2026-03-08T12:00:00.000Z'
    }
  ]
});

filterPresetsSchemaV1.parse({
  presets: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Florida',
      filters: { region: 'us', state: 'Florida' },
      isDefault: true,
      createdAt: '2026-03-08T12:00:00.000Z',
      updatedAt: '2026-03-08T12:00:00.000Z'
    }
  ]
});

launchNotificationPreferenceEnvelopeSchemaV1.parse({
  enabled: true,
  preference: {
    launchId: '11111111-1111-4111-8111-111111111111',
    channel: 'push',
    mode: 't_minus',
    timezone: 'UTC',
    tMinusMinutes: [10, 30],
    localTimes: [],
    notifyStatusChange: true,
    notifyNetChange: true
  }
});

pushDeviceRegistrationSchemaV1.parse({
  platform: 'ios',
  token: 'ExponentPushToken[abc123]',
  appVersion: '1.0.0',
  deviceName: 'iPhone',
  pushProvider: 'expo',
  registeredAt: '2026-03-08T12:00:00.000Z'
});

launchDetailSchemaV1.parse({
  launch: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'sample-launch',
    name: 'Sample Launch',
    net: '2026-03-08T12:00:00.000Z',
    status: 'Go',
    provider: 'Sample Provider',
    imageUrl: 'https://example.com/launch.jpg',
    mission: 'Sample mission.',
    padName: 'SLC-40',
    padLocation: 'Cape Canaveral',
    windowStart: '2026-03-08T12:00:00.000Z',
    windowEnd: '2026-03-08T12:30:00.000Z',
    weatherSummary: 'Clear skies',
    launchStatusDescription: 'Go for launch',
    rocketName: 'Falcon 9'
  },
  entitlements: {
    tier: 'free',
    status: 'active',
    source: 'stripe',
    isPaid: false,
    isAdmin: false,
    isAuthed: true,
    mode: 'public',
    refreshIntervalSeconds: 900,
    capabilities: {
      canUseSavedItems: true,
      canUseOneOffCalendar: true,
      canUseLiveFeed: false,
      canUseChangeLog: false,
      canUseInstantAlerts: false,
      canUseRecurringCalendarFeeds: false,
      canUseRssFeeds: false,
      canUseEmbedWidgets: false,
      canUseArTrajectory: false,
      canUseEnhancedForecastInsights: false,
      canUseLaunchDayEmail: false
    },
    limits: {
      presetLimit: 1,
      watchlistLimit: 1,
      watchlistRuleLimit: 10
    },
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
    stripePriceId: null,
    reconciled: false,
    reconcileThrottled: false
  },
  related: [],
  enrichment: {
    firstStageCount: 1,
    recoveryCount: 1,
    externalContentCount: 0,
    hasJepScore: false,
    faaAdvisoryCount: 0
  }
});

console.log('v1 contract smoke passed');
