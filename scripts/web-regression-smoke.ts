import assert from 'node:assert/strict';
import {
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
} from '@tminuszero/query';
import {
  buildAuthHref,
  buildLaunchHref,
  buildProfileHref,
  buildSavedHref,
  buildSearchHref,
  buildUpgradeHref
} from '@tminuszero/navigation';
import {
  WebBillingAdapterError,
  cancelBillingSubscription,
  openBillingPortal,
  resumeBillingSubscription,
  startBillingCheckout,
  startBillingSetupIntent,
  updateDefaultPaymentMethod
} from '@/lib/api/webBillingAdapters';
import { sanitizeReturnToPath } from '@/lib/billing/shared';

type LoggedBillingRequest = {
  path: string;
  method: string;
  body: unknown;
};

async function main() {
  verifyNavigationAndReturnTo();
  await verifyQueryReuse();
  await verifyBillingAdapters();
  console.log('web-regression-smoke: ok');
}

async function verifyQueryReuse() {
  const queryClient = createSharedQueryClient();
  const queryCounts = new Map<string, number>();

  const count = <T,>(key: string, payload: T) => {
    return async () => {
      queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
      return payload;
    };
  };

  await queryClient.fetchQuery(
    viewerSessionQueryOptions(
      count('viewerSession', {
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
      count('viewerSession', {
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
      count('viewerEntitlements', {
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
          canUseBrowserLaunchAlerts: false,
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
      count('viewerEntitlements', {
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
          canUseBrowserLaunchAlerts: false,
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
        count('launchFeed', {
          launches: [],
          nextCursor: null,
          hasMore: false,
          freshness: 'public-cache-db',
          intervalMinutes: 120
        }),
        { scope: 'public' }
      )
    ),
    queryClient.fetchQuery(watchlistsQueryOptions(count('watchlists', { watchlists: [] }))),
    queryClient.fetchQuery(filterPresetsQueryOptions(count('filterPresets', { presets: [] })))
  ]);

  await Promise.all([
    queryClient.fetchQuery(
      profileQueryOptions(
        count('profile', {
          email: 'viewer@example.com',
          role: 'member',
          firstName: 'Launch',
          lastName: 'Viewer',
          timezone: 'America/New_York'
        })
      )
    ),
    queryClient.fetchQuery(
      notificationPreferencesQueryOptions(
        count('notificationPreferences', {
          pushEnabled: false,
          emailEnabled: false,
          launchDayEmailEnabled: false,
          launchDayEmailProviders: [],
          launchDayEmailStates: [],
          quietHoursEnabled: false,
          quietStartLocal: null,
          quietEndLocal: null
        })
      )
    ),
    queryClient.fetchQuery(
      marketingEmailQueryOptions(
        count('marketingEmail', {
          subscribed: true,
          updatedAt: '2026-03-09T12:00:00.000Z'
        })
      )
    ),
    queryClient.fetchQuery(
      privacyPreferencesQueryOptions(
        count('privacyPreferences', {
          analyticsEnabled: false,
          advertisingEnabled: false,
          preferencesUpdatedAt: '2026-03-09T12:00:00.000Z'
        })
      )
    ),
    queryClient.fetchQuery(
      accountExportQueryOptions(
        count('accountExport', {
          lastRequestedAt: null,
          downloadUrl: null
        })
      )
    )
  ]);

  await queryClient.fetchQuery(
    searchQueryOptions(
      'starlink',
      count('search', {
        query: 'starlink',
        results: [],
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
      count('search', {
        query: 'starlink',
        results: [],
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
  assert.equal(queryCounts.get('privacyPreferences'), 1);
  assert.equal(queryCounts.get('search'), 1);
}

async function verifyBillingAdapters() {
  const originalFetch = globalThis.fetch;
  const requests: LoggedBillingRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, 'https://tmz.local').pathname;
    const method = String(init?.method || 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    requests.push({ path, method, body });

    if (path === '/api/billing/checkout') {
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/session' }), { status: 200 });
    }
    if (path === '/api/billing/portal') {
      return new Response(JSON.stringify({ url: 'https://billing.stripe.com/session' }), { status: 200 });
    }
    if (path === '/api/billing/setup-intent') {
      return new Response(JSON.stringify({ clientSecret: 'seti_secret_123' }), { status: 200 });
    }
    if (path === '/api/billing/default-payment-method') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (path === '/api/billing/cancel') {
      return new Response(JSON.stringify({ status: 'active', currentPeriodEnd: '2026-03-31T00:00:00.000Z' }), { status: 200 });
    }
    if (path === '/api/billing/resume') {
      return new Response(JSON.stringify({ status: 'active', currentPeriodEnd: '2026-04-30T00:00:00.000Z' }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }) as typeof fetch;

  try {
    const checkout = await startBillingCheckout('/account');
    assert.equal(checkout.url.includes('checkout.stripe.com'), true);

    const portal = await openBillingPortal();
    assert.equal(portal.url.includes('billing.stripe.com'), true);

    const setupIntent = await startBillingSetupIntent();
    assert.equal(setupIntent.clientSecret, 'seti_secret_123');

    const updatedPaymentMethod = await updateDefaultPaymentMethod('pm_123');
    assert.equal(updatedPaymentMethod.ok, true);

    const canceled = await cancelBillingSubscription();
    assert.equal(canceled.status, 'active');

    const resumed = await resumeBillingSubscription();
    assert.equal(resumed.status, 'active');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'https://tmz.local').pathname;
      requests.push({
        path,
        method: String(init?.method || 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
      });

      return new Response(JSON.stringify({ error: 'already_subscribed', returnTo: '/account' }), { status: 409 });
    }) as typeof fetch;

    let adapterError: WebBillingAdapterError | null = null;
    try {
      await startBillingCheckout('/account');
    } catch (error) {
      adapterError = error as WebBillingAdapterError;
    }

    assert.ok(adapterError instanceof WebBillingAdapterError);
    assert.equal(adapterError?.code, 'already_subscribed');
    assert.equal(adapterError?.returnTo, '/account');

    assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.path}`), [
      'POST /api/billing/checkout',
      'POST /api/billing/portal',
      'POST /api/billing/setup-intent',
      'POST /api/billing/default-payment-method',
      'POST /api/billing/cancel',
      'POST /api/billing/resume',
      'POST /api/billing/checkout'
    ]);
    assert.deepEqual(requests[0]?.body, { returnTo: '/account' });
    assert.deepEqual(requests[3]?.body, { paymentMethod: 'pm_123' });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function verifyNavigationAndReturnTo() {
  assert.equal(buildLaunchHref('launch-1'), '/launches/launch-1');
  assert.equal(buildSearchHref('starlink'), '/search?q=starlink');
  assert.equal(buildProfileHref(), '/account');
  assert.equal(buildSavedHref(), '/account/saved');
  assert.equal(buildUpgradeHref({ returnTo: '/account', autostart: true }), '/upgrade?return_to=%2Faccount&autostart=1');
  assert.equal(buildAuthHref('sign-in', { returnTo: '/account', intent: 'upgrade' }), '/auth/sign-in?return_to=%2Faccount&intent=upgrade');
  assert.equal(sanitizeReturnToPath('/account?tab=billing'), '/account?tab=billing');
  assert.equal(sanitizeReturnToPath('/upgrade', '/account'), '/account');
  assert.equal(sanitizeReturnToPath('https://evil.example/path', '/account'), '/account');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
