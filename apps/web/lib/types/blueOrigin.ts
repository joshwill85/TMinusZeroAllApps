import type { Launch } from '@/lib/types/launch';
import type { BlueOriginMissionKey } from '@/lib/utils/blueOrigin';

export type BlueOriginFaqItem = {
  question: string;
  answer: string;
};

export type BlueOriginChangeItem = {
  title: string;
  summary: string;
  date: string;
  href?: string;
};

export type BlueOriginProgramSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  faq: BlueOriginFaqItem[];
};

export type BlueOriginMissionSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  missionKey: BlueOriginMissionKey;
  missionName: string;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  highlights: string[];
  changes: BlueOriginChangeItem[];
  faq: BlueOriginFaqItem[];
};

export type BlueOriginFlightSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  missionKey: BlueOriginMissionKey;
  missionName: string;
  flightCode: string;
  flightSlug: string;
  nextLaunch: Launch | null;
  launch: Launch | null;
  recent: Launch[];
  highlights: string[];
  faq: BlueOriginFaqItem[];
};

export type BlueOriginPassenger = {
  id: string;
  missionKey: BlueOriginMissionKey;
  flightCode: string | null;
  flightSlug: string | null;
  travelerSlug?: string | null;
  seatIndex?: number | null;
  name: string;
  role: string | null;
  nationality: string | null;
  launchId: string | null;
  launchName: string | null;
  launchDate: string | null;
  profileUrl?: string | null;
  imageUrl?: string | null;
  bio?: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginTravelerProfile = {
  id: string;
  travelerSlug: string;
  canonicalName: string;
  bioShort: string | null;
  primaryImageUrl: string | null;
  primaryProfileUrl: string | null;
  nationality: string | null;
  sourceConfidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginTravelerSource = {
  id: string;
  sourceKey: string;
  travelerSlug: string;
  launchId: string | null;
  flightCode: string | null;
  sourceType: string;
  sourceUrl: string | null;
  sourceDocumentId: string | null;
  profileUrl: string | null;
  imageUrl: string | null;
  bioFull: string | null;
  bioExcerpt: string | null;
  attribution: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  contentSha256: string | null;
  capturedAt: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginTravelerIndexItem = {
  travelerSlug: string;
  name: string;
  roles: string[];
  nationalities: string[];
  confidence: 'high' | 'medium' | 'low';
  imageUrl: string | null;
  launchCount: number;
  flightCount: number;
  latestFlightCode: string | null;
  latestLaunchDate: string | null;
  latestLaunchName: string | null;
  latestLaunchHref: string | null;
};

export type BlueOriginTravelerIndexResponse = {
  generatedAt: string;
  items: BlueOriginTravelerIndexItem[];
};

export type BlueOriginPayload = {
  id: string;
  missionKey: BlueOriginMissionKey;
  flightCode: string | null;
  flightSlug: string | null;
  name: string;
  payloadType: string | null;
  orbit: string | null;
  agency: string | null;
  launchId: string | null;
  launchName: string | null;
  launchDate: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginVehicleSlug = 'new-shepard' | 'new-glenn' | 'blue-moon' | 'blue-ring';

export type BlueOriginEngineSlug = 'be-3pm' | 'be-3u' | 'be-4' | 'be-7';

export type BlueOriginVehicle = {
  id: string;
  vehicleSlug: BlueOriginVehicleSlug;
  missionKey: BlueOriginMissionKey;
  displayName: string;
  vehicleClass: string | null;
  status: string | null;
  firstFlight: string | null;
  description: string | null;
  officialUrl: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginEngine = {
  id: string;
  engineSlug: BlueOriginEngineSlug;
  missionKey: BlueOriginMissionKey;
  displayName: string;
  propellants: string | null;
  cycle: string | null;
  thrustVacKN: number | null;
  thrustSlKN: number | null;
  status: string | null;
  description: string | null;
  officialUrl: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginVehicleEngineLink = {
  vehicleSlug: BlueOriginVehicleSlug;
  engineSlug: BlueOriginEngineSlug;
  role: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
};

export type BlueOriginVehicleEngineBinding = BlueOriginVehicleEngineLink & {
  engine: BlueOriginEngine | null;
};

export type BlueOriginEngineVehicleBinding = BlueOriginVehicleEngineLink & {
  vehicle: BlueOriginVehicle | null;
};

export type BlueOriginVehicleDetail = {
  vehicle: BlueOriginVehicle;
  engines: BlueOriginVehicleEngineBinding[];
};

export type BlueOriginEngineDetail = {
  engine: BlueOriginEngine;
  vehicles: BlueOriginEngineVehicleBinding[];
};

export type BlueOriginVehicleResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginVehicle[];
};

export type BlueOriginEngineResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginEngine[];
};

export type BlueOriginFlightRecord = {
  id: string;
  flightCode: string;
  flightSlug: string;
  missionKey: BlueOriginMissionKey;
  missionLabel: string;
  launchId: string | null;
  ll2LaunchUuid: string | null;
  launchName: string | null;
  launchDate: string | null;
  status: string | null;
  officialMissionUrl: string | null;
  source: string | null;
  confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginFlightsResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginFlightRecord[];
};

export type BlueOriginContract = {
  id: string;
  contractKey: string;
  missionKey: BlueOriginMissionKey;
  title: string;
  agency: string | null;
  customer: string | null;
  amount: number | null;
  awardedOn: string | null;
  description: string | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginContractAction = {
  id: string;
  actionKey: string;
  modNumber: string | null;
  actionDate: string | null;
  obligationDelta: number | null;
  obligationCumulative: number | null;
  source: string;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginOpportunityNotice = {
  id: string;
  noticeId: string;
  solicitationId: string | null;
  title: string | null;
  postedDate: string | null;
  responseDeadline: string | null;
  awardeeName: string | null;
  awardAmount: number | null;
  noticeUrl: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginSpendingPoint = {
  id: string;
  fiscalYear: number;
  fiscalMonth: number;
  obligations: number | null;
  outlays: number | null;
  source: string;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type BlueOriginContractStory = {
  piid: string;
  storyHref: string;
  members: number;
  actions: BlueOriginContractAction[];
  notices: BlueOriginOpportunityNotice[];
  spending: BlueOriginSpendingPoint[];
  bidders: string[];
};

export type BlueOriginContractVehicleBinding = {
  id: string;
  vehicleSlug: BlueOriginVehicleSlug | null;
  engineSlug: BlueOriginEngineSlug | null;
  matchMethod: string;
  confidence: number;
  metadata: Record<string, unknown>;
  vehicle: BlueOriginVehicle | null;
  engine: BlueOriginEngine | null;
};

export type BlueOriginContractDetail = {
  generatedAt: string;
  contract: BlueOriginContract;
  actions: BlueOriginContractAction[];
  notices: BlueOriginOpportunityNotice[];
  spending: BlueOriginSpendingPoint[];
  vehicles: BlueOriginContractVehicleBinding[];
  story?: BlueOriginContractStory | null;
};

export type BlueOriginContentKind = 'article' | 'photo' | 'social' | 'data';

export type BlueOriginContentItem = {
  id: string;
  missionKey: BlueOriginMissionKey | 'all';
  kind: BlueOriginContentKind;
  title: string;
  summary: string | null;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  sourceType: string;
  sourceLabel: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginSocialPost = {
  id: string;
  missionKey: BlueOriginMissionKey | 'all';
  launchId: string | null;
  launchName: string | null;
  url: string;
  platform: 'x';
  handle: string;
  externalId: string | null;
  postedAt: string | null;
  summary: string | null;
  mediaImageUrl: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginYouTubeVideo = {
  id: string;
  title: string;
  url: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  summary: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginMediaImage = {
  id: string;
  title: string;
  imageUrl: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  sourceLabel: string;
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginAudienceMode = 'quick' | 'explorer' | 'technical';

export type BlueOriginTimelineSourceType = 'll2-cache' | 'blue-origin-official' | 'government-record' | 'curated-fallback';

export type BlueOriginTimelineConfidence = 'high' | 'medium' | 'low';

export type BlueOriginTimelineEventKind = 'program-milestone' | 'launch' | 'update' | 'contract';

export type BlueOriginTimelineEventStatus = 'completed' | 'upcoming' | 'tentative' | 'superseded';

export type BlueOriginTimelineSupersedeReason = 'rescheduled' | 'refined' | 'replaced';

export type BlueOriginTimelineSupersedesLink = {
  eventId: string;
  reason: BlueOriginTimelineSupersedeReason;
};

export type BlueOriginTimelineSource = {
  type: BlueOriginTimelineSourceType;
  label: string;
  href?: string;
  lastVerifiedAt?: string | null;
};

export type BlueOriginTimelineMission = BlueOriginMissionKey;

export type BlueOriginTimelineEvent = {
  id: string;
  mission: BlueOriginTimelineMission;
  title: string;
  summary: string;
  date: string;
  endDate?: string | null;
  kind: BlueOriginTimelineEventKind;
  status: BlueOriginTimelineEventStatus;
  source: BlueOriginTimelineSource;
  confidence: BlueOriginTimelineConfidence;
  supersedes: BlueOriginTimelineSupersedesLink[];
  supersededBy?: BlueOriginTimelineSupersedesLink | null;
  evidenceId: string;
  launch?: Launch | null;
};

export type BlueOriginTimelineFacetOption = {
  value: string;
  label: string;
  count: number;
  selected: boolean;
};

export type BlueOriginTimelineFacet = {
  key: 'mission' | 'sourceType';
  label: string;
  options: BlueOriginTimelineFacetOption[];
};

export type BlueOriginTimelineKpis = {
  totalEvents: number;
  completedEvents: number;
  upcomingEvents: number;
  tentativeEvents: number;
  supersededEvents: number;
  highConfidenceEvents: number;
  lastUpdated: string | null;
};

export type BlueOriginMissionProgressState = 'completed' | 'in-preparation' | 'planned';

export type BlueOriginMissionProgressCard = {
  mission: BlueOriginTimelineMission;
  label: string;
  state: BlueOriginMissionProgressState;
  summary: string;
  targetDate: string | null;
  sourceType: BlueOriginTimelineSourceType;
  confidence: BlueOriginTimelineConfidence;
  eventId: string | null;
};

export type BlueOriginEvidenceSource = {
  label: string;
  href?: string;
  note?: string;
  capturedAt?: string | null;
};

export type BlueOriginEventEvidence = {
  eventId: string;
  mission: BlueOriginTimelineMission;
  title: string;
  summary: string;
  sourceType: BlueOriginTimelineSourceType;
  confidence: BlueOriginTimelineConfidence;
  generatedAt: string;
  sources: BlueOriginEvidenceSource[];
  payload: Record<string, unknown>;
};

export type BlueOriginTimelineMissionFilter = BlueOriginTimelineMission | 'all';

export type BlueOriginTimelineSourceFilter = BlueOriginTimelineSourceType | 'all';

export type BlueOriginTimelineQuery = {
  mode: BlueOriginAudienceMode;
  mission: BlueOriginTimelineMissionFilter;
  sourceType: BlueOriginTimelineSourceFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: number;
};

export type BlueOriginTimelineResponse = {
  generatedAt: string;
  mode: BlueOriginAudienceMode;
  mission: BlueOriginTimelineMissionFilter;
  sourceType: BlueOriginTimelineSourceFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  events: BlueOriginTimelineEvent[];
  facets: BlueOriginTimelineFacet[];
  kpis: BlueOriginTimelineKpis;
  missionProgress: BlueOriginMissionProgressCard[];
  nextCursor: string | null;
};

export type BlueOriginContractsResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginContract[];
};

export type BlueOriginPassengersResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginPassenger[];
};

export type BlueOriginPayloadsResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  items: BlueOriginPayload[];
};

export type BlueOriginContentResponse = {
  generatedAt: string;
  mission: BlueOriginMissionKey | 'all';
  kind: BlueOriginContentKind | 'all';
  items: BlueOriginContentItem[];
  nextCursor: string | null;
};
