import assert from 'node:assert/strict';
import { ApiClientError, createApiClient } from '../packages/api-client/src/index.ts';

type LoggedRequest = {
  method: string;
  path: string;
  search: string;
  credentials: string | undefined;
  authorization: string | null;
  body: unknown;
};

const launchId = '11111111-1111-4111-8111-111111111111';

function parseBody(init: RequestInit | undefined) {
  if (!init?.body || typeof init.body !== 'string') {
    return undefined;
  }

  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

async function main() {
  const requestLog: LoggedRequest[] = [];

  const baseEntitlements = {
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
  } as const;

  const payloads = {
    viewerSession: {
      viewerId: null,
      email: null,
      role: 'guest',
      accessToken: null,
      expiresAt: null,
      authMode: 'guest',
      mobileHubRollout: {
        blueOrigin: { nativeEnabled: false, externalDeepLinksEnabled: false },
        spacex: { nativeEnabled: false, externalDeepLinksEnabled: false },
        artemis: { nativeEnabled: false, externalDeepLinksEnabled: false }
      }
    },
    viewerSessionBearer: {
      viewerId: launchId,
      email: 'viewer@example.com',
      role: 'member',
      accessToken: 'tmz-bearer',
      expiresAt: '2026-03-08T12:00:00.000Z',
      authMode: 'bearer',
      mobileHubRollout: {
        blueOrigin: { nativeEnabled: false, externalDeepLinksEnabled: false },
        spacex: { nativeEnabled: false, externalDeepLinksEnabled: false },
        artemis: { nativeEnabled: false, externalDeepLinksEnabled: false }
      }
    },
    entitlements: baseEntitlements,
    launchFeed: {
      launches: [
        {
          id: launchId,
          ll2Id: 'd7fce970-65bb-4fd2-9170-fcbe9f0ebc61',
          ll2AgencyId: 121,
          ll2PadId: 87,
          ll2RocketConfigId: 44,
          cacheGeneratedAt: '2026-03-08T11:58:00.000Z',
          slug: 'sample-launch',
          name: 'Sample Launch',
          launchDesignator: 'SL-42',
          agencyLaunchAttemptCount: 12,
          agencyLaunchAttemptCountYear: 3,
          locationLaunchAttemptCount: 19,
          locationLaunchAttemptCountYear: 4,
          orbitalLaunchAttemptCount: 27,
          orbitalLaunchAttemptCountYear: 5,
          padLaunchAttemptCount: 8,
          padLaunchAttemptCountYear: 2,
          padTurnaround: '17d',
          provider: 'Sample Provider',
          providerType: 'Commercial',
          providerCountryCode: 'USA',
          providerDescription: 'Sample launch provider.',
          providerLogoUrl: 'https://example.com/provider-logo.png',
          providerImageUrl: 'https://example.com/provider-image.png',
          vehicle: 'Falcon 9',
          rocket: {
            fullName: 'Falcon 9 Block 5',
            family: 'Falcon',
            variant: 'Block 5'
          },
          mission: {
            name: 'Starlink Group 99',
            type: 'Communications',
            description: 'Deploy broadband satellites.',
            orbit: 'LEO'
          },
          pad: {
            name: 'SLC-40',
            shortCode: 'SLC-40',
            state: 'Florida',
            timezone: 'America/New_York',
            locationName: 'Cape Canaveral',
            countryCode: 'USA',
            mapUrl: null,
            latitude: 28.5618571,
            longitude: -80.577366
          },
          net: '2026-03-08T12:00:00.000Z',
          netPrecision: 'minute',
          windowStart: '2026-03-08T12:00:00.000Z',
          windowEnd: '2026-03-08T12:30:00.000Z',
          webcastLive: true,
          videoUrl: 'https://example.com/watch',
          image: {
            thumbnail: 'https://example.com/launch.jpg',
            full: 'https://example.com/launch-full.jpg'
          },
          tier: 'major',
          status: 'go',
          statusText: 'Go',
          featured: true,
          hidden: false,
          payloads: [
            {
              name: 'Starlink',
              type: 'Satellite',
              orbit: 'LEO',
              agency: 'SpaceX'
            }
          ],
          launchInfoUrls: [
            {
              url: 'https://example.com/info',
              title: 'Mission page'
            }
          ],
          launchVidUrls: [
            {
              url: 'https://example.com/watch',
              title: 'Webcast',
              publisher: 'TMZ'
            }
          ],
          missionPatches: [
            {
              name: 'Primary patch',
              image_url: 'https://example.com/patch.png'
            }
          ],
          updates: [
            {
              id: 1,
              comment: 'Holding T-0',
              created_on: '2026-03-08T11:00:00.000Z'
            }
          ],
          timeline: [
            {
              relative_time: 'T-00:10:00'
            }
          ],
          currentEvent: {
            id: 1,
            name: 'Fueling',
            date: '2026-03-08T11:50:00.000Z'
          },
          nextEvent: {
            id: 2,
            name: 'Liftoff',
            date: '2026-03-08T12:00:00.000Z'
          },
          lastUpdated: '2026-03-08T11:59:00.000Z',
          updatedFields: ['net', 'status_abbrev'],
          changeSummary: 'NET change and status update'
        }
      ],
      nextCursor: null,
      hasMore: false,
      freshness: 'public-cache-db',
      intervalMinutes: 120,
      intervalSeconds: null,
      tier: null,
      scope: 'public'
    },
    changedLaunches: {
      hours: 24,
      tier: 'premium',
      intervalSeconds: 15,
      results: [
        {
          launchId,
          name: 'Sample Launch',
          summary: 'NET change and status update',
          lastUpdated: '2026-03-08T11:59:00.000Z',
          lastUpdatedLabel: '11:59 AM',
          entries: [
            {
              updateId: 'launch-update-1',
              changeSummary: 'NET change',
              updatedFields: ['net'],
              detectedAt: '2026-03-08T11:59:00.000Z',
              detectedLabel: '11:59 AM',
              details: ['NET moved 5 minutes later']
            }
          ]
        }
      ]
    },
    launchFeedVersion: {
      scope: 'public',
      tier: 'anon',
      intervalSeconds: 7200,
      recommendedIntervalSeconds: 7200,
      cadenceReason: 'default',
      cadenceAnchorNet: null,
      matchCount: 1,
      updatedAt: '2026-03-08T11:59:00.000Z',
      version: 'public|2026-03-08T11:59:00.000Z|1'
    },
    launchDetail: {
      launch: {
        id: launchId,
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
      entitlements: baseEntitlements,
      related: [
        {
          id: `launch:${launchId}`,
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
      enrichment: {
        firstStageCount: 1,
        recoveryCount: 1,
        externalContentCount: 1,
        hasJepScore: false,
        faaAdvisoryCount: 0
      },
      arTrajectory: {
        eligible: true,
        hasTrajectory: true,
        availabilityReason: 'available',
        qualityState: 'safe_corridor',
        confidenceBadge: 'medium',
        generatedAt: '2026-03-08T11:57:00.000Z',
        publishPolicy: {
          precisionClaim: false,
          allowPrecision: false,
          enforcePadOnly: false,
          contractStatus: 'pass',
          missingFields: [],
          blockingReasons: [],
          reasons: []
        }
      }
    },
    launchDetailVersion: {
      launchId,
      scope: 'public',
      tier: 'anon',
      intervalSeconds: 7200,
      recommendedIntervalSeconds: 7200,
      cadenceReason: 'default',
      cadenceAnchorNet: null,
      updatedAt: '2026-03-08T11:59:00.000Z',
      version: `${launchId}|public|2026-03-08T11:59:00.000Z`
    },
    launchFaaAirspaceMap: {
      launchId,
      generatedAt: '2026-03-08T11:58:00.000Z',
      advisoryCount: 1,
      hasRenderableGeometry: true,
      pad: {
        latitude: 28.5618571,
        longitude: -80.577366,
        label: 'SLC-40',
        shortCode: 'SLC-40',
        locationName: 'Cape Canaveral'
      },
      bounds: {
        minLatitude: 28.49,
        minLongitude: -80.7,
        maxLatitude: 28.63,
        maxLongitude: -80.47
      },
      advisories: [
        {
          matchId: 'faa-match-1',
          launchId,
          tfrRecordId: 'faa-record-1',
          tfrShapeId: 'faa-shape-1',
          matchStatus: 'matched',
          matchConfidence: 99,
          matchScore: 99,
          matchStrategy: 'v1_time_shape_state',
          matchedAt: '2026-03-08T11:57:00.000Z',
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
                { latitude: 28.49, longitude: -80.68 },
                { latitude: 28.57, longitude: -80.7 },
                { latitude: 28.63, longitude: -80.56 },
                { latitude: 28.54, longitude: -80.47 }
              ],
              holes: [],
              bounds: {
                minLatitude: 28.49,
                minLongitude: -80.7,
                maxLatitude: 28.63,
                maxLongitude: -80.47
              }
            }
          ]
        }
      ]
    },
    launchTrajectory: {
      launchId,
      version: 'trajectory-public-v2',
      modelVersion: 'ios-baseline-1',
      quality: 0.74,
      qualityState: 'safe_corridor',
      guidanceSemantics: 'constraint_backed',
      recoverySemantics: 'none',
      trackTopology: {
        hasStageSplit: false,
        hasUpperStageTrack: false,
        hasBoosterTrack: false
      },
      sourceCoverage: {
        orbitClass: 'official_numeric',
        hazardPresent: false,
        landingClass: 'none',
        stageSeparationSource: 'provider_timeline',
        supgpMode: 'none',
        shipAssignmentPresent: false
      },
      uncertaintyEnvelope: {
        sampleCount: 2,
        sigmaDegP50: 0.7,
        sigmaDegP95: 1.2,
        sigmaDegMax: 1.5
      },
      sourceBlend: {
        sourceCode: 'provider_plus_template',
        sourceLabel: 'Provider + template blend',
        hasDirectionalConstraint: true,
        hasLandingDirectional: false,
        hasHazardDirectional: false,
        hasMissionNumericOrbit: true,
        hasSupgpConstraint: false
      },
      confidenceReasons: ['provider_heading'],
      safeModeActive: false,
      generatedAt: '2026-03-08T11:57:00.000Z',
      confidenceTier: 'B',
      sourceSufficiency: {
        providerTimeline: true
      },
      freshnessState: 'fresh',
      lineageComplete: true,
      publishPolicy: {
        precisionClaim: false,
        allowPrecision: false,
        enforcePadOnly: false,
        contractStatus: 'pass',
        missingFields: [],
        blockingReasons: [],
        reasons: []
      },
      confidenceBadge: 'medium',
      evidenceLabel: 'Provider directional fit',
      tracks: [
        {
          trackKind: 'core_up',
          samples: [
            {
              tPlusSec: 0,
              ecef: [1, 2, 3],
              sigmaDeg: 0.7
            },
            {
              tPlusSec: 60,
              ecef: [4, 5, 6],
              sigmaDeg: 0.9
            }
          ]
        }
      ],
      milestones: [
        {
          key: 'liftoff',
          tPlusSec: 0,
          label: 'Liftoff',
          description: 'Vehicle leaves the pad.',
          timeText: 'T+0',
          sourceRefIds: ['provider-timeline'],
          confidence: 'high',
          phase: 'core_ascent',
          trackKind: 'core_up',
          sourceType: 'provider_timeline',
          estimated: false,
          projectable: true
        }
      ],
      product: {
        renderTier: 1
      }
    },
    spaceXDroneShips: {
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
    },
    spaceXDroneShipDetail: {
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
    },
    starshipOverview: {
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
            answer: 'Native flight previews, timeline events, and next-launch context.'
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
    },
    starshipFlightOverview: {
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
            answer: 'Starship flights carry richer native change tracking than the generic mission shell.'
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
    },
    search: {
      query: 'starlink',
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
    },
    notificationPreferences: {
      pushEnabled: false,
      emailEnabled: false,
      launchDayEmailEnabled: false,
      launchDayEmailProviders: [],
      launchDayEmailStates: [],
      quietHoursEnabled: false,
      quietStartLocal: null,
      quietEndLocal: null
    },
    privacyPreferences: {
      optOutSaleShare: false,
      limitSensitive: true,
      blockThirdPartyEmbeds: false,
      gpcEnabled: false,
      createdAt: '2026-03-08T12:00:00.000Z',
      updatedAt: '2026-03-08T12:00:00.000Z'
    },
    profile: {
      viewerId: launchId,
      email: 'viewer@example.com',
      role: 'member',
      firstName: 'Ada',
      lastName: 'Lovelace',
      timezone: 'America/New_York',
      emailConfirmedAt: '2026-03-08T12:00:00.000Z',
      createdAt: '2026-03-01T12:00:00.000Z'
    },
    marketingEmail: {
      marketingEmailOptIn: false,
      updatedAt: '2026-03-08T12:00:00.000Z'
    },
    accountExport: {
      generated_at: '2026-03-08T12:00:00.000Z',
      auth: {
        user_id: launchId,
        email: 'viewer@example.com',
        created_at: '2026-03-01T12:00:00.000Z',
        user_metadata: {
          first_name: 'Ada'
        }
      },
      profile: {
        user_id: launchId,
        email: 'viewer@example.com'
      },
      notification_preferences: {
        email_enabled: true
      },
      privacy_preferences: {
        opt_out_sale_share: false
      },
      launch_notification_preferences: [],
      push_subscriptions: [],
      subscription: null,
      stripe_customer: {
        stripe_customer_id: 'cus_123'
      },
      warnings: []
    },
    billingSummary: {
      provider: 'stripe',
      productKey: 'premium_monthly',
      status: 'active',
      isPaid: true,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-04-08T12:00:00.000Z',
      managementMode: 'stripe_portal',
      managementUrl: 'https://tmz.test/account',
      providerMessage: null,
      providerProductId: 'price_pro_monthly'
    },
    billingCatalogWeb: {
      platform: 'web',
      generatedAt: '2026-03-08T12:00:00.000Z',
      products: [
        {
          productKey: 'premium_monthly',
          platform: 'web',
          provider: 'stripe',
          available: true,
          displayName: 'Premium Monthly',
          priceLabel: '$3.99/mo',
          providerProductId: 'price_pro_monthly',
          stripePriceId: 'price_pro_monthly'
        }
      ]
    },
    billingCatalogIos: {
      platform: 'ios',
      generatedAt: '2026-03-08T12:00:00.000Z',
      products: [
        {
          productKey: 'premium_monthly',
          platform: 'ios',
          provider: 'apple_app_store',
          available: true,
          displayName: 'Premium Monthly',
          priceLabel: '$3.99/mo',
          providerProductId: 'app.tminuszero.premium.monthly'
        }
      ]
    },
    billingCatalogAndroid: {
      platform: 'android',
      generatedAt: '2026-03-08T12:00:00.000Z',
      products: [
        {
          productKey: 'premium_monthly',
          platform: 'android',
          provider: 'google_play',
          available: true,
          displayName: 'Premium Monthly',
          priceLabel: '$3.99/mo',
          providerProductId: 'app.tminuszero.premium.monthly',
          googleBasePlanId: 'premium-monthly',
          googleOfferToken: 'offer-token'
        }
      ]
    },
    billingSyncResponse: {
      summary: {
        provider: 'apple_app_store',
        productKey: 'premium_monthly',
        status: 'active',
        isPaid: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: '2026-04-08T12:00:00.000Z',
        managementMode: 'app_store_external',
        managementUrl: 'https://apps.apple.com/account/subscriptions',
        providerMessage: 'Purchased in the App Store. Manage or restore this subscription through Apple.',
        providerProductId: 'app.tminuszero.premium.monthly'
      },
      entitlements: {
        ...baseEntitlements,
        tier: 'premium',
        status: 'active',
        source: 'apple',
        isPaid: true,
        mode: 'live',
        capabilities: {
          ...baseEntitlements.capabilities,
          canUseSavedItems: true,
          canUseLaunchFilters: true,
          canUseLaunchCalendar: true,
          canManageFilterPresets: true,
          canManageFollows: true,
          canUseBasicAlertRules: true,
          canUseAdvancedAlertRules: true,
          canUseBrowserLaunchAlerts: false,
          canUseSingleLaunchFollow: true,
          canUseAllUsLaunchAlerts: true,
          canUseStateLaunchAlerts: true,
          canUseLiveFeed: true,
          canUseChangeLog: true,
          canUseInstantAlerts: true,
          canUseRecurringCalendarFeeds: true,
          canUseRssFeeds: true,
          canUseEmbedWidgets: true,
          canUseArTrajectory: true,
          canUseEnhancedForecastInsights: true,
          canUseLaunchDayEmail: true
        },
        limits: {
          presetLimit: 25,
          filterPresetLimit: 25,
          watchlistLimit: 5,
          watchlistRuleLimit: 200,
          singleLaunchFollowLimit: 0
        }
      }
    },
    retiredLaunchNotificationPreferencePush: {
      enabled: false,
      preference: {
        launchId,
        channel: 'push',
        mode: 't_minus',
        timezone: 'UTC',
        tMinusMinutes: [],
        localTimes: [],
        notifyStatusChange: false,
        notifyNetChange: false
      },
      pushStatus: {
        enabled: false,
        subscribed: false
      }
    },
    watchlists: {
      watchlists: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'My Launches',
          ruleCount: 2,
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
    },
    filterPresets: {
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
    },
    launchNotificationPreference: {
      enabled: false,
      preference: {
        launchId,
        channel: 'push',
        mode: 't_minus',
        timezone: 'UTC',
        tMinusMinutes: [],
        localTimes: [],
        notifyStatusChange: false,
        notifyNetChange: false
      },
      pushStatus: {
        enabled: false,
        subscribed: false
      }
    },
    watchlistEnvelope: {
      watchlist: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'My Launches',
        ruleCount: 0,
        createdAt: '2026-03-08T12:00:00.000Z',
        rules: []
      }
    },
    watchlistRuleEnvelope: {
      rule: {
        id: '55555555-5555-4555-8555-555555555555',
        ruleType: 'provider',
        ruleValue: 'SpaceX',
        createdAt: '2026-03-08T12:00:00.000Z'
      },
      source: 'created'
    },
    filterPresetEnvelope: {
      preset: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Florida',
        filters: { region: 'us', state: 'Florida' },
        isDefault: true,
        createdAt: '2026-03-08T12:00:00.000Z',
        updatedAt: '2026-03-08T12:00:00.000Z'
      }
    },
    calendarFeeds: {
      feeds: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          name: 'Live feed',
          token: 'calendar-token',
          filters: { region: 'us' },
          alarmMinutesBefore: 30,
          createdAt: '2026-03-08T12:00:00.000Z',
          updatedAt: '2026-03-08T12:00:00.000Z'
        }
      ]
    },
    calendarFeedEnvelope: {
      feed: {
        id: '66666666-6666-4666-8666-666666666666',
        name: 'Live feed',
        token: 'calendar-token',
        filters: { region: 'us' },
        alarmMinutesBefore: 30,
        createdAt: '2026-03-08T12:00:00.000Z',
        updatedAt: '2026-03-08T12:00:00.000Z'
      }
    },
    rssFeeds: {
      feeds: [
        {
          id: '77777777-7777-4777-8777-777777777777',
          name: 'RSS feed',
          token: 'rss-token',
          filters: { provider: 'SpaceX' },
          createdAt: '2026-03-08T12:00:00.000Z',
          updatedAt: '2026-03-08T12:00:00.000Z'
        }
      ]
    },
    rssFeedEnvelope: {
      feed: {
        id: '77777777-7777-4777-8777-777777777777',
        name: 'RSS feed',
        token: 'rss-token',
        filters: { provider: 'SpaceX' },
        createdAt: '2026-03-08T12:00:00.000Z',
        updatedAt: '2026-03-08T12:00:00.000Z'
      }
    },
    embedWidgets: {
      widgets: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          name: 'Next Launch',
          token: 'widget-token',
          widgetType: 'next_launch_card',
          filters: { region: 'all' },
          presetId: '33333333-3333-4333-8333-333333333333',
          watchlistId: null,
          createdAt: '2026-03-08T12:00:00.000Z',
          updatedAt: '2026-03-08T12:00:00.000Z'
        }
      ]
    },
    embedWidgetEnvelope: {
      widget: {
        id: '88888888-8888-4888-8888-888888888888',
        name: 'Next Launch',
        token: 'widget-token',
        widgetType: 'next_launch_card',
        filters: { region: 'all' },
        presetId: '33333333-3333-4333-8333-333333333333',
        watchlistId: null,
        createdAt: '2026-03-08T12:00:00.000Z',
        updatedAt: '2026-03-08T12:00:00.000Z'
      }
    },
    success: {
      ok: true
    },
    pushDevice: {
      platform: 'ios',
      installationId: 'tmz-installation-1',
      token: 'ExponentPushToken[abc123]',
      appVersion: '1.0.0',
      deviceName: 'iPhone',
      pushProvider: 'expo',
      active: true,
      registeredAt: '2026-03-08T12:00:00.000Z',
      lastSentAt: null,
      lastReceiptAt: null,
      lastFailureReason: null,
      disabledAt: null
    },
    pushDeviceRemoval: {
      platform: 'ios',
      installationId: 'tmz-installation-1',
      removed: true,
      removedAt: '2026-03-08T12:01:00.000Z'
    },
    pushTest: {
      ok: true,
      queuedAt: '2026-03-08T12:02:00.000Z'
    }
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = init?.method || 'GET';
    const headers = new Headers(init?.headers);

    requestLog.push({
      method,
      path: url.pathname,
      search: url.search,
      credentials: init?.credentials,
      authorization: headers.get('Authorization'),
      body: parseBody(init)
    });

    let status = 200;
    let payload: unknown;

    if (url.pathname === '/api/v1/viewer/session') {
      payload = headers.get('Authorization') ? payloads.viewerSessionBearer : payloads.viewerSession;
    } else if (url.pathname === '/api/v1/viewer/entitlements') {
      payload = payloads.entitlements;
    } else if (url.pathname === '/api/v1/launches') {
      payload = payloads.launchFeed;
    } else if (url.pathname === '/api/v1/launches/version') {
      payload = payloads.launchFeedVersion;
    } else if (url.pathname === '/api/v1/launches/changed') {
      payload = payloads.changedLaunches;
    } else if (url.pathname === `/api/v1/launches/${launchId}`) {
      payload = payloads.launchDetail;
    } else if (url.pathname === `/api/v1/launches/${launchId}/version`) {
      payload = payloads.launchDetailVersion;
    } else if (url.pathname === `/api/v1/launches/${launchId}/faa-airspace-map`) {
      payload = payloads.launchFaaAirspaceMap;
    } else if (url.pathname === `/api/v1/launches/${launchId}/trajectory`) {
      payload = payloads.launchTrajectory;
    } else if (url.pathname === '/api/v1/spacex/drone-ships') {
      payload = payloads.spaceXDroneShips;
    } else if (url.pathname === '/api/v1/spacex/drone-ships/asog') {
      payload = payloads.spaceXDroneShipDetail;
    } else if (url.pathname === '/api/v1/starship') {
      payload = payloads.starshipOverview;
    } else if (url.pathname === '/api/v1/starship/flight-10') {
      payload = payloads.starshipFlightOverview;
    } else if (url.pathname === '/api/v1/search') {
      payload = {
        ...payloads.search,
        query: url.searchParams.get('q') || ''
      };
    } else if (url.pathname === '/api/v1/ar/telemetry/session' && method === 'POST') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/profile') {
      payload = payloads.profile;
    } else if (url.pathname === '/api/v1/me/privacy/preferences' && method === 'GET') {
      payload = payloads.privacyPreferences;
    } else if (url.pathname === '/api/v1/me/privacy/preferences' && method === 'PATCH') {
      payload = {
        ...payloads.privacyPreferences,
        ...(parseBody(init) as object | undefined)
      };
    } else if (url.pathname === '/api/v1/me/export') {
      payload = payloads.accountExport;
    } else if (url.pathname === '/api/v1/me/billing/summary') {
      payload = payloads.billingSummary;
    } else if (url.pathname === '/api/v1/me/billing/catalog') {
      const platform = url.searchParams.get('platform');
      payload =
        platform === 'ios'
          ? payloads.billingCatalogIos
          : platform === 'android'
            ? payloads.billingCatalogAndroid
            : payloads.billingCatalogWeb;
    } else if (url.pathname === '/api/v1/me/billing/apple/sync' && method === 'POST') {
      payload = payloads.billingSyncResponse;
    } else if (url.pathname === '/api/v1/me/billing/google/sync' && method === 'POST') {
      payload = {
        ...payloads.billingSyncResponse,
        summary: {
          ...payloads.billingSyncResponse.summary,
          provider: 'google_play',
          managementMode: 'google_play_external',
          managementUrl: 'https://play.google.com/store/account/subscriptions',
          providerMessage: 'Purchased in Google Play. Manage or restore this subscription through Google Play.'
        },
        entitlements: {
          ...payloads.billingSyncResponse.entitlements,
          source: 'google'
        }
      };
    } else if (url.pathname === '/api/v1/me/marketing-email' && method === 'GET') {
      payload = payloads.marketingEmail;
    } else if (url.pathname === '/api/v1/me/marketing-email' && method === 'PATCH') {
      payload = {
        ...payloads.marketingEmail,
        ...(parseBody(init) as object | undefined)
      };
    } else if (url.pathname === '/api/v1/me/account/delete' && method === 'POST') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/watchlists' && method === 'GET') {
      payload = payloads.watchlists;
    } else if (url.pathname === '/api/v1/me/watchlists' && method === 'POST') {
      payload = payloads.watchlistEnvelope;
    } else if (url.pathname === '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222' && method === 'PATCH') {
      payload = payloads.watchlistEnvelope;
    } else if (url.pathname === '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222' && method === 'DELETE') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222/rules' && method === 'POST') {
      payload = payloads.watchlistRuleEnvelope;
    } else if (url.pathname === '/api/v1/me/filter-presets') {
      payload = method === 'GET' ? payloads.filterPresets : payloads.filterPresetEnvelope;
    } else if (url.pathname === '/api/v1/me/filter-presets/33333333-3333-4333-8333-333333333333') {
      payload = method === 'DELETE' ? payloads.success : payloads.filterPresetEnvelope;
    } else if (url.pathname === '/api/v1/me/calendar-feeds' && method === 'GET') {
      payload = payloads.calendarFeeds;
    } else if (url.pathname === '/api/v1/me/calendar-feeds' && method === 'POST') {
      payload = payloads.calendarFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666' && method === 'PATCH') {
      payload = payloads.calendarFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666' && method === 'DELETE') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666/rotate' && method === 'POST') {
      payload = payloads.calendarFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/rss-feeds' && method === 'GET') {
      payload = payloads.rssFeeds;
    } else if (url.pathname === '/api/v1/me/rss-feeds' && method === 'POST') {
      payload = payloads.rssFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777' && method === 'PATCH') {
      payload = payloads.rssFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777' && method === 'DELETE') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777/rotate' && method === 'POST') {
      payload = payloads.rssFeedEnvelope;
    } else if (url.pathname === '/api/v1/me/embed-widgets' && method === 'GET') {
      payload = payloads.embedWidgets;
    } else if (url.pathname === '/api/v1/me/embed-widgets' && method === 'POST') {
      payload = payloads.embedWidgetEnvelope;
    } else if (url.pathname === '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888' && method === 'PATCH') {
      payload = payloads.embedWidgetEnvelope;
    } else if (url.pathname === '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888' && method === 'DELETE') {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888/rotate' && method === 'POST') {
      payload = payloads.embedWidgetEnvelope;
    } else if (url.pathname === '/api/v1/me/notification-preferences' && method === 'GET') {
      payload = payloads.notificationPreferences;
    } else if (url.pathname === '/api/v1/me/notification-preferences' && method === 'POST') {
      status = 410;
      payload = { error: 'native_mobile_push_only' };
    } else if (url.pathname === `/api/v1/me/launch-notifications/${launchId}` && method === 'POST') {
      status = 410;
      payload = { error: 'native_mobile_push_only' };
    } else if (url.pathname === `/api/v1/me/launch-notifications/${launchId}`) {
      payload = payloads.retiredLaunchNotificationPreferencePush;
    } else if (
      url.pathname === '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222/rules/55555555-5555-4555-8555-555555555555' &&
      method === 'DELETE'
    ) {
      payload = payloads.success;
    } else if (url.pathname === '/api/v1/me/push-devices' && method === 'POST') {
      const body = parseBody(init) as { platform?: string } | undefined;
      if (body?.platform === 'web') {
        status = 410;
        payload = { error: 'native_mobile_push_only' };
      } else {
        payload = payloads.pushDevice;
      }
    } else if (url.pathname === '/api/v1/me/push-devices' && method === 'DELETE') {
      const body = parseBody(init) as { platform?: string } | undefined;
      if (body?.platform === 'web') {
        status = 410;
        payload = { error: 'native_mobile_push_only' };
      } else {
        payload = payloads.pushDeviceRemoval;
      }
    } else if (url.pathname === '/api/v1/me/push-devices/test' && headers.get('Authorization') === 'Bearer bad-token') {
      status = 409;
      payload = { error: 'push_not_enabled' };
    } else if (url.pathname === '/api/v1/me/push-devices/test') {
      payload = payloads.pushTest;
    } else {
      status = 404;
      payload = { error: 'not_found' };
    }

    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  function popLastRequest() {
    const request = requestLog.pop();
    assert.ok(request, 'expected a request to be logged');
    return request;
  }

  function expectGuest(request: LoggedRequest, path: string, method = 'GET') {
    assert.equal(request.method, method);
    assert.equal(request.path, path);
    assert.equal(request.authorization, null);
    assert.equal(request.credentials, 'same-origin');
  }

  function expectCookie(request: LoggedRequest, path: string, method = 'GET') {
    assert.equal(request.method, method);
    assert.equal(request.path, path);
    assert.equal(request.authorization, null);
    assert.equal(request.credentials, 'include');
  }

  function expectBearer(request: LoggedRequest, path: string, method = 'GET') {
    assert.equal(request.method, method);
    assert.equal(request.path, path);
    assert.equal(request.authorization, 'Bearer tmz-bearer');
    assert.equal(request.credentials, 'same-origin');
  }

  const guestClient = createApiClient({
    baseUrl: 'https://tmz.test',
    auth: { mode: 'guest' },
    fetchImpl
  });
  const cookieClient = createApiClient({
    baseUrl: 'https://tmz.test',
    auth: { mode: 'cookie' },
    fetchImpl
  });
  const bearerClient = createApiClient({
    baseUrl: 'https://tmz.test',
    auth: { mode: 'bearer', accessToken: 'tmz-bearer' },
    fetchImpl
  });

  assert.equal(typeof guestClient.getViewerSession, 'function');
  assert.equal(typeof guestClient.getViewerEntitlements, 'function');
  assert.equal(typeof guestClient.getLaunchFeed, 'function');
  assert.equal(typeof guestClient.getLaunchFeedVersion, 'function');
  assert.equal(typeof guestClient.getLaunchDetail, 'function');
  assert.equal(typeof guestClient.getLaunchDetailVersion, 'function');
  assert.equal(typeof guestClient.getLaunchFaaAirspaceMap, 'function');
  assert.equal(typeof guestClient.getLaunchTrajectory, 'function');
  assert.equal(typeof guestClient.getSpaceXDroneShips, 'function');
  assert.equal(typeof guestClient.getSpaceXDroneShipDetail, 'function');
  assert.equal(typeof guestClient.getStarshipOverview, 'function');
  assert.equal(typeof guestClient.getStarshipFlightOverview, 'function');
  assert.equal(typeof guestClient.postArTelemetrySession, 'function');
  assert.equal(typeof guestClient.search, 'function');
  assert.equal(typeof cookieClient.getProfile, 'function');
  assert.equal(typeof cookieClient.getBillingSummary, 'function');
  assert.equal(typeof cookieClient.getBillingCatalog, 'function');
  assert.equal(typeof cookieClient.syncAppleBilling, 'function');
  assert.equal(typeof cookieClient.syncGoogleBilling, 'function');
  assert.equal(typeof cookieClient.updateProfile, 'function');
  assert.equal(typeof cookieClient.getMarketingEmail, 'function');
  assert.equal(typeof cookieClient.updateMarketingEmail, 'function');
  assert.equal(typeof cookieClient.deleteAccount, 'function');
  assert.equal(typeof cookieClient.getWatchlists, 'function');
  assert.equal(typeof cookieClient.updateWatchlist, 'function');
  assert.equal(typeof cookieClient.deleteWatchlist, 'function');
  assert.equal(typeof cookieClient.getFilterPresets, 'function');
  assert.equal(typeof cookieClient.createFilterPreset, 'function');
  assert.equal(typeof cookieClient.updateFilterPreset, 'function');
  assert.equal(typeof cookieClient.deleteFilterPreset, 'function');
  assert.equal(typeof cookieClient.getCalendarFeeds, 'function');
  assert.equal(typeof cookieClient.createCalendarFeed, 'function');
  assert.equal(typeof cookieClient.updateCalendarFeed, 'function');
  assert.equal(typeof cookieClient.deleteCalendarFeed, 'function');
  assert.equal(typeof cookieClient.rotateCalendarFeed, 'function');
  assert.equal(typeof cookieClient.getRssFeeds, 'function');
  assert.equal(typeof cookieClient.createRssFeed, 'function');
  assert.equal(typeof cookieClient.updateRssFeed, 'function');
  assert.equal(typeof cookieClient.deleteRssFeed, 'function');
  assert.equal(typeof cookieClient.rotateRssFeed, 'function');
  assert.equal(typeof cookieClient.getEmbedWidgets, 'function');
  assert.equal(typeof cookieClient.createEmbedWidget, 'function');
  assert.equal(typeof cookieClient.updateEmbedWidget, 'function');
  assert.equal(typeof cookieClient.deleteEmbedWidget, 'function');
  assert.equal(typeof cookieClient.rotateEmbedWidget, 'function');
  assert.equal(typeof cookieClient.getNotificationPreferences, 'function');
  assert.equal(typeof cookieClient.updateNotificationPreferences, 'function');
  assert.equal(typeof cookieClient.getLaunchNotificationPreference, 'function');
  assert.equal(typeof cookieClient.updateLaunchNotificationPreference, 'function');
  assert.equal(typeof cookieClient.createWatchlist, 'function');
  assert.equal(typeof cookieClient.createWatchlistRule, 'function');
  assert.equal(typeof cookieClient.deleteWatchlistRule, 'function');
  assert.equal(typeof cookieClient.registerPushDevice, 'function');
  assert.equal(typeof cookieClient.removePushDevice, 'function');
  assert.equal(typeof cookieClient.sendPushTest, 'function');

  await guestClient.getViewerSession();
  expectGuest(popLastRequest(), '/api/v1/viewer/session');

  await guestClient.getViewerEntitlements();
  expectGuest(popLastRequest(), '/api/v1/viewer/entitlements');

  await guestClient.getLaunchFeed({ limit: 20, region: 'all' });
  {
    const request = popLastRequest();
    expectGuest(request, '/api/v1/launches');
    assert.match(request.search, /\blimit=20\b/);
    assert.match(request.search, /\bregion=all\b/);
  }

  await guestClient.getLaunchFeedVersion({ scope: 'public', range: '7d', region: 'all' });
  {
    const request = popLastRequest();
    expectGuest(request, '/api/v1/launches/version');
    assert.match(request.search, /\bscope=public\b/);
    assert.match(request.search, /\brange=7d\b/);
    assert.match(request.search, /\bregion=all\b/);
  }

  await cookieClient.getLaunchFeed({
    scope: 'watchlist',
    watchlistId: '22222222-2222-4222-8222-222222222222',
    limit: 10,
    offset: 20,
    range: 'month',
    region: 'us',
    provider: 'SpaceX',
    sort: 'changed',
    status: 'hold'
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/launches');
    assert.match(request.search, /\bscope=watchlist\b/);
    assert.match(request.search, /\bwatchlistId=22222222-2222-4222-8222-222222222222\b/);
    assert.match(request.search, /\blimit=10\b/);
    assert.match(request.search, /\boffset=20\b/);
    assert.match(request.search, /\brange=month\b/);
    assert.match(request.search, /\bprovider=SpaceX\b/);
    assert.match(request.search, /\bsort=changed\b/);
    assert.match(request.search, /\bstatus=hold\b/);
  }

  await bearerClient.getChangedLaunches({ hours: 24, region: 'non-us' });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/launches/changed');
    assert.match(request.search, /\bhours=24\b/);
    assert.match(request.search, /\bregion=non-us\b/);
  }

  await guestClient.getLaunchDetail(launchId);
  expectGuest(popLastRequest(), `/api/v1/launches/${launchId}`);

  await guestClient.getLaunchDetailVersion(launchId, { scope: 'public' });
  {
    const request = popLastRequest();
    expectGuest(request, `/api/v1/launches/${launchId}/version`);
    assert.match(request.search, /\bscope=public\b/);
  }

  await guestClient.getLaunchFaaAirspaceMap(launchId);
  expectGuest(popLastRequest(), `/api/v1/launches/${launchId}/faa-airspace-map`);

  await bearerClient.getLaunchTrajectory(launchId);
  expectBearer(popLastRequest(), `/api/v1/launches/${launchId}/trajectory`);

  const droneShips = await guestClient.getSpaceXDroneShips();
  expectGuest(popLastRequest(), '/api/v1/spacex/drone-ships');
  assert.deepEqual(droneShips, payloads.spaceXDroneShips);

  const droneShipDetail = await guestClient.getSpaceXDroneShipDetail('asog');
  expectGuest(popLastRequest(), '/api/v1/spacex/drone-ships/asog');
  assert.deepEqual(droneShipDetail, payloads.spaceXDroneShipDetail);

  const starshipOverview = await guestClient.getStarshipOverview();
  expectGuest(popLastRequest(), '/api/v1/starship');
  assert.deepEqual(starshipOverview, payloads.starshipOverview);

  const starshipFlightOverview = await guestClient.getStarshipFlightOverview('flight-10');
  expectGuest(popLastRequest(), '/api/v1/starship/flight-10');
  assert.deepEqual(starshipFlightOverview, payloads.starshipFlightOverview);

  await bearerClient.postArTelemetrySession({
    type: 'start',
    payload: {
      sessionId: '99999999-9999-4999-8999-999999999999',
      launchId,
      startedAt: '2026-03-08T11:58:00.000Z',
      runtimeFamily: 'ios_native',
      trackingState: 'normal',
      worldAlignment: 'gravity_and_heading',
      lidarAvailable: true,
      sceneDepthEnabled: true
    }
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/ar/telemetry/session', 'POST');
    assert.deepEqual(request.body, {
      type: 'start',
      payload: {
        sessionId: '99999999-9999-4999-8999-999999999999',
        launchId,
        startedAt: '2026-03-08T11:58:00.000Z',
        runtimeFamily: 'ios_native',
        trackingState: 'normal',
        worldAlignment: 'gravity_and_heading',
        lidarAvailable: true,
        sceneDepthEnabled: true
      }
    });
  }

  await guestClient.search('starlink', { limit: 8, offset: 0, types: ['launch'] });
  {
    const request = popLastRequest();
    expectGuest(request, '/api/v1/search');
    assert.match(request.search, /\bq=starlink\b/);
    assert.match(request.search, /\blimit=8\b/);
    assert.match(request.search, /\boffset=0\b/);
    assert.match(request.search, /\btypes=launch\b/);
  }

  await cookieClient.getProfile();
  expectCookie(popLastRequest(), '/api/v1/me/profile');

  await bearerClient.getProfile();
  expectBearer(popLastRequest(), '/api/v1/me/profile');

  await cookieClient.getPrivacyPreferences();
  expectCookie(popLastRequest(), '/api/v1/me/privacy/preferences');

  await bearerClient.updatePrivacyPreferences({ optOutSaleShare: true });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/privacy/preferences', 'PATCH');
    assert.deepEqual(request.body, {
      optOutSaleShare: true
    });
  }

  await cookieClient.getAccountExport();
  expectCookie(popLastRequest(), '/api/v1/me/export');

  await cookieClient.getBillingSummary();
  expectCookie(popLastRequest(), '/api/v1/me/billing/summary');

  await bearerClient.getBillingCatalog('ios');
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/billing/catalog');
    assert.match(request.search, /\bplatform=ios\b/);
  }

  await cookieClient.getBillingCatalog('android');
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/billing/catalog');
    assert.match(request.search, /\bplatform=android\b/);
  }

  await bearerClient.syncAppleBilling({
    transactionId: 'apple-transaction-1',
    productId: 'app.tminuszero.premium.monthly',
    originalTransactionId: 'apple-original-1',
    appAccountToken: launchId,
    environment: 'sandbox'
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/billing/apple/sync', 'POST');
    assert.deepEqual(request.body, {
      transactionId: 'apple-transaction-1',
      productId: 'app.tminuszero.premium.monthly',
      originalTransactionId: 'apple-original-1',
      appAccountToken: launchId,
      environment: 'sandbox'
    });
  }

  await cookieClient.syncGoogleBilling({
    purchaseToken: 'google-purchase-token',
    productId: 'app.tminuszero.premium.monthly',
    basePlanId: 'premium-monthly',
    obfuscatedAccountId: launchId
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/billing/google/sync', 'POST');
    assert.deepEqual(request.body, {
      purchaseToken: 'google-purchase-token',
      productId: 'app.tminuszero.premium.monthly',
      basePlanId: 'premium-monthly',
      obfuscatedAccountId: launchId
    });
  }

  await cookieClient.updateProfile({ firstName: 'Grace' });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/profile', 'PATCH');
    assert.deepEqual(request.body, {
      firstName: 'Grace'
    });
  }

  await bearerClient.getMarketingEmail();
  expectBearer(popLastRequest(), '/api/v1/me/marketing-email');

  await cookieClient.updateMarketingEmail({ marketingEmailOptIn: true });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/marketing-email', 'PATCH');
    assert.deepEqual(request.body, {
      marketingEmailOptIn: true
    });
  }

  await cookieClient.getWatchlists();
  expectCookie(popLastRequest(), '/api/v1/me/watchlists');

  await bearerClient.getWatchlists();
  expectBearer(popLastRequest(), '/api/v1/me/watchlists');

  await cookieClient.updateWatchlist('22222222-2222-4222-8222-222222222222', {
    name: 'My Launches'
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222', 'PATCH');
    assert.deepEqual(request.body, {
      name: 'My Launches'
    });
  }

  await bearerClient.deleteWatchlist('22222222-2222-4222-8222-222222222222');
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222', 'DELETE');
    assert.equal(request.body, undefined);
  }

  await cookieClient.getFilterPresets();
  expectCookie(popLastRequest(), '/api/v1/me/filter-presets');

  await bearerClient.getFilterPresets();
  expectBearer(popLastRequest(), '/api/v1/me/filter-presets');

  await cookieClient.createWatchlist({});
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/watchlists', 'POST');
    assert.deepEqual(request.body, {});
  }

  await bearerClient.createWatchlistRule('22222222-2222-4222-8222-222222222222', {
    ruleType: 'provider',
    ruleValue: 'SpaceX'
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222/rules', 'POST');
    assert.deepEqual(request.body, {
      ruleType: 'provider',
      ruleValue: 'SpaceX'
    });
  }

  await cookieClient.deleteWatchlistRule(
    '22222222-2222-4222-8222-222222222222',
    '55555555-5555-4555-8555-555555555555'
  );
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/watchlists/22222222-2222-4222-8222-222222222222/rules/55555555-5555-4555-8555-555555555555', 'DELETE');
    assert.equal(request.body, undefined);
  }

  await bearerClient.createFilterPreset({
    name: 'Florida',
    filters: { region: 'us', state: 'Florida' }
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/filter-presets', 'POST');
    assert.deepEqual(request.body, {
      name: 'Florida',
      filters: { region: 'us', state: 'Florida' }
    });
  }

  await cookieClient.updateFilterPreset('33333333-3333-4333-8333-333333333333', {
    isDefault: true
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/filter-presets/33333333-3333-4333-8333-333333333333', 'PATCH');
    assert.deepEqual(request.body, {
      isDefault: true
    });
  }

  await bearerClient.deleteFilterPreset('33333333-3333-4333-8333-333333333333');
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/filter-presets/33333333-3333-4333-8333-333333333333', 'DELETE');
    assert.equal(request.body, undefined);
  }

  await cookieClient.getCalendarFeeds();
  expectCookie(popLastRequest(), '/api/v1/me/calendar-feeds');

  await bearerClient.createCalendarFeed({
    name: 'Live feed',
    filters: { region: 'us' },
    alarmMinutesBefore: 30
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/calendar-feeds', 'POST');
    assert.deepEqual(request.body, {
      name: 'Live feed',
      filters: { region: 'us' },
      alarmMinutesBefore: 30
    });
  }

  await cookieClient.updateCalendarFeed('66666666-6666-4666-8666-666666666666', {
    alarmMinutesBefore: 60
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666', 'PATCH');
    assert.deepEqual(request.body, {
      alarmMinutesBefore: 60
    });
  }

  await bearerClient.rotateCalendarFeed('66666666-6666-4666-8666-666666666666');
  expectBearer(popLastRequest(), '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666/rotate', 'POST');

  await cookieClient.deleteCalendarFeed('66666666-6666-4666-8666-666666666666');
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/calendar-feeds/66666666-6666-4666-8666-666666666666', 'DELETE');
    assert.equal(request.body, undefined);
  }

  await cookieClient.getRssFeeds();
  expectCookie(popLastRequest(), '/api/v1/me/rss-feeds');

  await bearerClient.createRssFeed({
    name: 'RSS feed',
    filters: { provider: 'SpaceX' }
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/rss-feeds', 'POST');
    assert.deepEqual(request.body, {
      name: 'RSS feed',
      filters: { provider: 'SpaceX' }
    });
  }

  await cookieClient.updateRssFeed('77777777-7777-4777-8777-777777777777', {
    name: 'Renamed RSS feed'
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777', 'PATCH');
    assert.deepEqual(request.body, {
      name: 'Renamed RSS feed'
    });
  }

  await bearerClient.rotateRssFeed('77777777-7777-4777-8777-777777777777');
  expectBearer(popLastRequest(), '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777/rotate', 'POST');

  await cookieClient.deleteRssFeed('77777777-7777-4777-8777-777777777777');
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/rss-feeds/77777777-7777-4777-8777-777777777777', 'DELETE');
    assert.equal(request.body, undefined);
  }

  await cookieClient.getEmbedWidgets();
  expectCookie(popLastRequest(), '/api/v1/me/embed-widgets');

  await bearerClient.createEmbedWidget({
    name: 'Next Launch',
    presetId: '33333333-3333-4333-8333-333333333333'
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/embed-widgets', 'POST');
    assert.deepEqual(request.body, {
      name: 'Next Launch',
      presetId: '33333333-3333-4333-8333-333333333333'
    });
  }

  await cookieClient.updateEmbedWidget('88888888-8888-4888-8888-888888888888', {
    watchlistId: '22222222-2222-4222-8222-222222222222',
    presetId: null
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888', 'PATCH');
    assert.deepEqual(request.body, {
      watchlistId: '22222222-2222-4222-8222-222222222222',
      presetId: null
    });
  }

  await bearerClient.rotateEmbedWidget('88888888-8888-4888-8888-888888888888');
  expectBearer(popLastRequest(), '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888/rotate', 'POST');

  await cookieClient.deleteEmbedWidget('88888888-8888-4888-8888-888888888888');
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/embed-widgets/88888888-8888-4888-8888-888888888888', 'DELETE');
    assert.equal(request.body, undefined);
  }

  const cookieNotificationPreferences = await cookieClient.getNotificationPreferences();
  expectCookie(popLastRequest(), '/api/v1/me/notification-preferences');
  assert.deepEqual(cookieNotificationPreferences, payloads.notificationPreferences);

  const bearerNotificationPreferences = await bearerClient.getNotificationPreferences();
  expectBearer(popLastRequest(), '/api/v1/me/notification-preferences');
  assert.deepEqual(bearerNotificationPreferences, payloads.notificationPreferences);

  await assert.rejects(
    () => cookieClient.updateNotificationPreferences({ pushEnabled: true }),
    (error: unknown) => expectRetiredApiClientError(error)
  );
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/notification-preferences', 'POST');
    assert.deepEqual(request.body, {
      pushEnabled: true
    });
  }

  await assert.rejects(
    () => bearerClient.updateNotificationPreferences({ pushEnabled: true }),
    (error: unknown) => expectRetiredApiClientError(error)
  );
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/notification-preferences', 'POST');
    assert.deepEqual(request.body, {
      pushEnabled: true
    });
  }

  const retiredPushPreference = await cookieClient.getLaunchNotificationPreference(launchId);
  {
    const request = popLastRequest();
    expectCookie(request, `/api/v1/me/launch-notifications/${launchId}`);
    assert.equal(request.search, '');
    assert.equal(retiredPushPreference.enabled, false);
    assert.equal(retiredPushPreference.preference.launchId, launchId);
    assert.equal(retiredPushPreference.preference.channel, 'push');
    assert.deepEqual(retiredPushPreference.pushStatus, {
      enabled: false,
      subscribed: false
    });
  }

  await assert.rejects(
    () =>
      cookieClient.updateLaunchNotificationPreference(launchId, {
        mode: 't_minus',
        tMinusMinutes: [10],
        notifyStatusChange: true,
        notifyNetChange: false
      }),
    (error: unknown) => expectRetiredApiClientError(error)
  );
  {
    const request = popLastRequest();
    expectCookie(request, `/api/v1/me/launch-notifications/${launchId}`, 'POST');
    assert.deepEqual(request.body, {
      mode: 't_minus',
      tMinusMinutes: [10],
      notifyStatusChange: true,
      notifyNetChange: false
    });
  }

  const pushRegistrationPayload = {
    platform: 'ios' as const,
    installationId: 'tmz-installation-1',
    token: 'ExponentPushToken[abc123]',
    appVersion: '1.0.0',
    deviceName: 'iPhone 16',
    pushProvider: 'expo' as const,
    active: true,
    registeredAt: '2026-03-08T12:00:00.000Z'
  };

  await cookieClient.registerPushDevice(pushRegistrationPayload);
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/push-devices', 'POST');
    assert.equal((request.body as { installationId?: string }).installationId, 'tmz-installation-1');
  }

  await bearerClient.registerPushDevice(pushRegistrationPayload);
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/push-devices', 'POST');
    assert.equal((request.body as { token?: string }).token, 'ExponentPushToken[abc123]');
  }

  await cookieClient.removePushDevice({
    platform: 'ios',
    installationId: 'tmz-installation-1'
  });
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/push-devices', 'DELETE');
    assert.deepEqual(request.body, {
      platform: 'ios',
      installationId: 'tmz-installation-1'
    });
  }

  await bearerClient.removePushDevice({
    platform: 'ios',
    installationId: 'tmz-installation-1'
  });
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/push-devices', 'DELETE');
    assert.deepEqual(request.body, {
      platform: 'ios',
      installationId: 'tmz-installation-1'
    });
  }

  await assert.rejects(
    () =>
      cookieClient.registerPushDevice({
        ...pushRegistrationPayload,
        platform: 'web',
        pushProvider: 'webpush'
      }),
    (error: unknown) => expectRetiredApiClientError(error)
  );
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/push-devices', 'POST');
    assert.equal((request.body as { platform?: string }).platform, 'web');
  }

  await assert.rejects(
    () =>
      bearerClient.removePushDevice({
        platform: 'web',
        installationId: 'tmz-installation-web'
      }),
    (error: unknown) => expectRetiredApiClientError(error)
  );
  {
    const request = popLastRequest();
    expectBearer(request, '/api/v1/me/push-devices', 'DELETE');
    assert.deepEqual(request.body, {
      platform: 'web',
      installationId: 'tmz-installation-web'
    });
  }

  await cookieClient.sendPushTest();
  expectCookie(popLastRequest(), '/api/v1/me/push-devices/test', 'POST');

  await bearerClient.sendPushTest();
  expectBearer(popLastRequest(), '/api/v1/me/push-devices/test', 'POST');

  await cookieClient.deleteAccount('DELETE');
  {
    const request = popLastRequest();
    expectCookie(request, '/api/v1/me/account/delete', 'POST');
    assert.deepEqual(request.body, {
      confirm: 'DELETE'
    });
  }

  const failingBearerClient = createApiClient({
    baseUrl: 'https://tmz.test',
    auth: { mode: 'bearer', accessToken: 'bad-token' },
    fetchImpl
  });

  await assert.rejects(
    () => failingBearerClient.sendPushTest(),
    (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'push_not_enabled');
      assert.equal(error.path, '/api/v1/me/push-devices/test');
      return true;
    }
  );

  console.log('v1 client contracts passed');
}

await main();

function expectRetiredApiClientError(error: unknown) {
  assert.ok(error instanceof ApiClientError);
  assert.equal(error.status, 410);
  assert.equal(error.code, 'native_mobile_push_only');
  return true;
}
