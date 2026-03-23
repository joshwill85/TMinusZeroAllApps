import { QueryClient, queryOptions } from '@tanstack/react-query';

export type SearchQueryKeyOptions = {
  limit?: number | null;
  types?: readonly string[] | null;
};

export type LaunchFeedQueryKeyOptions = {
  scope?: 'public' | 'live' | 'watchlist' | null;
  watchlistId?: string | null;
  limit?: number | null;
  offset?: number | null;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all' | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  padId?: number | null;
  region?: 'us' | 'non-us' | 'all' | null;
  provider?: string | null;
  providerId?: number | null;
  rocketId?: number | null;
  sort?: 'soonest' | 'latest' | 'changed' | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export type LaunchFilterOptionsQueryKeyOptions = {
  mode?: 'public' | 'live' | null;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all' | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  region?: 'us' | 'non-us' | 'all' | null;
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export type LaunchFeedVersionQueryKeyOptions = {
  scope?: 'public' | 'live' | null;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all' | null;
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  padId?: number | null;
  region?: 'us' | 'non-us' | 'all' | null;
  provider?: string | null;
  providerId?: number | null;
  rocketId?: number | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export type ChangedLaunchesQueryKeyOptions = {
  hours?: number | null;
  region?: 'us' | 'non-us' | 'all' | null;
};

export type LaunchDetailVersionQueryKeyOptions = {
  scope?: 'public' | 'live' | null;
};

export type BillingCatalogQueryKeyOptions = {
  platform: 'web' | 'ios' | 'android';
};

export type BlueOriginMissionQueryKeyOptions = {
  mission?: string | null;
};

export type SpaceXMissionQueryKeyOptions = {
  mission?: string | null;
};

export type ArtemisMissionQueryKeyOptions = {
  mission?: string | null;
};

export type ArtemisAwardeeQueryKeyOptions = {
  q?: string | null;
  limit?: number | null;
};

export type ArtemisContentQueryKeyOptions = {
  mission?: string | null;
  kind?: string | null;
  tier?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

export type NewsStreamQueryKeyOptions = {
  type?: 'all' | 'article' | 'blog' | 'report' | null;
  provider?: string | null;
  cursor?: number | null;
  limit?: number | null;
};

export type CanonicalContractsQueryKeyOptions = {
  q?: string | null;
  scope?: 'all' | 'spacex' | 'blue-origin' | 'artemis' | null;
};

export type SatellitesQueryKeyOptions = {
  limit?: number | null;
  offset?: number | null;
};

export type SatelliteOwnersQueryKeyOptions = {
  limit?: number | null;
  offset?: number | null;
};

export type CatalogCollectionQueryKeyOptions = {
  region?: 'all' | 'us' | null;
  q?: string | null;
  limit?: number | null;
  offset?: number | null;
};

function normalizeSearchTypes(types: readonly string[] | null | undefined) {
  return [...new Set((types ?? []).map((value) => String(value).trim()).filter(Boolean))].sort();
}

function normalizeToken(value: string | null | undefined) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeInt(value: number | null | undefined) {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function normalizeLaunchFeedQueryOptions(options: LaunchFeedQueryKeyOptions = {}) {
  return {
    scope: options.scope ?? 'public',
    watchlistId: normalizeToken(options.watchlistId),
    limit: options.limit ?? null,
    offset: options.offset ?? null,
    range: options.range ?? null,
    from: normalizeToken(options.from),
    to: normalizeToken(options.to),
    location: normalizeToken(options.location),
    state: normalizeToken(options.state),
    pad: normalizeToken(options.pad),
    padId: normalizeInt(options.padId),
    region: options.region ?? null,
    provider: normalizeToken(options.provider),
    providerId: normalizeInt(options.providerId),
    rocketId: normalizeInt(options.rocketId),
    sort: options.sort ?? null,
    status: options.status ?? null
  };
}

function normalizeLaunchFilterOptionsQueryOptions(options: LaunchFilterOptionsQueryKeyOptions = {}) {
  return {
    mode: options.mode ?? 'public',
    range: options.range ?? null,
    from: normalizeToken(options.from),
    to: normalizeToken(options.to),
    location: normalizeToken(options.location),
    state: normalizeToken(options.state),
    pad: normalizeToken(options.pad),
    region: options.region ?? null,
    provider: normalizeToken(options.provider),
    status: options.status ?? null
  };
}

function normalizeLaunchFeedVersionQueryOptions(options: LaunchFeedVersionQueryKeyOptions = {}) {
  return {
    scope: options.scope ?? 'public',
    range: options.range ?? null,
    from: normalizeToken(options.from),
    to: normalizeToken(options.to),
    location: normalizeToken(options.location),
    state: normalizeToken(options.state),
    pad: normalizeToken(options.pad),
    padId: normalizeInt(options.padId),
    region: options.region ?? null,
    provider: normalizeToken(options.provider),
    providerId: normalizeInt(options.providerId),
    rocketId: normalizeInt(options.rocketId),
    status: options.status ?? null
  };
}

function normalizeChangedLaunchesQueryOptions(options: ChangedLaunchesQueryKeyOptions = {}) {
  return {
    hours: options.hours ?? 24,
    region: options.region ?? null
  };
}

function normalizeLaunchDetailVersionQueryOptions(options: LaunchDetailVersionQueryKeyOptions = {}) {
  return {
    scope: options.scope ?? 'public'
  };
}

function normalizeBlueOriginMissionQueryOptions(options: BlueOriginMissionQueryKeyOptions = {}) {
  return {
    mission: normalizeToken(options.mission) ?? 'all'
  };
}

function normalizeSpaceXMissionQueryOptions(options: SpaceXMissionQueryKeyOptions = {}) {
  return {
    mission: normalizeToken(options.mission) ?? 'all'
  };
}

function normalizeArtemisMissionQueryOptions(options: ArtemisMissionQueryKeyOptions = {}) {
  return {
    mission: normalizeToken(options.mission) ?? 'all'
  };
}

function normalizeArtemisAwardeeQueryOptions(options: ArtemisAwardeeQueryKeyOptions = {}) {
  return {
    q: normalizeToken(options.q),
    limit: normalizeInt(options.limit)
  };
}

function normalizeArtemisContentQueryOptions(options: ArtemisContentQueryKeyOptions = {}) {
  return {
    mission: normalizeToken(options.mission) ?? 'all',
    kind: normalizeToken(options.kind) ?? 'all',
    tier: normalizeToken(options.tier) ?? 'all',
    cursor: normalizeToken(options.cursor),
    limit: normalizeInt(options.limit)
  };
}

function normalizeNewsStreamQueryOptions(options: NewsStreamQueryKeyOptions = {}) {
  return {
    type: options.type ?? 'all',
    provider: normalizeToken(options.provider),
    cursor: normalizeInt(options.cursor),
    limit: normalizeInt(options.limit)
  };
}

function normalizeCanonicalContractsQueryOptions(options: CanonicalContractsQueryKeyOptions = {}) {
  return {
    q: normalizeToken(options.q),
    scope: options.scope ?? 'all'
  };
}

function normalizeSatellitesQueryOptions(options: SatellitesQueryKeyOptions = {}) {
  return {
    limit: normalizeInt(options.limit),
    offset: normalizeInt(options.offset)
  };
}

function normalizeSatelliteOwnersQueryOptions(options: SatelliteOwnersQueryKeyOptions = {}) {
  return {
    limit: normalizeInt(options.limit),
    offset: normalizeInt(options.offset)
  };
}

function normalizeCatalogCollectionQueryOptions(options: CatalogCollectionQueryKeyOptions = {}) {
  return {
    region: options.region ?? 'all',
    q: normalizeToken(options.q),
    limit: normalizeInt(options.limit),
    offset: normalizeInt(options.offset)
  };
}

export const sharedQueryKeys = {
  viewerSession: ['viewer-session'] as const,
  entitlements: ['viewer-entitlements'] as const,
  launchFeed: ['launch-feed'] as const,
  launchFeedVariant: (options: LaunchFeedQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchFeedQueryOptions(options);
    return [
      'launch-feed',
      normalized.scope,
      normalized.watchlistId,
      normalized.limit,
      normalized.offset,
      normalized.range,
      normalized.from,
      normalized.to,
      normalized.location,
      normalized.state,
      normalized.pad,
      normalized.padId,
      normalized.region,
      normalized.provider,
      normalized.providerId,
      normalized.rocketId,
      normalized.sort,
      normalized.status
    ] as const;
  },
  launchFilterOptions: ['launch-filter-options'] as const,
  launchFilterOptionsVariant: (options: LaunchFilterOptionsQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchFilterOptionsQueryOptions(options);
    return [
      'launch-filter-options',
      normalized.mode,
      normalized.range,
      normalized.from,
      normalized.to,
      normalized.location,
      normalized.state,
      normalized.pad,
      normalized.region,
      normalized.provider,
      normalized.status
    ] as const;
  },
  launchFeedVersion: ['launch-feed-version'] as const,
  launchFeedVersionVariant: (options: LaunchFeedVersionQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchFeedVersionQueryOptions(options);
    return [
      'launch-feed-version',
      normalized.scope,
      normalized.range,
      normalized.from,
      normalized.to,
      normalized.location,
      normalized.state,
      normalized.pad,
      normalized.padId,
      normalized.region,
      normalized.provider,
      normalized.providerId,
      normalized.rocketId,
      normalized.status
    ] as const;
  },
  changedLaunches: ['launches-changed'] as const,
  changedLaunchesVariant: (options: ChangedLaunchesQueryKeyOptions = {}) => {
    const normalized = normalizeChangedLaunchesQueryOptions(options);
    return ['launches-changed', normalized.hours, normalized.region] as const;
  },
  launchDetail: (id: string) => ['launch-detail', id] as const,
  launchDetailVersion: (id: string, options: LaunchDetailVersionQueryKeyOptions = {}) => {
    const normalized = normalizeLaunchDetailVersionQueryOptions(options);
    return ['launch-detail-version', id, normalized.scope] as const;
  },
  launchTrajectory: (id: string) => ['launch-trajectory', id] as const,
  blueOriginOverview: ['blue-origin-overview'] as const,
  blueOriginMissionOverview: (mission: string) => ['blue-origin-mission-overview', normalizeToken(mission)] as const,
  blueOriginFlights: ['blue-origin-flights'] as const,
  blueOriginFlightsVariant: (options: BlueOriginMissionQueryKeyOptions = {}) => {
    const normalized = normalizeBlueOriginMissionQueryOptions(options);
    return ['blue-origin-flights', normalized.mission] as const;
  },
  blueOriginTravelers: ['blue-origin-travelers'] as const,
  blueOriginVehicles: ['blue-origin-vehicles'] as const,
  blueOriginVehiclesVariant: (options: BlueOriginMissionQueryKeyOptions = {}) => {
    const normalized = normalizeBlueOriginMissionQueryOptions(options);
    return ['blue-origin-vehicles', normalized.mission] as const;
  },
  blueOriginEngines: ['blue-origin-engines'] as const,
  blueOriginEnginesVariant: (options: BlueOriginMissionQueryKeyOptions = {}) => {
    const normalized = normalizeBlueOriginMissionQueryOptions(options);
    return ['blue-origin-engines', normalized.mission] as const;
  },
  blueOriginContracts: ['blue-origin-contracts'] as const,
  blueOriginContractsVariant: (options: BlueOriginMissionQueryKeyOptions = {}) => {
    const normalized = normalizeBlueOriginMissionQueryOptions(options);
    return ['blue-origin-contracts', normalized.mission] as const;
  },
  spaceXOverview: ['spacex-overview'] as const,
  spaceXMissionOverview: (mission: string) => ['spacex-mission-overview', normalizeToken(mission)] as const,
  spaceXFlights: ['spacex-flights'] as const,
  spaceXFlightsVariant: (options: SpaceXMissionQueryKeyOptions = {}) => {
    const normalized = normalizeSpaceXMissionQueryOptions(options);
    return ['spacex-flights', normalized.mission] as const;
  },
  spaceXVehicles: ['spacex-vehicles'] as const,
  spaceXVehiclesVariant: (options: SpaceXMissionQueryKeyOptions = {}) => {
    const normalized = normalizeSpaceXMissionQueryOptions(options);
    return ['spacex-vehicles', normalized.mission] as const;
  },
  spaceXEngines: ['spacex-engines'] as const,
  spaceXEnginesVariant: (options: SpaceXMissionQueryKeyOptions = {}) => {
    const normalized = normalizeSpaceXMissionQueryOptions(options);
    return ['spacex-engines', normalized.mission] as const;
  },
  spaceXContracts: ['spacex-contracts'] as const,
  spaceXContractsVariant: (options: SpaceXMissionQueryKeyOptions = {}) => {
    const normalized = normalizeSpaceXMissionQueryOptions(options);
    return ['spacex-contracts', normalized.mission] as const;
  },
  artemisOverview: ['artemis-overview'] as const,
  artemisMissionOverview: (mission: string) => ['artemis-mission-overview', normalizeToken(mission)] as const,
  artemisContracts: ['artemis-contracts'] as const,
  artemisContractDetail: (piid: string) => ['artemis-contract-detail', normalizeToken(piid)] as const,
  artemisAwardees: ['artemis-awardees'] as const,
  artemisAwardeesVariant: (options: ArtemisAwardeeQueryKeyOptions = {}) => {
    const normalized = normalizeArtemisAwardeeQueryOptions(options);
    return ['artemis-awardees', normalized.q, normalized.limit] as const;
  },
  artemisAwardeeDetail: (slug: string) => ['artemis-awardee-detail', normalizeToken(slug)] as const,
  artemisContent: ['artemis-content'] as const,
  artemisContentVariant: (options: ArtemisContentQueryKeyOptions = {}) => {
    const normalized = normalizeArtemisContentQueryOptions(options);
    return ['artemis-content', normalized.mission, normalized.kind, normalized.tier, normalized.cursor, normalized.limit] as const;
  },
  newsStream: ['news-stream'] as const,
  newsStreamVariant: (options: NewsStreamQueryKeyOptions = {}) => {
    const normalized = normalizeNewsStreamQueryOptions(options);
    return ['news-stream', normalized.type, normalized.provider, normalized.cursor, normalized.limit] as const;
  },
  canonicalContracts: ['canonical-contracts'] as const,
  canonicalContractsVariant: (options: CanonicalContractsQueryKeyOptions = {}) => {
    const normalized = normalizeCanonicalContractsQueryOptions(options);
    return ['canonical-contracts', normalized.q, normalized.scope] as const;
  },
  canonicalContractDetail: (contractUid: string) => ['canonical-contract-detail', normalizeToken(contractUid)] as const,
  satellites: ['satellites'] as const,
  satellitesVariant: (options: SatellitesQueryKeyOptions = {}) => {
    const normalized = normalizeSatellitesQueryOptions(options);
    return ['satellites', normalized.limit, normalized.offset] as const;
  },
  satelliteDetail: (noradCatId: string | number) => ['satellite-detail', String(noradCatId)] as const,
  satelliteOwners: ['satellite-owners'] as const,
  satelliteOwnersVariant: (options: SatelliteOwnersQueryKeyOptions = {}) => {
    const normalized = normalizeSatelliteOwnersQueryOptions(options);
    return ['satellite-owners', normalized.limit, normalized.offset] as const;
  },
  satelliteOwnerProfile: (owner: string) => ['satellite-owner-profile', normalizeToken(owner)] as const,
  infoHub: ['info-hub'] as const,
  contentPage: (slug: string) => ['content-page', normalizeToken(slug)] as const,
  catalogHub: ['catalog-hub'] as const,
  catalogCollection: (entity: string, options: CatalogCollectionQueryKeyOptions = {}) => {
    const normalized = normalizeCatalogCollectionQueryOptions(options);
    return ['catalog-collection', normalizeToken(entity), normalized.region, normalized.q, normalized.limit, normalized.offset] as const;
  },
  catalogDetail: (entity: string, entityId: string) => ['catalog-detail', normalizeToken(entity), normalizeToken(entityId)] as const,
  providerDetail: (slug: string) => ['provider-detail', normalizeToken(slug)] as const,
  rocketDetail: (id: string) => ['rocket-detail', normalizeToken(id)] as const,
  locationDetail: (id: string) => ['location-detail', normalizeToken(id)] as const,
  padDetail: (id: string) => ['pad-detail', normalizeToken(id)] as const,
  search: (query: string, options: SearchQueryKeyOptions = {}) =>
    ['search', normalizeSearchQuery(query), options.limit ?? null, normalizeSearchTypes(options.types).join(',')] as const,
  profile: ['profile'] as const,
  privacyPreferences: ['privacy-preferences'] as const,
  accountExport: ['account-export'] as const,
  billingSummary: ['billing-summary'] as const,
  billingSummaryVariant: (viewerId: string | null | undefined) => ['billing-summary', normalizeToken(viewerId)] as const,
  billingCatalog: (options: BillingCatalogQueryKeyOptions) => ['billing-catalog', options.platform] as const,
  marketingEmail: ['marketing-email'] as const,
  watchlists: ['watchlists'] as const,
  filterPresets: ['filter-presets'] as const,
  alertRules: ['alert-rules'] as const,
  calendarFeeds: ['calendar-feeds'] as const,
  rssFeeds: ['rss-feeds'] as const,
  embedWidgets: ['embed-widgets'] as const,
  notificationPreferences: ['notification-preferences'] as const,
  launchNotificationPreference: (launchId: string, channel: 'sms' | 'push' = 'push') =>
    ['launch-notification-preference', launchId, channel] as const,
  pushDevice: (installationId: string) => ['push-device', installationId] as const,
  mobilePushRules: (installationId: string) => ['mobile-push-rules', installationId] as const,
  mobilePushLaunchPreference: (launchId: string, installationId: string) =>
    ['mobile-push-launch-preference', launchId, installationId] as const
};

export const sharedQueryStaleTimes = {
  viewerSession: 60_000,
  entitlements: 60_000,
  launchFeed: 30_000,
  launchFilterOptions: 300_000,
  launchFeedVersion: 0,
  changedLaunches: 15_000,
  launchDetail: 30_000,
  launchDetailVersion: 0,
  launchTrajectory: 30_000,
  blueOriginOverview: 120_000,
  blueOriginMissionOverview: 120_000,
  blueOriginFlights: 300_000,
  blueOriginTravelers: 300_000,
  blueOriginVehicles: 300_000,
  blueOriginEngines: 300_000,
  blueOriginContracts: 300_000,
  spaceXOverview: 120_000,
  spaceXMissionOverview: 120_000,
  spaceXFlights: 300_000,
  spaceXVehicles: 300_000,
  spaceXEngines: 300_000,
  spaceXContracts: 300_000,
  artemisOverview: 120_000,
  artemisMissionOverview: 120_000,
  artemisContracts: 300_000,
  artemisContractDetail: 300_000,
  artemisAwardees: 300_000,
  artemisAwardeeDetail: 300_000,
  artemisContent: 120_000,
  newsStream: 120_000,
  canonicalContracts: 300_000,
  canonicalContractDetail: 300_000,
  satellites: 300_000,
  satelliteDetail: 300_000,
  satelliteOwners: 300_000,
  satelliteOwnerProfile: 300_000,
  infoHub: 300_000,
  contentPage: 300_000,
  catalogHub: 300_000,
  catalogCollection: 300_000,
  catalogDetail: 300_000,
  providerDetail: 300_000,
  rocketDetail: 300_000,
  locationDetail: 300_000,
  padDetail: 300_000,
  search: 15_000,
  profile: 60_000,
  privacyPreferences: 30_000,
  accountExport: 0,
  billingSummary: 30_000,
  billingCatalog: 300_000,
  marketingEmail: 60_000,
  watchlists: 60_000,
  filterPresets: 60_000,
  alertRules: 60_000,
  calendarFeeds: 60_000,
  rssFeeds: 60_000,
  embedWidgets: 60_000,
  notificationPreferences: 30_000,
  launchNotificationPreference: 30_000,
  pushDevice: 60_000,
  mobilePushRules: 30_000,
  mobilePushLaunchPreference: 30_000
} as const;

type QueryLoader<T> = () => Promise<T>;

export function normalizeSearchQuery(query: string) {
  return query.trim();
}

export function viewerSessionQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.viewerSession,
    queryFn,
    staleTime: sharedQueryStaleTimes.viewerSession
  });
}

export function viewerEntitlementsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.entitlements,
    queryFn,
    staleTime: sharedQueryStaleTimes.entitlements
  });
}

export function launchFeedQueryOptions<T>(queryFn: QueryLoader<T>, options: LaunchFeedQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchFeedVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchFeed
  });
}

export function launchFilterOptionsQueryOptions<T>(
  queryFn: QueryLoader<T>,
  options: LaunchFilterOptionsQueryKeyOptions = {}
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchFilterOptionsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchFilterOptions
  });
}

export function launchFeedVersionQueryOptions<T>(
  queryFn: QueryLoader<T>,
  options: LaunchFeedVersionQueryKeyOptions = {}
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchFeedVersionVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchFeedVersion
  });
}

export function changedLaunchesQueryOptions<T>(queryFn: QueryLoader<T>, options: ChangedLaunchesQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.changedLaunchesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.changedLaunches
  });
}

export function launchDetailQueryOptions<T>(launchId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchDetail(launchId),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchDetail
  });
}

export function launchDetailVersionQueryOptions<T>(
  launchId: string,
  queryFn: QueryLoader<T>,
  options: LaunchDetailVersionQueryKeyOptions = {}
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchDetailVersion(launchId, options),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchDetailVersion
  });
}

export function launchTrajectoryQueryOptions<T>(launchId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchTrajectory(launchId),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchTrajectory
  });
}

export function blueOriginOverviewQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginOverview,
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginOverview
  });
}

export function blueOriginMissionOverviewQueryOptions<T>(mission: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginMissionOverview(mission),
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginMissionOverview
  });
}

export function blueOriginFlightsQueryOptions<T>(queryFn: QueryLoader<T>, options: BlueOriginMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginFlightsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginFlights
  });
}

export function blueOriginTravelersQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginTravelers,
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginTravelers
  });
}

export function blueOriginVehiclesQueryOptions<T>(queryFn: QueryLoader<T>, options: BlueOriginMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginVehiclesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginVehicles
  });
}

export function blueOriginEnginesQueryOptions<T>(queryFn: QueryLoader<T>, options: BlueOriginMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginEnginesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginEngines
  });
}

export function blueOriginContractsQueryOptions<T>(queryFn: QueryLoader<T>, options: BlueOriginMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.blueOriginContractsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.blueOriginContracts
  });
}

export function spaceXOverviewQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXOverview,
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXOverview
  });
}

export function spaceXMissionOverviewQueryOptions<T>(mission: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXMissionOverview(mission),
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXMissionOverview
  });
}

export function spaceXFlightsQueryOptions<T>(queryFn: QueryLoader<T>, options: SpaceXMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXFlightsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXFlights
  });
}

export function spaceXVehiclesQueryOptions<T>(queryFn: QueryLoader<T>, options: SpaceXMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXVehiclesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXVehicles
  });
}

export function spaceXEnginesQueryOptions<T>(queryFn: QueryLoader<T>, options: SpaceXMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXEnginesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXEngines
  });
}

export function spaceXContractsQueryOptions<T>(queryFn: QueryLoader<T>, options: SpaceXMissionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.spaceXContractsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.spaceXContracts
  });
}

export function artemisOverviewQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisOverview,
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisOverview
  });
}

export function artemisMissionOverviewQueryOptions<T>(mission: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisMissionOverview(mission),
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisMissionOverview
  });
}

export function artemisContractsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisContracts,
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisContracts
  });
}

export function artemisContractDetailQueryOptions<T>(piid: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisContractDetail(piid),
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisContractDetail
  });
}

export function artemisAwardeesQueryOptions<T>(queryFn: QueryLoader<T>, options: ArtemisAwardeeQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisAwardeesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisAwardees
  });
}

export function artemisAwardeeDetailQueryOptions<T>(slug: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisAwardeeDetail(slug),
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisAwardeeDetail
  });
}

export function artemisContentQueryOptions<T>(queryFn: QueryLoader<T>, options: ArtemisContentQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.artemisContentVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.artemisContent
  });
}

export function newsStreamQueryOptions<T>(queryFn: QueryLoader<T>, options: NewsStreamQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.newsStreamVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.newsStream
  });
}

export function canonicalContractsQueryOptions<T>(queryFn: QueryLoader<T>, options: CanonicalContractsQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.canonicalContractsVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.canonicalContracts
  });
}

export function canonicalContractDetailQueryOptions<T>(contractUid: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.canonicalContractDetail(contractUid),
    queryFn,
    staleTime: sharedQueryStaleTimes.canonicalContractDetail
  });
}

export function satellitesQueryOptions<T>(queryFn: QueryLoader<T>, options: SatellitesQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.satellitesVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.satellites
  });
}

export function satelliteDetailQueryOptions<T>(noradCatId: string | number, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.satelliteDetail(noradCatId),
    queryFn,
    staleTime: sharedQueryStaleTimes.satelliteDetail
  });
}

export function satelliteOwnersQueryOptions<T>(queryFn: QueryLoader<T>, options: SatelliteOwnersQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.satelliteOwnersVariant(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.satelliteOwners
  });
}

export function satelliteOwnerProfileQueryOptions<T>(owner: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.satelliteOwnerProfile(owner),
    queryFn,
    staleTime: sharedQueryStaleTimes.satelliteOwnerProfile
  });
}

export function infoHubQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.infoHub,
    queryFn,
    staleTime: sharedQueryStaleTimes.infoHub
  });
}

export function contentPageQueryOptions<T>(slug: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.contentPage(slug),
    queryFn,
    staleTime: sharedQueryStaleTimes.contentPage
  });
}

export function catalogHubQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.catalogHub,
    queryFn,
    staleTime: sharedQueryStaleTimes.catalogHub
  });
}

export function catalogCollectionQueryOptions<T>(entity: string, queryFn: QueryLoader<T>, options: CatalogCollectionQueryKeyOptions = {}) {
  return queryOptions({
    queryKey: sharedQueryKeys.catalogCollection(entity, options),
    queryFn,
    staleTime: sharedQueryStaleTimes.catalogCollection
  });
}

export function catalogDetailQueryOptions<T>(entity: string, entityId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.catalogDetail(entity, entityId),
    queryFn,
    staleTime: sharedQueryStaleTimes.catalogDetail
  });
}

export function providerDetailQueryOptions<T>(slug: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.providerDetail(slug),
    queryFn,
    staleTime: sharedQueryStaleTimes.providerDetail
  });
}

export function rocketDetailQueryOptions<T>(id: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.rocketDetail(id),
    queryFn,
    staleTime: sharedQueryStaleTimes.rocketDetail
  });
}

export function locationDetailQueryOptions<T>(id: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.locationDetail(id),
    queryFn,
    staleTime: sharedQueryStaleTimes.locationDetail
  });
}

export function padDetailQueryOptions<T>(id: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.padDetail(id),
    queryFn,
    staleTime: sharedQueryStaleTimes.padDetail
  });
}

export function searchQueryOptions<T>(query: string, queryFn: QueryLoader<T>, options: SearchQueryKeyOptions = {}) {
  const normalized = normalizeSearchQuery(query);

  return queryOptions({
    queryKey: sharedQueryKeys.search(normalized, options),
    queryFn,
    staleTime: sharedQueryStaleTimes.search
  });
}

export function profileQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.profile,
    queryFn,
    staleTime: sharedQueryStaleTimes.profile
  });
}

export function privacyPreferencesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.privacyPreferences,
    queryFn,
    staleTime: sharedQueryStaleTimes.privacyPreferences
  });
}

export function accountExportQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.accountExport,
    queryFn,
    staleTime: sharedQueryStaleTimes.accountExport
  });
}

export function billingSummaryQueryOptions<T>(queryFn: QueryLoader<T>, viewerId?: string | null) {
  return queryOptions({
    queryKey: sharedQueryKeys.billingSummaryVariant(viewerId),
    queryFn,
    staleTime: sharedQueryStaleTimes.billingSummary
  });
}

export function billingCatalogQueryOptions<T>(queryFn: QueryLoader<T>, options: BillingCatalogQueryKeyOptions) {
  return queryOptions({
    queryKey: sharedQueryKeys.billingCatalog(options),
    queryFn,
    staleTime: sharedQueryStaleTimes.billingCatalog
  });
}

export function marketingEmailQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.marketingEmail,
    queryFn,
    staleTime: sharedQueryStaleTimes.marketingEmail
  });
}

export function watchlistsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.watchlists,
    queryFn,
    staleTime: sharedQueryStaleTimes.watchlists
  });
}

export function filterPresetsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.filterPresets,
    queryFn,
    staleTime: sharedQueryStaleTimes.filterPresets
  });
}

export function alertRulesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.alertRules,
    queryFn,
    staleTime: sharedQueryStaleTimes.alertRules
  });
}

export function calendarFeedsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.calendarFeeds,
    queryFn,
    staleTime: sharedQueryStaleTimes.calendarFeeds
  });
}

export function rssFeedsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.rssFeeds,
    queryFn,
    staleTime: sharedQueryStaleTimes.rssFeeds
  });
}

export function embedWidgetsQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.embedWidgets,
    queryFn,
    staleTime: sharedQueryStaleTimes.embedWidgets
  });
}

export function notificationPreferencesQueryOptions<T>(queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.notificationPreferences,
    queryFn,
    staleTime: sharedQueryStaleTimes.notificationPreferences
  });
}

export function launchNotificationPreferenceQueryOptions<T>(
  launchId: string,
  channel: 'sms' | 'push',
  queryFn: QueryLoader<T>
) {
  return queryOptions({
    queryKey: sharedQueryKeys.launchNotificationPreference(launchId, channel),
    queryFn,
    staleTime: sharedQueryStaleTimes.launchNotificationPreference
  });
}

export function mobilePushRulesQueryOptions<T>(installationId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.mobilePushRules(installationId),
    queryFn,
    staleTime: sharedQueryStaleTimes.mobilePushRules
  });
}

export function mobilePushLaunchPreferenceQueryOptions<T>(launchId: string, installationId: string, queryFn: QueryLoader<T>) {
  return queryOptions({
    queryKey: sharedQueryKeys.mobilePushLaunchPreference(launchId, installationId),
    queryFn,
    staleTime: sharedQueryStaleTimes.mobilePushLaunchPreference
  });
}

export function createSharedQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false
      }
    }
  });
}
