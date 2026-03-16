import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApiClient } from '../packages/api-client/src/index.ts';
import {
  createSharedQueryClient,
  filterPresetsQueryOptions,
  launchFeedQueryOptions,
  marketingEmailQueryOptions,
  normalizeSearchQuery,
  notificationPreferencesQueryOptions,
  profileQueryOptions,
  searchQueryOptions,
  viewerEntitlementsQueryOptions,
  viewerSessionQueryOptions,
  watchlistsQueryOptions
} from '../packages/query/src/index.ts';

type LoggedRequest = {
  method: string;
  path: string;
  search: string;
};

type ScenarioCounts = {
  totalRequests: number;
  requestsByPath: Record<string, number>;
};

type ScenarioReport = {
  name: string;
  counts: ScenarioCounts;
  assertions: string[];
};

type MobileQueryGuardReport = {
  generatedAt: string;
  scenarios: ScenarioReport[];
};

type MockResponseResolver = (url: URL, init: RequestInit | undefined) => unknown;

const launchId = '11111111-1111-4111-8111-111111111111';
const searchQuery = 'starlink';
const launchDayFilterOptionsKey = ['launch-day-email-filter-options'] as const;

const payloadByPath = new Map<string, MockResponseResolver>([
  [
    '/api/v1/viewer/session',
    () => ({
      viewerId: launchId,
      email: 'viewer@example.com',
      role: 'member',
      accessToken: null,
      expiresAt: null,
      authMode: 'cookie',
      mobileHubRollout: {
        blueOrigin: { nativeEnabled: false, externalDeepLinksEnabled: false },
        spacex: { nativeEnabled: false, externalDeepLinksEnabled: false },
        artemis: { nativeEnabled: false, externalDeepLinksEnabled: false }
      }
    })
  ],
  [
    '/api/v1/viewer/entitlements',
    () => ({
      tier: 'free',
      status: 'active',
      source: 'stripe',
      isPaid: false,
      isAdmin: false,
      isAuthed: true,
      mode: 'public',
      refreshIntervalSeconds: 900,
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
        watchlistRuleLimit: 0
      },
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      stripePriceId: null,
      reconciled: true,
      reconcileThrottled: false
    })
  ],
  [
    '/api/v1/launches',
    () => ({
      launches: [
        {
          id: launchId,
          ll2Id: 'll2-sample-launch',
          slug: 'sample-launch',
          name: 'Sample Launch',
          provider: 'Sample Provider',
          vehicle: 'Falcon 9 Block 5',
          pad: {
            name: 'LC-39A',
            shortCode: '39A',
            state: 'Florida',
            timezone: 'America/New_York',
            locationName: 'Kennedy Space Center',
            countryCode: 'USA',
            mapUrl: null,
            latitude: 28.6084,
            longitude: -80.6043
          },
          net: '2026-03-08T12:00:00.000Z',
          netPrecision: 'minute',
          image: {
            thumbnail: 'https://example.com/launch-thumb.jpg',
            full: 'https://example.com/launch.jpg',
            credit: 'Example Credit'
          },
          tier: 'major',
          status: 'go',
          statusText: 'Go for launch',
          imageUrl: 'https://example.com/launch.jpg'
        }
      ],
      nextCursor: null,
      hasMore: false,
      freshness: 'public-cache-db',
      intervalMinutes: 15
    })
  ],
  [
    '/api/v1/search',
    (url) => ({
      query: url.searchParams.get('q') || '',
      results: [
        {
          id: launchId,
          type: 'launch',
          title: 'Sample Launch',
          subtitle: 'Sample Provider',
          summary: 'Upcoming launch.',
          href: `/launches/${launchId}`,
          imageUrl: 'https://example.com/launch.jpg',
          badge: 'Launch',
          publishedAt: '2026-03-08T12:00:00.000Z'
        }
      ],
      tookMs: 12,
      limit: 8,
      offset: 0,
      hasMore: false
    })
  ],
  [
    '/api/v1/me/profile',
    () => ({
      viewerId: launchId,
      email: 'viewer@example.com',
      role: 'member',
      firstName: 'Ada',
      lastName: 'Lovelace',
      timezone: 'America/New_York',
      emailConfirmedAt: '2026-03-08T12:00:00.000Z',
      createdAt: '2026-03-01T12:00:00.000Z'
    })
  ],
  [
    '/api/v1/me/marketing-email',
    () => ({
      marketingEmailOptIn: false,
      updatedAt: '2026-03-08T12:00:00.000Z'
    })
  ],
  [
    '/api/v1/me/notification-preferences',
    () => ({
      pushEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      launchDayEmailEnabled: false,
      launchDayEmailProviders: [],
      launchDayEmailStates: [],
      quietHoursEnabled: false,
      quietStartLocal: null,
      quietEndLocal: null,
      smsVerified: false,
      smsPhone: null,
      smsSystemEnabled: true
    })
  ],
  [
    '/api/v1/me/watchlists',
    () => ({
      watchlists: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'My Launches',
          ruleCount: 1,
          createdAt: '2026-03-08T12:00:00.000Z',
          rules: [
            {
              id: '44444444-4444-4444-8444-444444444444',
              ruleType: 'launch',
              ruleValue: launchId,
              createdAt: '2026-03-08T12:00:00.000Z'
            }
          ]
        }
      ]
    })
  ],
  [
    '/api/v1/me/filter-presets',
    () => ({
      presets: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Florida',
          filters: { region: 'us', state: 'Florida' },
          isDefault: true,
          createdAt: '2026-03-08T12:00:00.000Z',
          updatedAt: '2026-03-08T12:00:00.000Z'
        }
      ]
    })
  ],
  [
    '/api/filters',
    () => ({
      providers: ['Sample Provider', 'SpaceX'],
      states: ['California', 'Florida']
    })
  ]
]);

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    const [key, ...rest] = trimmed.split('=');
    args.set(key, rest.join('='));
  }
  return args;
}

function ensureParentDir(filePath: string | null) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string | null, value: unknown) {
  if (!filePath) return;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string | null, markdown: string) {
  if (!filePath) return;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function createMockRuntime() {
  const requestLog: LoggedRequest[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    requestLog.push({
      method: init?.method || 'GET',
      path: url.pathname,
      search: url.search
    });

    const resolver = payloadByPath.get(url.pathname);
    if (!resolver) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(resolver(url, init)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const client = createApiClient({
    baseUrl: 'https://tmz.test',
    auth: { mode: 'cookie' },
    fetchImpl
  });
  const queryClient = createSharedQueryClient();

  return {
    client,
    fetchImpl,
    queryClient,
    requestLog,
    cleanup() {
      queryClient.clear();
    }
  };
}

function summarizeRequests(requestLog: LoggedRequest[]): ScenarioCounts {
  const requestsByPath = new Map<string, number>();

  for (const request of requestLog) {
    const key = `${request.method} ${request.path}${request.search}`;
    requestsByPath.set(key, (requestsByPath.get(key) || 0) + 1);
  }

  return {
    totalRequests: requestLog.length,
    requestsByPath: Object.fromEntries([...requestsByPath.entries()].sort(([left], [right]) => left.localeCompare(right)))
  };
}

async function fetchLaunchDayEmailFilterOptions(fetchImpl: typeof fetch) {
  const response = await fetchImpl('https://tmz.test/api/filters?mode=live&region=all', {
    method: 'GET'
  });
  return await response.json();
}

async function runScenario(name: string, action: () => Promise<void>, assertions: string[]) {
  await action();
  return { name, assertions };
}

export async function collectMobileQueryGuardReport(): Promise<MobileQueryGuardReport> {
  const scenarios: ScenarioReport[] = [];

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'viewer bootstrap',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession())),
            queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession())),
            queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements())),
            queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements()))
          ]);
        },
        [
          'viewer session bootstrap dedupes to one request',
          'viewer entitlements bootstrap dedupes to one request'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/viewer/session'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/viewer/entitlements'] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'feed bootstrap',
        async () => {
          await queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession()));
          await queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements()));
          await Promise.all([
            queryClient.fetchQuery(launchFeedQueryOptions(() => client.getLaunchFeed({ limit: 20, region: 'all' }))),
            queryClient.fetchQuery(filterPresetsQueryOptions(() => client.getFilterPresets())),
            queryClient.fetchQuery(watchlistsQueryOptions(() => client.getWatchlists()))
          ]);
          await Promise.all([
            queryClient.fetchQuery(launchFeedQueryOptions(() => client.getLaunchFeed({ limit: 20, region: 'all' }))),
            queryClient.fetchQuery(filterPresetsQueryOptions(() => client.getFilterPresets())),
            queryClient.fetchQuery(watchlistsQueryOptions(() => client.getWatchlists()))
          ]);
        },
        [
          'feed bootstrap uses one launches request',
          'feed saved-state bootstrap reuses preset and watchlist cache on repeat reads'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/launches?limit=20&region=all'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/filter-presets'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/watchlists'] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'search fan-out and cache',
        async () => {
          const normalized = normalizeSearchQuery(`  ${searchQuery}  `);
          await queryClient.fetchQuery(searchQueryOptions(normalized, () => client.search(normalized), { limit: 8 }));
          await queryClient.fetchQuery(searchQueryOptions(searchQuery, () => client.search(searchQuery), { limit: 8 }));
        },
        ['normalized duplicate search queries reuse one /api/v1/search request']
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath[`GET /api/v1/search?q=${encodeURIComponent(searchQuery)}`] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, fetchImpl, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'account bootstrap',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession())),
            queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements()))
          ]);
          await Promise.all([
            queryClient.fetchQuery(profileQueryOptions(() => client.getProfile())),
            queryClient.fetchQuery(marketingEmailQueryOptions(() => client.getMarketingEmail())),
            queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences())),
            queryClient.fetchQuery({
              queryKey: launchDayFilterOptionsKey,
              queryFn: () => fetchLaunchDayEmailFilterOptions(fetchImpl),
              staleTime: 5 * 60_000
            })
          ]);
          await Promise.all([
            queryClient.fetchQuery(profileQueryOptions(() => client.getProfile())),
            queryClient.fetchQuery(marketingEmailQueryOptions(() => client.getMarketingEmail())),
            queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences())),
            queryClient.fetchQuery({
              queryKey: launchDayFilterOptionsKey,
              queryFn: () => fetchLaunchDayEmailFilterOptions(fetchImpl),
              staleTime: 5 * 60_000
            })
          ]);
        },
        [
          'account bootstrap reuses profile, marketing email, notification preferences, and launch-day filter caches'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/me/profile'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/marketing-email'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/notification-preferences'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/filters?mode=live&region=all'] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'saved bootstrap',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession())),
            queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements()))
          ]);
          await Promise.all([
            queryClient.fetchQuery(filterPresetsQueryOptions(() => client.getFilterPresets())),
            queryClient.fetchQuery(watchlistsQueryOptions(() => client.getWatchlists()))
          ]);
        },
        ['saved bootstrap uses one preset request', 'saved bootstrap uses one watchlist request']
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/me/filter-presets'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/watchlists'] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'preferences bootstrap',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(viewerSessionQueryOptions(() => client.getViewerSession())),
            queryClient.fetchQuery(viewerEntitlementsQueryOptions(() => client.getViewerEntitlements())),
            queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences()))
          ]);
          await queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences()));
        },
        ['preferences bootstrap keeps notification preferences app-scoped and reusable']
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/me/notification-preferences'] ?? 0, 1);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    scenarios
  };
}

function renderMarkdown(report: MobileQueryGuardReport) {
  const lines = ['# Mobile Query Guard', '', `Generated: ${report.generatedAt}`, ''];

  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.name}`);
    lines.push('');
    lines.push(`- Total requests: ${scenario.counts.totalRequests}`);
    for (const assertion of scenario.assertions) {
      lines.push(`- ${assertion}`);
    }
    lines.push('');
    lines.push('| request | count |');
    lines.push('| --- | ---: |');
    for (const [request, count] of Object.entries(scenario.counts.requestsByPath)) {
      lines.push(`| \`${request}\` | ${count} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await collectMobileQueryGuardReport();

  writeJson(args.get('output') || null, report);
  writeMarkdown(args.get('markdown') || null, renderMarkdown(report));

  console.log(`mobile-query-guard: ok (${report.scenarios.length} scenarios)`);
}

await main();
