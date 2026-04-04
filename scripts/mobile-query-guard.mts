import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApiClient } from '../packages/api-client/src/index.ts';
import {
  createSharedQueryClient,
  filterPresetsQueryOptions,
  launchFaaAirspaceMapQueryOptions,
  launchFeedQueryOptions,
  launchFeedVersionQueryOptions,
  launchDetailVersionQueryOptions,
  marketingEmailQueryOptions,
  normalizeSearchQuery,
  notificationPreferencesQueryOptions,
  profileQueryOptions,
  searchQueryOptions,
  spaceXDroneShipDetailQueryOptions,
  spaceXDroneShipsQueryOptions,
  starshipFlightOverviewQueryOptions,
  starshipOverviewQueryOptions,
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
      intervalMinutes: 120
    })
  ],
  [
    '/api/v1/launches/version',
    () => ({
      scope: 'public',
      tier: 'anon',
      intervalSeconds: 7200,
      recommendedIntervalSeconds: 7200,
      cadenceReason: 'default',
      cadenceAnchorNet: null,
      matchCount: 1,
      updatedAt: '2026-03-08T12:00:00.000Z',
      version: 'public|2026-03-08T12:00:00.000Z|1'
    })
  ],
  [
    `/api/v1/launches/${launchId}/version`,
    () => ({
      launchId,
      scope: 'public',
      tier: 'anon',
      intervalSeconds: 7200,
      recommendedIntervalSeconds: 7200,
      cadenceReason: 'default',
      cadenceAnchorNet: null,
      updatedAt: '2026-03-08T12:00:00.000Z',
      version: `${launchId}|public|2026-03-08T12:00:00.000Z`
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
      pushEnabled: false,
      emailEnabled: false,
      launchDayEmailEnabled: false,
      launchDayEmailProviders: [],
      launchDayEmailStates: [],
      quietHoursEnabled: false,
      quietStartLocal: null,
      quietEndLocal: null
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
    `/api/v1/launches/${launchId}/faa-airspace-map`,
    () => ({
      launchId,
      generatedAt: '2026-03-08T12:00:00.000Z',
      advisoryCount: 1,
      hasRenderableGeometry: true,
      pad: {
        latitude: 28.6084,
        longitude: -80.6043,
        label: '39A',
        shortCode: '39A',
        locationName: 'Kennedy Space Center'
      },
      bounds: {
        minLatitude: 28.55,
        minLongitude: -80.66,
        maxLatitude: 28.67,
        maxLongitude: -80.53
      },
      advisories: [
        {
          matchId: 'faa-match-1',
          launchId,
          tfrRecordId: 'faa-record-1',
          tfrShapeId: 'faa-shape-1',
          matchStatus: 'matched',
          matchConfidence: 98,
          matchScore: 98,
          matchStrategy: 'v1_time_shape_state',
          matchedAt: '2026-03-08T11:55:00.000Z',
          notamId: '6/5918',
          title: 'SPACE OPERATIONS',
          type: 'SPACE OPERATIONS',
          facility: 'ZJX',
          state: 'FL',
          status: 'active',
          validStart: '2026-03-08T11:42:00.000Z',
          validEnd: '2026-03-08T16:34:00.000Z',
          isActiveNow: true,
          hasShape: true,
          shapeCount: 1,
          rawText: '!FDC 6/5918 ZJX FL..SPACE OPERATIONS..TEMPORARY FLIGHT RESTRICTIONS WITHIN AN AREA DEFINED AS 285100N/0804100W TO 284900N/0804200W TO 285300N/0803000W.',
          rawTextFetchedAt: '2026-03-08T11:56:00.000Z',
          sourceGraphicUrl: 'https://tfr.faa.gov/tfr3/?page=detail_6_5918.html',
          sourceRawUrl: 'https://tfr.faa.gov/tfrapi/getWebText?notamId=6%2F5918',
          sourceUrl: 'https://tfr.faa.gov/tfr3/?page=detail_6_5918.html',
          matchMeta: null,
          polygons: [
            {
              polygonId: 'faa-shape-1:0',
              outerRing: [
                { latitude: 28.55, longitude: -80.64 },
                { latitude: 28.61, longitude: -80.66 },
                { latitude: 28.67, longitude: -80.57 },
                { latitude: 28.58, longitude: -80.53 }
              ],
              holes: [],
              bounds: {
                minLatitude: 28.55,
                minLongitude: -80.66,
                maxLatitude: 28.67,
                maxLongitude: -80.53
              }
            }
          ]
        }
      ]
    })
  ],
  [
    '/api/v1/spacex/drone-ships',
    () => ({
      generatedAt: '2026-03-08T12:00:00.000Z',
      items: [
        {
          slug: 'asog',
          name: 'A Shortfall of Gravitas',
          abbrev: 'ASOG',
          status: 'active',
          description: 'Atlantic drone ship supporting Falcon booster recovery.',
          wikidataId: null,
          wikiSourceUrl: null,
          wikipediaUrl: null,
          wikimediaCommonsCategory: null,
          wikiLastSyncedAt: '2026-03-08T10:00:00.000Z',
          imageUrl: null,
          imageSourceUrl: null,
          imageLicense: null,
          imageLicenseUrl: null,
          imageCredit: null,
          imageAlt: null,
          lengthM: 91.4,
          yearBuilt: 2021,
          homePort: 'Port Canaveral',
          ownerName: 'SpaceX',
          operatorName: 'SpaceX',
          countryName: 'United States',
          kpis: {
            assignmentsKnown: 12,
            upcomingAssignments: 2,
            assignmentsPastYear: 5,
            distinctBoostersRecovered: 4,
            distinctLaunchSitesServed: 2,
            coveragePercent: 82.5,
            firstAssignmentDate: '2024-01-01T00:00:00.000Z',
            lastAssignmentDate: '2026-03-01T00:00:00.000Z'
          }
        }
      ],
      coverage: {
        generatedAt: '2026-03-08T12:00:00.000Z',
        totalSpaceXLaunches: 100,
        knownLandingAssignments: 82,
        coveragePercent: 82,
        upcomingKnownAssignments: 2,
        lastVerifiedAt: '2026-03-08T11:45:00.000Z'
      },
      upcomingAssignments: [
        {
          launchId,
          ll2LaunchUuid: 'll2-sample-launch',
          launchName: 'Starlink Group 99',
          launchSlug: 'sample-launch',
          launchNet: '2026-03-08T12:00:00.000Z',
          launchHref: `/launches/${launchId}`,
          flightSlug: 'falcon-9',
          missionKey: 'falcon-9',
          missionLabel: 'Falcon 9',
          provider: 'SpaceX',
          vehicle: 'Falcon 9',
          padName: 'SLC-40',
          padShortCode: 'SLC-40',
          padLocationName: 'Cape Canaveral',
          shipSlug: 'asog',
          shipName: 'A Shortfall of Gravitas',
          shipAbbrev: 'ASOG',
          landingResult: 'unknown',
          landingAttempt: true,
          landingSuccess: null,
          landingTime: null,
          source: 'internal',
          sourceLandingId: null,
          lastVerifiedAt: '2026-03-08T11:45:00.000Z'
        }
      ]
    })
  ],
  [
    '/api/v1/spacex/drone-ships/asog',
    () => ({
      generatedAt: '2026-03-08T12:00:00.000Z',
      ship: {
        slug: 'asog',
        name: 'A Shortfall of Gravitas',
        abbrev: 'ASOG',
        status: 'active',
        description: 'Atlantic drone ship supporting Falcon booster recovery.',
        wikidataId: null,
        wikiSourceUrl: null,
        wikipediaUrl: null,
        wikimediaCommonsCategory: null,
        wikiLastSyncedAt: '2026-03-08T10:00:00.000Z',
        imageUrl: null,
        imageSourceUrl: null,
        imageLicense: null,
        imageLicenseUrl: null,
        imageCredit: null,
        imageAlt: null,
        lengthM: 91.4,
        yearBuilt: 2021,
        homePort: 'Port Canaveral',
        ownerName: 'SpaceX',
        operatorName: 'SpaceX',
        countryName: 'United States',
        kpis: {
          assignmentsKnown: 12,
          upcomingAssignments: 2,
          assignmentsPastYear: 5,
          distinctBoostersRecovered: 4,
          distinctLaunchSitesServed: 2,
          coveragePercent: 82.5,
          firstAssignmentDate: '2024-01-01T00:00:00.000Z',
          lastAssignmentDate: '2026-03-01T00:00:00.000Z'
        }
      },
      coverage: {
        generatedAt: '2026-03-08T12:00:00.000Z',
        totalSpaceXLaunches: 100,
        knownLandingAssignments: 82,
        coveragePercent: 82,
        upcomingKnownAssignments: 2,
        lastVerifiedAt: '2026-03-08T11:45:00.000Z'
      },
      upcomingAssignments: [
        {
          launchId,
          ll2LaunchUuid: 'll2-sample-launch',
          launchName: 'Starlink Group 99',
          launchSlug: 'sample-launch',
          launchNet: '2026-03-08T12:00:00.000Z',
          launchHref: `/launches/${launchId}`,
          flightSlug: 'falcon-9',
          missionKey: 'falcon-9',
          missionLabel: 'Falcon 9',
          provider: 'SpaceX',
          vehicle: 'Falcon 9',
          padName: 'SLC-40',
          padShortCode: 'SLC-40',
          padLocationName: 'Cape Canaveral',
          shipSlug: 'asog',
          shipName: 'A Shortfall of Gravitas',
          shipAbbrev: 'ASOG',
          landingResult: 'unknown',
          landingAttempt: true,
          landingSuccess: null,
          landingTime: null,
          source: 'internal',
          sourceLandingId: null,
          lastVerifiedAt: '2026-03-08T11:45:00.000Z'
        }
      ],
      recentAssignments: [
        {
          launchId,
          ll2LaunchUuid: 'll2-sample-launch',
          launchName: 'Crew-11',
          launchSlug: 'crew-11',
          launchNet: '2026-02-01T12:00:00.000Z',
          launchHref: `/launches/${launchId}`,
          flightSlug: 'falcon-9',
          missionKey: 'falcon-9',
          missionLabel: 'Falcon 9',
          provider: 'SpaceX',
          vehicle: 'Falcon 9',
          padName: 'LC-39A',
          padShortCode: '39A',
          padLocationName: 'Kennedy Space Center',
          shipSlug: 'asog',
          shipName: 'A Shortfall of Gravitas',
          shipAbbrev: 'ASOG',
          landingResult: 'success',
          landingAttempt: true,
          landingSuccess: true,
          landingTime: '2026-02-01T12:12:00.000Z',
          source: 'internal',
          sourceLandingId: 'landing-1',
          lastVerifiedAt: '2026-02-01T12:30:00.000Z'
        }
      ],
      launchSites: [
        {
          name: 'Cape Canaveral',
          count: 9
        }
      ],
      missionMix: [
        {
          missionKey: 'falcon-9',
          missionLabel: 'Falcon 9',
          count: 12
        }
      ],
      boosters: [
        {
          ll2LauncherId: 123,
          serialNumber: 'B1075',
          missions: 4
        }
      ]
    })
  ],
  [
    '/api/v1/starship',
    () => ({
      generatedAt: '2026-03-08T12:00:00.000Z',
      title: 'Starship Program Workbench',
      description: 'Native mobile workbench for Starship flights, timeline, and next-launch context.',
      snapshot: {
        generatedAt: '2026-03-08T12:00:00.000Z',
        lastUpdated: '2026-03-08T11:45:00.000Z',
        nextLaunch: {
          id: launchId,
          name: 'Starship Flight 10',
          provider: 'SpaceX',
          vehicle: 'Starship',
          net: '2026-04-15T12:00:00.000Z',
          netPrecision: 'minute',
          status: 'go',
          statusText: 'Go',
          imageUrl: null,
          padName: 'Orbital Launch Mount A',
          padShortCode: 'OLM-A',
          padLocation: 'Starbase',
          missionName: 'Integrated flight test',
          missionKey: 'starship',
          flightSlug: 'flight-10',
          href: '/starship/flight-10'
        },
        upcoming: [],
        recent: [],
        faq: [
          {
            question: 'What does the workbench track?',
            answer: 'Native flight previews, timeline events, and the next launch state.'
          }
        ]
      },
      stats: {
        upcomingLaunches: 1,
        recentLaunches: 2,
        flightsTracked: 10,
        timelineEvents: 4
      },
      flights: [
        {
          flightNumber: 10,
          flightSlug: 'flight-10',
          label: 'Flight 10',
          nextLaunch: {
            id: launchId,
            name: 'Starship Flight 10',
            provider: 'SpaceX',
            vehicle: 'Starship',
            net: '2026-04-15T12:00:00.000Z',
            netPrecision: 'minute',
            status: 'go',
            statusText: 'Go',
            imageUrl: null,
            padName: 'Orbital Launch Mount A',
            padShortCode: 'OLM-A',
            padLocation: 'Starbase',
            missionName: 'Integrated flight test',
            missionKey: 'starship',
            flightSlug: 'flight-10',
            href: '/starship/flight-10'
          },
          upcomingCount: 1,
          recentCount: 0,
          lastUpdated: '2026-03-08T11:45:00.000Z'
        }
      ],
      timeline: [
        {
          id: 'timeline-1',
          missionLabel: 'Flight 10',
          title: 'Static fire campaign',
          summary: 'Vehicle completed a multi-engine static fire ahead of launch window targeting.',
          date: '2026-03-05T18:00:00.000Z',
          status: 'completed',
          sourceLabel: 'Program note',
          href: '/starship/flight-10'
        }
      ]
    })
  ],
  [
    '/api/v1/starship/flight-10',
    () => ({
      generatedAt: '2026-03-08T12:00:00.000Z',
      title: 'Starship Flight 10',
      description: 'Flight-level mobile summary for Starship integrated flight testing.',
      snapshot: {
        generatedAt: '2026-03-08T12:00:00.000Z',
        lastUpdated: '2026-03-08T11:45:00.000Z',
        missionName: 'Starship Flight 10',
        flightNumber: 10,
        flightSlug: 'flight-10',
        nextLaunch: {
          id: launchId,
          name: 'Starship Flight 10',
          provider: 'SpaceX',
          vehicle: 'Starship',
          net: '2026-04-15T12:00:00.000Z',
          netPrecision: 'minute',
          status: 'go',
          statusText: 'Go',
          imageUrl: null,
          padName: 'Orbital Launch Mount A',
          padShortCode: 'OLM-A',
          padLocation: 'Starbase',
          missionName: 'Integrated flight test',
          missionKey: 'starship',
          flightSlug: 'flight-10',
          href: '/starship/flight-10'
        },
        upcoming: [],
        recent: [],
        crewHighlights: ['Booster hot-staging iteration', 'Ship reentry profile update'],
        changes: [
          {
            title: 'Window retargeted',
            summary: 'Launch window moved later in the month while range work closes out.',
            date: '2026-03-07T16:00:00.000Z',
            href: '/starship/flight-10'
          }
        ],
        faq: [
          {
            question: 'Why a dedicated flight screen?',
            answer: 'Starship program flights have richer change tracking than the generic mission shell.'
          }
        ]
      },
      timeline: [
        {
          id: 'timeline-1',
          missionLabel: 'Flight 10',
          title: 'Static fire campaign',
          summary: 'Vehicle completed a multi-engine static fire ahead of launch window targeting.',
          date: '2026-03-05T18:00:00.000Z',
          status: 'completed',
          sourceLabel: 'Program note',
          href: '/starship/flight-10'
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
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
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
            queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences()))
          ]);
          await Promise.all([
            queryClient.fetchQuery(profileQueryOptions(() => client.getProfile())),
            queryClient.fetchQuery(marketingEmailQueryOptions(() => client.getMarketingEmail())),
            queryClient.fetchQuery(notificationPreferencesQueryOptions(() => client.getNotificationPreferences()))
          ]);
        },
        [
          'account bootstrap reuses profile, marketing email, and notification preference caches'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/me/profile'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/marketing-email'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/me/notification-preferences'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/filters?mode=live&region=all'] ?? 0, 0);
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

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'launch faa map cache',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(
              launchFaaAirspaceMapQueryOptions(launchId, () => client.getLaunchFaaAirspaceMap(launchId))
            ),
            queryClient.fetchQuery(
              launchFaaAirspaceMapQueryOptions(launchId, () => client.getLaunchFaaAirspaceMap(launchId))
            )
          ]);
        },
        ['launch FAA map geometry dedupes to one request and stays separate from launch detail payloads']
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath[`GET /api/v1/launches/${launchId}/faa-airspace-map`] ?? 0, 1);
      assert.equal(counts.requestsByPath[`GET /api/v1/launches/${launchId}`] ?? 0, 0);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'program hub native cache',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(spaceXDroneShipsQueryOptions(() => client.getSpaceXDroneShips())),
            queryClient.fetchQuery(spaceXDroneShipsQueryOptions(() => client.getSpaceXDroneShips())),
            queryClient.fetchQuery(starshipOverviewQueryOptions(() => client.getStarshipOverview())),
            queryClient.fetchQuery(starshipOverviewQueryOptions(() => client.getStarshipOverview()))
          ]);
          await Promise.all([
            queryClient.fetchQuery(
              spaceXDroneShipDetailQueryOptions('asog', () => client.getSpaceXDroneShipDetail('asog'))
            ),
            queryClient.fetchQuery(
              spaceXDroneShipDetailQueryOptions('asog', () => client.getSpaceXDroneShipDetail('asog'))
            ),
            queryClient.fetchQuery(
              starshipFlightOverviewQueryOptions('flight-10', () => client.getStarshipFlightOverview('flight-10'))
            ),
            queryClient.fetchQuery(
              starshipFlightOverviewQueryOptions('flight-10', () => client.getStarshipFlightOverview('flight-10'))
            )
          ]);
        },
        [
          'program hub list and detail queries dedupe by stable shared query keys',
          'Starship and recovery-fleet native routes stay isolated from the generic SpaceX overview payload'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/spacex/drone-ships'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/spacex/drone-ships/asog'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/starship'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/starship/flight-10'] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/spacex'] ?? 0, 0);
      scenarios.push({ ...scenario, counts });
    } finally {
      cleanup();
    }
  }

  {
    const { client, queryClient, requestLog, cleanup } = createMockRuntime();
    try {
      const scenario = await runScenario(
        'refresh version checks',
        async () => {
          await Promise.all([
            queryClient.fetchQuery(
              launchFeedVersionQueryOptions(
                () => client.getLaunchFeedVersion({ scope: 'public', range: '7d', region: 'all' }),
                { scope: 'public', range: '7d', region: 'all' }
              )
            ),
            queryClient.fetchQuery(
              launchFeedVersionQueryOptions(
                () => client.getLaunchFeedVersion({ scope: 'public', range: '7d', region: 'all' }),
                { scope: 'public', range: '7d', region: 'all' }
              )
            ),
            queryClient.fetchQuery(
              launchDetailVersionQueryOptions(
                launchId,
                () => client.getLaunchDetailVersion(launchId, { scope: 'public' }),
                { scope: 'public' }
              )
            ),
            queryClient.fetchQuery(
              launchDetailVersionQueryOptions(
                launchId,
                () => client.getLaunchDetailVersion(launchId, { scope: 'public' }),
                { scope: 'public' }
              )
            )
          ]);
        },
        [
          'feed and detail version checks dedupe on shared query keys',
          'version checks do not trigger full feed or full detail payload requests'
        ]
      );
      const counts = summarizeRequests(requestLog);
      assert.equal(counts.requestsByPath['GET /api/v1/launches/version?scope=public&range=7d&region=all'] ?? 0, 1);
      assert.equal(counts.requestsByPath[`GET /api/v1/launches/${launchId}/version?scope=public`] ?? 0, 1);
      assert.equal(counts.requestsByPath['GET /api/v1/launches'] ?? 0, 0);
      assert.equal(counts.requestsByPath[`GET /api/v1/launches/${launchId}`] ?? 0, 0);
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
