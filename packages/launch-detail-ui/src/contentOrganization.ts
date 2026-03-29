import type { LaunchDetailV1 } from '@tminuszero/contracts';

/**
 * Content organization helpers for each tab
 * These functions extract the relevant data for each tab from LaunchDetailV1
 */

export interface OverviewTabData {
  missionBrief: {
    name: string | null;
    description: string | null;
    objectives: string | null;
  };
  quickStats: Array<{
    label: string;
    value: string | number;
    icon?: string;
  }>;
  rocketProfile: {
    name: string | null;
    variant: string | null;
    manufacturer: string | null;
    image: string | null;
    specs: {
      reusable: boolean | null;
      length: number | null;
      diameter: number | null;
      maidenFlight: string | null;
    };
  };
  launchInfo: {
    provider: string | null;
    vehicle: string | null;
    pad: string | null;
    location: string | null;
    windowStart: string | null;
    windowEnd: string | null;
    orbit: string | null;
    programs: Array<{ id: number; name: string; description?: string }>;
  };
  weather: {
    summary: string | null;
    concerns: string[];
  };
}

export interface LiveTabData {
  webcastEmbed: {
    url: string | null;
    isLive: boolean;
  };
  watchLinks: Array<{
    title: string;
    url: string;
    image?: string;
  }>;
  socialPosts: Array<{
    id: string;
    platform: string;
    url: string;
  }>;
  launchUpdates: Array<{
    timestamp: string;
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }>;
  weatherDetail: any; // From weatherModule
  faaAdvisories: any[]; // From enrichment.faaAdvisories
  jepScore: number | null;
}

export interface MissionTabData {
  missionOverview: {
    description: string | null;
    objectives: string | null;
    customer: string | null;
  };
  payloadManifest: any[]; // From payloadManifest
  objectInventory: any; // From objectInventory
  crew: Array<{
    name: string;
    role: string;
    nationality: string;
  }>;
  blueOriginDetails: any; // From blueOrigin module
  programs: Array<{
    id: number;
    name: string;
    description?: string;
  }>;
}

export interface VehicleTabData {
  vehicleConfig: {
    family: string | null;
    variant: string | null;
    manufacturer: string | null;
    specs: Record<string, any>;
  };
  stages: any[]; // From enrichment.firstStages
  recovery: any; // From enrichment.recovery
  boosterHistory: any[]; // If booster is reused
  missionStats: any; // From missionStats
}

export interface RelatedTabData {
  news: Array<{
    title: string;
    summary: string;
    url: string;
    image?: string;
    source: string;
    date: string;
  }>;
  events: any[]; // From relatedEvents
  media: any[]; // From enrichment.externalContent
  resources: any[]; // From resources module
  vehicleTimeline: any[]; // Historical launches of same vehicle
}

/**
 * Extract Overview tab data from LaunchDetailV1
 */
export function extractOverviewData(detail: LaunchDetailV1): OverviewTabData {
  const launch = detail.launchData ?? detail.launch;
  const rocket = launch?.rocket;

  return {
    missionBrief: {
      name: launch?.mission?.name ?? launch?.name ?? null,
      description: launch?.mission?.description ?? launch?.missionSummary ?? null,
      objectives: null, // Not in current schema
    },
    quickStats: buildQuickStats(launch),
    rocketProfile: {
      name: launch?.vehicle ?? launch?.rocketName ?? null,
      variant: rocket?.variant ?? null,
      manufacturer: rocket?.manufacturer ?? null,
      image: launch?.image?.full ?? null,
      specs: {
        reusable: rocket?.reusable ?? null,
        length: rocket?.length ?? null,
        diameter: rocket?.diameter ?? null,
        maidenFlight: rocket?.maidenFlight ?? null,
      },
    },
    launchInfo: {
      provider: launch?.provider ?? null,
      vehicle: launch?.vehicle ?? null,
      pad: launch?.pad?.name ?? launch?.padName ?? null,
      location: launch?.pad?.location ?? launch?.padLocation ?? null,
      windowStart: launch?.windowStart ?? null,
      windowEnd: launch?.windowEnd ?? null,
      orbit: launch?.mission?.orbit ?? null,
      programs: launch?.programs ?? [],
    },
    weather: {
      summary: launch?.weatherSummary ?? null,
      concerns: [], // Extract from weatherModule
    },
  };
}

/**
 * Extract Live tab data from LaunchDetailV1
 */
export function extractLiveData(detail: LaunchDetailV1): LiveTabData {
  const launch = detail.launchData ?? detail.launch;
  const resources = detail.resources;

  return {
    webcastEmbed: {
      url: resources?.watchLinks?.[0]?.url ?? null,
      isLive: Boolean(launch?.webcastLive),
    },
    watchLinks: resources?.watchLinks ?? [],
    socialPosts: detail.social?.matchedPosts ?? [],
    launchUpdates: detail.launchUpdates ?? [],
    weatherDetail: detail.weather,
    faaAdvisories: detail.enrichment?.faaAdvisories ?? [],
    jepScore: null, // Computed separately
  };
}

/**
 * Extract Mission tab data from LaunchDetailV1
 */
export function extractMissionData(detail: LaunchDetailV1): MissionTabData {
  const launch = detail.launchData ?? detail.launch;

  return {
    missionOverview: {
      description: launch?.mission?.description ?? launch?.missionSummary ?? null,
      objectives: null,
      customer: launch?.mission?.agencies?.[0]?.name ?? null,
    },
    payloadManifest: detail.payloadManifest ?? [],
    objectInventory: detail.objectInventory ?? null,
    crew: launch?.crew ?? [],
    blueOriginDetails: detail.blueOrigin ?? null,
    programs: launch?.programs ?? [],
  };
}

/**
 * Extract Vehicle tab data from LaunchDetailV1
 */
export function extractVehicleData(detail: LaunchDetailV1): VehicleTabData {
  const launch = detail.launchData ?? detail.launch;
  const rocket = launch?.rocket;

  return {
    vehicleConfig: {
      family: rocket?.family ?? null,
      variant: rocket?.variant ?? null,
      manufacturer: rocket?.manufacturer ?? null,
      specs: rocket ?? {},
    },
    stages: detail.enrichment?.firstStages ?? [],
    recovery: detail.enrichment?.recovery ?? null,
    boosterHistory: [], // Would need to query separately
    missionStats: detail.missionStats ?? null,
  };
}

/**
 * Extract Related tab data from LaunchDetailV1
 */
export function extractRelatedData(detail: LaunchDetailV1): RelatedTabData {
  return {
    news: detail.relatedNews ?? [],
    events: detail.relatedEvents ?? [],
    media: detail.enrichment?.externalContent ?? [],
    resources: detail.resources ?? null,
    vehicleTimeline: [], // Would need to query separately
  };
}

/**
 * Helper to build quick stats from launch data
 */
function buildQuickStats(launch: any): Array<{ label: string; value: string | number; icon?: string }> {
  const stats: Array<{ label: string; value: string | number; icon?: string }> = [];

  if (launch?.provider) {
    stats.push({ label: 'Provider', value: launch.provider, icon: '🚀' });
  }

  if (launch?.vehicle) {
    stats.push({ label: 'Vehicle', value: launch.vehicle, icon: '🛸' });
  }

  if (launch?.mission?.orbit) {
    stats.push({ label: 'Orbit', value: launch.mission.orbit, icon: '🌍' });
  }

  if (launch?.pad?.location) {
    stats.push({ label: 'Location', value: launch.pad.location, icon: '📍' });
  }

  return stats;
}
