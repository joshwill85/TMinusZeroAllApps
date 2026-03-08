import type { Launch } from '@/lib/types/launch';
import type {
  ContractStoryPresentation,
  ContractStorySummary
} from '@/lib/types/contractsStory';

export type SpaceXMissionKey = 'spacex-program' | 'starship' | 'falcon-9' | 'falcon-heavy' | 'dragon';

export type SpaceXProgramFaqItem = {
  question: string;
  answer: string;
};

export type SpaceXProgramSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  faq: SpaceXProgramFaqItem[];
};

export type SpaceXMissionSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  missionKey: SpaceXMissionKey;
  missionName: string;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  highlights: string[];
  faq: SpaceXProgramFaqItem[];
};

export type SpaceXVehicleSlug = 'starship-super-heavy' | 'falcon-9' | 'falcon-heavy' | 'dragon';

export type SpaceXEngineSlug = 'raptor' | 'merlin-1d' | 'merlin-vac' | 'draco' | 'superdraco';

export type SpaceXVehicle = {
  id: string;
  vehicleSlug: SpaceXVehicleSlug;
  missionKey: SpaceXMissionKey;
  displayName: string;
  vehicleClass: string | null;
  status: string | null;
  firstFlight: string | null;
  description: string | null;
  officialUrl: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type SpaceXEngine = {
  id: string;
  engineSlug: SpaceXEngineSlug;
  missionKey: SpaceXMissionKey;
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

export type SpaceXVehicleEngineLink = {
  vehicleSlug: SpaceXVehicleSlug;
  engineSlug: SpaceXEngineSlug;
  role: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
};

export type SpaceXVehicleEngineBinding = SpaceXVehicleEngineLink & {
  engine: SpaceXEngine | null;
};

export type SpaceXEngineVehicleBinding = SpaceXVehicleEngineLink & {
  vehicle: SpaceXVehicle | null;
};

export type SpaceXVehicleDetail = {
  vehicle: SpaceXVehicle;
  engines: SpaceXVehicleEngineBinding[];
};

export type SpaceXEngineDetail = {
  engine: SpaceXEngine;
  vehicles: SpaceXEngineVehicleBinding[];
};

export type SpaceXVehicleResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXVehicle[];
};

export type SpaceXEngineResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXEngine[];
};

export type SpaceXFlightRecord = {
  id: string;
  flightSlug: string;
  missionKey: SpaceXMissionKey;
  missionLabel: string;
  droneShipSlug: SpaceXDroneShipSlug | null;
  droneShipName: string | null;
  droneShipAbbrev: string | null;
  droneShipLandingResult: SpaceXDroneShipLandingResult;
  launch: Launch;
};

export type SpaceXFlightsResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXFlightRecord[];
};

export type SpaceXDroneShipSlug = 'ocisly' | 'asog' | 'jrti';

export type SpaceXDroneShipStatus = 'active' | 'retired' | 'unknown';

export type SpaceXDroneShipLandingResult = 'success' | 'failure' | 'no_attempt' | 'unknown';

export type SpaceXDroneShipKpis = {
  assignmentsKnown: number;
  upcomingAssignments: number;
  assignmentsPastYear: number;
  distinctBoostersRecovered: number;
  distinctLaunchSitesServed: number;
  coveragePercent: number;
  firstAssignmentDate: string | null;
  lastAssignmentDate: string | null;
};

export type SpaceXDroneShip = {
  slug: SpaceXDroneShipSlug;
  name: string;
  abbrev: string | null;
  status: SpaceXDroneShipStatus;
  description: string | null;
  wikidataId: string | null;
  wikiSourceUrl: string | null;
  wikipediaUrl: string | null;
  wikimediaCommonsCategory: string | null;
  wikiLastSyncedAt: string | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  imageLicense: string | null;
  imageLicenseUrl: string | null;
  imageCredit: string | null;
  imageAlt: string | null;
  lengthM: number | null;
  yearBuilt: number | null;
  homePort: string | null;
  ownerName: string | null;
  operatorName: string | null;
  countryName: string | null;
  kpis: SpaceXDroneShipKpis;
};

export type SpaceXDroneShipAssignmentRecord = {
  launchId: string;
  ll2LaunchUuid: string | null;
  launchName: string;
  launchSlug: string | null;
  launchNet: string | null;
  launchHref: string;
  flightSlug: string;
  missionKey: SpaceXMissionKey;
  missionLabel: string;
  provider: string | null;
  vehicle: string | null;
  padName: string | null;
  padShortCode: string | null;
  padLocationName: string | null;
  shipSlug: SpaceXDroneShipSlug;
  shipName: string;
  shipAbbrev: string | null;
  landingResult: SpaceXDroneShipLandingResult;
  landingAttempt: boolean | null;
  landingSuccess: boolean | null;
  landingTime: string | null;
  source: string;
  sourceLandingId: string | null;
  lastVerifiedAt: string | null;
};

export type SpaceXDroneShipCoverage = {
  generatedAt: string;
  totalSpaceXLaunches: number;
  knownLandingAssignments: number;
  coveragePercent: number;
  upcomingKnownAssignments: number;
  lastVerifiedAt: string | null;
};

export type SpaceXDroneShipListResponse = {
  generatedAt: string;
  items: SpaceXDroneShip[];
  coverage: SpaceXDroneShipCoverage;
  upcomingAssignments: SpaceXDroneShipAssignmentRecord[];
};

export type SpaceXDroneShipBoosterStat = {
  ll2LauncherId: number;
  serialNumber: string | null;
  missions: number;
};

export type SpaceXDroneShipDetail = {
  generatedAt: string;
  ship: SpaceXDroneShip;
  coverage: SpaceXDroneShipCoverage;
  upcomingAssignments: SpaceXDroneShipAssignmentRecord[];
  recentAssignments: SpaceXDroneShipAssignmentRecord[];
  launchSites: Array<{ name: string; count: number }>;
  missionMix: Array<{ missionKey: SpaceXMissionKey; missionLabel: string; count: number }>;
  boosters: SpaceXDroneShipBoosterStat[];
};

export type SpaceXSocialPost = {
  id: string;
  missionKey: SpaceXMissionKey;
  missionLabel: string;
  launchId: string | null;
  launchName: string | null;
  launchDate: string | null;
  url: string;
  platform: string;
  handle: string | null;
  externalId: string | null;
  postedAt: string | null;
  summary: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type SpaceXPassenger = {
  id: string;
  missionKey: SpaceXMissionKey;
  flightSlug: string;
  name: string;
  role: string | null;
  nationality: string | null;
  launchId: string;
  launchName: string;
  launchDate: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type SpaceXPassengersResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXPassenger[];
};

export type SpaceXPayload = {
  id: string;
  missionKey: SpaceXMissionKey;
  flightSlug: string;
  name: string;
  payloadType: string | null;
  orbit: string | null;
  agency: string | null;
  launchId: string;
  launchName: string;
  launchDate: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
};

export type SpaceXPayloadsResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXPayload[];
};

export type SpaceXContract = {
  id: string;
  contractKey: string;
  missionKey: SpaceXMissionKey;
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
  contractStory?: ContractStorySummary | null;
  storyPresentation?: ContractStoryPresentation;
};

export type SpaceXContractAction = {
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

export type SpaceXOpportunityNotice = {
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

export type SpaceXSpendingPoint = {
  id: string;
  fiscalYear: number;
  fiscalMonth: number;
  obligations: number | null;
  outlays: number | null;
  source: string;
  metadata: Record<string, unknown>;
  updatedAt: string | null;
};

export type SpaceXContractStory = {
  piid: string;
  storyHref: string;
  members: number;
  actions: SpaceXContractAction[];
  notices: SpaceXOpportunityNotice[];
  spending: SpaceXSpendingPoint[];
  bidders: string[];
};

export type SpaceXContractDetail = {
  generatedAt: string;
  contract: SpaceXContract;
  actions: SpaceXContractAction[];
  spending: SpaceXSpendingPoint[];
  notices?: SpaceXOpportunityNotice[];
  story?: SpaceXContractStory | null;
};

export type SpaceXContractsResponse = {
  generatedAt: string;
  mission: SpaceXMissionKey | 'all';
  items: SpaceXContract[];
};

export type SpaceXFinanceSignalKind =
  | 'government-obligations'
  | 'announced-deal-value'
  | 'launch-cadence'
  | 'private-company-disclosure';

export type SpaceXFinanceSignal = {
  id: string;
  company: 'SpaceX' | 'Blue Origin';
  kind: SpaceXFinanceSignalKind;
  title: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  asOfDate: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  confidence: 'high' | 'medium' | 'low';
  disclaimer: string;
  metadata: Record<string, unknown>;
};

export type SpaceXFinanceResponse = {
  generatedAt: string;
  company: 'SpaceX';
  publicEarningsAvailable: boolean;
  disclaimer: string;
  items: SpaceXFinanceSignal[];
};
