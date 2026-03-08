import type { Launch } from '@/lib/types/launch';

export type StarshipFaqItem = {
  question: string;
  answer: string;
};

export type StarshipChangeItem = {
  title: string;
  summary: string;
  date: string;
  href?: string;
};

export type StarshipProgramSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  faq: StarshipFaqItem[];
};

export type StarshipFlightSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  missionName: string;
  flightNumber: number;
  flightSlug: string;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  crewHighlights: string[];
  changes: StarshipChangeItem[];
  faq: StarshipFaqItem[];
};

export type StarshipMissionSnapshot = StarshipFlightSnapshot;

export type StarshipAudienceMode = 'quick' | 'explorer' | 'technical';

export type StarshipTimelineMission = `flight-${number}` | 'starship-program';

export type StarshipTimelineSourceType = 'll2-cache' | 'spacex-official' | 'curated-fallback';

export type StarshipTimelineConfidence = 'high' | 'medium' | 'low';

export type StarshipTimelineEventKind = 'program-milestone' | 'launch' | 'update';

export type StarshipTimelineEventStatus = 'completed' | 'upcoming' | 'tentative' | 'superseded';

export type StarshipTimelineSupersedeReason = 'rescheduled' | 'refined' | 'replaced';

export type StarshipTimelineSupersedesLink = {
  eventId: string;
  reason: StarshipTimelineSupersedeReason;
};

export type StarshipTimelineSource = {
  type: StarshipTimelineSourceType;
  label: string;
  href?: string;
  lastVerifiedAt?: string | null;
};

export type StarshipTimelineEvent = {
  id: string;
  mission: StarshipTimelineMission;
  title: string;
  summary: string;
  date: string;
  endDate?: string | null;
  kind: StarshipTimelineEventKind;
  status: StarshipTimelineEventStatus;
  source: StarshipTimelineSource;
  confidence: StarshipTimelineConfidence;
  supersedes: StarshipTimelineSupersedesLink[];
  supersededBy?: StarshipTimelineSupersedesLink | null;
  evidenceId: string;
  launch?: Launch | null;
};

export type StarshipTimelineFacetOption = {
  value: string;
  label: string;
  count: number;
  selected: boolean;
};

export type StarshipTimelineFacet = {
  key: 'mission' | 'sourceType';
  label: string;
  options: StarshipTimelineFacetOption[];
};

export type StarshipTimelineKpis = {
  totalEvents: number;
  completedEvents: number;
  upcomingEvents: number;
  tentativeEvents: number;
  supersededEvents: number;
  highConfidenceEvents: number;
  lastUpdated: string | null;
};

export type StarshipMissionProgressState = 'completed' | 'in-preparation' | 'planned';

export type StarshipMissionProgressCard = {
  mission: StarshipTimelineMission;
  label: string;
  state: StarshipMissionProgressState;
  summary: string;
  targetDate: string | null;
  sourceType: StarshipTimelineSourceType;
  confidence: StarshipTimelineConfidence;
  eventId: string | null;
};

export type StarshipEvidenceSource = {
  label: string;
  href?: string;
  note?: string;
  capturedAt?: string | null;
};

export type StarshipEventEvidence = {
  eventId: string;
  mission: StarshipTimelineMission;
  title: string;
  summary: string;
  sourceType: StarshipTimelineSourceType;
  confidence: StarshipTimelineConfidence;
  generatedAt: string;
  sources: StarshipEvidenceSource[];
  payload: Record<string, unknown>;
};

export type StarshipTimelineMissionFilter = StarshipTimelineMission | 'all';

export type StarshipTimelineSourceFilter = StarshipTimelineSourceType | 'all';

export type StarshipTimelineQuery = {
  mode: StarshipAudienceMode;
  mission: StarshipTimelineMissionFilter;
  sourceType: StarshipTimelineSourceFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: number;
};

export type StarshipTimelineResponse = {
  generatedAt: string;
  mode: StarshipAudienceMode;
  mission: StarshipTimelineMissionFilter;
  sourceType: StarshipTimelineSourceFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  events: StarshipTimelineEvent[];
  facets: StarshipTimelineFacet[];
  kpis: StarshipTimelineKpis;
  missionProgress: StarshipMissionProgressCard[];
  nextCursor: string | null;
};

export type StarshipFlightIndexEntry = {
  flightNumber: number;
  flightSlug: `flight-${number}`;
  label: string;
  nextLaunch: Launch | null;
  upcomingCount: number;
  recentCount: number;
  lastUpdated: string | null;
};
