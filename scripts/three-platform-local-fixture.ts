export const LOCAL_ACCEPTANCE_PASSWORD = 'AcceptancePass!2026';

export const LOCAL_ACCEPTANCE_USERS = {
  free: {
    email: 'acceptance-free@tminuszero.local',
    password: LOCAL_ACCEPTANCE_PASSWORD,
    firstName: 'Free',
    lastName: 'Viewer',
    timezone: 'America/New_York'
  },
  premium: {
    email: 'acceptance-premium@tminuszero.local',
    password: LOCAL_ACCEPTANCE_PASSWORD,
    firstName: 'Premium',
    lastName: 'Viewer',
    timezone: 'America/New_York'
  }
} as const;

export const LOCAL_ACCEPTANCE_IDS = {
  primaryLaunchId: '11111111-1111-4111-8111-111111111111',
  secondaryLaunchId: '22222222-2222-4222-8222-222222222222',
  premiumWatchlistId: '33333333-3333-4333-8333-333333333333',
  premiumWatchlistRuleId: '44444444-4444-4444-8444-444444444444',
  premiumFilterPresetId: '55555555-5555-4555-8555-555555555555'
} as const;

export const LOCAL_ACCEPTANCE_LAUNCHES = [
  {
    id: LOCAL_ACCEPTANCE_IDS.primaryLaunchId,
    ll2LaunchUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Starlink Group 9-9',
    slug: 'starlink-group-9-9',
    provider: 'SpaceX',
    vehicle: 'Falcon 9 Block 5',
    rocketFullName: 'Falcon 9 Block 5',
    missionName: 'Starlink Group 9-9',
    missionDescription: 'Deterministic local acceptance fixture for mobile feed, detail, and search.',
    net: '2026-04-01T12:00:00.000Z',
    netPrecision: 'hour',
    statusName: 'go',
    statusAbbrev: 'Go',
    tier: 'major',
    featured: true,
    padName: 'Space Launch Complex 40',
    padShortCode: 'SLC-40',
    padStateCode: 'FL',
    padState: 'FL',
    padTimezone: 'America/New_York',
    padLocationName: 'Cape Canaveral, Florida',
    padCountryCode: 'USA',
    imageThumbnailUrl: 'https://images2.imgbox.com/00/00/default.png'
  },
  {
    id: LOCAL_ACCEPTANCE_IDS.secondaryLaunchId,
    ll2LaunchUuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Transporter Local 1',
    slug: 'transporter-local-1',
    provider: 'SpaceX',
    vehicle: 'Falcon 9 Block 5',
    rocketFullName: 'Falcon 9 Block 5',
    missionName: 'Transporter Local 1',
    missionDescription: 'Second deterministic local acceptance launch used for pagination checks.',
    net: '2026-04-02T15:00:00.000Z',
    netPrecision: 'hour',
    statusName: 'hold',
    statusAbbrev: 'Hold',
    tier: 'notable',
    featured: false,
    padName: 'Launch Complex 39A',
    padShortCode: 'LC-39A',
    padStateCode: 'FL',
    padState: 'FL',
    padTimezone: 'America/New_York',
    padLocationName: 'Kennedy Space Center, Florida',
    padCountryCode: 'USA',
    imageThumbnailUrl: 'https://images2.imgbox.com/00/00/default.png'
  }
] as const;
