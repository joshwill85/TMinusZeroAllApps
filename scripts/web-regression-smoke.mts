import assert from 'node:assert/strict';
import {
  billingSummaryQueryOptions,
  accountExportQueryOptions,
  createSharedQueryClient,
  filterPresetsQueryOptions,
  launchFeedQueryOptions,
  marketingEmailQueryOptions,
  notificationPreferencesQueryOptions,
  privacyPreferencesQueryOptions,
  profileQueryOptions,
  searchQueryOptions,
  viewerEntitlementsQueryOptions,
  viewerSessionQueryOptions,
  watchlistsQueryOptions
} from '../packages/query/src/index.ts';
import {
  buildAuthHref,
  buildLaunchHref,
  buildProfileHref,
  buildSavedHref,
  buildSearchHref,
  buildUpgradeHref,
  sanitizeReturnTo
} from '../packages/navigation/src/index.ts';

const queryClient = createSharedQueryClient();
const queryCounts = new Map<string, number>();

function createLoader<T>(key: string, payload: T) {
  return async () => {
    queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
    return payload;
  };
}

async function verifyQueryReuse() {
  await queryClient.fetchQuery(
    viewerSessionQueryOptions(
      createLoader('viewerSession', {
        viewerId: 'viewer-1',
        email: 'viewer@example.com',
        role: 'member',
        accessToken: null,
        expiresAt: null,
        authMode: 'cookie'
      })
    )
  );
  await queryClient.fetchQuery(
    viewerSessionQueryOptions(
      createLoader('viewerSession', {
        viewerId: 'viewer-1',
        email: 'viewer@example.com',
        role: 'member',
        accessToken: null,
        expiresAt: null,
        authMode: 'cookie'
      })
    )
  );

  await queryClient.fetchQuery(
    viewerEntitlementsQueryOptions(
      createLoader('viewerEntitlements', {
        tier: 'anon',
        status: 'active',
        source: 'stripe',
        isPaid: false,
        billingIsPaid: false,
        isAdmin: false,
        isAuthed: true,
        mode: 'public',
        effectiveTierSource: 'anon',
        adminAccessOverride: null,
        refreshIntervalSeconds: 7200,
        capabilities: {
          canUseSavedItems: false,
          canUseLaunchFilters: true,
          canUseLaunchCalendar: true,
          canUseOneOffCalendar: true,
          canUseLiveFeed: false,
          canUseChangeLog: false,
          canUseInstantAlerts: false,
          canManageFilterPresets: false,
          canManageFollows: false,
          canUseBasicAlertRules: true,
          canUseAdvancedAlertRules: false,
          canUseBrowserLaunchAlerts: true,
          canUseSingleLaunchFollow: true,
          canUseAllUsLaunchAlerts: true,
          canUseStateLaunchAlerts: false,
          canUseRecurringCalendarFeeds: false,
          canUseRssFeeds: false,
          canUseEmbedWidgets: false,
          canUseArTrajectory: false,
          canUseEnhancedForecastInsights: false,
          canUseLaunchDayEmail: false
        },
        limits: {
          presetLimit: 0,
          filterPresetLimit: 0,
          watchlistLimit: 0,
          watchlistRuleLimit: 0,
          singleLaunchFollowLimit: 1
        },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        stripePriceId: null,
        reconciled: true,
        reconcileThrottled: false
      })
    )
  );
  await queryClient.fetchQuery(
    viewerEntitlementsQueryOptions(
      createLoader('viewerEntitlements', {
        tier: 'anon',
        status: 'active',
        source: 'stripe',
        isPaid: false,
        billingIsPaid: false,
        isAdmin: false,
        isAuthed: true,
        mode: 'public',
        effectiveTierSource: 'anon',
        adminAccessOverride: null,
        refreshIntervalSeconds: 7200,
        capabilities: {
          canUseSavedItems: false,
          canUseLaunchFilters: true,
          canUseLaunchCalendar: true,
          canUseOneOffCalendar: true,
          canUseLiveFeed: false,
          canUseChangeLog: false,
          canUseInstantAlerts: false,
          canManageFilterPresets: false,
          canManageFollows: false,
          canUseBasicAlertRules: true,
          canUseAdvancedAlertRules: false,
          canUseBrowserLaunchAlerts: true,
          canUseSingleLaunchFollow: true,
          canUseAllUsLaunchAlerts: true,
          canUseStateLaunchAlerts: false,
          canUseRecurringCalendarFeeds: false,
          canUseRssFeeds: false,
          canUseEmbedWidgets: false,
          canUseArTrajectory: false,
          canUseEnhancedForecastInsights: false,
          canUseLaunchDayEmail: false
        },
        limits: {
          presetLimit: 0,
          filterPresetLimit: 0,
          watchlistLimit: 0,
          watchlistRuleLimit: 0,
          singleLaunchFollowLimit: 1
        },
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        stripePriceId: null,
        reconciled: true,
        reconcileThrottled: false
      })
    )
  );

  await Promise.all([
    queryClient.fetchQuery(
      launchFeedQueryOptions(
        createLoader('launchFeed', {
          launches: [
            {
              id: 'launch-1',
              ll2Id: 'll2-1',
              slug: 'sample-launch',
              name: 'Sample Launch',
              provider: 'Sample Provider',
              vehicle: 'Falcon 9',
              status: 'go',
              statusText: 'Go',
              net: '2026-03-09T12:00:00.000Z',
              netPrecision: 'minute',
              pad: {
                name: 'SLC-40',
                shortCode: 'SLC-40',
                state: 'Florida',
                timezone: 'America/New_York'
              },
              image: {
                thumbnail: 'https://example.com/launch.jpg'
              },
              tier: 'major'
            }
          ],
          nextCursor: null,
          hasMore: false,
          freshness: 'public-cache-db',
          intervalMinutes: 120
        }),
        { scope: 'public' }
      )
    ),
    queryClient.fetchQuery(
      watchlistsQueryOptions(
        createLoader('watchlists', {
          watchlists: [
            {
              id: 'watch-1',
              name: 'My Launches',
              isDefault: true,
              ruleCount: 1,
              createdAt: '2026-03-09T11:00:00.000Z',
              rules: []
            }
          ]
        })
      )
    ),
    queryClient.fetchQuery(
      filterPresetsQueryOptions(
        createLoader('filterPresets', {
          presets: [
            {
              id: 'preset-1',
              name: 'Cape launches',
              filters: { location: 'Cape Canaveral' },
              isDefault: true
            }
          ]
        })
      )
    )
  ]);

  await Promise.all([
    queryClient.fetchQuery(profileQueryOptions(createLoader('profile', {
      email: 'viewer@example.com',
      role: 'member',
      firstName: 'Launch',
      lastName: 'Viewer',
      timezone: 'America/New_York'
    }))),
    queryClient.fetchQuery(notificationPreferencesQueryOptions(createLoader('notificationPreferences', {
      pushEnabled: true,
      emailEnabled: true,
      launchDayEmailEnabled: false,
      launchDayEmailProviders: [],
      launchDayEmailStates: [],
      quietHoursEnabled: false,
      quietStartLocal: null,
      quietEndLocal: null
    }))),
    queryClient.fetchQuery(marketingEmailQueryOptions(createLoader('marketingEmail', {
      subscribed: true,
      updatedAt: '2026-03-09T12:00:00.000Z'
    }))),
    queryClient.fetchQuery(billingSummaryQueryOptions(createLoader('billingSummary', {
      provider: 'stripe',
      productKey: 'premium_monthly',
      status: 'active',
      isPaid: true,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-04-01T00:00:00.000Z',
      managementMode: 'stripe_portal',
      managementUrl: '/account',
      providerMessage: null,
      providerProductId: 'price_123'
    }), 'viewer-1')),
    queryClient.fetchQuery(billingSummaryQueryOptions(createLoader('billingSummary', {
      provider: 'stripe',
      productKey: 'premium_monthly',
      status: 'active',
      isPaid: true,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-04-01T00:00:00.000Z',
      managementMode: 'stripe_portal',
      managementUrl: '/account',
      providerMessage: null,
      providerProductId: 'price_123'
    }), 'viewer-1')),
    queryClient.fetchQuery(privacyPreferencesQueryOptions(createLoader('privacyPreferences', {
      analyticsEnabled: false,
      advertisingEnabled: false,
      preferencesUpdatedAt: '2026-03-09T12:00:00.000Z'
    }))),
    queryClient.fetchQuery(accountExportQueryOptions(createLoader('accountExport', {
      lastRequestedAt: null,
      downloadUrl: null
    })))
  ]);

  await queryClient.fetchQuery(
    searchQueryOptions(
      'starlink',
      createLoader('search', {
        query: 'starlink',
        results: [
          {
            id: 'launch-1',
            type: 'launch',
            title: 'Starlink 12',
            href: '/launches/launch-1'
          }
        ],
        tookMs: 10,
        limit: 8,
        offset: 0,
        hasMore: false
      })
    )
  );
  await queryClient.fetchQuery(
    searchQueryOptions(
      'starlink',
      createLoader('search', {
        query: 'starlink',
        results: [
          {
            id: 'launch-1',
            type: 'launch',
            title: 'Starlink 12',
            href: '/launches/launch-1'
          }
        ],
        tookMs: 10,
        limit: 8,
        offset: 0,
        hasMore: false
      })
    )
  );

  assert.equal(queryCounts.get('viewerSession'), 1);
  assert.equal(queryCounts.get('viewerEntitlements'), 1);
  assert.equal(queryCounts.get('launchFeed'), 1);
  assert.equal(queryCounts.get('watchlists'), 1);
  assert.equal(queryCounts.get('filterPresets'), 1);
  assert.equal(queryCounts.get('profile'), 1);
  assert.equal(queryCounts.get('notificationPreferences'), 1);
  assert.equal(queryCounts.get('marketingEmail'), 1);
  assert.equal(queryCounts.get('billingSummary'), 1);
  assert.equal(queryCounts.get('privacyPreferences'), 1);
  assert.equal(queryCounts.get('search'), 1);
}

function verifyNavigationAndReturnTo() {
  assert.equal(buildLaunchHref('launch-1'), '/launches/launch-1');
  assert.equal(buildSearchHref('starlink'), '/search?q=starlink');
  assert.equal(buildProfileHref(), '/account');
  assert.equal(buildSavedHref(), '/account/saved');
  assert.equal(buildUpgradeHref({ returnTo: '/account', autostart: true }), '/upgrade?return_to=%2Faccount&autostart=1');
  assert.equal(buildAuthHref('sign-in', { returnTo: '/account', intent: 'upgrade' }), '/auth/sign-in?return_to=%2Faccount&intent=upgrade');
  assert.equal(sanitizeReturnTo('/account?tab=billing', '/account'), '/account?tab=billing');
  assert.equal(sanitizeReturnTo('/upgrade', '/account'), '/upgrade');
  assert.equal(sanitizeReturnTo('https://evil.example/path', '/account'), '/account');
}

async function main() {
  try {
    verifyNavigationAndReturnTo();
    await verifyQueryReuse();
    console.log('web-regression-smoke: ok');
  } finally {
    queryClient.clear();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
