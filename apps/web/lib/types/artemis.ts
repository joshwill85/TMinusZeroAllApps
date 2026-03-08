import type { Launch } from '@/lib/types/launch';

export const ARTEMIS_MISSION_HUB_KEYS = [
  'artemis-i',
  'artemis-ii',
  'artemis-iii',
  'artemis-iv',
  'artemis-v',
  'artemis-vi',
  'artemis-vii'
] as const;

export type ArtemisMissionHubKey = (typeof ARTEMIS_MISSION_HUB_KEYS)[number];

export type ArtemisFaqItem = {
  question: string;
  answer: string;
};

export type ArtemisChangeItem = {
  title: string;
  summary: string;
  date: string;
  href?: string;
};

export type ArtemisProgramSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  faq: ArtemisFaqItem[];
};

export type ArtemisMissionSnapshot = {
  generatedAt: string;
  lastUpdated: string | null;
  missionName: string;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  crewHighlights: string[];
  changes: ArtemisChangeItem[];
  faq: ArtemisFaqItem[];
};

export type ArtemisMissionWatchLink = {
  url: string;
  label: string;
};

export type ArtemisMissionEvidenceLink = {
  label: string;
  url: string;
  source?: string | null;
  detail?: string | null;
  capturedAt?: string | null;
  kind?: 'stream' | 'report' | 'reference' | 'status' | 'social';
};

export type ArtemisMissionNewsItem = {
  snapiUid: string;
  itemType: 'article' | 'blog' | 'report' | string;
  title: string;
  url: string;
  newsSite: string | null;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  authors: string[];
  featured: boolean;
  relevance: 'launch-join' | 'mission-keyword' | 'both';
};

export type ArtemisMissionSocialItem = {
  id: string;
  launchId: string;
  launchName?: string | null;
  platform: string;
  postType: string;
  status: string;
  text: string | null;
  replyText: string | null;
  externalId: string | null;
  externalUrl: string | null;
  scheduledFor: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArtemisMissionDataCoverage = {
  hasLaunch: boolean;
  hasCrew: boolean;
  hasWatchLinks: boolean;
  hasEvidenceLinks: boolean;
  hasNews: boolean;
  hasSocial: boolean;
};

export type ArtemisMissionLifecycleState = 'completed' | 'in-preparation' | 'planned';

export type ArtemisMissionProfile = {
  missionKey: ArtemisMissionHubKey;
  missionName: string;
  shortLabel: string;
  status: ArtemisMissionLifecycleState;
  summary: string;
  detail: string;
  hubHref: string;
  keywords: string[];
  crewHighlights: string[];
  watchLinks: ArtemisMissionWatchLink[];
  evidenceLinks: ArtemisMissionEvidenceLink[];
  targetDate: string | null;
  faq?: ArtemisFaqItem[];
};

export type ArtemisMissionHubData = {
  missionKey: ArtemisMissionHubKey;
  missionName: string;
  generatedAt: string;
  lastUpdated: string | null;
  nextLaunch: Launch | null;
  upcoming: Launch[];
  recent: Launch[];
  crewHighlights: string[];
  changes: ArtemisChangeItem[];
  faq: ArtemisFaqItem[];
  watchLinks: ArtemisMissionWatchLink[];
  evidenceLinks: ArtemisMissionEvidenceLink[];
  news: ArtemisMissionNewsItem[];
  social: ArtemisMissionSocialItem[];
  coverage: ArtemisMissionDataCoverage;
};

export type ArtemisAudienceMode = 'quick' | 'explorer' | 'technical';

export type ArtemisDashboardView = 'overview' | 'timeline' | 'intel' | 'budget' | 'missions';

export type ArtemisTimelineMission = ArtemisMissionHubKey | 'artemis-program';

export type ArtemisTimelineSourceType = 'll2-cache' | 'nasa-official' | 'curated-fallback';

export type ArtemisSourceClass =
  | 'nasa_primary'
  | 'oversight'
  | 'budget'
  | 'procurement'
  | 'technical'
  | 'media'
  | 'll2-cache'
  | 'curated-fallback';

export type ArtemisSourceTier = 'tier1' | 'tier2';

export type ArtemisTimelineConfidence = 'high' | 'medium' | 'low';

export type ArtemisTimelineEventKind = 'mission-milestone' | 'launch' | 'update';

export type ArtemisTimelineEventStatus = 'completed' | 'upcoming' | 'tentative' | 'superseded';

export type ArtemisTimelineSupersedeReason = 'rescheduled' | 'refined' | 'replaced';

export type ArtemisTimelineSupersedesLink = {
  eventId: string;
  reason: ArtemisTimelineSupersedeReason;
};

export type ArtemisTimelineSource = {
  type: ArtemisTimelineSourceType;
  sourceClass?: ArtemisSourceClass;
  label: string;
  href?: string;
  lastVerifiedAt?: string | null;
};

export type ArtemisTimelineEvent = {
  id: string;
  mission: ArtemisTimelineMission;
  title: string;
  summary: string;
  date: string;
  endDate?: string | null;
  kind: ArtemisTimelineEventKind;
  status: ArtemisTimelineEventStatus;
  source: ArtemisTimelineSource;
  confidence: ArtemisTimelineConfidence;
  supersedes: ArtemisTimelineSupersedesLink[];
  supersededBy?: ArtemisTimelineSupersedesLink | null;
  evidenceId: string;
  launch?: Launch | null;
};

export type ArtemisTimelineFacetOption = {
  value: string;
  label: string;
  count: number;
  selected: boolean;
};

export type ArtemisTimelineFacet = {
  key: 'mission' | 'sourceType' | 'sourceClass';
  label: string;
  options: ArtemisTimelineFacetOption[];
};

export type ArtemisTimelineKpis = {
  totalEvents: number;
  completedEvents: number;
  upcomingEvents: number;
  tentativeEvents: number;
  supersededEvents: number;
  highConfidenceEvents: number;
  lastUpdated: string | null;
};

export type ArtemisMissionProgressState = 'completed' | 'in-preparation' | 'planned';

export type ArtemisMissionProgressCard = {
  mission: ArtemisMissionHubKey;
  label: string;
  state: ArtemisMissionProgressState;
  summary: string;
  targetDate: string | null;
  sourceType: ArtemisTimelineSourceType;
  confidence: ArtemisTimelineConfidence;
  eventId: string | null;
};

export type ArtemisEvidenceSource = {
  label: string;
  href?: string;
  note?: string;
  capturedAt?: string | null;
};

export type ArtemisEventEvidence = {
  eventId: string;
  mission: ArtemisTimelineMission;
  title: string;
  summary: string;
  sourceType: ArtemisTimelineSourceType;
  confidence: ArtemisTimelineConfidence;
  generatedAt: string;
  sources: ArtemisEvidenceSource[];
  payload: Record<string, unknown>;
};

export type ArtemisTimelineMissionFilter = ArtemisTimelineMission | 'all';

export type ArtemisTimelineSourceFilter = ArtemisTimelineSourceType | 'all';

export type ArtemisTimelineSourceClassFilter = ArtemisSourceClass | 'all';

export type ArtemisTimelineQuery = {
  mode: ArtemisAudienceMode;
  mission: ArtemisTimelineMissionFilter;
  sourceType: ArtemisTimelineSourceFilter;
  sourceClass?: ArtemisTimelineSourceClassFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  cursor: string | null;
  limit: number;
};

export type ArtemisTimelineResponse = {
  generatedAt: string;
  mode: ArtemisAudienceMode;
  mission: ArtemisTimelineMissionFilter;
  sourceType: ArtemisTimelineSourceFilter;
  sourceClass: ArtemisTimelineSourceClassFilter;
  includeSuperseded: boolean;
  from: string | null;
  to: string | null;
  events: ArtemisTimelineEvent[];
  facets: ArtemisTimelineFacet[];
  kpis: ArtemisTimelineKpis;
  missionProgress: ArtemisMissionProgressCard[];
  nextCursor: string | null;
};

export type ArtemisContentKind = 'article' | 'photo' | 'social' | 'data';

export type ArtemisContentKindFilter = ArtemisContentKind | 'all';

export type ArtemisContentTierFilter = ArtemisSourceTier | 'all';

export type ArtemisContentMissionKey = ArtemisMissionHubKey | 'program';

export type ArtemisContentMissionFilter = ArtemisContentMissionKey | 'all';

export type ArtemisContentScoreBreakdown = {
  authority: number;
  relevance: number;
  freshness: number;
  stability: number;
  risk: number;
  overall: number;
};

export type ArtemisContentItem = {
  id: string;
  fingerprint: string;
  kind: ArtemisContentKind;
  missionKey: ArtemisContentMissionKey;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string | null;
  capturedAt: string | null;
  sourceKey: string | null;
  sourceType: ArtemisSourceClass;
  sourceClass: ArtemisSourceClass;
  sourceTier: ArtemisSourceTier;
  sourceLabel: string;
  imageUrl: string | null;
  externalId: string | null;
  platform: string | null;
  dataLabel: string | null;
  dataValue: number | null;
  dataUnit: string | null;
  missionLabel: string;
  score: ArtemisContentScoreBreakdown;
  whyShown: string;
  metadata: Record<string, unknown>;
};

export type ArtemisContentCoverage = {
  generatedFrom: 'content_items' | 'fallback';
  totalItems: number;
  tier1Items: number;
  tier2Items: number;
  byKind: Record<ArtemisContentKind, number>;
  sourceKeys: string[];
};

export type ArtemisContentQuery = {
  mission: ArtemisContentMissionFilter;
  kind: ArtemisContentKindFilter;
  tier: ArtemisContentTierFilter;
  limit: number;
  cursor: string | null;
};

export type ArtemisContentResponse = {
  generatedAt: string;
  mission: ArtemisContentMissionFilter;
  kind: ArtemisContentKindFilter;
  tier: ArtemisContentTierFilter;
  items: ArtemisContentItem[];
  nextCursor: string | null;
  sourceCoverage: ArtemisContentCoverage;
};

export type ArtemisPersonProfile = {
  id: string;
  missionKey: ArtemisContentMissionKey;
  sortOrder: number;
  name: string;
  agency: string;
  role: string | null;
  bioUrl: string;
  portraitUrl: string | null;
  summary: string | null;
  updatedAt: string;
};

export type ArtemisMissionComponent = {
  id: string;
  missionKey: ArtemisContentMissionKey;
  sortOrder: number;
  component: string;
  description: string;
  officialUrls: string[];
  imageUrl: string | null;
  updatedAt: string;
};

export type ArtemisSeoApprovalState = 'draft' | 'approved' | 'rejected';

export type ArtemisAwardeeMissionKey = ArtemisMissionHubKey | 'program';

export type ArtemisAwardeeAward = {
  awardId: string | null;
  title: string | null;
  recipient: string;
  obligatedAmount: number | null;
  awardedOn: string | null;
  missionKey: ArtemisAwardeeMissionKey;
  contractKey?: string | null;
  piid?: string | null;
  solicitationId?: string | null;
  detail: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
};

export type ArtemisAwardeeMissionSummary = {
  missionKey: ArtemisAwardeeMissionKey;
  label: string;
  awardCount: number;
  obligatedAmount: number | null;
};

export type ArtemisAwardeeProfile = {
  recipientKey: string;
  recipientName: string;
  slug: string;
  aliases: string[];
  seoApprovalState: ArtemisSeoApprovalState;
  summary: string;
  awards: ArtemisAwardeeAward[];
  awardCount: number;
  totalObligatedAmount: number | null;
  firstAwardedOn: string | null;
  lastAwardedOn: string | null;
  missionBreakdown: ArtemisAwardeeMissionSummary[];
  sourceUrls: string[];
  sourceTitles: string[];
  lastUpdated: string | null;
};

export type ArtemisAwardeeIndexItem = {
  recipientKey: string;
  recipientName: string;
  slug: string;
  aliases: string[];
  seoApprovalState: ArtemisSeoApprovalState;
  summary: string;
  awardCount: number;
  totalObligatedAmount: number | null;
  firstAwardedOn: string | null;
  lastAwardedOn: string | null;
  missionBreakdown: ArtemisAwardeeMissionSummary[];
};
