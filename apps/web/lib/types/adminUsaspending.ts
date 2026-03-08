import type {
  ProgramScope,
  ProgramUsaspendingAuditTier,
  ProgramUsaspendingReviewStatus
} from '@/lib/usaspending/hubAudit';

export type AdminUsaspendingScope = ProgramScope;

export const ADMIN_USASPENDING_SCOPES = [
  'blue-origin',
  'spacex',
  'artemis'
] as const satisfies readonly AdminUsaspendingScope[];

export type AdminUsaspendingReviewTier = Extract<
  ProgramUsaspendingAuditTier,
  'candidate' | 'excluded'
>;

export const ADMIN_USASPENDING_REVIEW_TIERS = [
  'candidate',
  'excluded'
] as const satisfies readonly AdminUsaspendingReviewTier[];

export type AdminUsaspendingAwardFamily =
  | 'contracts'
  | 'idvs'
  | 'grants'
  | 'loans'
  | 'direct_payments'
  | 'other_financial_assistance'
  | 'unknown';

export type AdminUsaspendingReviewCounts = Record<
  AdminUsaspendingScope,
  Record<AdminUsaspendingReviewTier, number>
>;

export type AdminUsaspendingReviewRow = {
  awardIdentityKey: string;
  programScope: AdminUsaspendingScope;
  awardId: string | null;
  title: string | null;
  recipient: string | null;
  obligatedAmount: number | null;
  awardedOn: string | null;
  missionKey: string | null;
  awardFamily: AdminUsaspendingAwardFamily;
  sourceUrl: string | null;
  sourceTitle: string | null;
  autoTier: ProgramUsaspendingAuditTier;
  finalTier: ProgramUsaspendingAuditTier | null;
  effectiveTier: ProgramUsaspendingAuditTier;
  reviewStatus: ProgramUsaspendingReviewStatus;
  reasonCodes: string[];
  signals: string[];
  score: number | null;
  canonicalRecipientMatch: boolean | null;
  storyLinked: boolean | null;
  declaredScopes: AdminUsaspendingScope[];
  liveRecipientName: string | null;
  liveParentRecipientName: string | null;
  auditVersion: string | null;
  reviewNotes: string | null;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
  signalSnapshot: Record<string, unknown> | null;
  liveSourceSnapshot: Record<string, unknown> | null;
};

export type AdminUsaspendingReviewsResponse = {
  scope: AdminUsaspendingScope;
  tier: AdminUsaspendingReviewTier;
  total: number;
  offset: number;
  limit: number;
  query: string;
  counts: AdminUsaspendingReviewCounts;
  items: AdminUsaspendingReviewRow[];
};

export type AdminUsaspendingPromoteResponse = {
  ok: true;
  promoted: {
    awardIdentityKey: string;
    programScope: AdminUsaspendingScope;
    finalTier: Extract<ProgramUsaspendingAuditTier, 'exact'>;
    reviewStatus: Extract<ProgramUsaspendingReviewStatus, 'confirmed'>;
    updatedAt: string;
  };
};

export function createEmptyAdminUsaspendingReviewCounts(): AdminUsaspendingReviewCounts {
  return {
    artemis: { candidate: 0, excluded: 0 },
    'blue-origin': { candidate: 0, excluded: 0 },
    spacex: { candidate: 0, excluded: 0 }
  };
}
