export type LaunchTier = 'major' | 'notable' | 'routine';
export type LaunchStatus = 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown';

export type LaunchInfoUrl = {
  url: string;
  title?: string;
  description?: string;
  source?: string;
  feature_image?: string;
  type?: { id?: number; name?: string };
  language?: { id?: number; name?: string; code?: string };
};

export type LaunchVidUrl = {
  url: string;
  title?: string;
  description?: string;
  source?: string;
  publisher?: string;
  feature_image?: string;
  type?: { id?: number; name?: string };
  language?: { id?: number; name?: string; code?: string };
  start_time?: string;
  end_time?: string;
  priority?: number;
};

export type LaunchTimelineEvent = {
  type?: { id?: number; abbrev?: string; description?: string };
  relative_time?: string;
};

export type LaunchUpdate = {
  id?: number;
  comment?: string;
  info_url?: string;
  created_by?: string;
  created_on?: string;
  profile_image?: string;
};

export type MissionPatch = {
  id?: number;
  name?: string;
  priority?: number;
  image_url?: string;
  agency?: { id?: number; name?: string; abbrev?: string; type?: { id?: number; name?: string } | string };
};

export type LaunchStageKind = 'launcher_stage' | 'spacecraft_stage';
export type LaunchStageSource = 'll2' | 'spacex_content';
export type LaunchRecoveryRole = 'booster' | 'spacecraft' | 'unknown';
export type LaunchExternalContentSource = 'spacex_content' | string;
export type LaunchExternalResourceKind =
  | 'page'
  | 'infographic'
  | 'image'
  | 'video'
  | 'webcast'
  | 'document'
  | 'timeline'
  | 'resource';

export type LaunchStageSummary = {
  id: string;
  kind: LaunchStageKind;
  title: string;
  serialNumber?: string | null;
  status?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  launcherConfigId?: number | null;
  totalMissions?: number | null;
  trackedMissions?: number | null;
  missionsThisYear?: number | null;
  lastMissionNet?: string | null;
  firstLaunchDate?: string | null;
  lastLaunchDate?: string | null;
  source: LaunchStageSource;
};

export type LaunchRecoveryDetail = {
  id: string;
  role: LaunchRecoveryRole;
  source: 'll2' | 'spacex_content';
  sourceId?: string | null;
  title?: string | null;
  attempt?: boolean | null;
  success?: boolean | null;
  description?: string | null;
  downrangeDistanceKm?: number | null;
  landingLocationName?: string | null;
  landingLocationAbbrev?: string | null;
  landingLocationContext?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  landingTypeName?: string | null;
  landingTypeAbbrev?: string | null;
  returnSite?: string | null;
  returnDateTime?: string | null;
  fetchedAt?: string | null;
};

export type LaunchExternalResource = {
  id: string;
  kind: LaunchExternalResourceKind;
  label: string;
  url: string;
  previewUrl?: string | null;
  mime?: string | null;
  width?: number | null;
  height?: number | null;
  source: 'spacex_content';
  sourceId?: string | null;
};

export type LaunchTimelineResourceEvent = {
  id: string;
  label: string;
  time?: string | null;
  description?: string | null;
  kind?: string | null;
  phase?: 'prelaunch' | 'postlaunch' | 'timeline' | null;
};

export type LaunchExternalContent = {
  id: string;
  source: LaunchExternalContentSource;
  contentType: string;
  sourceId: string;
  title?: string | null;
  launchPageUrl?: string | null;
  confidence?: number | null;
  fetchedAt?: string | null;
  returnSite?: string | null;
  returnDateTime?: string | null;
  resources: LaunchExternalResource[];
  timelineEvents?: LaunchTimelineResourceEvent[];
};

export type LaunchDetailEnrichment = {
  firstStages: LaunchStageSummary[];
  recovery: LaunchRecoveryDetail[];
  externalContent: LaunchExternalContent[];
};

export type LaunchRelatedEvent = {
  id: number;
  name: string;
  date?: string | null;
  datePrecision?: string | null;
  typeName?: string | null;
  url?: string | null;
};

export type Launch = {
  id: string;
  name: string;
  ll2Id: string;
  ll2AgencyId?: number | null;
  ll2PadId?: number | null;
  ll2RocketConfigId?: number | null;
  cacheGeneratedAt?: string;
  slug?: string;
  launchDesignator?: string;
  agencyLaunchAttemptCount?: number;
  agencyLaunchAttemptCountYear?: number;
  locationLaunchAttemptCount?: number;
  locationLaunchAttemptCountYear?: number;
  orbitalLaunchAttemptCount?: number;
  orbitalLaunchAttemptCountYear?: number;
  padLaunchAttemptCount?: number;
  padLaunchAttemptCountYear?: number;
  padTurnaround?: string;
  provider: string;
  providerType?: string;
  providerCountryCode?: string;
  providerDescription?: string;
  providerLogoUrl?: string;
  providerImageUrl?: string;
  vehicle: string;
  firstStageBooster?: string | null;
  rocket?: {
    fullName?: string;
    family?: string;
    description?: string;
    manufacturer?: string;
    manufacturerLogoUrl?: string;
    manufacturerImageUrl?: string;
    imageUrl?: string;
    variant?: string;
    lengthM?: number;
    diameterM?: number;
    reusable?: boolean;
    maidenFlight?: string;
    leoCapacity?: number;
    gtoCapacity?: number;
    launchMass?: number;
    launchCost?: string;
    infoUrl?: string;
    wikiUrl?: string;
  };
  mission?: {
    name?: string;
    type?: string;
    description?: string;
    orbit?: string;
    infoUrls?: LaunchInfoUrl[];
    vidUrls?: LaunchVidUrl[];
    agencies?: Array<{
      id?: number;
      name?: string;
      type?: string;
      country_code?: string;
      logoUrl?: string;
      imageUrl?: string;
    }>;
  };
  pad: {
    name: string;
    shortCode: string;
    state: string;
    timezone: string;
    locationName?: string;
    countryCode?: string;
    mapUrl?: string | null;
    latitude?: number;
    longitude?: number;
  };
  net: string; // ISO timestamp
  netPrecision: 'minute' | 'hour' | 'day' | 'month' | 'tbd';
  windowStart?: string;
  windowEnd?: string;
  webcastLive?: boolean;
  videoUrl?: string;
  image: {
    thumbnail: string;
    full?: string;
    credit?: string;
    license?: string;
    licenseUrl?: string;
    singleUse?: boolean;
  };
  tier: LaunchTier;
  status: LaunchStatus;
  statusText: string;
  featured?: boolean;
  hidden?: boolean;
  programs?: Array<{
    id?: number;
    name?: string;
    type?: string;
    description?: string;
    image_url?: string;
    info_url?: string;
    wiki_url?: string;
    start_date?: string;
    end_date?: string;
    agencies?: string[];
  }>;
  crew?: Array<{ role?: string; astronaut?: string; astronaut_id?: number | null; nationality?: string }>;
  payloads?: Array<{ name?: string; type?: string; orbit?: string; agency?: string }>;
  launchInfoUrls?: LaunchInfoUrl[];
  launchVidUrls?: LaunchVidUrl[];
  flightclubUrl?: string;
  hashtag?: string;
  probability?: number;
  weatherConcerns?: string[];
  weatherIconUrl?: string;
  holdReason?: string;
  failReason?: string;
  missionPatches?: MissionPatch[];
  updates?: LaunchUpdate[];
  timeline?: LaunchTimelineEvent[];
  currentEvent?: LaunchRelatedEvent;
  nextEvent?: LaunchRelatedEvent;
  lastUpdated?: string;
  updatedFields?: string[];
  changeSummary?: string;
  socialPrimaryPostId?: string;
  socialPrimaryPostUrl?: string;
  socialPrimaryPostPlatform?: 'x' | string;
  socialPrimaryPostHandle?: string;
  socialPrimaryPostMatchedAt?: string;
  socialPrimaryPostForDate?: string;
  spacexXPostId?: string;
  spacexXPostUrl?: string;
  spacexXPostCapturedAt?: string;
  spacexXPostForDate?: string;
};

export type LaunchFilter = {
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  region?: 'us' | 'non-us' | 'all';
  location?: string;
  state?: string;
  pad?: string;
  provider?: string;
  status?: LaunchStatus | 'all';
  sort?: 'soonest' | 'latest' | 'changed';
};

export type LaunchFilterOptions = {
  providers: string[];
  locations: string[];
  states: string[];
  pads: string[];
  statuses: string[];
};
