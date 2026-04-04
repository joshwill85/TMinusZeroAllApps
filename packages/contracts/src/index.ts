import { z } from 'zod';

export const viewerSessionSchemaV1 = z.object({
  viewerId: z.string().uuid().nullable(),
  email: z.string().email().nullable(),
  role: z.enum(['guest', 'member', 'admin']),
  accessToken: z.string().nullable(),
  expiresAt: z.string().nullable(),
  authMode: z.enum(['guest', 'cookie', 'bearer']),
  mobileHubRollout: z.object({
    blueOrigin: z.object({
      nativeEnabled: z.boolean(),
      externalDeepLinksEnabled: z.boolean()
    }),
    spacex: z.object({
      nativeEnabled: z.boolean(),
      externalDeepLinksEnabled: z.boolean()
    }),
    artemis: z.object({
      nativeEnabled: z.boolean(),
      externalDeepLinksEnabled: z.boolean()
    })
  })
});

export const blueOriginMissionKeySchemaV1 = z.enum([
  'blue-origin-program',
  'new-shepard',
  'new-glenn',
  'blue-moon',
  'blue-ring',
  'be-4'
]);

const blueOriginConfidenceSchemaV1 = z.enum(['high', 'medium', 'low']);

const blueOriginFaqItemSchemaV1 = z.object({
  question: z.string(),
  answer: z.string()
});

const blueOriginChangeItemSchemaV1 = z.object({
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  href: z.string().optional()
});

const blueOriginLaunchSummarySchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  vehicle: z.string(),
  net: z.string(),
  netPrecision: z.enum(['minute', 'hour', 'day', 'month', 'tbd']),
  status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown']),
  statusText: z.string(),
  imageUrl: z.string().nullable(),
  padName: z.string().nullable(),
  padShortCode: z.string().nullable(),
  padLocation: z.string().nullable(),
  missionName: z.string().nullable(),
  missionKey: blueOriginMissionKeySchemaV1.nullable(),
  flightCode: z.string().nullable(),
  href: z.string()
});

const blueOriginProgramSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  nextLaunch: blueOriginLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(blueOriginLaunchSummarySchemaV1),
  recent: z.array(blueOriginLaunchSummarySchemaV1),
  faq: z.array(blueOriginFaqItemSchemaV1)
});

const blueOriginMissionSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  missionKey: blueOriginMissionKeySchemaV1,
  missionName: z.string(),
  nextLaunch: blueOriginLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(blueOriginLaunchSummarySchemaV1),
  recent: z.array(blueOriginLaunchSummarySchemaV1),
  highlights: z.array(z.string()),
  changes: z.array(blueOriginChangeItemSchemaV1),
  faq: z.array(blueOriginFaqItemSchemaV1)
});

const blueOriginFlightRecordSchemaV1 = z.object({
  id: z.string(),
  flightCode: z.string(),
  flightSlug: z.string(),
  missionKey: blueOriginMissionKeySchemaV1,
  missionLabel: z.string(),
  launchId: z.string().nullable(),
  ll2LaunchUuid: z.string().nullable(),
  launchName: z.string().nullable(),
  launchDate: z.string().nullable(),
  status: z.string().nullable(),
  officialMissionUrl: z.string().nullable(),
  source: z.string().nullable(),
  confidence: blueOriginConfidenceSchemaV1,
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const blueOriginTravelerIndexItemSchemaV1 = z.object({
  travelerSlug: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
  nationalities: z.array(z.string()),
  confidence: blueOriginConfidenceSchemaV1,
  imageUrl: z.string().nullable(),
  launchCount: z.number().int().nonnegative(),
  flightCount: z.number().int().nonnegative(),
  latestFlightCode: z.string().nullable(),
  latestLaunchDate: z.string().nullable(),
  latestLaunchName: z.string().nullable(),
  latestLaunchHref: z.string().nullable()
});

const blueOriginVehicleSchemaV1 = z.object({
  id: z.string(),
  vehicleSlug: z.enum(['new-shepard', 'new-glenn', 'blue-moon', 'blue-ring']),
  missionKey: blueOriginMissionKeySchemaV1,
  displayName: z.string(),
  vehicleClass: z.string().nullable(),
  status: z.string().nullable(),
  firstFlight: z.string().nullable(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const blueOriginEngineSchemaV1 = z.object({
  id: z.string(),
  engineSlug: z.enum(['be-3pm', 'be-3u', 'be-4', 'be-7']),
  missionKey: blueOriginMissionKeySchemaV1,
  displayName: z.string(),
  propellants: z.string().nullable(),
  cycle: z.string().nullable(),
  thrustVacKN: z.number().nullable(),
  thrustSlKN: z.number().nullable(),
  status: z.string().nullable(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const blueOriginContractSchemaV1 = z.object({
  id: z.string(),
  contractKey: z.string(),
  missionKey: blueOriginMissionKeySchemaV1,
  title: z.string(),
  agency: z.string().nullable(),
  customer: z.string().nullable(),
  amount: z.number().nullable(),
  awardedOn: z.string().nullable(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  status: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const blueOriginPassengerSchemaV1 = z.object({
  id: z.string(),
  missionKey: blueOriginMissionKeySchemaV1,
  flightCode: z.string().nullable(),
  flightSlug: z.string().nullable(),
  travelerSlug: z.string().nullable().optional(),
  seatIndex: z.number().int().nullable().optional(),
  name: z.string(),
  role: z.string().nullable(),
  nationality: z.string().nullable(),
  launchId: z.string().nullable(),
  launchName: z.string().nullable(),
  launchDate: z.string().nullable(),
  profileUrl: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  source: z.string(),
  confidence: blueOriginConfidenceSchemaV1
});

const blueOriginPayloadSchemaV1 = z.object({
  id: z.string(),
  missionKey: blueOriginMissionKeySchemaV1,
  flightCode: z.string().nullable(),
  flightSlug: z.string().nullable(),
  name: z.string(),
  payloadType: z.string().nullable(),
  orbit: z.string().nullable(),
  agency: z.string().nullable(),
  launchId: z.string().nullable(),
  launchName: z.string().nullable(),
  launchDate: z.string().nullable(),
  source: z.string(),
  confidence: blueOriginConfidenceSchemaV1
});

const blueOriginContentItemSchemaV1 = z.object({
  id: z.string(),
  missionKey: z.union([blueOriginMissionKeySchemaV1, z.literal('all')]),
  kind: z.enum(['article', 'photo', 'social', 'data']),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  sourceType: z.string(),
  sourceLabel: z.string(),
  confidence: blueOriginConfidenceSchemaV1
});

const hubLinkedRecordPreviewSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  meta: z.string().nullable(),
  href: z.string().nullable()
});

const blueOriginTimelinePreviewSchemaV1 = z.object({
  id: z.string(),
  missionKey: blueOriginMissionKeySchemaV1,
  missionLabel: z.string(),
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  status: z.enum(['completed', 'upcoming', 'tentative', 'superseded']),
  sourceLabel: z.string(),
  href: z.string().nullable()
});

const blueOriginSocialPreviewSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  postedAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  sourceLabel: z.string()
});

const blueOriginVideoPreviewSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  sourceLabel: z.string()
});

const blueOriginImagePreviewSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  imageUrl: z.string(),
  sourceUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  sourceLabel: z.string()
});

const blueOriginMediaPreviewSchemaV1 = z.object({
  social: z.array(blueOriginSocialPreviewSchemaV1).default([]),
  videos: z.array(blueOriginVideoPreviewSchemaV1).default([]),
  images: z.array(blueOriginImagePreviewSchemaV1).default([])
});

const blueOriginMissionCardSchemaV1 = z.object({
  missionKey: blueOriginMissionKeySchemaV1,
  title: z.string(),
  description: z.string(),
  href: z.string(),
  statusLabel: z.string(),
  highlight: z.string().nullable()
});

const blueOriginOverviewStatsSchemaV1 = z.object({
  upcomingLaunches: z.number().int().nonnegative(),
  recentLaunches: z.number().int().nonnegative(),
  flights: z.number().int().nonnegative(),
  travelers: z.number().int().nonnegative(),
  vehicles: z.number().int().nonnegative(),
  engines: z.number().int().nonnegative(),
  contracts: z.number().int().nonnegative(),
  contentItems: z.number().int().nonnegative()
});

export const blueOriginOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: blueOriginProgramSnapshotSchemaV1,
  stats: blueOriginOverviewStatsSchemaV1,
  missions: z.array(blueOriginMissionCardSchemaV1),
  flights: z.array(blueOriginFlightRecordSchemaV1),
  travelers: z.array(blueOriginTravelerIndexItemSchemaV1),
  vehicles: z.array(blueOriginVehicleSchemaV1),
  engines: z.array(blueOriginEngineSchemaV1),
  contracts: z.array(blueOriginContractSchemaV1),
  content: z.array(blueOriginContentItemSchemaV1),
  timeline: z.array(blueOriginTimelinePreviewSchemaV1).default([]),
  auditTrail: z.array(hubLinkedRecordPreviewSchemaV1).default([]),
  media: blueOriginMediaPreviewSchemaV1.default({
    social: [],
    videos: [],
    images: []
  })
});

export const blueOriginMissionOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: blueOriginMissionSnapshotSchemaV1,
  passengers: z.array(blueOriginPassengerSchemaV1),
  payloads: z.array(blueOriginPayloadSchemaV1),
  contracts: z.array(blueOriginContractSchemaV1),
  content: z.array(blueOriginContentItemSchemaV1)
});

export const blueOriginFlightsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([blueOriginMissionKeySchemaV1, z.literal('all')]),
  items: z.array(blueOriginFlightRecordSchemaV1)
});

export const blueOriginTravelersResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  items: z.array(blueOriginTravelerIndexItemSchemaV1)
});

export const blueOriginVehiclesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([blueOriginMissionKeySchemaV1, z.literal('all')]),
  items: z.array(blueOriginVehicleSchemaV1)
});

export const blueOriginEnginesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([blueOriginMissionKeySchemaV1, z.literal('all')]),
  items: z.array(blueOriginEngineSchemaV1)
});

export const blueOriginContractsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([blueOriginMissionKeySchemaV1, z.literal('all')]),
  items: z.array(blueOriginContractSchemaV1)
});

export const spaceXMissionKeySchemaV1 = z.enum(['spacex-program', 'starship', 'falcon-9', 'falcon-heavy', 'dragon']);

const spaceXFaqItemSchemaV1 = z.object({
  question: z.string(),
  answer: z.string()
});

const spaceXLaunchSummarySchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  vehicle: z.string(),
  net: z.string(),
  netPrecision: z.enum(['minute', 'hour', 'day', 'month', 'tbd']),
  status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown']),
  statusText: z.string(),
  imageUrl: z.string().nullable(),
  padName: z.string().nullable(),
  padShortCode: z.string().nullable(),
  padLocation: z.string().nullable(),
  missionName: z.string().nullable(),
  missionKey: spaceXMissionKeySchemaV1.nullable(),
  flightSlug: z.string().nullable(),
  href: z.string()
});

const spaceXProgramSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  nextLaunch: spaceXLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(spaceXLaunchSummarySchemaV1),
  recent: z.array(spaceXLaunchSummarySchemaV1),
  faq: z.array(spaceXFaqItemSchemaV1)
});

const spaceXMissionSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  missionKey: spaceXMissionKeySchemaV1,
  missionName: z.string(),
  nextLaunch: spaceXLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(spaceXLaunchSummarySchemaV1),
  recent: z.array(spaceXLaunchSummarySchemaV1),
  highlights: z.array(z.string()),
  faq: z.array(spaceXFaqItemSchemaV1)
});

const spaceXVehicleSchemaV1 = z.object({
  id: z.string(),
  vehicleSlug: z.enum(['starship-super-heavy', 'falcon-9', 'falcon-heavy', 'dragon']),
  missionKey: spaceXMissionKeySchemaV1,
  displayName: z.string(),
  vehicleClass: z.string().nullable(),
  status: z.string().nullable(),
  firstFlight: z.string().nullable(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const spaceXEngineSchemaV1 = z.object({
  id: z.string(),
  engineSlug: z.enum(['raptor', 'merlin-1d', 'merlin-vac', 'draco', 'superdraco']),
  missionKey: spaceXMissionKeySchemaV1,
  displayName: z.string(),
  propellants: z.string().nullable(),
  cycle: z.string().nullable(),
  thrustVacKN: z.number().nullable(),
  thrustSlKN: z.number().nullable(),
  status: z.string().nullable(),
  description: z.string().nullable(),
  officialUrl: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const spaceXContractSchemaV1 = z.object({
  id: z.string(),
  contractKey: z.string(),
  missionKey: spaceXMissionKeySchemaV1,
  title: z.string(),
  agency: z.string().nullable(),
  customer: z.string().nullable(),
  amount: z.number().nullable(),
  awardedOn: z.string().nullable(),
  description: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  status: z.string().nullable(),
  metadata: z.record(z.unknown()),
  updatedAt: z.string().nullable()
});

const spaceXFlightRecordSchemaV1 = z.object({
  id: z.string(),
  flightSlug: z.string(),
  missionKey: spaceXMissionKeySchemaV1,
  missionLabel: z.string(),
  droneShipSlug: z.string().nullable(),
  droneShipName: z.string().nullable(),
  droneShipAbbrev: z.string().nullable(),
  droneShipLandingResult: z.enum(['success', 'failure', 'no_attempt', 'unknown']),
  launch: spaceXLaunchSummarySchemaV1
});

const spaceXPassengerSchemaV1 = z.object({
  id: z.string(),
  missionKey: spaceXMissionKeySchemaV1,
  flightSlug: z.string(),
  name: z.string(),
  role: z.string().nullable(),
  nationality: z.string().nullable(),
  launchId: z.string(),
  launchName: z.string(),
  launchDate: z.string(),
  source: z.string(),
  confidence: blueOriginConfidenceSchemaV1
});

const spaceXPayloadSchemaV1 = z.object({
  id: z.string(),
  missionKey: spaceXMissionKeySchemaV1,
  flightSlug: z.string(),
  name: z.string(),
  payloadType: z.string().nullable(),
  orbit: z.string().nullable(),
  agency: z.string().nullable(),
  launchId: z.string(),
  launchName: z.string(),
  launchDate: z.string(),
  source: z.string(),
  confidence: blueOriginConfidenceSchemaV1
});

const spaceXDroneShipKpisSchemaV1 = z.object({
  assignmentsKnown: z.number().int().nonnegative(),
  upcomingAssignments: z.number().int().nonnegative(),
  assignmentsPastYear: z.number().int().nonnegative(),
  distinctBoostersRecovered: z.number().int().nonnegative(),
  distinctLaunchSitesServed: z.number().int().nonnegative(),
  coveragePercent: z.number().nonnegative(),
  firstAssignmentDate: z.string().nullable(),
  lastAssignmentDate: z.string().nullable()
});

const spaceXDroneShipSchemaV1 = z.object({
  slug: z.enum(['ocisly', 'asog', 'jrti']),
  name: z.string(),
  abbrev: z.string().nullable(),
  status: z.enum(['active', 'retired', 'unknown']),
  description: z.string().nullable(),
  wikidataId: z.string().nullable(),
  wikiSourceUrl: z.string().nullable(),
  wikipediaUrl: z.string().nullable(),
  wikimediaCommonsCategory: z.string().nullable(),
  wikiLastSyncedAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  imageSourceUrl: z.string().nullable(),
  imageLicense: z.string().nullable(),
  imageLicenseUrl: z.string().nullable(),
  imageCredit: z.string().nullable(),
  imageAlt: z.string().nullable(),
  lengthM: z.number().nullable(),
  yearBuilt: z.number().int().nullable(),
  homePort: z.string().nullable(),
  ownerName: z.string().nullable(),
  operatorName: z.string().nullable(),
  countryName: z.string().nullable(),
  kpis: spaceXDroneShipKpisSchemaV1
});

const spaceXDroneShipAssignmentSchemaV1 = z.object({
  launchId: z.string(),
  ll2LaunchUuid: z.string().nullable(),
  launchName: z.string(),
  launchSlug: z.string().nullable(),
  launchNet: z.string().nullable(),
  launchHref: z.string(),
  flightSlug: z.string(),
  missionKey: spaceXMissionKeySchemaV1,
  missionLabel: z.string(),
  provider: z.string().nullable(),
  vehicle: z.string().nullable(),
  padName: z.string().nullable(),
  padShortCode: z.string().nullable(),
  padLocationName: z.string().nullable(),
  shipSlug: z.enum(['ocisly', 'asog', 'jrti']),
  shipName: z.string(),
  shipAbbrev: z.string().nullable(),
  landingResult: z.enum(['success', 'failure', 'no_attempt', 'unknown']),
  landingAttempt: z.boolean().nullable(),
  landingSuccess: z.boolean().nullable(),
  landingTime: z.string().nullable(),
  source: z.string(),
  sourceLandingId: z.string().nullable(),
  lastVerifiedAt: z.string().nullable()
});

const spaceXDroneShipCoverageSchemaV1 = z.object({
  generatedAt: z.string(),
  totalSpaceXLaunches: z.number().int().nonnegative(),
  knownLandingAssignments: z.number().int().nonnegative(),
  coveragePercent: z.number().nonnegative(),
  upcomingKnownAssignments: z.number().int().nonnegative(),
  lastVerifiedAt: z.string().nullable()
});

const spaceXDroneShipBoosterStatSchemaV1 = z.object({
  ll2LauncherId: z.number().int(),
  serialNumber: z.string().nullable(),
  missions: z.number().int().nonnegative()
});

const spaceXFinanceSignalSchemaV1 = z.object({
  id: z.string(),
  company: z.literal('SpaceX'),
  kind: z.enum(['government-obligations', 'announced-deal-value', 'launch-cadence', 'private-company-disclosure']),
  title: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  period: z.string().nullable(),
  asOfDate: z.string().nullable(),
  sourceLabel: z.string(),
  sourceUrl: z.string().nullable(),
  confidence: blueOriginConfidenceSchemaV1,
  disclaimer: z.string(),
  metadata: z.record(z.unknown())
});

const spaceXFinanceResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  company: z.literal('SpaceX'),
  publicEarningsAvailable: z.boolean(),
  disclaimer: z.string(),
  items: z.array(spaceXFinanceSignalSchemaV1)
});

const spaceXMissionCardSchemaV1 = z.object({
  missionKey: spaceXMissionKeySchemaV1,
  title: z.string(),
  description: z.string(),
  href: z.string(),
  statusLabel: z.string(),
  highlight: z.string().nullable()
});

const spaceXOverviewStatsSchemaV1 = z.object({
  upcomingLaunches: z.number().int().nonnegative(),
  recentLaunches: z.number().int().nonnegative(),
  flights: z.number().int().nonnegative(),
  vehicles: z.number().int().nonnegative(),
  engines: z.number().int().nonnegative(),
  passengers: z.number().int().nonnegative(),
  payloads: z.number().int().nonnegative(),
  contracts: z.number().int().nonnegative()
});

export const spaceXOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: spaceXProgramSnapshotSchemaV1,
  stats: spaceXOverviewStatsSchemaV1,
  missions: z.array(spaceXMissionCardSchemaV1),
  flights: z.array(spaceXFlightRecordSchemaV1),
  vehicles: z.array(spaceXVehicleSchemaV1),
  engines: z.array(spaceXEngineSchemaV1),
  contracts: z.array(spaceXContractSchemaV1),
  droneShips: z.object({
    items: z.array(spaceXDroneShipSchemaV1).default([]),
    coverage: spaceXDroneShipCoverageSchemaV1.nullable().default(null),
    upcomingAssignments: z.array(spaceXDroneShipAssignmentSchemaV1).default([])
  }).default({
    items: [],
    coverage: null,
    upcomingAssignments: []
  }),
  finance: spaceXFinanceResponseSchemaV1.nullable().default(null),
  discovery: z.array(hubLinkedRecordPreviewSchemaV1).default([]),
  usaspending: z.array(hubLinkedRecordPreviewSchemaV1).default([])
});

export const spaceXMissionOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: spaceXMissionSnapshotSchemaV1,
  passengers: z.array(spaceXPassengerSchemaV1),
  payloads: z.array(spaceXPayloadSchemaV1),
  contracts: z.array(spaceXContractSchemaV1)
});

export const spaceXFlightsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([spaceXMissionKeySchemaV1, z.literal('all')]),
  items: z.array(spaceXFlightRecordSchemaV1)
});

export const spaceXVehiclesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([spaceXMissionKeySchemaV1, z.literal('all')]),
  items: z.array(spaceXVehicleSchemaV1)
});

export const spaceXEnginesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([spaceXMissionKeySchemaV1, z.literal('all')]),
  items: z.array(spaceXEngineSchemaV1)
});

export const spaceXContractsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: z.union([spaceXMissionKeySchemaV1, z.literal('all')]),
  items: z.array(spaceXContractSchemaV1)
});

export const spaceXDroneShipListResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  items: z.array(spaceXDroneShipSchemaV1),
  coverage: spaceXDroneShipCoverageSchemaV1,
  upcomingAssignments: z.array(spaceXDroneShipAssignmentSchemaV1)
});

export const spaceXDroneShipDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  ship: spaceXDroneShipSchemaV1,
  coverage: spaceXDroneShipCoverageSchemaV1,
  upcomingAssignments: z.array(spaceXDroneShipAssignmentSchemaV1),
  recentAssignments: z.array(spaceXDroneShipAssignmentSchemaV1),
  launchSites: z.array(
    z.object({
      name: z.string(),
      count: z.number().int().nonnegative()
    })
  ),
  missionMix: z.array(
    z.object({
      missionKey: spaceXMissionKeySchemaV1,
      missionLabel: z.string(),
      count: z.number().int().nonnegative()
    })
  ),
  boosters: z.array(spaceXDroneShipBoosterStatSchemaV1)
});

export const artemisMissionKeySchemaV1 = z.enum([
  'artemis-i',
  'artemis-ii',
  'artemis-iii',
  'artemis-iv',
  'artemis-v',
  'artemis-vi',
  'artemis-vii'
]);

const artemisFaqItemSchemaV1 = z.object({
  question: z.string(),
  answer: z.string()
});

const artemisChangeItemSchemaV1 = z.object({
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  href: z.string().optional()
});

const artemisLaunchSummarySchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  vehicle: z.string(),
  net: z.string(),
  netPrecision: z.enum(['minute', 'hour', 'day', 'month', 'tbd']),
  status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown']),
  statusText: z.string(),
  imageUrl: z.string().nullable(),
  padName: z.string().nullable(),
  padShortCode: z.string().nullable(),
  padLocation: z.string().nullable(),
  missionName: z.string().nullable(),
  missionKey: artemisMissionKeySchemaV1.nullable(),
  href: z.string()
});

const artemisProgramSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  nextLaunch: artemisLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(artemisLaunchSummarySchemaV1),
  recent: z.array(artemisLaunchSummarySchemaV1),
  faq: z.array(artemisFaqItemSchemaV1)
});

const artemisMissionSnapshotSchemaV1 = z.object({
  generatedAt: z.string(),
  lastUpdated: z.string().nullable(),
  missionKey: artemisMissionKeySchemaV1,
  missionName: z.string(),
  nextLaunch: artemisLaunchSummarySchemaV1.nullable(),
  upcoming: z.array(artemisLaunchSummarySchemaV1),
  recent: z.array(artemisLaunchSummarySchemaV1),
  crewHighlights: z.array(z.string()),
  changes: z.array(artemisChangeItemSchemaV1),
  faq: z.array(artemisFaqItemSchemaV1)
});

const artemisMissionCardSchemaV1 = z.object({
  missionKey: artemisMissionKeySchemaV1,
  title: z.string(),
  description: z.string(),
  href: z.string(),
  statusLabel: z.string(),
  targetDate: z.string().nullable(),
  highlight: z.string().nullable()
});

const artemisTimelinePreviewSchemaV1 = z.object({
  id: z.string(),
  missionKey: z.union([artemisMissionKeySchemaV1, z.literal('artemis-program')]),
  missionLabel: z.string(),
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  status: z.enum(['completed', 'upcoming', 'tentative', 'superseded']),
  sourceLabel: z.string(),
  href: z.string().nullable()
});

const artemisContentPreviewSchemaV1 = z.object({
  id: z.string(),
  kind: z.enum(['article', 'photo', 'social', 'data']),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  sourceLabel: z.string(),
  missionLabel: z.string()
});

const artemisOverviewStatsSchemaV1 = z.object({
  missions: z.number().int().nonnegative(),
  upcomingLaunches: z.number().int().nonnegative(),
  recentLaunches: z.number().int().nonnegative(),
  timelineEvents: z.number().int().nonnegative(),
  contentItems: z.number().int().nonnegative(),
  procurementAwards: z.number().int().nonnegative(),
  budgetLines: z.number().int().nonnegative()
});

const artemisMissionWatchLinkSchemaV1 = z.object({
  url: z.string(),
  label: z.string()
});

const artemisMissionEvidenceLinkSchemaV1 = z.object({
  label: z.string(),
  url: z.string(),
  source: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  capturedAt: z.string().nullable().optional(),
  kind: z.enum(['stream', 'report', 'reference', 'status', 'social']).optional()
});

const artemisMissionNewsItemSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  newsSite: z.string().nullable(),
  summary: z.string().nullable(),
  publishedAt: z.string().nullable(),
  relevance: z.enum(['launch-join', 'mission-keyword', 'both'])
});

const artemisMissionSocialItemSchemaV1 = z.object({
  id: z.string(),
  launchName: z.string().nullable(),
  platform: z.string(),
  externalUrl: z.string().nullable(),
  postedAt: z.string().nullable(),
  text: z.string().nullable(),
  status: z.string()
});

const artemisMissionCoverageSchemaV1 = z.object({
  hasLaunch: z.boolean(),
  hasCrew: z.boolean(),
  hasWatchLinks: z.boolean(),
  hasEvidenceLinks: z.boolean(),
  hasNews: z.boolean(),
  hasSocial: z.boolean()
});

const artemisContractMissionKeySchemaV1 = z.union([artemisMissionKeySchemaV1, z.literal('program')]);

const artemisContractSummarySchemaV1 = z.object({
  id: z.string(),
  contractKey: z.string(),
  piid: z.string(),
  referencedIdvPiid: z.string().nullable(),
  parentAwardId: z.string().nullable(),
  missionKey: artemisContractMissionKeySchemaV1.nullable(),
  awardeeName: z.string().nullable(),
  awardeeUei: z.string().nullable(),
  contractType: z.string().nullable(),
  description: z.string().nullable(),
  baseAwardDate: z.string().nullable(),
  agencyCode: z.string().nullable(),
  subtierCode: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
  metadata: z.record(z.unknown())
});

const artemisContractActionSchemaV1 = z.object({
  id: z.string(),
  contractId: z.string(),
  actionKey: z.string(),
  modNumber: z.string().nullable(),
  actionDate: z.string().nullable(),
  obligationDelta: z.number().nullable(),
  obligationCumulative: z.number().nullable(),
  solicitationId: z.string().nullable(),
  samNoticeId: z.string().nullable(),
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  metadata: z.record(z.unknown())
});

const artemisOpportunityNoticeSchemaV1 = z.object({
  id: z.string(),
  noticeId: z.string(),
  solicitationId: z.string().nullable(),
  ptype: z.string().nullable(),
  title: z.string().nullable(),
  postedDate: z.string().nullable(),
  responseDeadline: z.string().nullable(),
  latestActiveVersion: z.boolean(),
  awardeeName: z.string().nullable(),
  awardAmount: z.number().nullable(),
  noticeUrl: z.string().nullable(),
  attachmentCount: z.number().nullable(),
  updatedAt: z.string().nullable(),
  metadata: z.record(z.unknown())
});

const artemisContractSpendingPointSchemaV1 = z.object({
  id: z.string(),
  contractId: z.string(),
  fiscalYear: z.number().int(),
  fiscalMonth: z.number().int(),
  obligations: z.number().nullable(),
  outlays: z.number().nullable(),
  source: z.string().nullable(),
  updatedAt: z.string().nullable(),
  metadata: z.record(z.unknown())
});

const artemisContractStorySchemaV1 = z.object({
  piid: z.string(),
  missionKey: artemisContractMissionKeySchemaV1.nullable(),
  missionLabel: z.string(),
  members: z.array(artemisContractSummarySchemaV1),
  actions: z.array(artemisContractActionSchemaV1),
  notices: z.array(artemisOpportunityNoticeSchemaV1),
  spending: z.array(artemisContractSpendingPointSchemaV1),
  bidders: z.array(z.string())
});

const artemisSeoApprovalStateSchemaV1 = z.enum(['draft', 'approved', 'rejected']);

const artemisAwardeeMissionSummarySchemaV1 = z.object({
  missionKey: artemisContractMissionKeySchemaV1,
  label: z.string(),
  awardCount: z.number().int().nonnegative(),
  obligatedAmount: z.number().nullable()
});

const artemisAwardeeAwardSchemaV1 = z.object({
  awardId: z.string().nullable(),
  title: z.string().nullable(),
  recipient: z.string(),
  obligatedAmount: z.number().nullable(),
  awardedOn: z.string().nullable(),
  missionKey: artemisContractMissionKeySchemaV1,
  contractKey: z.string().nullable(),
  solicitationId: z.string().nullable(),
  detail: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  piid: z.string().nullable().optional()
});

const artemisAwardeeIndexItemSchemaV1 = z.object({
  recipientKey: z.string(),
  recipientName: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()),
  seoApprovalState: artemisSeoApprovalStateSchemaV1,
  summary: z.string(),
  awardCount: z.number().int().nonnegative(),
  totalObligatedAmount: z.number().nullable(),
  firstAwardedOn: z.string().nullable(),
  lastAwardedOn: z.string().nullable(),
  missionBreakdown: z.array(artemisAwardeeMissionSummarySchemaV1)
});

const artemisAwardeeProfileSchemaV1 = artemisAwardeeIndexItemSchemaV1.extend({
  awards: z.array(artemisAwardeeAwardSchemaV1),
  sourceUrls: z.array(z.string()),
  sourceTitles: z.array(z.string()),
  lastUpdated: z.string().nullable()
});

const artemisContentKindSchemaV1 = z.enum(['article', 'photo', 'social', 'data']);
const artemisContentTierSchemaV1 = z.enum(['tier1', 'tier2']);
const artemisContentMissionKeySchemaV1 = z.union([artemisMissionKeySchemaV1, z.literal('program')]);
const artemisContentMissionFilterSchemaV1 = z.union([artemisContentMissionKeySchemaV1, z.literal('all')]);
const artemisContentKindFilterSchemaV1 = z.union([artemisContentKindSchemaV1, z.literal('all')]);
const artemisContentTierFilterSchemaV1 = z.union([artemisContentTierSchemaV1, z.literal('all')]);

const artemisContentScoreSchemaV1 = z.object({
  authority: z.number(),
  relevance: z.number(),
  freshness: z.number(),
  stability: z.number(),
  risk: z.number(),
  overall: z.number()
});

const artemisContentItemSchemaV1 = z.object({
  id: z.string(),
  fingerprint: z.string(),
  kind: artemisContentKindSchemaV1,
  missionKey: artemisContentMissionKeySchemaV1,
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
  capturedAt: z.string().nullable(),
  sourceKey: z.string().nullable(),
  sourceType: z.enum(['nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media', 'll2-cache', 'curated-fallback']),
  sourceClass: z.enum(['nasa_primary', 'oversight', 'budget', 'procurement', 'technical', 'media', 'll2-cache', 'curated-fallback']),
  sourceTier: artemisContentTierSchemaV1,
  sourceLabel: z.string(),
  imageUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  platform: z.string().nullable(),
  dataLabel: z.string().nullable(),
  dataValue: z.number().nullable(),
  dataUnit: z.string().nullable(),
  missionLabel: z.string(),
  score: artemisContentScoreSchemaV1,
  whyShown: z.string(),
  metadata: z.record(z.unknown())
});

const artemisContentCoverageSchemaV1 = z.object({
  generatedFrom: z.enum(['content_items', 'fallback']),
  totalItems: z.number().int().nonnegative(),
  tier1Items: z.number().int().nonnegative(),
  tier2Items: z.number().int().nonnegative(),
  byKind: z.object({
    article: z.number().int().nonnegative(),
    photo: z.number().int().nonnegative(),
    social: z.number().int().nonnegative(),
    data: z.number().int().nonnegative()
  }),
  sourceKeys: z.array(z.string())
});

const artemisBudgetPreviewSchemaV1 = z.object({
  id: z.string(),
  fiscalYear: z.number().int().nullable(),
  agency: z.string().nullable(),
  program: z.string().nullable(),
  lineItem: z.string().nullable(),
  amountRequested: z.number().nullable(),
  amountEnacted: z.number().nullable(),
  announcedTime: z.string().nullable(),
  detail: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  sourceUrl: z.string().nullable()
});

const artemisProcurementPreviewSchemaV1 = z.object({
  id: z.string(),
  awardId: z.string().nullable(),
  title: z.string().nullable(),
  recipient: z.string().nullable(),
  obligatedAmount: z.number().nullable(),
  awardedOn: z.string().nullable(),
  missionKey: z.string().nullable(),
  detail: z.string().nullable(),
  sourceTitle: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  canonicalPath: z.string().nullable()
});

export const artemisOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: artemisProgramSnapshotSchemaV1,
  stats: artemisOverviewStatsSchemaV1,
  missions: z.array(artemisMissionCardSchemaV1),
  timeline: z.array(artemisTimelinePreviewSchemaV1),
  content: z.array(artemisContentPreviewSchemaV1),
  intel: z.array(hubLinkedRecordPreviewSchemaV1).default([]),
  budget: z.array(artemisBudgetPreviewSchemaV1).default([]),
  procurement: z.array(artemisProcurementPreviewSchemaV1).default([])
});

export const artemisMissionOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: artemisMissionSnapshotSchemaV1,
  watchLinks: z.array(artemisMissionWatchLinkSchemaV1),
  evidenceLinks: z.array(artemisMissionEvidenceLinkSchemaV1),
  news: z.array(artemisMissionNewsItemSchemaV1),
  social: z.array(artemisMissionSocialItemSchemaV1),
  coverage: artemisMissionCoverageSchemaV1
});

export const artemisContractsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  items: z.array(artemisContractSummarySchemaV1),
  totalRows: z.number().int().nonnegative(),
  totalFamilies: z.number().int().nonnegative()
});

export const artemisContractDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  story: artemisContractStorySchemaV1
});

export const artemisAwardeesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  query: z.string().nullable(),
  items: z.array(artemisAwardeeIndexItemSchemaV1)
});

export const artemisAwardeeDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  profile: artemisAwardeeProfileSchemaV1,
  related: z.array(artemisAwardeeIndexItemSchemaV1)
});

export const artemisContentResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  mission: artemisContentMissionFilterSchemaV1,
  kind: artemisContentKindFilterSchemaV1,
  tier: artemisContentTierFilterSchemaV1,
  items: z.array(artemisContentItemSchemaV1),
  nextCursor: z.string().nullable(),
  sourceCoverage: artemisContentCoverageSchemaV1
});

const starshipFaqItemSchemaV1 = z.object({
  question: z.string(),
  answer: z.string()
});

const starshipChangeItemSchemaV1 = z.object({
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  href: z.string().optional()
});

const starshipTimelinePreviewSchemaV1 = z.object({
  id: z.string(),
  missionLabel: z.string(),
  title: z.string(),
  summary: z.string(),
  date: z.string(),
  status: z.enum(['completed', 'upcoming', 'tentative', 'superseded']),
  sourceLabel: z.string(),
  href: z.string().nullable()
});

const starshipFlightIndexItemSchemaV1 = z.object({
  flightNumber: z.number().int().positive(),
  flightSlug: z.string(),
  label: z.string(),
  nextLaunch: spaceXLaunchSummarySchemaV1.nullable(),
  upcomingCount: z.number().int().nonnegative(),
  recentCount: z.number().int().nonnegative(),
  lastUpdated: z.string().nullable()
});

const starshipOverviewStatsSchemaV1 = z.object({
  upcomingLaunches: z.number().int().nonnegative(),
  recentLaunches: z.number().int().nonnegative(),
  flightsTracked: z.number().int().nonnegative(),
  timelineEvents: z.number().int().nonnegative()
});

export const starshipOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: z.object({
    generatedAt: z.string(),
    lastUpdated: z.string().nullable(),
    nextLaunch: spaceXLaunchSummarySchemaV1.nullable(),
    upcoming: z.array(spaceXLaunchSummarySchemaV1),
    recent: z.array(spaceXLaunchSummarySchemaV1),
    faq: z.array(starshipFaqItemSchemaV1)
  }),
  stats: starshipOverviewStatsSchemaV1,
  flights: z.array(starshipFlightIndexItemSchemaV1),
  timeline: z.array(starshipTimelinePreviewSchemaV1)
});

export const starshipFlightOverviewSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  snapshot: z.object({
    generatedAt: z.string(),
    lastUpdated: z.string().nullable(),
    missionName: z.string(),
    flightNumber: z.number().int().positive(),
    flightSlug: z.string(),
    nextLaunch: spaceXLaunchSummarySchemaV1.nullable(),
    upcoming: z.array(spaceXLaunchSummarySchemaV1),
    recent: z.array(spaceXLaunchSummarySchemaV1),
    crewHighlights: z.array(z.string()),
    changes: z.array(starshipChangeItemSchemaV1),
    faq: z.array(starshipFaqItemSchemaV1)
  }),
  timeline: z.array(starshipTimelinePreviewSchemaV1)
});

export const entitlementCapabilitiesSchemaV1 = z.object({
  canUseSavedItems: z.boolean(),
  canUseLaunchFilters: z.boolean(),
  canUseLaunchCalendar: z.boolean(),
  canUseOneOffCalendar: z.boolean(),
  canUseLiveFeed: z.boolean(),
  canUseChangeLog: z.boolean(),
  canUseInstantAlerts: z.boolean(),
  canManageFilterPresets: z.boolean(),
  canManageFollows: z.boolean(),
  canUseBasicAlertRules: z.boolean(),
  canUseAdvancedAlertRules: z.boolean(),
  canUseBrowserLaunchAlerts: z.boolean(),
  canUseSingleLaunchFollow: z.boolean(),
  canUseAllUsLaunchAlerts: z.boolean(),
  canUseStateLaunchAlerts: z.boolean(),
  canUseRecurringCalendarFeeds: z.boolean(),
  canUseRssFeeds: z.boolean(),
  canUseEmbedWidgets: z.boolean(),
  canUseArTrajectory: z.boolean(),
  canUseEnhancedForecastInsights: z.boolean(),
  canUseLaunchDayEmail: z.boolean()
});

export const entitlementLimitsSchemaV1 = z.object({
  presetLimit: z.number().int().nonnegative(),
  filterPresetLimit: z.number().int().nonnegative(),
  watchlistLimit: z.number().int().nonnegative(),
  watchlistRuleLimit: z.number().int().nonnegative(),
  singleLaunchFollowLimit: z.number().int().nonnegative()
});

export const adminAccessOverrideTierSchemaV1 = z.enum(['anon', 'premium']);

export const effectiveTierSourceSchemaV1 = z.enum(['guest', 'anon', 'subscription', 'admin', 'admin_override']);

export const entitlementSchemaV1 = z.object({
  tier: z.enum(['anon', 'premium']),
  status: z.string(),
  source: z.enum(['stub', 'guest', 'db', 'stripe_reconcile', 'none', 'stripe', 'apple', 'google', 'manual']),
  isPaid: z.boolean(),
  billingIsPaid: z.boolean(),
  isAdmin: z.boolean(),
  isAuthed: z.boolean(),
  mode: z.enum(['public', 'live']),
  effectiveTierSource: effectiveTierSourceSchemaV1,
  adminAccessOverride: adminAccessOverrideTierSchemaV1.nullable(),
  refreshIntervalSeconds: z.number().int().nonnegative(),
  capabilities: entitlementCapabilitiesSchemaV1,
  limits: entitlementLimitsSchemaV1,
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  reconciled: z.boolean(),
  reconcileThrottled: z.boolean()
});

export const adminAccessOverrideSchemaV1 = z.object({
  adminAccessOverride: adminAccessOverrideTierSchemaV1.nullable(),
  effectiveTier: z.enum(['anon', 'premium']),
  effectiveTierSource: effectiveTierSourceSchemaV1,
  isAdmin: z.boolean(),
  billingIsPaid: z.boolean(),
  updatedAt: z.string().nullable()
});

export const adminAccessOverrideUpdateSchemaV1 = z.object({
  adminAccessOverride: adminAccessOverrideTierSchemaV1.nullable()
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

const launchInfoUrlSchemaV1 = z
  .object({
    url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    source: z.string().optional(),
    feature_image: z.string().optional(),
    type: z.object({ id: z.number().int().optional(), name: z.string().optional() }).passthrough().optional(),
    language: z
      .object({
        id: z.number().int().optional(),
        name: z.string().optional(),
        code: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

const launchVidUrlSchemaV1 = launchInfoUrlSchemaV1
  .extend({
    publisher: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    priority: z.number().int().optional()
  })
  .passthrough();

const launchMissionAgencySchemaV1 = z
  .object({
    id: z.number().int().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    country_code: z.string().optional(),
    logoUrl: z.string().optional(),
    imageUrl: z.string().optional()
  })
  .passthrough();

const launchMissionSchemaV1 = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    description: z.string().optional(),
    orbit: z.string().optional(),
    infoUrls: z.array(launchInfoUrlSchemaV1).optional(),
    vidUrls: z.array(launchVidUrlSchemaV1).optional(),
    agencies: z.array(launchMissionAgencySchemaV1).optional()
  })
  .passthrough();

const launchPadSchemaV1 = z.object({
  name: z.string(),
  shortCode: z.string(),
  state: z.string(),
  timezone: z.string(),
  locationName: z.string().optional(),
  countryCode: z.string().optional(),
  mapUrl: z.string().nullable().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const launchImageSchemaV1 = z.object({
  thumbnail: z.string(),
  full: z.string().optional(),
  credit: z.string().optional(),
  license: z.string().optional(),
  licenseUrl: z.string().optional(),
  singleUse: z.boolean().optional()
});

const launchRelatedEventSchemaV1 = z
  .object({
    id: z.number().int(),
    name: z.string(),
    date: z.string().nullable().optional(),
    datePrecision: z.string().nullable().optional(),
    typeName: z.string().nullable().optional(),
    url: z.string().nullable().optional()
  })
  .passthrough();

const launchPayloadSchemaV1 = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    orbit: z.string().optional(),
    agency: z.string().optional()
  })
  .passthrough();

const launchPatchSchemaV1 = z
  .object({
    id: z.number().int().optional(),
    name: z.string().optional(),
    priority: z.number().int().optional(),
    image_url: z.string().optional(),
    agency: z.unknown().optional()
  })
  .passthrough();

const launchUpdateSchemaV1 = z
  .object({
    id: z.number().int().optional(),
    comment: z.string().optional(),
    info_url: z.string().optional(),
    created_by: z.string().optional(),
    created_on: z.string().optional(),
    profile_image: z.string().optional()
  })
  .passthrough();

const launchTimelineEventSchemaV1 = z
  .object({
    type: z.unknown().optional(),
    relative_time: z.string().optional()
  })
  .passthrough();

const launchLinkItemSchemaV1 = z.object({
  url: z.string(),
  label: z.string(),
  meta: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  host: z.string().nullable().optional(),
  kind: z.string().nullable().optional()
});

const launchWeatherMetricSchemaV1 = z.object({
  label: z.string(),
  value: z.string()
});

const launchWeatherCardSchemaV1 = z.object({
  id: z.string(),
  source: z.enum(['ws45', 'nws']),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  issuedAt: z.string().nullable().optional(),
  validStart: z.string().nullable().optional(),
  validEnd: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  detail: z.string().nullable().optional(),
  badges: z.array(z.string()).default([]),
  metrics: z.array(launchWeatherMetricSchemaV1).default([]),
  actionLabel: z.string().nullable().optional(),
  actionUrl: z.string().nullable().optional()
});

const launchWeatherModuleSchemaV1 = z.object({
  summary: z.string().nullable().optional(),
  concerns: z.array(z.string()).default([]),
  cards: z.array(launchWeatherCardSchemaV1).default([])
});

const launchMissionResourceEntrySchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  url: z.string()
});

const launchMissionTimelineEntrySchemaV1 = z.object({
  id: z.string(),
  label: z.string(),
  time: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  phase: z.enum(['prelaunch', 'postlaunch', 'timeline']).nullable().optional()
});

const launchResourcesModuleSchemaV1 = z.object({
  watchLinks: z.array(launchLinkItemSchemaV1).default([]),
  externalLinks: z.array(launchLinkItemSchemaV1).default([]),
  missionResources: z.array(launchMissionResourceEntrySchemaV1).default([]),
  missionTimeline: z.array(launchMissionTimelineEntrySchemaV1).default([])
});

const launchSocialPostSchemaV1 = z.object({
  platform: z.enum(['x']),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  url: z.string(),
  handle: z.string().nullable().optional(),
  matchedAt: z.string().nullable().optional()
});

const launchSocialFeedSchemaV1 = z.object({
  id: z.string(),
  platform: z.enum(['x']),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  url: z.string(),
  handle: z.string().nullable().optional()
});

const launchSocialModuleSchemaV1 = z.object({
  matchedPost: launchSocialPostSchemaV1.nullable().optional(),
  providerFeeds: z.array(launchSocialFeedSchemaV1).default([])
});

const launchRelatedNewsSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  newsSite: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  itemType: z.enum(['article', 'blog', 'report']).nullable().optional(),
  authors: z.array(z.string()).default([]),
  featured: z.boolean().nullable().optional()
});

const launchRelatedEventDetailSchemaV1 = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable().optional(),
  typeName: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  datePrecision: z.string().nullable().optional(),
  locationName: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  webcastLive: z.boolean().nullable().optional()
});

const launchPayloadManifestItemSchemaV1 = z.object({
  id: z.string(),
  kind: z.enum(['payload', 'spacecraft']),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  destination: z.string().nullable().optional(),
  deploymentStatus: z.string().nullable().optional(),
  operator: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  infoUrl: z.string().nullable().optional(),
  wikiUrl: z.string().nullable().optional(),
  landingSummary: z.string().nullable().optional(),
  dockingSummary: z.string().nullable().optional()
});

const launchObjectInventoryItemSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  lines: z.array(z.string()).default([])
});

const launchObjectInventorySchemaV1 = z.object({
  summaryBadges: z.array(z.string()).default([]),
  payloadObjects: z.array(launchObjectInventoryItemSchemaV1).default([]),
  nonPayloadObjects: z.array(launchObjectInventoryItemSchemaV1).default([])
});

const launchUpdateEntrySchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  detectedAt: z.string().nullable().optional(),
  details: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
});

const launchStatCardSchemaV1 = z.object({
  id: z.string(),
  eyebrow: z.string(),
  title: z.string(),
  allTime: z.number().int().nullable().optional(),
  year: z.number().int().nullable().optional(),
  yearLabel: z.string(),
  allTimeLabel: z.string(),
  story: z.string()
});

const launchBoosterCardSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  allTime: z.number().int().nullable().optional(),
  year: z.number().int().nullable().optional(),
  yearLabel: z.string(),
  allTimeLabel: z.string(),
  detailLines: z.array(z.string()).default([]),
  imageUrl: z.string().nullable().optional()
});

const launchBonusInsightSchemaV1 = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().nullable().optional()
});

const launchMissionStatsSchemaV1 = z.object({
  cards: z.array(launchStatCardSchemaV1).default([]),
  boosterCards: z.array(launchBoosterCardSchemaV1).default([]),
  bonusInsights: z.array(launchBonusInsightSchemaV1).default([])
});

const blueOriginTravelerProfileSchemaV1 = z.object({
  name: z.string(),
  travelerSlug: z.string(),
  role: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  profileUrl: z.string().nullable().optional()
});

const blueOriginFactSchemaV1 = z.object({
  label: z.string(),
  value: z.string(),
  sourceUrl: z.string().nullable().optional()
});

const blueOriginPayloadNoteSchemaV1 = z.object({
  name: z.string(),
  description: z.string(),
  sourceUrl: z.string().nullable().optional()
});

const blueOriginModuleSchemaV1 = z.object({
  resourceLinks: z.array(launchLinkItemSchemaV1).default([]),
  travelerProfiles: z.array(blueOriginTravelerProfileSchemaV1).default([]),
  missionGraphics: z.array(launchLinkItemSchemaV1).default([]),
  facts: z.array(blueOriginFactSchemaV1).default([]),
  payloadNotes: z.array(blueOriginPayloadNoteSchemaV1).default([])
});

export const launchFeedItemSchemaV1 = z
  .object({
    id: z.string().uuid(),
    ll2Id: z.string(),
    ll2AgencyId: z.number().int().nullable().optional(),
    ll2PadId: z.number().int().nullable().optional(),
    ll2RocketConfigId: z.number().int().nullable().optional(),
    cacheGeneratedAt: z.string().optional(),
    slug: z.string().optional(),
    name: z.string(),
    launchDesignator: z.string().optional(),
    agencyLaunchAttemptCount: z.number().int().optional(),
    agencyLaunchAttemptCountYear: z.number().int().optional(),
    locationLaunchAttemptCount: z.number().int().optional(),
    locationLaunchAttemptCountYear: z.number().int().optional(),
    orbitalLaunchAttemptCount: z.number().int().optional(),
    orbitalLaunchAttemptCountYear: z.number().int().optional(),
    padLaunchAttemptCount: z.number().int().optional(),
    padLaunchAttemptCountYear: z.number().int().optional(),
    padTurnaround: z.string().optional(),
    provider: z.string(),
    providerType: z.string().optional(),
    providerCountryCode: z.string().optional(),
    providerDescription: z.string().optional(),
    providerLogoUrl: z.string().optional(),
    providerImageUrl: z.string().optional(),
    vehicle: z.string(),
    firstStageBooster: z.string().nullable().optional(),
    rocket: z
      .object({
        fullName: z.string().optional(),
        family: z.string().optional(),
        description: z.string().optional(),
        manufacturer: z.string().optional(),
        manufacturerLogoUrl: z.string().optional(),
        manufacturerImageUrl: z.string().optional(),
        imageUrl: z.string().optional(),
        variant: z.string().optional(),
        lengthM: z.number().optional(),
        diameterM: z.number().optional(),
        reusable: z.boolean().optional(),
        maidenFlight: z.string().optional(),
        leoCapacity: z.number().optional(),
        gtoCapacity: z.number().optional(),
        launchMass: z.number().optional(),
        launchCost: z.string().optional(),
        infoUrl: z.string().optional(),
        wikiUrl: z.string().optional()
      })
      .passthrough()
      .optional(),
    mission: launchMissionSchemaV1.optional(),
    pad: launchPadSchemaV1,
    net: z.string(),
    netPrecision: z.enum(['minute', 'hour', 'day', 'month', 'tbd']),
    windowStart: z.string().optional(),
    windowEnd: z.string().optional(),
    webcastLive: z.boolean().optional(),
    videoUrl: z.string().optional(),
    image: launchImageSchemaV1,
    tier: z.enum(['major', 'notable', 'routine']),
    status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown']),
    statusText: z.string(),
    featured: z.boolean().optional(),
    hidden: z.boolean().optional(),
    programs: z.array(z.object({}).passthrough()).optional(),
    crew: z.array(z.object({}).passthrough()).optional(),
    payloads: z.array(launchPayloadSchemaV1).optional(),
    launchInfoUrls: z.array(launchInfoUrlSchemaV1).optional(),
    launchVidUrls: z.array(launchVidUrlSchemaV1).optional(),
    flightclubUrl: z.string().optional(),
    hashtag: z.string().optional(),
    probability: z.number().optional(),
    weatherConcerns: z.array(z.string()).optional(),
    weatherIconUrl: z.string().optional(),
    holdReason: z.string().optional(),
    failReason: z.string().optional(),
    missionPatches: z.array(launchPatchSchemaV1).optional(),
    updates: z.array(launchUpdateSchemaV1).optional(),
    timeline: z.array(launchTimelineEventSchemaV1).optional(),
    currentEvent: launchRelatedEventSchemaV1.optional(),
    nextEvent: launchRelatedEventSchemaV1.optional(),
    lastUpdated: z.string().optional(),
    updatedFields: z.array(z.string()).optional(),
    changeSummary: z.string().optional(),
    socialPrimaryPostId: z.string().optional(),
    socialPrimaryPostUrl: z.string().optional(),
    socialPrimaryPostPlatform: z.string().optional(),
    socialPrimaryPostHandle: z.string().optional(),
    socialPrimaryPostMatchedAt: z.string().optional(),
    socialPrimaryPostForDate: z.string().optional(),
    spacexXPostId: z.string().optional(),
    spacexXPostUrl: z.string().optional(),
    spacexXPostCapturedAt: z.string().optional(),
    spacexXPostForDate: z.string().optional()
  })
  .passthrough();

export const launchFeedSchemaV1 = z.object({
  launches: z.array(launchFeedItemSchemaV1),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  freshness: z.string().nullable(),
  intervalMinutes: z.number().int().nonnegative().nullable(),
  intervalSeconds: z.number().int().nonnegative().nullable().optional(),
  tier: z.enum(['anon', 'premium']).nullable().optional(),
  scope: z.enum(['public', 'live', 'watchlist']).optional()
});

const launchRefreshScopeSchemaV1 = z.enum(['public', 'live']);
const launchRefreshCadenceReasonSchemaV1 = z.enum(['default', 'site_hot_window']);

export const launchFeedVersionSchemaV1 = z.object({
  scope: launchRefreshScopeSchemaV1,
  tier: z.enum(['anon', 'premium']),
  intervalSeconds: z.number().int().nonnegative(),
  matchCount: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  version: z.string(),
  recommendedIntervalSeconds: z.number().int().nonnegative().optional(),
  cadenceReason: launchRefreshCadenceReasonSchemaV1.optional(),
  cadenceAnchorNet: z.string().nullable().optional()
});

const changedLaunchEntrySchemaV1 = z.object({
  updateId: z.string(),
  changeSummary: z.string().optional(),
  updatedFields: z.array(z.string()).default([]),
  detectedAt: z.string().optional(),
  detectedLabel: z.string().optional(),
  details: z.array(z.string()).default([])
});

const changedLaunchSchemaV1 = z.object({
  launchId: z.string().uuid(),
  name: z.string(),
  summary: z.string(),
  lastUpdated: z.string().optional(),
  lastUpdatedLabel: z.string().optional(),
  entries: z.array(changedLaunchEntrySchemaV1)
});

export const changedLaunchesSchemaV1 = z.object({
  hours: z.number().int().positive(),
  tier: z.enum(['anon', 'premium']),
  intervalSeconds: z.number().int().nonnegative(),
  results: z.array(changedLaunchSchemaV1)
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

const customerRouteLinkSchemaV1 = z.object({
  label: z.string(),
  href: z.string(),
  external: z.boolean().default(false)
});

const customerRouteLaunchSummarySchemaV1 = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().nullable(),
  vehicle: z.string().nullable(),
  net: z.string().nullable(),
  netPrecision: z.enum(['minute', 'hour', 'day', 'month', 'tbd']).nullable(),
  status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown']).nullable(),
  statusText: z.string().nullable(),
  href: z.string()
});

export const basicLaunchFollowSchemaV1 = z.object({
  launchId: z.string().uuid(),
  launchName: z.string(),
  net: z.string().nullable()
});

export const basicFollowsSchemaV1 = z.object({
  singleLaunchFollowLimit: z.number().int().nonnegative(),
  activeLaunchFollow: basicLaunchFollowSchemaV1.nullable(),
  allUsEnabled: z.boolean()
});

const newsProviderSchemaV1 = z.object({
  slug: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  countryCode: z.string().nullable()
});

const newsItemSchemaV1 = z.object({
  id: z.string(),
  itemType: z.enum(['article', 'blog', 'report']),
  title: z.string(),
  summary: z.string().nullable(),
  url: z.string(),
  newsSite: z.string().nullable(),
  imageUrl: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
  authors: z.array(z.string()).default([]),
  featured: z.boolean(),
  matchedBy: z.enum(['join', 'mention', 'none']),
  relatedLaunchCount: z.number().int().nonnegative(),
  launch: customerRouteLaunchSummarySchemaV1.nullable()
});

export const newsStreamSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  type: z.enum(['all', 'article', 'blog', 'report']),
  providerSlug: z.string().nullable(),
  providers: z.array(newsProviderSchemaV1),
  items: z.array(newsItemSchemaV1),
  nextCursor: z.number().int().nonnegative(),
  hasMore: z.boolean()
});

const canonicalContractProgramScopeSchemaV1 = z.enum(['spacex', 'blue-origin', 'artemis']);
const canonicalContractScopeFilterSchemaV1 = z.enum(['all', 'spacex', 'blue-origin', 'artemis']);
const canonicalContractStoryStatusSchemaV1 = z.enum(['exact', 'pending']);

const canonicalContractSummarySchemaV1 = z.object({
  uid: z.string(),
  scope: canonicalContractProgramScopeSchemaV1,
  storyStatus: canonicalContractStoryStatusSchemaV1,
  title: z.string(),
  description: z.string().nullable(),
  contractKey: z.string(),
  piid: z.string().nullable(),
  usaspendingAwardId: z.string().nullable(),
  missionKey: z.string().nullable(),
  missionLabel: z.string(),
  agency: z.string().nullable(),
  customer: z.string().nullable(),
  recipient: z.string().nullable(),
  amount: z.number().nullable(),
  awardedOn: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  status: z.string().nullable(),
  updatedAt: z.string().nullable(),
  canonicalPath: z.string(),
  programPath: z.string(),
  keywords: z.array(z.string()).default([]),
  actionCount: z.number().int().nonnegative(),
  noticeCount: z.number().int().nonnegative(),
  spendingCount: z.number().int().nonnegative(),
  bidderCount: z.number().int().nonnegative()
});

export const canonicalContractsResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  query: z.string().nullable(),
  scope: canonicalContractScopeFilterSchemaV1,
  totalRows: z.number().int().nonnegative(),
  totals: z.object({
    all: z.number().int().nonnegative(),
    exact: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    spacex: z.number().int().nonnegative(),
    blueOrigin: z.number().int().nonnegative(),
    artemis: z.number().int().nonnegative()
  }),
  items: z.array(canonicalContractSummarySchemaV1)
});

const canonicalContractFactSchemaV1 = z.object({
  label: z.string(),
  value: z.string()
});

export const canonicalContractDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  contract: canonicalContractSummarySchemaV1,
  facts: z.array(canonicalContractFactSchemaV1),
  links: z.array(customerRouteLinkSchemaV1),
  familyMembers: z.array(canonicalContractSummarySchemaV1)
});

const satelliteOwnerIndexItemSchemaV1 = z.object({
  ownerCode: z.string(),
  ownerLabel: z.string(),
  href: z.string(),
  satelliteCount: z.number().int().nonnegative(),
  lastSatcatUpdatedAt: z.string().nullable()
});

const satellitePreviewItemSchemaV1 = z.object({
  noradCatId: z.number().int().positive(),
  intlDes: z.string().nullable(),
  name: z.string().nullable(),
  objectType: z.string().nullable(),
  ownerCode: z.string().nullable(),
  ownerLabel: z.string().nullable(),
  ownerHref: z.string().nullable(),
  satcatUpdatedAt: z.string().nullable(),
  href: z.string()
});

const satelliteOrbitSummarySchemaV1 = z.object({
  source: z.string().nullable(),
  epoch: z.string().nullable(),
  inclinationDeg: z.number().nullable(),
  raanDeg: z.number().nullable(),
  eccentricity: z.number().nullable(),
  argPerigeeDeg: z.number().nullable(),
  meanAnomalyDeg: z.number().nullable(),
  meanMotionRevPerDay: z.number().nullable(),
  bstar: z.number().nullable(),
  fetchedAt: z.string().nullable()
});

export const satellitesResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  items: z.array(satellitePreviewItemSchemaV1),
  topOwners: z.array(satelliteOwnerIndexItemSchemaV1)
});

export const satelliteOwnersResponseSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  items: z.array(satelliteOwnerIndexItemSchemaV1)
});

export const satelliteDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  satellite: z.object({
    noradCatId: z.number().int().positive(),
    intlDes: z.string().nullable(),
    name: z.string().nullable(),
    objectType: z.string().nullable(),
    opsStatusCode: z.string().nullable(),
    ownerCode: z.string().nullable(),
    ownerLabel: z.string().nullable(),
    ownerHref: z.string().nullable(),
    launchDate: z.string().nullable(),
    launchSite: z.string().nullable(),
    decayDate: z.string().nullable(),
    periodMinutes: z.number().nullable(),
    inclinationDeg: z.number().nullable(),
    apogeeKm: z.number().nullable(),
    perigeeKm: z.number().nullable(),
    rcsM2: z.number().nullable(),
    satcatUpdatedAt: z.string().nullable(),
    groups: z.array(z.string()).default([]),
    orbit: satelliteOrbitSummarySchemaV1.nullable()
  }),
  relatedLaunch: customerRouteLaunchSummarySchemaV1.nullable()
});

export const satelliteOwnerProfileSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  profile: z.object({
    ownerCode: z.string(),
    ownerLabel: z.string(),
    ownerHref: z.string(),
    ownerSatelliteCount: z.number().int().nonnegative(),
    lastSatcatUpdatedAt: z.string().nullable(),
    typeCounts: z.object({
      PAY: z.number().int().nonnegative(),
      RB: z.number().int().nonnegative(),
      DEB: z.number().int().nonnegative(),
      UNK: z.number().int().nonnegative()
    })
  }),
  relatedLaunches: z.array(customerRouteLaunchSummarySchemaV1),
  satellites: z.array(
    satellitePreviewItemSchemaV1.extend({
      apogeeKm: z.number().nullable(),
      perigeeKm: z.number().nullable(),
      inclinationDeg: z.number().nullable()
    })
  )
});

const contentSectionSchemaV1 = z.object({
  title: z.string(),
  body: z.string(),
  bullets: z.array(z.string()).default([])
});

export const contentPageSchemaV1 = z.object({
  slug: z.string(),
  eyebrow: z.string(),
  title: z.string(),
  description: z.string(),
  lastUpdated: z.string(),
  actions: z.array(customerRouteLinkSchemaV1),
  sections: z.array(contentSectionSchemaV1)
});

const infoHubCardSchemaV1 = z.object({
  title: z.string(),
  description: z.string(),
  href: z.string(),
  badge: z.string().nullable()
});

export const infoHubSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  cards: z.array(infoHubCardSchemaV1)
});

export const catalogEntityTypeSchemaV1 = z.enum([
  'agencies',
  'astronauts',
  'space_stations',
  'expeditions',
  'docking_events',
  'launcher_configurations',
  'launchers',
  'spacecraft_configurations',
  'locations',
  'pads',
  'events'
]);

const catalogEntitySummarySchemaV1 = z.object({
  entity: catalogEntityTypeSchemaV1,
  label: z.string(),
  description: z.string(),
  href: z.string()
});

const catalogCollectionItemSchemaV1 = z.object({
  entityType: catalogEntityTypeSchemaV1,
  entityId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  countryCodes: z.array(z.string()).default([]),
  launchCount: z.number().int().nullable(),
  href: z.string()
});

const catalogDetailFactSchemaV1 = z.object({
  label: z.string(),
  value: z.string()
});

export const catalogHubSchemaV1 = z.object({
  generatedAt: z.string(),
  title: z.string(),
  description: z.string(),
  entities: z.array(catalogEntitySummarySchemaV1)
});

export const catalogCollectionSchemaV1 = z.object({
  generatedAt: z.string(),
  entity: catalogEntityTypeSchemaV1,
  label: z.string(),
  description: z.string(),
  region: z.enum(['all', 'us']),
  query: z.string().nullable(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  items: z.array(catalogCollectionItemSchemaV1)
});

export const catalogDetailSchemaV1 = z.object({
  generatedAt: z.string(),
  entity: catalogEntityTypeSchemaV1,
  label: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  href: z.string(),
  facts: z.array(catalogDetailFactSchemaV1),
  links: z.array(customerRouteLinkSchemaV1),
  relatedLaunches: z.array(customerRouteLaunchSummarySchemaV1)
});

const coreEntityDetailTypeSchemaV1 = z.enum(['provider', 'rocket', 'location', 'pad']);

const coreEntityBadgeSchemaV1 = z.object({
  label: z.string(),
  tone: z.enum(['default', 'accent', 'success', 'warning']).default('default')
});

const coreEntityFactSchemaV1 = z.object({
  label: z.string(),
  value: z.string()
});

const coreEntityStatSchemaV1 = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().nullable().optional()
});

const coreEntityLinkSchemaV1 = z.object({
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
  badge: z.string().nullable(),
  external: z.boolean().default(false)
});

const coreEntityNewsItemSchemaV1 = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  publishedAt: z.string().nullable(),
  href: z.string(),
  external: z.boolean().default(false)
});

const coreEntityDetailBaseSchemaV1 = z.object({
  generatedAt: z.string(),
  entity: coreEntityDetailTypeSchemaV1,
  eyebrow: z.string(),
  title: z.string(),
  description: z.string(),
  canonicalPath: z.string(),
  imageUrl: z.string().nullable(),
  badges: z.array(coreEntityBadgeSchemaV1).default([]),
  facts: z.array(coreEntityFactSchemaV1).default([]),
  stats: z.array(coreEntityStatSchemaV1).default([]),
  links: z.array(coreEntityLinkSchemaV1).default([]),
  relatedLinks: z.array(coreEntityLinkSchemaV1).default([]),
  relatedNews: z.array(coreEntityNewsItemSchemaV1).default([]),
  upcomingLaunches: z.array(customerRouteLaunchSummarySchemaV1).default([]),
  recentLaunches: z.array(customerRouteLaunchSummarySchemaV1).default([])
});

export const providerDetailSchemaV1 = coreEntityDetailBaseSchemaV1.extend({
  entity: z.literal('provider')
});

export const rocketDetailSchemaV1 = coreEntityDetailBaseSchemaV1.extend({
  entity: z.literal('rocket')
});

export const locationDetailSchemaV1 = coreEntityDetailBaseSchemaV1.extend({
  entity: z.literal('location')
});

export const padDetailSchemaV1 = coreEntityDetailBaseSchemaV1.extend({
  entity: z.literal('pad')
});

export const notificationPreferencesSchemaV1 = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  launchDayEmailEnabled: z.boolean(),
  launchDayEmailProviders: z.array(z.string()),
  launchDayEmailStates: z.array(z.string()),
  quietHoursEnabled: z.boolean(),
  quietStartLocal: z.string().nullable(),
  quietEndLocal: z.string().nullable()
});

export const notificationPreferencesUpdateSchemaV1 = z
  .object({
    pushEnabled: z.boolean().optional(),
    emailEnabled: z.boolean().optional(),
    launchDayEmailEnabled: z.boolean().optional(),
    launchDayEmailProviders: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
    launchDayEmailStates: z.array(z.string().trim().min(1).max(40)).max(80).optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietStartLocal: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    quietEndLocal: z
      .string()
      .trim()
      .regex(/^\d{2}:\d{2}$/)
      .optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one notification preference update is required.'
  });

export const privacyPreferencesSchemaV1 = z.object({
  optOutSaleShare: z.boolean(),
  limitSensitive: z.boolean(),
  blockThirdPartyEmbeds: z.boolean(),
  gpcEnabled: z.boolean(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable()
});

export const privacyPreferencesUpdateSchemaV1 = z
  .object({
    optOutSaleShare: z.boolean().optional(),
    limitSensitive: z.boolean().optional(),
    blockThirdPartyEmbeds: z.boolean().optional(),
    gpcEnabled: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one privacy preference update is required.'
  });

export const marketingEmailSchemaV1 = z.object({
  marketingEmailOptIn: z.boolean(),
  updatedAt: z.string().nullable()
});

export const marketingEmailUpdateSchemaV1 = z.object({
  marketingEmailOptIn: z.boolean()
});

export const billingProviderSchemaV1 = z.enum(['none', 'stripe', 'apple_app_store', 'google_play']);
export const billingPlatformSchemaV1 = z.enum(['web', 'ios', 'android']);
export const billingProductKeySchemaV1 = z.enum(['premium_monthly']);
export const billingManagementModeSchemaV1 = z.enum(['none', 'stripe_portal', 'app_store_external', 'google_play_external']);

export const billingSummarySchemaV1 = z.object({
  provider: billingProviderSchemaV1,
  productKey: billingProductKeySchemaV1.nullable(),
  status: z.string(),
  isPaid: z.boolean(),
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodEnd: z.string().nullable(),
  managementMode: billingManagementModeSchemaV1,
  managementUrl: z.string().url().nullable(),
  providerMessage: z.string().nullable(),
  providerProductId: z.string().nullable()
});

export const billingCatalogOfferArtifactKindSchemaV1 = z.enum([
  'stripe_coupon',
  'stripe_promotion_code',
  'apple_offer_code',
  'apple_promotional_offer',
  'apple_win_back_offer',
  'google_offer',
  'google_promo_code'
]);

export const billingCatalogOfferSchemaV1 = z.object({
  offerKey: z.string(),
  provider: z.enum(['stripe', 'apple_app_store', 'google_play']),
  artifactKind: billingCatalogOfferArtifactKindSchemaV1,
  label: z.string(),
  eligibilityHint: z.string().nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  isCodeBased: z.boolean(),
  offerIdentifier: z.string().nullable().optional(),
  redemptionUrl: z.string().url().nullable().optional(),
  basePlanId: z.string().nullable().optional(),
  offerId: z.string().nullable().optional(),
  offerToken: z.string().nullable().optional(),
  promotionCode: z.string().nullable().optional()
});

export const billingCatalogProductSchemaV1 = z.object({
  productKey: billingProductKeySchemaV1,
  platform: billingPlatformSchemaV1,
  provider: z.enum(['stripe', 'apple_app_store', 'google_play']),
  available: z.boolean(),
  displayName: z.string(),
  priceLabel: z.string().nullable(),
  providerProductId: z.string().nullable(),
  stripePriceId: z.string().nullable().optional(),
  googleBasePlanId: z.string().nullable().optional(),
  googleOfferToken: z.string().nullable().optional(),
  offers: z.array(billingCatalogOfferSchemaV1).default([])
});

export const billingCatalogSchemaV1 = z.object({
  platform: billingPlatformSchemaV1,
  generatedAt: z.string(),
  products: z.array(billingCatalogProductSchemaV1)
});

export const appleBillingSyncRequestSchemaV1 = z
  .object({
    transactionId: z.string().trim().min(1),
    productId: z.string().trim().min(1),
    originalTransactionId: z.string().trim().min(1).optional(),
    appAccountToken: z.string().uuid().optional(),
    environment: z.enum(['sandbox', 'production']).optional()
  })
  .strict();

export const googleBillingSyncRequestSchemaV1 = z
  .object({
    purchaseToken: z.string().trim().min(1),
    productId: z.string().trim().min(1),
    packageName: z.string().trim().min(1).optional(),
    basePlanId: z.string().trim().min(1).optional(),
    offerToken: z.string().trim().min(1).optional(),
    obfuscatedAccountId: z.string().trim().min(1).optional()
  })
  .strict();

export const billingSyncResponseSchemaV1 = z.object({
  summary: billingSummarySchemaV1,
  entitlements: entitlementSchemaV1
});

export const premiumClaimStatusSchemaV1 = z.enum(['pending', 'verified', 'claimed']);

export const premiumClaimSchemaV1 = z.object({
  claimToken: z.string().uuid(),
  provider: z.enum(['stripe', 'apple_app_store', 'google_play']),
  productKey: billingProductKeySchemaV1,
  status: premiumClaimStatusSchemaV1,
  email: z.string().email().nullable(),
  returnTo: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const premiumClaimEnvelopeSchemaV1 = z.object({
  claim: premiumClaimSchemaV1
});

export const premiumClaimPasswordSignUpSchemaV1 = z
  .object({
    claimToken: z.string().uuid(),
    email: z.string().trim().email(),
    password: z.string().min(1).max(4096)
  })
  .strict();

export const premiumClaimPasswordSignUpResponseSchemaV1 = z
  .object({
    session: z.lazy(() => mobileAuthSessionSchemaV1),
    claim: premiumClaimSchemaV1,
    returnTo: z.string()
  })
  .strict();

export const premiumClaimAttachResponseSchemaV1 = z
  .object({
    ok: z.literal(true),
    claim: premiumClaimSchemaV1,
    returnTo: z.string(),
    entitlements: entitlementSchemaV1
  })
  .strict();

export const launchFilterValueSchemaV1 = z
  .object({
    range: z.enum(['today', '7d', 'month', 'year', 'past', 'all']).optional(),
    sort: z.enum(['soonest', 'latest', 'changed']).optional(),
    region: z.enum(['us', 'non-us', 'all']).optional(),
    location: z.string().trim().min(1).max(180).optional(),
    state: z.string().trim().min(1).max(60).optional(),
    pad: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['go', 'hold', 'scrubbed', 'tbd', 'unknown', 'all']).optional()
  })
  .strict();

export const launchFilterOptionsSchemaV1 = z.object({
  providers: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  states: z.array(z.string()).default([]),
  pads: z.array(z.string()).default([]),
  statuses: z.array(z.string()).default([])
});

export const watchlistRuleTypeSchemaV1 = z.enum(['launch', 'pad', 'provider', 'rocket', 'launch_site', 'state', 'tier']);

export const pushDeviceRegistrationSchemaV1 = z.object({
  platform: z.enum(['web', 'ios', 'android']),
  installationId: z.string().min(1).max(160),
  token: z.string(),
  appVersion: z.string().nullable(),
  deviceName: z.string().nullable(),
  pushProvider: z.enum(['expo', 'webpush']).nullable().optional(),
  active: z.boolean().optional(),
  registeredAt: z.string().nullable().optional(),
  lastSentAt: z.string().nullable().optional(),
  lastReceiptAt: z.string().nullable().optional(),
  lastFailureReason: z.string().nullable().optional(),
  disabledAt: z.string().nullable().optional()
});

export const pushDeviceRemovalSchemaV1 = z.object({
  platform: z.enum(['web', 'ios', 'android']),
  installationId: z.string().min(1).max(160),
  removed: z.boolean(),
  removedAt: z.string().nullable()
});

export const pushDeliveryTestSchemaV1 = z.object({
  ok: z.boolean(),
  queuedAt: z.string()
});

const localHourMinuteSchemaV1 = z
  .string()
  .trim()
  .regex(/^\d{2}:\d{2}$/);

export const mobilePushOwnerKindSchemaV1 = z.enum(['guest', 'user']);
export const mobilePushScopeKindSchemaV1 = z.enum(['all_us', 'state', 'launch', 'all_launches', 'preset', 'follow']);
export const mobilePushStatusChangeTypeSchemaV1 = z.enum(['any', 'go', 'hold', 'scrubbed', 'tbd']);
export const notificationOwnerKindSchemaV2 = z.enum(['guest', 'user']);
export const notificationChannelSchemaV2 = z.enum(['push', 'email']);
export const notificationDeliveryKindSchemaV2 = z.enum(['web_push', 'mobile_push', 'email']);
export const notificationRuleIntentSchemaV2 = z.enum(['follow', 'notifications_only']);
export const notificationScopeKindSchemaV2 = z.enum([
  'launch',
  'state',
  'provider',
  'rocket',
  'pad',
  'launch_site',
  'preset',
  'filter',
  'all_us',
  'all_launches',
  'tier'
]);

export const mobilePushGuestContextSchemaV1 = z
  .object({
    installationId: z.string().trim().min(1).max(160),
    deviceSecret: z.string().trim().min(1).max(200).nullable().optional()
  })
  .strict();

export const mobilePushAccessSchemaV1 = z.object({
  ownerKind: mobilePushOwnerKindSchemaV1,
  basicAllowed: z.boolean(),
  advancedAllowed: z.boolean(),
  maxPrelaunchOffsets: z.number().int().positive(),
  canUseDailyDigest: z.boolean(),
  canUseStatusChangeTypes: z.boolean(),
  canUseNetChangeAlerts: z.boolean()
});

export const mobilePushDeviceSchemaV1 = z.object({
  ownerKind: mobilePushOwnerKindSchemaV1,
  platform: z.enum(['ios', 'android']).nullable().optional(),
  installationId: z.string().min(1).max(160),
  registered: z.boolean(),
  active: z.boolean(),
  registeredAt: z.string().nullable(),
  lastSentAt: z.string().nullable().optional(),
  lastReceiptAt: z.string().nullable().optional(),
  lastFailureReason: z.string().nullable().optional(),
  disabledAt: z.string().nullable().optional(),
  deviceSecret: z.string().nullable().optional()
});

export const mobilePushDeviceRegisterSchemaV1 = mobilePushGuestContextSchemaV1
  .extend({
    platform: z.enum(['ios', 'android']),
    token: z.string().trim().min(1).max(4096),
    appVersion: z.string().trim().min(1).max(80).nullable().optional(),
    deviceName: z.string().trim().min(1).max(160).nullable().optional(),
    pushProvider: z.enum(['expo']).default('expo')
  })
  .strict();

export const mobilePushDeviceRemoveSchemaV1 = mobilePushGuestContextSchemaV1
  .extend({
    platform: z.enum(['ios', 'android'])
  })
  .strict();

export const mobilePushRuleSettingsSchemaV1 = z.object({
  timezone: z.string().trim().min(1).max(64),
  prelaunchOffsetsMinutes: z.array(z.number().int()).max(3),
  dailyDigestLocalTime: localHourMinuteSchemaV1.nullable(),
  statusChangeTypes: z.array(mobilePushStatusChangeTypeSchemaV1).max(5),
  notifyNetChanges: z.boolean()
});

export const mobilePushRuleSettingsInputSchemaV1 = z
  .object({
    timezone: z.string().trim().min(1).max(64).optional(),
    prelaunchOffsetsMinutes: z.array(z.number().int()).max(3).optional(),
    dailyDigestLocalTime: localHourMinuteSchemaV1.nullable().optional(),
    statusChangeTypes: z.array(mobilePushStatusChangeTypeSchemaV1).max(5).optional(),
    notifyNetChanges: z.boolean().optional()
  })
  .strict();

const mobilePushRuleBaseSchemaV1 = z.object({
  id: z.string().uuid(),
  scopeKind: mobilePushScopeKindSchemaV1,
  label: z.string(),
  settings: mobilePushRuleSettingsSchemaV1,
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const mobilePushRuleSchemaV1 = z.discriminatedUnion('scopeKind', [
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('all_us')
  }),
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('state'),
    state: z.string().trim().min(1).max(60)
  }),
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('launch'),
    launchId: z.string().uuid()
  }),
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('all_launches')
  }),
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('preset'),
    presetId: z.string().uuid()
  }),
  mobilePushRuleBaseSchemaV1.extend({
    scopeKind: z.literal('follow'),
    followRuleType: watchlistRuleTypeSchemaV1,
    followRuleValue: z.string().trim().min(1).max(200)
  })
]);

const mobilePushRuleUpsertBaseSchemaV1 = mobilePushGuestContextSchemaV1.extend(mobilePushRuleSettingsInputSchemaV1.shape);

export const mobilePushRuleUpsertSchemaV1 = z.discriminatedUnion('scopeKind', [
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('all_us')
  }),
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('state'),
    state: z.string().trim().min(1).max(60)
  }),
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('launch')
  }),
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('all_launches')
  }),
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('preset'),
    presetId: z.string().uuid()
  }),
  mobilePushRuleUpsertBaseSchemaV1.extend({
    scopeKind: z.literal('follow'),
    followRuleType: watchlistRuleTypeSchemaV1,
    followRuleValue: z.string().trim().min(1).max(200)
  })
]);

export const mobilePushRulesEnvelopeSchemaV1 = z.object({
  access: mobilePushAccessSchemaV1,
  device: mobilePushDeviceSchemaV1,
  rules: z.array(mobilePushRuleSchemaV1)
});

export const mobilePushRuleEnvelopeSchemaV1 = z.object({
  access: mobilePushAccessSchemaV1,
  device: mobilePushDeviceSchemaV1,
  rule: mobilePushRuleSchemaV1,
  source: z.enum(['existing', 'created', 'updated']).optional()
});

export const mobilePushLaunchPreferenceEnvelopeSchemaV1 = z.object({
  access: mobilePushAccessSchemaV1,
  device: mobilePushDeviceSchemaV1,
  rule: mobilePushRuleSchemaV1.nullable()
});

export const mobilePushTestRequestSchemaV1 = mobilePushGuestContextSchemaV1;

export const mobilePushTestSchemaV1 = z.object({
  ok: z.boolean(),
  queuedAt: z.string()
});

export const notificationRuleSettingsSchemaV2 = z.object({
  timezone: z.string().trim().min(1).max(64),
  prelaunchOffsetsMinutes: z.array(z.number().int()).max(5),
  includeLiftoff: z.boolean(),
  dailyDigestLocalTime: localHourMinuteSchemaV1.nullable(),
  statusChangeTypes: z.array(mobilePushStatusChangeTypeSchemaV1).max(5),
  notifyNetChanges: z.boolean()
});

export const notificationRuleSettingsInputSchemaV2 = z
  .object({
    timezone: z.string().trim().min(1).max(64).optional(),
    prelaunchOffsetsMinutes: z.array(z.number().int()).max(5).optional(),
    includeLiftoff: z.boolean().optional(),
    dailyDigestLocalTime: localHourMinuteSchemaV1.nullable().optional(),
    statusChangeTypes: z.array(mobilePushStatusChangeTypeSchemaV1).max(5).optional(),
    notifyNetChanges: z.boolean().optional()
  })
  .strict();

export const notificationDestinationSchemaV2 = z.object({
  id: z.string().uuid(),
  ownerKind: notificationOwnerKindSchemaV2,
  channel: notificationChannelSchemaV2,
  deliveryKind: notificationDeliveryKindSchemaV2,
  platform: z.enum(['web', 'ios', 'android']).nullable().optional(),
  installationId: z.string().trim().min(1).max(160).nullable().optional(),
  label: z.string().nullable().optional(),
  registered: z.boolean(),
  active: z.boolean(),
  verified: z.boolean().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  lastSentAt: z.string().nullable().optional(),
  lastReceiptAt: z.string().nullable().optional(),
  lastFailureReason: z.string().nullable().optional(),
  disabledAt: z.string().nullable().optional()
});

export const notificationCapabilitiesSchemaV2 = z.object({
  ownerKind: notificationOwnerKindSchemaV2,
  basicAllowed: z.boolean(),
  advancedAllowed: z.boolean(),
  allowedScopeKinds: z.array(notificationScopeKindSchemaV2),
  allowedChannels: z.array(notificationChannelSchemaV2),
  anonLaunchLimit: z.number().int().nonnegative(),
  anonStateLimit: z.number().int().nonnegative()
});

export const notificationPreferencesSchemaV2 = z.object({
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietStartLocal: z.string().nullable(),
  quietEndLocal: z.string().nullable(),
  launchDayEmailEnabled: z.boolean().optional(),
  launchDayEmailProviders: z.array(z.string()).default([]).optional(),
  launchDayEmailStates: z.array(z.string()).default([]).optional()
});

export const notificationRuleSchemaV2 = z.object({
  id: z.string().uuid(),
  ownerKind: notificationOwnerKindSchemaV2,
  intent: notificationRuleIntentSchemaV2,
  visibleInFollowing: z.boolean(),
  enabled: z.boolean(),
  label: z.string(),
  scopeKind: notificationScopeKindSchemaV2,
  scopeKey: z.string().trim().min(1).max(200),
  channels: z.array(notificationChannelSchemaV2),
  settings: notificationRuleSettingsSchemaV2,
  launchId: z.string().uuid().nullable().optional(),
  state: z.string().trim().min(1).max(60).nullable().optional(),
  provider: z.string().trim().min(1).max(200).nullable().optional(),
  rocketId: z.number().int().nullable().optional(),
  padKey: z.string().trim().min(1).max(200).nullable().optional(),
  launchSite: z.string().trim().min(1).max(200).nullable().optional(),
  presetId: z.string().uuid().nullable().optional(),
  filters: z.record(z.unknown()).nullable().optional(),
  tier: z.string().trim().min(1).max(80).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const notificationRuleUpsertSchemaV2 = z
  .object({
    intent: notificationRuleIntentSchemaV2,
    visibleInFollowing: z.boolean().optional(),
    enabled: z.boolean().optional(),
    scopeKind: notificationScopeKindSchemaV2,
    launchId: z.string().uuid().optional(),
    state: z.string().trim().min(1).max(60).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    rocketId: z.number().int().optional(),
    padKey: z.string().trim().min(1).max(200).optional(),
    launchSite: z.string().trim().min(1).max(200).optional(),
    presetId: z.string().uuid().optional(),
    filters: z.record(z.unknown()).optional(),
    tier: z.string().trim().min(1).max(80).optional(),
    channels: z.array(notificationChannelSchemaV2).optional()
  })
  .merge(notificationRuleSettingsInputSchemaV2)
  .strict();

export const notificationStateSchemaV2 = z.object({
  capabilities: notificationCapabilitiesSchemaV2,
  preferences: notificationPreferencesSchemaV2,
  destinations: z.array(notificationDestinationSchemaV2),
  rules: z.array(notificationRuleSchemaV2)
});

export const notificationRuleEnvelopeSchemaV2 = z.object({
  rule: notificationRuleSchemaV2,
  source: z.enum(['existing', 'created', 'updated']).optional()
});

export const notificationDestinationEnvelopeSchemaV2 = z.object({
  destination: notificationDestinationSchemaV2
});

export const authProviderSchemaV1 = z.enum(['email_password', 'apple', 'google', 'email_link', 'unknown']);

export const authPlatformSchemaV1 = z.enum(['web', 'ios', 'android']);

export const mobileAuthPlatformSchemaV1 = z.enum(['ios', 'android']);

export const mobileAuthFlowSchemaV1 = z.enum(['sign_in', 'sign_up', 'resend', 'recover']);

export const mobileAuthAttestationProviderSchemaV1 = z.enum([
  'ios_app_attest',
  'ios_device_check',
  'android_play_integrity',
  'dev_bypass',
  'none'
]);

export const mobileAuthAttestationSchemaV1 = z
  .object({
    provider: mobileAuthAttestationProviderSchemaV1,
    token: z.string().trim().min(1).max(8192).nullable().optional(),
    nonce: z.string().trim().min(1).max(255),
    keyId: z.string().trim().min(1).max(255).nullable().optional()
  })
  .strict();

export const mobileAuthRiskDispositionSchemaV1 = z.enum(['silent_turnstile', 'visible_turnstile', 'deny']);

export const mobileAuthSessionSchemaV1 = z
  .object({
    accessToken: z.string().trim().min(1),
    refreshToken: z.string().trim().min(1).nullable(),
    expiresIn: z.number().int().positive().nullable(),
    expiresAt: z.string().datetime().nullable(),
    userId: z.string().uuid().nullable(),
    email: z.string().email().nullable()
  })
  .strict();

export const mobileAuthUserSchemaV1 = z
  .object({
    userId: z.string().uuid().nullable(),
    email: z.string().email().nullable()
  })
  .strict();

export const mobileAuthRiskStartSchemaV1 = z
  .object({
    flow: mobileAuthFlowSchemaV1,
    email: z.string().trim().email(),
    installationId: z.string().trim().min(1).max(160),
    platform: mobileAuthPlatformSchemaV1,
    appVersion: z.string().trim().min(1).max(40).nullable().optional(),
    buildProfile: z.string().trim().min(1).max(40).nullable().optional(),
    attestation: mobileAuthAttestationSchemaV1
  })
  .strict();

export const mobileAuthRiskDecisionSchemaV1 = z
  .object({
    riskSessionId: z.string().uuid(),
    disposition: mobileAuthRiskDispositionSchemaV1,
    challengeUrl: z.string().url().nullable().optional(),
    retryAfterSeconds: z.number().int().positive().nullable().optional(),
    reasonCode: z.string().trim().min(1).max(80).nullable().optional()
  })
  .strict();

export const mobileAuthChallengeCompleteSchemaV1 = z
  .object({
    riskSessionId: z.string().uuid(),
    captchaToken: z.string().trim().min(1).max(8192)
  })
  .strict();

export const mobileAuthChallengeResultSchemaV1 = z
  .object({
    riskSessionId: z.string().uuid(),
    challengeCode: z.string().trim().min(1).max(8192)
  })
  .strict();

export const clientBootstrapRequestSchemaV1 = z
  .object({
    installationId: z.string().trim().min(1).max(160),
    platform: z.enum(['ios', 'android']),
    appVersion: z.string().trim().min(1).max(40).nullable().optional(),
    buildProfile: z.string().trim().min(1).max(40).nullable().optional()
  })
  .strict();

export const clientBootstrapResponseSchemaV1 = z
  .object({
    guestToken: z.string().trim().min(1).max(8192),
    expiresAt: z.string().datetime(),
    tokenType: z.literal('app_guest')
  })
  .strict();

export const mobileAuthPasswordSignInSchemaV1 = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(1).max(4096),
    riskSessionId: z.string().uuid(),
    challengeCode: z.string().trim().min(1).max(8192)
  })
  .strict();

export const mobileAuthPasswordSignInResponseSchemaV1 = z
  .object({
    session: mobileAuthSessionSchemaV1
  })
  .strict();

export const mobileAuthPasswordSignUpSchemaV1 = z
  .object({
    email: z.string().trim().email(),
    password: z.string().min(1).max(4096),
    emailRedirectTo: z.string().url(),
    riskSessionId: z.string().uuid(),
    challengeCode: z.string().trim().min(1).max(8192)
  })
  .strict();

export const mobileAuthPasswordSignUpResponseSchemaV1 = z
  .object({
    session: mobileAuthSessionSchemaV1.nullable(),
    user: mobileAuthUserSchemaV1,
    requiresVerification: z.boolean()
  })
  .strict();

export const mobileAuthPasswordResendSchemaV1 = z
  .object({
    email: z.string().trim().email(),
    emailRedirectTo: z.string().url(),
    riskSessionId: z.string().uuid(),
    challengeCode: z.string().trim().min(1).max(8192)
  })
  .strict();

export const mobileAuthPasswordRecoverSchemaV1 = z
  .object({
    email: z.string().trim().email(),
    redirectTo: z.string().url(),
    riskSessionId: z.string().uuid(),
    challengeCode: z.string().trim().min(1).max(8192)
  })
  .strict();

export const authContextEventTypeSchemaV1 = z.enum([
  'sign_in',
  'sign_up',
  'oauth_callback',
  'password_reset',
  'session_restore',
  'sign_out'
]);

export const appleAuthCaptureSourceSchemaV1 = z.enum([
  'ios_native_code',
  'web_provider_refresh',
  'web_provider_access'
]);

export const appleAuthCaptureSchemaV1 = z
  .object({
    source: appleAuthCaptureSourceSchemaV1,
    authorizationCode: z.string().trim().min(1).max(4096).optional(),
    providerToken: z.string().trim().min(1).max(8192).optional(),
    appleUserId: z.string().trim().min(1).max(255).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    emailIsPrivateRelay: z.boolean().optional(),
    firstName: z.string().trim().min(1).max(80).nullable().optional(),
    lastName: z.string().trim().min(1).max(80).nullable().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === 'ios_native_code' && !value.authorizationCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'authorizationCode is required for native Apple auth capture.',
        path: ['authorizationCode']
      });
    }

    if ((value.source === 'web_provider_refresh' || value.source === 'web_provider_access') && !value.providerToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'providerToken is required for web Apple auth capture.',
        path: ['providerToken']
      });
    }
  });

export const appleAuthCaptureResponseSchemaV1 = z
  .object({
    ok: z.literal(true),
    tokenKind: z.enum(['refresh_token', 'access_token']),
    storedAt: z.string()
  })
  .strict();

export const authMethodProviderSchemaV1 = z.enum(['email_password', 'apple']);

export const authMethodSchemaV1 = z
  .object({
    provider: authMethodProviderSchemaV1,
    linked: z.boolean(),
    linkedAt: z.string().nullable(),
    email: z.string().trim().email().nullable().optional(),
    emailIsPrivateRelay: z.boolean().optional(),
    canLink: z.boolean(),
    canUnlink: z.boolean(),
    unlinkBlockedReason: z.enum(['backup_method_required']).nullable().optional()
  })
  .strict();

export const authMethodsSchemaV1 = z
  .object({
    viewerId: z.string().uuid(),
    email: z.string().trim().email().nullable(),
    methods: z.array(authMethodSchemaV1).length(2)
  })
  .strict();

export const authContextUpsertSchemaV1 = z
  .object({
    provider: authProviderSchemaV1,
    platform: authPlatformSchemaV1,
    eventType: authContextEventTypeSchemaV1,
    displayName: z.string().trim().min(1).max(120).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    emailIsPrivateRelay: z.boolean().optional(),
    appVersion: z.string().trim().min(1).max(40).nullable().optional(),
    buildProfile: z.string().trim().min(1).max(40).nullable().optional(),
    riskSessionId: z.string().uuid().nullable().optional()
  })
  .strict();

export const profileSchemaV1 = z.object({
  viewerId: z.string().uuid(),
  email: z.string().email(),
  role: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  timezone: z.string().nullable(),
  emailConfirmedAt: z.string().nullable(),
  createdAt: z.string().nullable()
});

export const profileUpdateSchemaV1 = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(100).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile update is required.'
  });

export const accountExportSchemaV1 = z
  .object({
    generated_at: z.string(),
    auth: z
      .object({
        user_id: z.string(),
        email: z.string().nullable(),
        created_at: z.string().nullable(),
        user_metadata: z.record(z.unknown()).default({})
      })
      .passthrough(),
    profile: z.record(z.unknown()).nullable(),
    notification_preferences: z.record(z.unknown()).nullable(),
    privacy_preferences: z.record(z.unknown()).nullable(),
    launch_notification_preferences: z.array(z.record(z.unknown())).default([]),
    notification_alert_rules: z.array(z.record(z.unknown())).default([]),
    push_subscriptions: z.array(z.record(z.unknown())).default([]),
    subscription: z.record(z.unknown()).nullable(),
    stripe_customer: z.record(z.unknown()).nullable().optional(),
    warnings: z.array(z.string()).default([])
  })
  .passthrough();

export const calendarTokenSchemaV1 = z.object({
  token: z.string().uuid().nullable(),
  source: z.enum(['stub', 'db', 'generated'])
});

export const watchlistRuleSchemaV1 = z.object({
  id: z.string().uuid(),
  ruleType: watchlistRuleTypeSchemaV1,
  ruleValue: z.string(),
  createdAt: z.string().nullable().optional()
});

export const watchlistSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  ruleCount: z.number().int().nonnegative(),
  createdAt: z.string().nullable().optional(),
  rules: z.array(watchlistRuleSchemaV1).default([])
});

export const watchlistsSchemaV1 = z.object({
  watchlists: z.array(watchlistSchemaV1)
});

export const watchlistCreateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80).optional()
  })
  .strict();

export const watchlistUpdateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80)
  })
  .strict();

export const watchlistEnvelopeSchemaV1 = z.object({
  watchlist: watchlistSchemaV1
});

export const watchlistRuleCreateSchemaV1 = z
  .object({
    ruleType: watchlistRuleTypeSchemaV1,
    ruleValue: z.string().trim().min(1).max(200)
  })
  .strict();

export const watchlistRuleEnvelopeSchemaV1 = z.object({
  rule: watchlistRuleSchemaV1,
  source: z.enum(['existing', 'created'])
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

export const filterPresetCreateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: launchFilterValueSchemaV1,
    isDefault: z.boolean().optional()
  })
  .strict();

export const filterPresetUpdateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: launchFilterValueSchemaV1.optional(),
    isDefault: z.boolean().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one filter preset update is required.'
  });

export const filterPresetEnvelopeSchemaV1 = z.object({
  preset: filterPresetSchemaV1
});

export const calendarFeedSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  token: z.string(),
  filters: z.record(z.unknown()),
  sourceKind: z.enum(['all_launches', 'preset', 'follow']).nullable().optional(),
  presetId: z.string().uuid().nullable().optional(),
  followRuleType: watchlistRuleTypeSchemaV1.nullable().optional(),
  followRuleValue: z.string().trim().min(1).max(200).nullable().optional(),
  alarmMinutesBefore: z.number().int().min(0).max(10080).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const calendarFeedsSchemaV1 = z.object({
  feeds: z.array(calendarFeedSchemaV1)
});

export const calendarFeedCreateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: launchFilterValueSchemaV1.optional(),
    sourceKind: z.enum(['all_launches', 'preset', 'follow']).optional(),
    presetId: z.string().uuid().optional(),
    followRuleType: watchlistRuleTypeSchemaV1.optional(),
    followRuleValue: z.string().trim().min(1).max(200).optional(),
    alarmMinutesBefore: z.number().int().min(0).max(10080).nullable().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceKind === 'preset' && !value.presetId) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'presetId is required for preset calendar feeds.' });
    }
    if (value.sourceKind === 'follow') {
      if (!value.followRuleType) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'followRuleType is required for follow calendar feeds.' });
      }
      if (!value.followRuleValue) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'followRuleValue is required for follow calendar feeds.' });
      }
    }
  });

export const calendarFeedUpdateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: launchFilterValueSchemaV1.optional(),
    sourceKind: z.enum(['all_launches', 'preset', 'follow']).optional(),
    presetId: z.string().uuid().nullable().optional(),
    followRuleType: watchlistRuleTypeSchemaV1.nullable().optional(),
    followRuleValue: z.string().trim().min(1).max(200).nullable().optional(),
    alarmMinutesBefore: z.number().int().min(0).max(10080).nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one calendar feed update is required.'
  });

export const calendarFeedEnvelopeSchemaV1 = z.object({
  feed: calendarFeedSchemaV1
});

export const rssFeedSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  token: z.string(),
  filters: z.record(z.unknown()),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const rssFeedsSchemaV1 = z.object({
  feeds: z.array(rssFeedSchemaV1)
});

export const rssFeedCreateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: launchFilterValueSchemaV1.optional()
  })
  .strict();

export const rssFeedUpdateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: launchFilterValueSchemaV1.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one RSS feed update is required.'
  });

export const rssFeedEnvelopeSchemaV1 = z.object({
  feed: rssFeedSchemaV1
});

export const embedWidgetSchemaV1 = z.object({
  id: z.string().uuid(),
  name: z.string(),
  token: z.string(),
  widgetType: z.string(),
  filters: z.record(z.unknown()),
  presetId: z.string().uuid().nullable().optional(),
  watchlistId: z.string().uuid().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional()
});

export const embedWidgetsSchemaV1 = z.object({
  widgets: z.array(embedWidgetSchemaV1)
});

export const embedWidgetCreateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80),
    filters: launchFilterValueSchemaV1.optional(),
    presetId: z.string().uuid().optional(),
    watchlistId: z.string().uuid().optional()
  })
  .strict();

export const embedWidgetUpdateSchemaV1 = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    filters: launchFilterValueSchemaV1.optional(),
    presetId: z.string().uuid().nullable().optional(),
    watchlistId: z.string().uuid().nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one embed widget update is required.'
  });

export const embedWidgetEnvelopeSchemaV1 = z.object({
  widget: embedWidgetSchemaV1
});

export const launchNotificationPreferenceSchemaV1 = z.object({
  launchId: z.string().uuid(),
  channel: z.literal('push'),
  mode: z.enum(['t_minus', 'local_time']),
  timezone: z.string(),
  tMinusMinutes: z.array(z.number().int()),
  localTimes: z.array(z.string()),
  notifyStatusChange: z.boolean(),
  notifyNetChange: z.boolean()
});

export const launchNotificationPreferenceUpdateSchemaV1 = z.object({
  mode: z.enum(['t_minus', 'local_time']),
  timezone: z.string().trim().min(1).max(64).optional(),
  tMinusMinutes: z.array(z.number().int()).max(2).optional(),
  localTimes: z.array(z.string().trim().regex(/^(\d{2}):(\d{2})(?::\d{2})?$/)).max(2).optional(),
  notifyStatusChange: z.boolean().optional(),
  notifyNetChange: z.boolean().optional()
});

export const pushChannelStatusSchemaV1 = z.object({
  enabled: z.boolean(),
  subscribed: z.boolean()
});

export const launchNotificationPreferenceEnvelopeSchemaV1 = z.object({
  preference: launchNotificationPreferenceSchemaV1,
  enabled: z.boolean(),
  pushStatus: pushChannelStatusSchemaV1.optional()
});

export const alertRuleKindSchemaV1 = z.enum(['region_us', 'state', 'filter_preset', 'follow']);

export const alertRuleCreateSchemaV1 = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('region_us')
  }),
  z.object({
    kind: z.literal('state'),
    state: z.string().trim().min(1).max(60)
  }),
  z.object({
    kind: z.literal('filter_preset'),
    presetId: z.string().uuid()
  }),
  z.object({
    kind: z.literal('follow'),
    followRuleType: watchlistRuleTypeSchemaV1,
    followRuleValue: z.string().trim().min(1).max(200)
  })
]);

export const alertRuleSchemaV1 = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().uuid(),
    kind: z.literal('region_us'),
    label: z.string(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional()
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('state'),
    state: z.string().trim().min(1).max(60),
    label: z.string(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional()
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('filter_preset'),
    presetId: z.string().uuid(),
    label: z.string(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional()
  }),
  z.object({
    id: z.string().uuid(),
    kind: z.literal('follow'),
    followRuleType: watchlistRuleTypeSchemaV1,
    followRuleValue: z.string().trim().min(1).max(200),
    label: z.string(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional()
  })
]);

export const alertRulesSchemaV1 = z.object({
  rules: z.array(alertRuleSchemaV1)
});

export const alertRuleEnvelopeSchemaV1 = z.object({
  rule: alertRuleSchemaV1,
  source: z.enum(['existing', 'created']).optional()
});

export const successResponseSchemaV1 = z.object({
  ok: z.literal(true)
});

const launchStageSummarySchemaV1 = z.object({
  id: z.string(),
  kind: z.enum(['launcher_stage', 'spacecraft_stage']),
  title: z.string(),
  serialNumber: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  launcherConfigId: z.number().int().nullable().optional(),
  totalMissions: z.number().int().nullable().optional(),
  trackedMissions: z.number().int().nullable().optional(),
  missionsThisYear: z.number().int().nullable().optional(),
  lastMissionNet: z.string().nullable().optional(),
  firstLaunchDate: z.string().nullable().optional(),
  lastLaunchDate: z.string().nullable().optional(),
  source: z.enum(['ll2', 'spacex_content'])
});

const launchRecoveryDetailSchemaV1 = z.object({
  id: z.string(),
  role: z.enum(['booster', 'spacecraft', 'unknown']),
  source: z.enum(['ll2', 'spacex_content']),
  sourceId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  attempt: z.boolean().nullable().optional(),
  success: z.boolean().nullable().optional(),
  description: z.string().nullable().optional(),
  downrangeDistanceKm: z.number().nullable().optional(),
  landingLocationName: z.string().nullable().optional(),
  landingLocationAbbrev: z.string().nullable().optional(),
  landingLocationContext: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  landingTypeName: z.string().nullable().optional(),
  landingTypeAbbrev: z.string().nullable().optional(),
  returnSite: z.string().nullable().optional(),
  returnDateTime: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional()
});

const launchExternalResourceSchemaV1 = z.object({
  id: z.string(),
  kind: z.enum(['page', 'infographic', 'image', 'video', 'webcast', 'document', 'timeline', 'resource']),
  label: z.string(),
  url: z.string(),
  previewUrl: z.string().nullable().optional(),
  mime: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  source: z.literal('spacex_content'),
  sourceId: z.string().nullable().optional()
});

const launchTimelineResourceEventSchemaV1 = z.object({
  id: z.string(),
  label: z.string(),
  time: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  phase: z.enum(['prelaunch', 'postlaunch', 'timeline']).nullable().optional()
});

const launchExternalContentSchemaV1 = z.object({
  id: z.string(),
  source: z.string(),
  contentType: z.string(),
  sourceId: z.string(),
  title: z.string().nullable().optional(),
  launchPageUrl: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  fetchedAt: z.string().nullable().optional(),
  returnSite: z.string().nullable().optional(),
  returnDateTime: z.string().nullable().optional(),
  resources: z.array(launchExternalResourceSchemaV1),
  timelineEvents: z.array(launchTimelineResourceEventSchemaV1).optional()
});

const launchFaaAirspaceAdvisorySchemaV1 = z.object({
  matchId: z.string(),
  launchId: z.string(),
  tfrRecordId: z.string(),
  tfrShapeId: z.string().nullable(),
  matchStatus: z.enum(['matched', 'ambiguous', 'unmatched', 'manual']),
  matchConfidence: z.number().nullable(),
  matchScore: z.number().nullable(),
  matchStrategy: z.string().nullable(),
  matchedAt: z.string().nullable(),
  notamId: z.string().nullable(),
  title: z.string(),
  type: z.string().nullable(),
  facility: z.string().nullable(),
  state: z.string().nullable(),
  status: z.enum(['active', 'expired', 'manual']),
  validStart: z.string().nullable(),
  validEnd: z.string().nullable(),
  isActiveNow: z.boolean(),
  hasShape: z.boolean(),
  shapeCount: z.number().int().nonnegative(),
  rawText: z.string().nullable(),
  rawTextFetchedAt: z.string().nullable(),
  sourceGraphicUrl: z.string().nullable(),
  sourceRawUrl: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  matchMeta: z.record(z.unknown()).nullable()
});

const launchFaaAirspaceMapPointSchemaV1 = z.object({
  latitude: z.number(),
  longitude: z.number()
});

const launchFaaAirspaceMapBoundsSchemaV1 = z.object({
  minLatitude: z.number(),
  minLongitude: z.number(),
  maxLatitude: z.number(),
  maxLongitude: z.number()
});

const launchFaaAirspaceMapPolygonSchemaV1 = z.object({
  polygonId: z.string(),
  outerRing: z.array(launchFaaAirspaceMapPointSchemaV1),
  holes: z.array(z.array(launchFaaAirspaceMapPointSchemaV1)).default([]),
  bounds: launchFaaAirspaceMapBoundsSchemaV1.nullable().default(null)
});

const launchFaaAirspaceMapPadSchemaV1 = z.object({
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  label: z.string().nullable(),
  shortCode: z.string().nullable(),
  locationName: z.string().nullable()
});

export const launchFaaAirspaceMapSchemaV1 = z.object({
  launchId: z.string(),
  generatedAt: z.string(),
  advisoryCount: z.number().int().nonnegative(),
  hasRenderableGeometry: z.boolean(),
  pad: launchFaaAirspaceMapPadSchemaV1,
  bounds: launchFaaAirspaceMapBoundsSchemaV1.nullable(),
  advisories: z.array(
    launchFaaAirspaceAdvisorySchemaV1.extend({
      polygons: z.array(launchFaaAirspaceMapPolygonSchemaV1).default([])
    })
  )
});

export const launchDetailEnrichmentSchemaV1 = z.object({
  firstStageCount: z.number().int().nonnegative(),
  recoveryCount: z.number().int().nonnegative(),
  externalContentCount: z.number().int().nonnegative(),
  hasJepScore: z.boolean(),
  faaAdvisoryCount: z.number().int().nonnegative(),
  firstStages: z.array(launchStageSummarySchemaV1).default([]),
  recovery: z.array(launchRecoveryDetailSchemaV1).default([]),
  externalContent: z.array(launchExternalContentSchemaV1).default([]),
  faaAdvisories: z.array(launchFaaAirspaceAdvisorySchemaV1).default([])
});

const trajectoryPublishPolicyReasonSchemaV1 = z.enum([
  'source_contract_missing',
  'source_contract_unknown',
  'source_contract_failed',
  'sources_stale',
  'lineage_incomplete',
  'missing_required_fields',
  'blocking_reasons_present'
]);

const trajectoryPublishPolicySchemaV1 = z.object({
  precisionClaim: z.boolean(),
  allowPrecision: z.boolean(),
  enforcePadOnly: z.boolean(),
  contractStatus: z.enum(['pass', 'fail', 'unknown']),
  missingFields: z.array(z.string()),
  blockingReasons: z.array(z.string()),
  reasons: z.array(trajectoryPublishPolicyReasonSchemaV1)
});

const trajectoryConfidenceBadgeSchemaV1 = z.enum(['high', 'medium', 'low', 'unknown']);
const trajectoryPublicQualityStateSchemaV1 = z.enum(['precision', 'safe_corridor', 'pad_only']);
const arTrajectoryAvailabilityReasonSchemaV1 = z.enum(['available', 'not_eligible', 'trajectory_missing']);

export const arTrajectorySummarySchemaV1 = z.object({
  eligible: z.boolean(),
  hasTrajectory: z.boolean(),
  availabilityReason: arTrajectoryAvailabilityReasonSchemaV1,
  qualityState: trajectoryPublicQualityStateSchemaV1.nullable(),
  confidenceBadge: trajectoryConfidenceBadgeSchemaV1.nullable(),
  generatedAt: z.string().nullable(),
  publishPolicy: trajectoryPublishPolicySchemaV1.nullable()
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
  launchData: launchFeedItemSchemaV1
    .extend({
    imageUrl: z.string().url().nullable().optional(),
    missionSummary: z.string().nullable(),
    padName: z.string().nullable(),
    padLocation: z.string().nullable(),
    windowStart: z.string().nullable(),
    windowEnd: z.string().nullable(),
    weatherSummary: z.string().nullable(),
    launchStatusDescription: z.string().nullable(),
    rocketName: z.string().nullable()
    })
    .optional(),
  arTrajectory: arTrajectorySummarySchemaV1,
  entitlements: entitlementSchemaV1,
  related: z.array(searchResultSchemaV1),
  enrichment: launchDetailEnrichmentSchemaV1,
  weather: launchWeatherModuleSchemaV1.optional(),
  resources: launchResourcesModuleSchemaV1.optional(),
  social: launchSocialModuleSchemaV1.optional(),
  relatedEvents: z.array(launchRelatedEventDetailSchemaV1).default([]),
  relatedNews: z.array(launchRelatedNewsSchemaV1).default([]),
  payloadManifest: z.array(launchPayloadManifestItemSchemaV1).default([]),
  objectInventory: launchObjectInventorySchemaV1.nullable().optional(),
  launchUpdates: z.array(launchUpdateEntrySchemaV1).default([]),
  missionStats: launchMissionStatsSchemaV1.nullable().optional(),
  blueOrigin: blueOriginModuleSchemaV1.nullable().optional()
});

export const launchDetailVersionSchemaV1 = z.object({
  launchId: z.string(),
  scope: launchRefreshScopeSchemaV1,
  tier: z.enum(['anon', 'premium']),
  intervalSeconds: z.number().int().nonnegative(),
  updatedAt: z.string().nullable(),
  version: z.string(),
  recommendedIntervalSeconds: z.number().int().nonnegative().optional(),
  cadenceReason: launchRefreshCadenceReasonSchemaV1.optional(),
  cadenceAnchorNet: z.string().nullable().optional()
});

const jepCalibrationBandSchemaV1 = z.enum(['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'UNKNOWN']);
const jepWeatherMainBlockerSchemaV1 = z.enum([
  'observer_low_ceiling',
  'observer_sky_cover',
  'path_low_ceiling',
  'path_sky_cover',
  'observer_low_clouds',
  'observer_mid_clouds',
  'observer_high_clouds',
  'mixed',
  'unknown'
]);

const jepReadinessSchemaV1 = z
  .object({
    publicVisible: z.boolean(),
    probabilityReady: z.boolean(),
    probabilityPublicEligible: z.boolean(),
    reasons: z.array(z.string()).default([])
  })
  .passthrough();

const jepFactorsSchemaV1 = z.object({
  illumination: z.number(),
  darkness: z.number(),
  lineOfSight: z.number(),
  weather: z.number(),
  solarDepressionDeg: z.number().nullable(),
  cloudCoverPct: z.number().nullable(),
  cloudCoverLowPct: z.number().nullable(),
  cloudCoverMidPct: z.number().nullable(),
  cloudCoverHighPct: z.number().nullable()
});

const jepWeatherPointSummarySchemaV1 = z
  .object({
    note: z.string().nullable().optional()
  })
  .passthrough();

const jepWeatherPathSummarySchemaV1 = z
  .object({
    note: z.string().nullable().optional()
  })
  .passthrough();

const jepWeatherDetailsSchemaV1 = z
  .object({
    sourceUsed: z.string().nullable().optional(),
    mainBlocker: jepWeatherMainBlockerSchemaV1,
    observer: jepWeatherPointSummarySchemaV1.nullable().optional(),
    alongPath: jepWeatherPathSummarySchemaV1.nullable().optional()
  })
  .passthrough();

const jepSolarWindowRangeSchemaV1 = z.object({
  netDeg: z.number().nullable(),
  windowStartDeg: z.number().nullable(),
  windowEndDeg: z.number().nullable(),
  minDeg: z.number().nullable(),
  maxDeg: z.number().nullable(),
  crossesTwilightSweetSpot: z.boolean()
});

const jepBestWindowSchemaV1 = z.object({
  startTPlusSec: z.number(),
  endTPlusSec: z.number(),
  label: z.string(),
  reason: z.string()
});

const jepDirectionBandSchemaV1 = z.object({
  fromAzDeg: z.number(),
  toAzDeg: z.number(),
  label: z.string()
});

const jepElevationBandSchemaV1 = z.object({
  minDeg: z.number(),
  maxDeg: z.number(),
  label: z.string()
});

const jepScenarioWindowSchemaV1 = z.object({
  offsetMinutes: z.number(),
  score: z.number(),
  delta: z.number(),
  trend: z.enum(['better', 'similar', 'worse']),
  label: z.string()
});

export const launchJepScoreSchemaV1 = z
  .object({
    launchId: z.string(),
    mode: z.enum(['watchability', 'probability']),
    readiness: jepReadinessSchemaV1,
    score: z.number(),
    probability: z.number(),
    calibrationBand: jepCalibrationBandSchemaV1,
    modelVersion: z.string(),
    computedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    isStale: z.boolean(),
    isSnapshot: z.boolean(),
    snapshotAt: z.string().nullable(),
    sunlitMarginKm: z.number().nullable(),
    losVisibleFraction: z.number().nullable(),
    weatherFreshnessMinutes: z.number().int().nonnegative().nullable().optional(),
    factors: jepFactorsSchemaV1,
    source: z
      .object({
        weather: z.string().nullable(),
        azimuth: z.string().nullable().optional(),
        geometryOnlyFallback: z.boolean()
      })
      .passthrough(),
    weatherDetails: jepWeatherDetailsSchemaV1.nullable(),
    observer: z
      .object({
        locationHash: z.string(),
        latBucket: z.number().nullable().optional(),
        lonBucket: z.number().nullable().optional(),
        personalized: z.boolean(),
        usingPadFallback: z.boolean()
      })
      .passthrough(),
    solarWindowRange: jepSolarWindowRangeSchemaV1.nullable(),
    bestWindow: jepBestWindowSchemaV1.nullable(),
    directionBand: jepDirectionBandSchemaV1.nullable(),
    elevationBand: jepElevationBandSchemaV1.nullable(),
    scenarioWindows: z.array(jepScenarioWindowSchemaV1).default([])
  })
  .passthrough();

export type LaunchJepScoreV1 = z.infer<typeof launchJepScoreSchemaV1>;

const trajectoryCovarianceSchemaV1 = z.object({
  alongTrackDeg: z.number(),
  crossTrackDeg: z.number()
});

const trajectoryUncertaintySchemaV1 = z.object({
  sigmaDeg: z.number().optional(),
  covariance: trajectoryCovarianceSchemaV1.optional()
});

const trajectoryTrackSampleSchemaV1 = z.object({
  tPlusSec: z.number(),
  ecef: z.tuple([z.number(), z.number(), z.number()]),
  sigmaDeg: z.number().optional(),
  covariance: trajectoryCovarianceSchemaV1.optional(),
  uncertainty: trajectoryUncertaintySchemaV1.optional()
});

const trajectoryTrackKindSchemaV1 = z.enum(['core_up', 'upper_stage_up', 'booster_down']);

const trajectoryTrackSchemaV1 = z.object({
  trackKind: trajectoryTrackKindSchemaV1,
  samples: z.array(trajectoryTrackSampleSchemaV1)
});

const trajectoryMilestoneSchemaV1 = z.object({
  key: z.string(),
  tPlusSec: z.number().nullable(),
  label: z.string(),
  description: z.string().nullable().optional(),
  timeText: z.string().nullable().optional(),
  sourceRefIds: z.array(z.string()),
  confidence: z.enum(['low', 'med', 'high']).optional(),
  phase: z.enum(['prelaunch', 'core_ascent', 'upper_stage', 'booster_return', 'landing', 'unknown']),
  trackKind: trajectoryTrackKindSchemaV1.optional(),
  sourceType: z.enum(['provider_timeline', 'll2_timeline', 'family_template']),
  estimated: z.boolean(),
  projectable: z.boolean(),
  projectionReason: z.enum(['phase_not_projectable', 'missing_track', 'outside_track_horizon', 'unresolved_time']).optional()
});

const trajectoryUncertaintyEnvelopeSchemaV1 = z.object({
  sampleCount: z.number().int().nonnegative(),
  sigmaDegP50: z.number().nullable(),
  sigmaDegP95: z.number().nullable(),
  sigmaDegMax: z.number().nullable()
});

const trajectoryGuidanceSemanticsSchemaV1 = z.enum(['constraint_backed', 'modeled', 'pad_only']);
const trajectoryRecoverySemanticsSchemaV1 = z.enum(['exact_track', 'coarse_sector', 'text_only', 'none']);
const trajectorySupgpModeSchemaV1 = z.enum(['none', 'family_feed', 'launch_file']);
const trajectoryOrbitCoverageClassSchemaV1 = z.enum([
  'licensed',
  'official_numeric',
  'supgp_launch_file',
  'supgp_family_feed',
  'hazard_backed',
  'landing_prior',
  'template_only',
  'none'
]);
const trajectoryLandingCoverageClassSchemaV1 = z.enum(['exact_coordinates', 'directional', 'downrange_only', 'text_only', 'none']);
const trajectoryStageSeparationSourceSchemaV1 = z.enum(['provider_timeline', 'll2_timeline', 'family_template', 'unknown']);

const trajectoryTrackTopologySchemaV1 = z.object({
  hasStageSplit: z.boolean(),
  hasUpperStageTrack: z.boolean(),
  hasBoosterTrack: z.boolean()
});

const trajectorySourceCoverageSchemaV1 = z.object({
  orbitClass: trajectoryOrbitCoverageClassSchemaV1,
  hazardPresent: z.boolean(),
  landingClass: trajectoryLandingCoverageClassSchemaV1,
  stageSeparationSource: trajectoryStageSeparationSourceSchemaV1,
  supgpMode: trajectorySupgpModeSchemaV1,
  shipAssignmentPresent: z.boolean()
});

export const trajectoryPublicV2ResponseSchemaV1 = z.object({
  launchId: z.string(),
  version: z.string(),
  modelVersion: z.string(),
  quality: z.number(),
  qualityState: trajectoryPublicQualityStateSchemaV1,
  guidanceSemantics: trajectoryGuidanceSemanticsSchemaV1,
  recoverySemantics: trajectoryRecoverySemanticsSchemaV1,
  trackTopology: trajectoryTrackTopologySchemaV1,
  sourceCoverage: trajectorySourceCoverageSchemaV1,
  uncertaintyEnvelope: trajectoryUncertaintyEnvelopeSchemaV1,
  sourceBlend: z.object({
    sourceCode: z.string().nullable(),
    sourceLabel: z.string().nullable(),
    hasDirectionalConstraint: z.boolean(),
    hasLandingDirectional: z.boolean(),
    hasHazardDirectional: z.boolean(),
    hasMissionNumericOrbit: z.boolean(),
    hasSupgpConstraint: z.boolean()
  }),
  confidenceReasons: z.array(z.string()),
  safeModeActive: z.boolean(),
  generatedAt: z.string(),
  confidenceTier: z.enum(['A', 'B', 'C', 'D']).nullable(),
  sourceSufficiency: z.record(z.unknown()).nullable(),
  freshnessState: z.enum(['fresh', 'stale', 'unknown']).nullable(),
  lineageComplete: z.boolean(),
  publishPolicy: trajectoryPublishPolicySchemaV1,
  confidenceBadge: trajectoryConfidenceBadgeSchemaV1,
  evidenceLabel: z.string(),
  tracks: z.array(trajectoryTrackSchemaV1),
  milestones: z.array(trajectoryMilestoneSchemaV1),
  product: z.record(z.unknown()).nullable()
});

const arTelemetryRuntimeFamilySchemaV1 = z.enum(['web', 'ios_native', 'android_native']);
const arTelemetryTrackingStateSchemaV1 = z.enum(['not_available', 'limited', 'normal']);
const arTelemetryWorldAlignmentSchemaV1 = z.enum(['gravity', 'gravity_and_heading', 'camera']);
const arTelemetryWorldMappingStatusSchemaV1 = z.enum(['not_available', 'limited', 'extending', 'mapped']);
const arTelemetryGeoTrackingStateSchemaV1 = z.enum(['not_available', 'initializing', 'localizing', 'localized']);
const arTelemetryGeoTrackingAccuracySchemaV1 = z.enum(['unknown', 'low', 'medium', 'high']);
const arTelemetryOcclusionModeSchemaV1 = z.enum(['none', 'scene_depth', 'mesh']);
const arTelemetryPermissionStateSchemaV1 = z.enum(['granted', 'denied', 'prompt', 'error', 'not_applicable']);
const arTelemetryLocationAccuracySchemaV1 = z.enum(['full', 'reduced', 'unknown']);
const arTelemetryLocationFixStateSchemaV1 = z.enum(['unavailable', 'acquiring', 'timeout', 'coarse', 'ready']);

export const arTelemetrySessionEventSchemaV1 = z.object({
  type: z.enum(['start', 'update', 'end']),
  payload: z.object({
    sessionId: z.string().uuid(),
    launchId: z.string().uuid(),

    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    durationMs: z.number().int().nonnegative().optional(),

    runtimeFamily: arTelemetryRuntimeFamilySchemaV1.optional(),
    clientEnv: z
      .enum([
        'ios_safari',
        'ios_chrome',
        'ios_firefox',
        'android_chrome',
        'android_firefox',
        'android_other',
        'desktop_chrome',
        'desktop_safari',
        'desktop_firefox',
        'desktop_edge',
        'desktop_other',
        'unknown'
      ])
      .optional(),
    clientProfile: z
      .enum(['android_chrome', 'android_samsung_internet', 'ios_webkit', 'android_fallback', 'desktop_debug', 'unknown'])
      .optional(),
    releaseProfile: z.string().max(64).optional(),
    screenBucket: z.enum(['xs', 'sm', 'md', 'lg', 'unknown']).optional(),

    cameraStatus: z.enum(['granted', 'denied', 'prompt', 'error']).optional(),
    motionStatus: arTelemetryPermissionStateSchemaV1.optional(),
    locationPermission: arTelemetryPermissionStateSchemaV1.optional(),
    locationAccuracy: arTelemetryLocationAccuracySchemaV1.optional(),
    locationFixState: arTelemetryLocationFixStateSchemaV1.optional(),
    alignmentReady: z.boolean().optional(),
    headingStatus: z.enum(['ok', 'unavailable', 'noisy', 'unknown']).optional(),
    headingSource: z
      .enum([
        'webxr',
        'webkit_compass',
        'deviceorientation_absolute',
        'deviceorientation_tilt_comp',
        'deviceorientation_relative',
        'arkit_world',
        'core_location_heading',
        'unknown'
      ])
      .optional(),
    declinationApplied: z.boolean().optional(),
    declinationSource: z.enum(['wmm', 'approx', 'none']).optional(),
    declinationMagBucket: z.string().max(32).optional(),
    fusionEnabled: z.boolean().optional(),
    fusionUsed: z.boolean().optional(),
    fusionFallbackReason: z.enum(['no_gyro', 'no_gravity', 'gravity_unreliable', 'not_initialized']).nullable().optional(),
    poseSource: z
      .enum(['webxr', 'deviceorientation', 'deviceorientationabsolute', 'sky_compass', 'arkit_world_tracking'])
      .optional(),
    poseMode: z.enum(['webxr', 'sensor_fused', 'arkit_world_tracking']).optional(),
    overlayMode: z.enum(['precision', 'guided', 'search', 'recover']).optional(),
    visionBackend: z.enum(['worker_roi', 'main_thread_roi', 'none', 'vision_native']).optional(),
    degradationTier: z.number().int().min(0).max(3).optional(),
    xrSupported: z.boolean().optional(),
    xrUsed: z.boolean().optional(),
    xrErrorBucket: z.enum(['not_available', 'unsupported', 'webgl', 'permission', 'session_error', 'unknown']).optional(),

    trackingState: arTelemetryTrackingStateSchemaV1.optional(),
    trackingReason: z.string().max(64).optional(),
    worldAlignment: arTelemetryWorldAlignmentSchemaV1.optional(),
    worldMappingStatus: arTelemetryWorldMappingStatusSchemaV1.optional(),
    lidarAvailable: z.boolean().optional(),
    sceneDepthEnabled: z.boolean().optional(),
    sceneReconstructionEnabled: z.boolean().optional(),
    geoTrackingState: arTelemetryGeoTrackingStateSchemaV1.optional(),
    geoTrackingAccuracy: arTelemetryGeoTrackingAccuracySchemaV1.optional(),
    occlusionMode: arTelemetryOcclusionModeSchemaV1.optional(),
    relocalizationCount: z.number().int().nonnegative().optional(),
    highResCaptureAttempted: z.boolean().optional(),
    highResCaptureSucceeded: z.boolean().optional(),

    renderLoopRunning: z.boolean().optional(),
    canvasHidden: z.boolean().optional(),
    timeToUsableMs: z.number().int().nonnegative().max(6 * 60 * 60 * 1000).optional(),
    poseUpdateRateBucket: z.string().max(32).optional(),
    arLoopActiveMs: z.number().int().nonnegative().max(6 * 60 * 60 * 1000).optional(),
    skyCompassLoopActiveMs: z.number().int().nonnegative().max(6 * 60 * 60 * 1000).optional(),
    loopRestartCount: z.number().int().nonnegative().max(10_000).optional(),

    modeEntered: z.enum(['ar', 'sky_compass']).optional(),
    fallbackReason: z.enum(['camera_denied', 'motion_denied', 'no_heading', 'camera_error']).nullable().optional(),
    retryCount: z.number().int().nonnegative().optional(),

    usedScrub: z.boolean().optional(),
    scrubSecondsTotal: z.number().int().nonnegative().optional(),
    eventTapCount: z.number().int().nonnegative().optional(),

    lensPreset: z.enum(['0.5x', '1x', '2x', '3x', 'custom']).optional(),
    corridorMode: z.enum(['tight', 'normal', 'wide']).optional(),
    lockOnMode: z.enum(['auto', 'manual_debug']).optional(),
    lockOnAttempted: z.boolean().optional(),
    lockOnAcquired: z.boolean().optional(),
    timeToLockBucket: z.enum(['<2s', '2..5s', '5..10s', '10..20s', '20..60s', '60s+']).optional(),
    lockLossCount: z.number().int().nonnegative().optional(),

    yawOffsetBucket: z.string().max(32).optional(),
    pitchLevelBucket: z.string().max(32).optional(),
    hfovBucket: z.string().max(32).optional(),
    vfovBucket: z.string().max(32).optional(),
    fovSource: z.enum(['xr', 'preset', 'saved', 'inferred', 'default', 'unknown']).optional(),
    zoomSupported: z.boolean().optional(),
    zoomRatioBucket: z.string().max(32).optional(),
    zoomControlPath: z.enum(['native_camera', 'track_constraints', 'preset_fallback', 'unsupported']).optional(),
    zoomApplyLatencyBucket: z.string().max(32).optional(),
    zoomProjectionSyncLatencyBucket: z.string().max(32).optional(),
    projectionSource: z.enum(['intrinsics_frame', 'projection_matrix', 'inferred_fov', 'preset']).optional(),

    tier: z.number().int().min(0).max(3).optional(),
    trajectoryVersion: z.string().max(64).optional(),
    durationS: z.number().int().min(0).max(7200).optional(),
    stepS: z.number().int().min(0).max(120).optional(),
    avgSigmaDeg: z.number().min(0).max(90).optional(),
    confidenceTierSeen: z.enum(['A', 'B', 'C', 'D']).optional(),
    contractTier: z.enum(['A', 'B', 'C', 'D']).optional(),
    trajectoryAuthorityTier: z
      .enum([
        'partner_feed',
        'official_numeric',
        'regulatory_constrained',
        'supplemental_ephemeris',
        'public_metadata',
        'model_prior'
      ])
      .optional(),
    trajectoryQualityState: z.enum(['precision', 'guided', 'search', 'pad_only']).optional(),
    renderTier: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
    droppedFrameBucket: z.string().max(32).optional()
  })
});

export type ViewerSessionV1 = z.infer<typeof viewerSessionSchemaV1>;
export type BlueOriginMissionKeyV1 = z.infer<typeof blueOriginMissionKeySchemaV1>;
export type BlueOriginOverviewV1 = z.infer<typeof blueOriginOverviewSchemaV1>;
export type BlueOriginMissionOverviewV1 = z.infer<typeof blueOriginMissionOverviewSchemaV1>;
export type BlueOriginFlightsResponseV1 = z.infer<typeof blueOriginFlightsResponseSchemaV1>;
export type BlueOriginTravelersResponseV1 = z.infer<typeof blueOriginTravelersResponseSchemaV1>;
export type BlueOriginVehiclesResponseV1 = z.infer<typeof blueOriginVehiclesResponseSchemaV1>;
export type BlueOriginEnginesResponseV1 = z.infer<typeof blueOriginEnginesResponseSchemaV1>;
export type BlueOriginContractsResponseV1 = z.infer<typeof blueOriginContractsResponseSchemaV1>;
export type SpaceXMissionKeyV1 = z.infer<typeof spaceXMissionKeySchemaV1>;
export type SpaceXOverviewV1 = z.infer<typeof spaceXOverviewSchemaV1>;
export type SpaceXMissionOverviewV1 = z.infer<typeof spaceXMissionOverviewSchemaV1>;
export type SpaceXFlightsResponseV1 = z.infer<typeof spaceXFlightsResponseSchemaV1>;
export type SpaceXVehiclesResponseV1 = z.infer<typeof spaceXVehiclesResponseSchemaV1>;
export type SpaceXEnginesResponseV1 = z.infer<typeof spaceXEnginesResponseSchemaV1>;
export type SpaceXContractsResponseV1 = z.infer<typeof spaceXContractsResponseSchemaV1>;
export type SpaceXDroneShipListResponseV1 = z.infer<typeof spaceXDroneShipListResponseSchemaV1>;
export type SpaceXDroneShipDetailV1 = z.infer<typeof spaceXDroneShipDetailSchemaV1>;
export type ArtemisMissionKeyV1 = z.infer<typeof artemisMissionKeySchemaV1>;
export type ArtemisOverviewV1 = z.infer<typeof artemisOverviewSchemaV1>;
export type ArtemisMissionOverviewV1 = z.infer<typeof artemisMissionOverviewSchemaV1>;
export type ArtemisContractsResponseV1 = z.infer<typeof artemisContractsResponseSchemaV1>;
export type ArtemisContractDetailV1 = z.infer<typeof artemisContractDetailSchemaV1>;
export type ArtemisAwardeesResponseV1 = z.infer<typeof artemisAwardeesResponseSchemaV1>;
export type ArtemisAwardeeDetailV1 = z.infer<typeof artemisAwardeeDetailSchemaV1>;
export type ArtemisContentResponseV1 = z.infer<typeof artemisContentResponseSchemaV1>;
export type StarshipOverviewV1 = z.infer<typeof starshipOverviewSchemaV1>;
export type StarshipFlightOverviewV1 = z.infer<typeof starshipFlightOverviewSchemaV1>;
export type EntitlementCapabilitiesV1 = z.infer<typeof entitlementCapabilitiesSchemaV1>;
export type EntitlementLimitsV1 = z.infer<typeof entitlementLimitsSchemaV1>;
export type EntitlementsV1 = z.infer<typeof entitlementSchemaV1>;
export type AdminAccessOverrideV1 = z.infer<typeof adminAccessOverrideSchemaV1>;
export type AdminAccessOverrideUpdateV1 = z.infer<typeof adminAccessOverrideUpdateSchemaV1>;
export type BasicLaunchFollowV1 = z.infer<typeof basicLaunchFollowSchemaV1>;
export type BasicFollowsV1 = z.infer<typeof basicFollowsSchemaV1>;
export type LaunchCardV1 = z.infer<typeof launchCardSchemaV1>;
export type LaunchFeedItemV1 = z.infer<typeof launchFeedItemSchemaV1>;
export type LaunchFeedV1 = z.infer<typeof launchFeedSchemaV1>;
export type LaunchFeedVersionV1 = z.infer<typeof launchFeedVersionSchemaV1>;
export type ChangedLaunchesV1 = z.infer<typeof changedLaunchesSchemaV1>;
export type SearchResultV1 = z.infer<typeof searchResultSchemaV1>;
export type ArTrajectorySummaryV1 = z.infer<typeof arTrajectorySummarySchemaV1>;
export type LaunchDetailEnrichmentV1 = z.infer<typeof launchDetailEnrichmentSchemaV1>;
export type LaunchDetailV1 = z.infer<typeof launchDetailSchemaV1>;
export type LaunchDetailVersionV1 = z.infer<typeof launchDetailVersionSchemaV1>;
export type LaunchFaaAirspaceMapV1 = z.infer<typeof launchFaaAirspaceMapSchemaV1>;
export type TrajectoryPublicV2ResponseV1 = z.infer<typeof trajectoryPublicV2ResponseSchemaV1>;
export type ArTelemetrySessionEventV1 = z.infer<typeof arTelemetrySessionEventSchemaV1>;
export type SearchResponseV1 = z.infer<typeof searchResponseSchemaV1>;
export type NewsStreamV1 = z.infer<typeof newsStreamSchemaV1>;
export type CanonicalContractsResponseV1 = z.infer<typeof canonicalContractsResponseSchemaV1>;
export type CanonicalContractDetailV1 = z.infer<typeof canonicalContractDetailSchemaV1>;
export type SatellitesResponseV1 = z.infer<typeof satellitesResponseSchemaV1>;
export type SatelliteOwnersResponseV1 = z.infer<typeof satelliteOwnersResponseSchemaV1>;
export type SatelliteDetailV1 = z.infer<typeof satelliteDetailSchemaV1>;
export type SatelliteOwnerProfileV1 = z.infer<typeof satelliteOwnerProfileSchemaV1>;
export type ContentPageV1 = z.infer<typeof contentPageSchemaV1>;
export type InfoHubV1 = z.infer<typeof infoHubSchemaV1>;
export type CatalogEntityTypeV1 = z.infer<typeof catalogEntityTypeSchemaV1>;
export type CatalogHubV1 = z.infer<typeof catalogHubSchemaV1>;
export type CatalogCollectionV1 = z.infer<typeof catalogCollectionSchemaV1>;
export type CatalogDetailV1 = z.infer<typeof catalogDetailSchemaV1>;
export type CoreEntityDetailTypeV1 = z.infer<typeof coreEntityDetailTypeSchemaV1>;
export type CoreEntityBadgeV1 = z.infer<typeof coreEntityBadgeSchemaV1>;
export type CoreEntityFactV1 = z.infer<typeof coreEntityFactSchemaV1>;
export type CoreEntityStatV1 = z.infer<typeof coreEntityStatSchemaV1>;
export type CoreEntityLinkV1 = z.infer<typeof coreEntityLinkSchemaV1>;
export type CoreEntityNewsItemV1 = z.infer<typeof coreEntityNewsItemSchemaV1>;
export type ProviderDetailV1 = z.infer<typeof providerDetailSchemaV1>;
export type RocketDetailV1 = z.infer<typeof rocketDetailSchemaV1>;
export type LocationDetailV1 = z.infer<typeof locationDetailSchemaV1>;
export type PadDetailV1 = z.infer<typeof padDetailSchemaV1>;
export type NotificationPreferencesV1 = z.infer<typeof notificationPreferencesSchemaV1>;
export type NotificationPreferencesUpdateV1 = z.infer<typeof notificationPreferencesUpdateSchemaV1>;
export type PrivacyPreferencesV1 = z.infer<typeof privacyPreferencesSchemaV1>;
export type PrivacyPreferencesUpdateV1 = z.infer<typeof privacyPreferencesUpdateSchemaV1>;
export type MarketingEmailV1 = z.infer<typeof marketingEmailSchemaV1>;
export type MarketingEmailUpdateV1 = z.infer<typeof marketingEmailUpdateSchemaV1>;
export type BillingProviderV1 = z.infer<typeof billingProviderSchemaV1>;
export type BillingPlatformV1 = z.infer<typeof billingPlatformSchemaV1>;
export type BillingProductKeyV1 = z.infer<typeof billingProductKeySchemaV1>;
export type BillingManagementModeV1 = z.infer<typeof billingManagementModeSchemaV1>;
export type BillingSummaryV1 = z.infer<typeof billingSummarySchemaV1>;
export type BillingCatalogProductV1 = z.infer<typeof billingCatalogProductSchemaV1>;
export type BillingCatalogOfferV1 = z.infer<typeof billingCatalogOfferSchemaV1>;
export type BillingCatalogV1 = z.infer<typeof billingCatalogSchemaV1>;
export type AppleBillingSyncRequestV1 = z.infer<typeof appleBillingSyncRequestSchemaV1>;
export type GoogleBillingSyncRequestV1 = z.infer<typeof googleBillingSyncRequestSchemaV1>;
export type BillingSyncResponseV1 = z.infer<typeof billingSyncResponseSchemaV1>;
export type PremiumClaimStatusV1 = z.infer<typeof premiumClaimStatusSchemaV1>;
export type PremiumClaimV1 = z.infer<typeof premiumClaimSchemaV1>;
export type PremiumClaimEnvelopeV1 = z.infer<typeof premiumClaimEnvelopeSchemaV1>;
export type PremiumClaimPasswordSignUpV1 = z.infer<typeof premiumClaimPasswordSignUpSchemaV1>;
export type PremiumClaimPasswordSignUpResponseV1 = z.infer<typeof premiumClaimPasswordSignUpResponseSchemaV1>;
export type PremiumClaimAttachResponseV1 = z.infer<typeof premiumClaimAttachResponseSchemaV1>;
export type LaunchFilterValueV1 = z.infer<typeof launchFilterValueSchemaV1>;
export type LaunchFilterOptionsV1 = z.infer<typeof launchFilterOptionsSchemaV1>;
export type PushDeviceRegistrationV1 = z.infer<typeof pushDeviceRegistrationSchemaV1>;
export type PushDeviceRemovalV1 = z.infer<typeof pushDeviceRemovalSchemaV1>;
export type PushDeliveryTestV1 = z.infer<typeof pushDeliveryTestSchemaV1>;
export type MobilePushOwnerKindV1 = z.infer<typeof mobilePushOwnerKindSchemaV1>;
export type MobilePushScopeKindV1 = z.infer<typeof mobilePushScopeKindSchemaV1>;
export type MobilePushStatusChangeTypeV1 = z.infer<typeof mobilePushStatusChangeTypeSchemaV1>;
export type MobilePushGuestContextV1 = z.infer<typeof mobilePushGuestContextSchemaV1>;
export type MobilePushAccessV1 = z.infer<typeof mobilePushAccessSchemaV1>;
export type MobilePushDeviceV1 = z.infer<typeof mobilePushDeviceSchemaV1>;
export type MobilePushDeviceRegisterV1 = z.infer<typeof mobilePushDeviceRegisterSchemaV1>;
export type MobilePushDeviceRemoveV1 = z.infer<typeof mobilePushDeviceRemoveSchemaV1>;
export type MobilePushRuleSettingsV1 = z.infer<typeof mobilePushRuleSettingsSchemaV1>;
export type MobilePushRuleSettingsInputV1 = z.infer<typeof mobilePushRuleSettingsInputSchemaV1>;
export type MobilePushRuleV1 = z.infer<typeof mobilePushRuleSchemaV1>;
export type MobilePushRuleUpsertV1 = z.infer<typeof mobilePushRuleUpsertSchemaV1>;
export type MobilePushRulesEnvelopeV1 = z.infer<typeof mobilePushRulesEnvelopeSchemaV1>;
export type MobilePushRuleEnvelopeV1 = z.infer<typeof mobilePushRuleEnvelopeSchemaV1>;
export type MobilePushLaunchPreferenceEnvelopeV1 = z.infer<typeof mobilePushLaunchPreferenceEnvelopeSchemaV1>;
export type MobilePushTestRequestV1 = z.infer<typeof mobilePushTestRequestSchemaV1>;
export type MobilePushTestV1 = z.infer<typeof mobilePushTestSchemaV1>;
export type NotificationOwnerKindV2 = z.infer<typeof notificationOwnerKindSchemaV2>;
export type NotificationChannelV2 = z.infer<typeof notificationChannelSchemaV2>;
export type NotificationDeliveryKindV2 = z.infer<typeof notificationDeliveryKindSchemaV2>;
export type NotificationRuleIntentV2 = z.infer<typeof notificationRuleIntentSchemaV2>;
export type NotificationScopeKindV2 = z.infer<typeof notificationScopeKindSchemaV2>;
export type NotificationRuleSettingsV2 = z.infer<typeof notificationRuleSettingsSchemaV2>;
export type NotificationRuleSettingsInputV2 = z.infer<typeof notificationRuleSettingsInputSchemaV2>;
export type NotificationDestinationV2 = z.infer<typeof notificationDestinationSchemaV2>;
export type NotificationCapabilitiesV2 = z.infer<typeof notificationCapabilitiesSchemaV2>;
export type NotificationPreferencesV2 = z.infer<typeof notificationPreferencesSchemaV2>;
export type NotificationRuleV2 = z.infer<typeof notificationRuleSchemaV2>;
export type NotificationRuleUpsertV2 = z.infer<typeof notificationRuleUpsertSchemaV2>;
export type NotificationStateV2 = z.infer<typeof notificationStateSchemaV2>;
export type NotificationRuleEnvelopeV2 = z.infer<typeof notificationRuleEnvelopeSchemaV2>;
export type NotificationDestinationEnvelopeV2 = z.infer<typeof notificationDestinationEnvelopeSchemaV2>;
export type AuthProviderV1 = z.infer<typeof authProviderSchemaV1>;
export type AuthPlatformV1 = z.infer<typeof authPlatformSchemaV1>;
export type MobileAuthPlatformV1 = z.infer<typeof mobileAuthPlatformSchemaV1>;
export type MobileAuthFlowV1 = z.infer<typeof mobileAuthFlowSchemaV1>;
export type MobileAuthAttestationProviderV1 = z.infer<typeof mobileAuthAttestationProviderSchemaV1>;
export type MobileAuthAttestationV1 = z.infer<typeof mobileAuthAttestationSchemaV1>;
export type MobileAuthRiskDispositionV1 = z.infer<typeof mobileAuthRiskDispositionSchemaV1>;
export type MobileAuthSessionV1 = z.infer<typeof mobileAuthSessionSchemaV1>;
export type MobileAuthUserV1 = z.infer<typeof mobileAuthUserSchemaV1>;
export type MobileAuthRiskStartV1 = z.infer<typeof mobileAuthRiskStartSchemaV1>;
export type MobileAuthRiskDecisionV1 = z.infer<typeof mobileAuthRiskDecisionSchemaV1>;
export type MobileAuthChallengeCompleteV1 = z.infer<typeof mobileAuthChallengeCompleteSchemaV1>;
export type MobileAuthChallengeResultV1 = z.infer<typeof mobileAuthChallengeResultSchemaV1>;
export type ClientBootstrapRequestV1 = z.infer<typeof clientBootstrapRequestSchemaV1>;
export type ClientBootstrapResponseV1 = z.infer<typeof clientBootstrapResponseSchemaV1>;
export type MobileAuthPasswordSignInV1 = z.infer<typeof mobileAuthPasswordSignInSchemaV1>;
export type MobileAuthPasswordSignInResponseV1 = z.infer<typeof mobileAuthPasswordSignInResponseSchemaV1>;
export type MobileAuthPasswordSignUpV1 = z.infer<typeof mobileAuthPasswordSignUpSchemaV1>;
export type MobileAuthPasswordSignUpResponseV1 = z.infer<typeof mobileAuthPasswordSignUpResponseSchemaV1>;
export type MobileAuthPasswordResendV1 = z.infer<typeof mobileAuthPasswordResendSchemaV1>;
export type MobileAuthPasswordRecoverV1 = z.infer<typeof mobileAuthPasswordRecoverSchemaV1>;
export type AppleAuthCaptureSourceV1 = z.infer<typeof appleAuthCaptureSourceSchemaV1>;
export type AppleAuthCaptureV1 = z.infer<typeof appleAuthCaptureSchemaV1>;
export type AppleAuthCaptureResponseV1 = z.infer<typeof appleAuthCaptureResponseSchemaV1>;
export type AuthMethodProviderV1 = z.infer<typeof authMethodProviderSchemaV1>;
export type AuthMethodV1 = z.infer<typeof authMethodSchemaV1>;
export type AuthMethodsV1 = z.infer<typeof authMethodsSchemaV1>;
export type AuthContextEventTypeV1 = z.infer<typeof authContextEventTypeSchemaV1>;
export type AuthContextUpsertV1 = z.infer<typeof authContextUpsertSchemaV1>;
export type ProfileV1 = z.infer<typeof profileSchemaV1>;
export type ProfileUpdateV1 = z.infer<typeof profileUpdateSchemaV1>;
export type AccountExportV1 = z.infer<typeof accountExportSchemaV1>;
export type CalendarTokenV1 = z.infer<typeof calendarTokenSchemaV1>;
export type WatchlistRuleV1 = z.infer<typeof watchlistRuleSchemaV1>;
export type WatchlistV1 = z.infer<typeof watchlistSchemaV1>;
export type WatchlistsV1 = z.infer<typeof watchlistsSchemaV1>;
export type WatchlistCreateV1 = z.infer<typeof watchlistCreateSchemaV1>;
export type WatchlistUpdateV1 = z.infer<typeof watchlistUpdateSchemaV1>;
export type WatchlistEnvelopeV1 = z.infer<typeof watchlistEnvelopeSchemaV1>;
export type WatchlistRuleCreateV1 = z.infer<typeof watchlistRuleCreateSchemaV1>;
export type WatchlistRuleEnvelopeV1 = z.infer<typeof watchlistRuleEnvelopeSchemaV1>;
export type FilterPresetV1 = z.infer<typeof filterPresetSchemaV1>;
export type FilterPresetsV1 = z.infer<typeof filterPresetsSchemaV1>;
export type FilterPresetCreateV1 = z.infer<typeof filterPresetCreateSchemaV1>;
export type FilterPresetUpdateV1 = z.infer<typeof filterPresetUpdateSchemaV1>;
export type FilterPresetEnvelopeV1 = z.infer<typeof filterPresetEnvelopeSchemaV1>;
export type CalendarFeedV1 = z.infer<typeof calendarFeedSchemaV1>;
export type CalendarFeedsV1 = z.infer<typeof calendarFeedsSchemaV1>;
export type CalendarFeedCreateV1 = z.infer<typeof calendarFeedCreateSchemaV1>;
export type CalendarFeedUpdateV1 = z.infer<typeof calendarFeedUpdateSchemaV1>;
export type CalendarFeedEnvelopeV1 = z.infer<typeof calendarFeedEnvelopeSchemaV1>;
export type RssFeedV1 = z.infer<typeof rssFeedSchemaV1>;
export type RssFeedsV1 = z.infer<typeof rssFeedsSchemaV1>;
export type RssFeedCreateV1 = z.infer<typeof rssFeedCreateSchemaV1>;
export type RssFeedUpdateV1 = z.infer<typeof rssFeedUpdateSchemaV1>;
export type RssFeedEnvelopeV1 = z.infer<typeof rssFeedEnvelopeSchemaV1>;
export type EmbedWidgetV1 = z.infer<typeof embedWidgetSchemaV1>;
export type EmbedWidgetsV1 = z.infer<typeof embedWidgetsSchemaV1>;
export type EmbedWidgetCreateV1 = z.infer<typeof embedWidgetCreateSchemaV1>;
export type EmbedWidgetUpdateV1 = z.infer<typeof embedWidgetUpdateSchemaV1>;
export type EmbedWidgetEnvelopeV1 = z.infer<typeof embedWidgetEnvelopeSchemaV1>;
export type LaunchNotificationPreferenceV1 = z.infer<typeof launchNotificationPreferenceSchemaV1>;
export type LaunchNotificationPreferenceUpdateV1 = z.infer<typeof launchNotificationPreferenceUpdateSchemaV1>;
export type PushChannelStatusV1 = z.infer<typeof pushChannelStatusSchemaV1>;
export type LaunchNotificationPreferenceEnvelopeV1 = z.infer<typeof launchNotificationPreferenceEnvelopeSchemaV1>;
export type AlertRuleKindV1 = z.infer<typeof alertRuleKindSchemaV1>;
export type AlertRuleV1 = z.infer<typeof alertRuleSchemaV1>;
export type AlertRulesV1 = z.infer<typeof alertRulesSchemaV1>;
export type AlertRuleCreateV1 = z.infer<typeof alertRuleCreateSchemaV1>;
export type AlertRuleEnvelopeV1 = z.infer<typeof alertRuleEnvelopeSchemaV1>;
export type SuccessResponseV1 = z.infer<typeof successResponseSchemaV1>;
