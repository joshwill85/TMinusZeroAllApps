export type ProgramContractStoryScope = 'artemis' | 'spacex' | 'blue-origin';

export type ContractStoryMatchStrategy =
  | 'exact_award_id'
  | 'exact_piid'
  | 'exact_solicitation'
  | 'heuristic_multi_signal';

export type ContractStoryMatchTier = 'exact' | 'candidate' | 'discovery-only';
export type ContractStoryDiscoveryJoinStatus = 'unlinked' | 'candidate' | 'linked' | 'suppressed';
export type ContractStoryDiscoverySourceType = 'sam-contract-award' | 'sam-opportunity';
export type ContractStorySourceEvidenceType =
  | 'usaspending-award'
  | 'sam-contract-award'
  | 'sam-opportunity';
export type ContractStoryPresentationState = 'exact' | 'lead' | 'pending';

export type ContractStoryEvidenceSignal = {
  key: string;
  value: string;
  weight?: number;
};

export type ContractStorySourceCoverage = {
  actions: number;
  notices: number;
  spendingPoints: number;
  bidders: number;
  exactSources: number;
};

export type ContractStorySummary = {
  storyKey: string;
  programScope: ProgramContractStoryScope;
  matchStrategy: ContractStoryMatchStrategy;
  matchConfidence: number;
  hasFullStory: boolean;
  primaryUsaspendingAwardId: string | null;
  primaryPiid: string | null;
  primaryContractKey: string | null;
  primarySolicitationId: string | null;
  primaryNoticeId: string | null;
  missionKey: string | null;
  recipient: string | null;
  title: string | null;
  awardedOn: string | null;
  obligatedAmount: number | null;
  actionCount: number;
  noticeCount: number;
  spendingPointCount: number;
  bidderCount: number;
  latestActionDate: string | null;
  latestNoticeDate: string | null;
  latestSpendingFiscalYear: number | null;
  latestSpendingFiscalMonth: number | null;
  matchEvidence: Record<string, unknown>;
};

export type ContractStoryAction = {
  id: string;
  actionKey: string | null;
  modNumber: string | null;
  actionDate: string | null;
  obligationDelta: number | null;
  obligationCumulative: number | null;
  solicitationId: string | null;
  samNoticeId: string | null;
  source: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ContractStoryNotice = {
  id: string;
  noticeId: string;
  solicitationId: string | null;
  title: string | null;
  postedDate: string | null;
  responseDeadline: string | null;
  awardeeName: string | null;
  awardAmount: number | null;
  noticeUrl: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ContractStorySpendingPoint = {
  id: string;
  fiscalYear: number;
  fiscalMonth: number;
  obligations: number | null;
  outlays: number | null;
  source: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ContractStoryPresentation = {
  state: ContractStoryPresentationState;
  leadCount: number;
  canonicalPath: string | null;
  sourceCoverage: ContractStorySourceCoverage;
};

export type ContractStorySourceEvidenceItem = {
  id: string;
  storyKey: string;
  programScope: ProgramContractStoryScope;
  sourceType: ContractStorySourceEvidenceType;
  sourceRecordKey: string;
  title: string | null;
  summary: string | null;
  entityName: string | null;
  agencyName: string | null;
  piid: string | null;
  solicitationId: string | null;
  noticeId: string | null;
  usaspendingAwardId: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  amount: number | null;
};

export type ContractStorySourceEvidenceGroup = {
  sourceType: ContractStorySourceEvidenceType;
  label: string;
  items: ContractStorySourceEvidenceItem[];
};

export type ContractStoryDetail = {
  storyKey: string;
  summary: ContractStorySummary;
  bidders: string[];
  actions: ContractStoryAction[];
  notices: ContractStoryNotice[];
  spending: ContractStorySpendingPoint[];
  sourceEvidence: ContractStorySourceEvidenceGroup[];
  links: {
    canonicalPath: string | null;
    artemisStoryHref: string | null;
    usaspendingUrl: string | null;
    samSearchUrl: string | null;
  };
};

export type ContractStoryDiscoveryItem = {
  discoveryKey: string;
  programScope: ProgramContractStoryScope;
  sourceType: ContractStoryDiscoverySourceType;
  sourceRecordKey: string;
  title: string | null;
  summary: string | null;
  entityName: string | null;
  agencyName: string | null;
  piid: string | null;
  solicitationId: string | null;
  noticeId: string | null;
  usaspendingAwardId: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  amount: number | null;
  joinStatus: ContractStoryDiscoveryJoinStatus;
  bestCandidateStoryKey: string | null;
  relevanceScore: number;
  relevanceSignals: Array<Record<string, unknown>>;
};
