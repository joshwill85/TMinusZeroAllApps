import type { LaunchFeedItemV1 } from '@tminuszero/contracts';

export type FeedLaunchCardData = {
  id: string;
  ll2PadId?: number | null;
  ll2RocketConfigId?: number | null;
  name: string;
  provider: string;
  providerLogoUrl?: string;
  vehicle: string;
  firstStageBooster?: string | null;
  net: string;
  netPrecision: LaunchFeedItemV1['netPrecision'];
  windowStart?: string;
  windowEnd?: string;
  image?: {
    thumbnail?: string;
    full?: string;
  } | null;
  pad: {
    name: string;
    shortCode?: string;
    locationName?: string;
    state?: string;
  };
  rocket?: {
    fullName?: string;
  };
  mission?: {
    orbit?: string;
    type?: string;
  };
  payloads?: Array<{
    orbit?: string;
  }>;
  status: LaunchFeedItemV1['status'];
  statusText: string;
  featured?: boolean;
  webcastLive?: boolean;
  videoUrl?: string;
  launchVidUrls?: Array<{
    url?: string;
  }>;
  launchInfoUrls?: Array<{
    url?: string;
  }>;
  weatherConcerns?: string[];
  currentEvent?: {
    name?: string;
    date?: string | null;
  };
  nextEvent?: {
    name?: string;
    date?: string | null;
  };
  changeSummary?: string;
};

export function toFeedLaunchCardData(launch: LaunchFeedItemV1): FeedLaunchCardData {
  return {
    id: launch.id,
    ll2PadId: launch.ll2PadId ?? null,
    ll2RocketConfigId: launch.ll2RocketConfigId ?? null,
    name: launch.name,
    provider: launch.provider,
    providerLogoUrl: launch.providerLogoUrl,
    vehicle: launch.vehicle,
    firstStageBooster: launch.firstStageBooster ?? null,
    net: launch.net,
    netPrecision: launch.netPrecision,
    windowStart: launch.windowStart,
    windowEnd: launch.windowEnd,
    image: launch.image
      ? {
          thumbnail: launch.image.thumbnail,
          full: launch.image.full
        }
      : null,
    pad: {
      name: launch.pad.name,
      shortCode: launch.pad.shortCode,
      locationName: launch.pad.locationName,
      state: launch.pad.state
    },
    rocket: launch.rocket
      ? {
          fullName: launch.rocket.fullName
        }
      : undefined,
    mission: launch.mission
      ? {
          orbit: launch.mission.orbit,
          type: launch.mission.type
        }
      : undefined,
    payloads: launch.payloads?.map((payload) => ({
      orbit: payload.orbit
    })),
    status: launch.status,
    statusText: launch.statusText,
    featured: launch.featured,
    webcastLive: launch.webcastLive,
    videoUrl: launch.videoUrl,
    launchVidUrls: launch.launchVidUrls?.map((item) => ({
      url: item.url
    })),
    launchInfoUrls: launch.launchInfoUrls?.map((item) => ({
      url: item.url
    })),
    weatherConcerns: launch.weatherConcerns,
    currentEvent: launch.currentEvent
      ? {
          name: launch.currentEvent.name,
          date: launch.currentEvent.date
        }
      : undefined,
    nextEvent: launch.nextEvent
      ? {
          name: launch.nextEvent.name,
          date: launch.nextEvent.date
        }
      : undefined,
    changeSummary: launch.changeSummary
  };
}
