import type { LaunchDetailV1 } from '@tminuszero/contracts';
import {
  getLaunchCrew,
  getLaunchData,
  getLaunchEvents,
  getLaunchLocation,
  getLaunchMedia,
  getLaunchMissionDescription,
  getLaunchMissionStats,
  getLaunchMissionName,
  getLaunchNews,
  getLaunchObjectInventory,
  getLaunchOrbit,
  getLaunchPadName,
  getLaunchPayloadManifest,
  getLaunchPrograms,
  getLaunchRecovery,
  getLaunchResourceLinks,
  getLaunchSocialPosts,
  getLaunchUpdates,
  getLaunchVehicleTimeline,
  getLaunchVehicle,
  getLaunchWatchLinks,
  getLaunchWeatherSummary,
  type LaunchCrewSummary,
  type LaunchEventSummary,
  type LaunchMediaItem,
  type LaunchMissionStatsSummary,
  type LaunchNewsSummary,
  type LaunchObjectInventorySummary,
  type LaunchPayloadSummary,
  type LaunchProgramSummary,
  type LaunchRecoverySummary,
  type LaunchResourceLinks,
  type LaunchSocialPostSummary,
  type LaunchUpdateSummary,
  type LaunchVehicleTimelineSummary,
  type LaunchWatchLinkSummary
} from './detailModel';

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
    programs: LaunchProgramSummary[];
  };
  weather: {
    summary: string | null;
    concerns: string[];
  };
}

export interface LiveTabData {
  launchId: string;
  padTimezone: string;
  hasJepScore: boolean;
  webcastEmbed: {
    url: string | null;
    isLive: boolean;
  };
  watchLinks: LaunchWatchLinkSummary[];
  socialPosts: LaunchSocialPostSummary[];
  launchUpdates: LaunchUpdateSummary[];
  weatherDetail: LaunchDetailV1['weather'] | null;
  faaAdvisories: NonNullable<LaunchDetailV1['enrichment']>['faaAdvisories'];
  jepScore: number | null;
}

export interface MissionTabData {
  missionOverview: {
    description: string | null;
    objectives: string | null;
    customer: string | null;
  };
  payloadManifest: LaunchPayloadSummary[];
  objectInventory: LaunchObjectInventorySummary | null;
  crew: LaunchCrewSummary[];
  blueOriginDetails: {
    travelers: Array<{ name: string }>;
    payloadNotes: string | null;
  } | null;
  programs: LaunchProgramSummary[];
}

export interface VehicleTabData {
  vehicleConfig: {
    family: string | null;
    variant: string | null;
    manufacturer: string | null;
    specs: {
      length: number | null;
      diameter: number | null;
      leoCapacity: number | null;
      gtoCapacity: number | null;
    };
  };
  stages: Array<{
    name: string;
    serialNumber: string | null;
    reused: boolean;
    previousFlights: number;
    engine: string | null;
    fuel: string | null;
  }>;
  recovery: LaunchRecoverySummary | null;
  missionStats: LaunchMissionStatsSummary | null;
}

export interface RelatedTabData {
  news: LaunchNewsSummary[];
  events: LaunchEventSummary[];
  media: LaunchMediaItem[];
  resources: LaunchResourceLinks | null;
  vehicleTimeline: LaunchVehicleTimelineSummary[];
}

export function extractOverviewData(detail: LaunchDetailV1): OverviewTabData {
  const launch = getLaunchData(detail);
  const rocket = launch?.rocket;

  return {
    missionBrief: {
      name: getLaunchMissionName(detail),
      description: getLaunchMissionDescription(detail),
      objectives: null
    },
    quickStats: buildQuickStats(detail),
    rocketProfile: {
      name: getLaunchVehicle(detail) ?? launch?.rocketName ?? null,
      variant: rocket?.variant ?? null,
      manufacturer: rocket?.manufacturer ?? null,
      image: rocket?.imageUrl ?? launch?.image?.full ?? launch?.image?.thumbnail ?? detail.launch.imageUrl ?? null,
      specs: {
        reusable: rocket?.reusable ?? null,
        length: rocket?.lengthM ?? null,
        diameter: rocket?.diameterM ?? null,
        maidenFlight: rocket?.maidenFlight ?? null
      }
    },
    launchInfo: {
      provider: launch?.provider ?? detail.launch.provider ?? null,
      vehicle: getLaunchVehicle(detail),
      pad: getLaunchPadName(detail),
      location: getLaunchLocation(detail),
      windowStart: launch?.windowStart ?? detail.launch.windowStart ?? null,
      windowEnd: launch?.windowEnd ?? detail.launch.windowEnd ?? null,
      orbit: getLaunchOrbit(detail),
      programs: getLaunchPrograms(detail)
    },
    weather: {
      summary: getLaunchWeatherSummary(detail),
      concerns: detail.weather?.concerns ?? []
    }
  };
}

export function extractLiveData(detail: LaunchDetailV1): LiveTabData {
  const launch = getLaunchData(detail);
  const watchLinks = getLaunchWatchLinks(detail);

  return {
    launchId: detail.launch.id,
    padTimezone: launch?.pad?.timezone ?? 'UTC',
    hasJepScore: detail.enrichment.hasJepScore,
    webcastEmbed: {
      url: watchLinks[0]?.url ?? null,
      isLive: Boolean(getLaunchData(detail)?.webcastLive)
    },
    watchLinks,
    socialPosts: getLaunchSocialPosts(detail),
    launchUpdates: getLaunchUpdates(detail),
    weatherDetail: detail.weather ?? null,
    faaAdvisories: detail.enrichment?.faaAdvisories ?? [],
    jepScore: null
  };
}

export function extractMissionData(detail: LaunchDetailV1): MissionTabData {
  const launch = getLaunchData(detail);
  const payloadNotes = detail.blueOrigin?.payloadNotes?.map((note) => `${note.name}: ${note.description}`).join('\n\n') ?? null;

  return {
    missionOverview: {
      description: getLaunchMissionDescription(detail),
      objectives: null,
      customer: launch?.mission?.agencies?.[0]?.name ?? null
    },
    payloadManifest: getLaunchPayloadManifest(detail),
    objectInventory: getLaunchObjectInventory(detail),
    crew: getLaunchCrew(detail),
    blueOriginDetails: detail.blueOrigin
      ? {
          travelers: detail.blueOrigin.travelerProfiles.map((traveler) => ({ name: traveler.name })),
          payloadNotes
        }
      : null,
    programs: getLaunchPrograms(detail)
  };
}

export function extractVehicleData(detail: LaunchDetailV1): VehicleTabData {
  const launch = getLaunchData(detail);
  const rocket = launch?.rocket;

  return {
    vehicleConfig: {
      family: rocket?.family ?? getLaunchVehicle(detail),
      variant: rocket?.variant ?? null,
      manufacturer: rocket?.manufacturer ?? null,
      specs: {
        length: rocket?.lengthM ?? null,
        diameter: rocket?.diameterM ?? null,
        leoCapacity: rocket?.leoCapacity ?? null,
        gtoCapacity: rocket?.gtoCapacity ?? null
      }
    },
    stages: (detail.enrichment?.firstStages ?? []).map((stage) => ({
      name: stage.title,
      serialNumber: stage.serialNumber ?? null,
      reused: typeof stage.totalMissions === 'number' ? stage.totalMissions > 1 : false,
      previousFlights: typeof stage.totalMissions === 'number' ? Math.max(stage.totalMissions - 1, 0) : 0,
      engine: null,
      fuel: null
    })),
    recovery: getLaunchRecovery(detail),
    missionStats: getLaunchMissionStats(detail)
  };
}

export function extractRelatedData(detail: LaunchDetailV1): RelatedTabData {
  return {
    news: getLaunchNews(detail),
    events: getLaunchEvents(detail),
    media: getLaunchMedia(detail),
    resources: getLaunchResourceLinks(detail),
    vehicleTimeline: getLaunchVehicleTimeline(detail)
  };
}

function buildQuickStats(detail: LaunchDetailV1): Array<{ label: string; value: string | number; icon?: string }> {
  const launch = getLaunchData(detail);
  const stats: Array<{ label: string; value: string | number; icon?: string }> = [];

  if (launch?.provider ?? detail.launch.provider) {
    stats.push({ label: 'Provider', value: launch?.provider ?? detail.launch.provider ?? 'Unknown', icon: 'Provider' });
  }

  const vehicle = getLaunchVehicle(detail);
  if (vehicle) {
    stats.push({ label: 'Vehicle', value: vehicle, icon: 'Vehicle' });
  }

  const orbit = getLaunchOrbit(detail);
  if (orbit) {
    stats.push({ label: 'Orbit', value: orbit, icon: 'Orbit' });
  }

  const location = getLaunchLocation(detail);
  if (location) {
    stats.push({ label: 'Location', value: location, icon: 'Pad' });
  }

  return stats;
}
