import type {
  ContractStoryPresentation,
  ContractStorySourceCoverage,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import { buildCanonicalContractHrefForStory, type CanonicalContractScope } from '@/lib/utils/canonicalContracts';

export function buildContractStoryPresentation(input: {
  scope: CanonicalContractScope;
  story: ContractStorySummary | null;
  leadCount?: number;
  exactSourceCount?: number;
  fallbackContractKey?: string | null;
}) : ContractStoryPresentation {
  const leadCount = clampNonNegativeInt(input.leadCount);
  const exactSourceCount = clampNonNegativeInt(input.exactSourceCount);
  if (!input.story) {
    return {
      state: leadCount > 0 ? 'lead' : 'pending',
      leadCount,
      canonicalPath: null,
      sourceCoverage: buildEmptyCoverage()
    };
  }

  return {
    state: 'exact',
    leadCount,
    canonicalPath: buildCanonicalContractHrefForStory({
      scope: input.scope,
      awardId: input.story.primaryUsaspendingAwardId,
      piid: input.story.primaryPiid,
      contractKey: input.story.primaryContractKey || input.fallbackContractKey || null
    }),
    sourceCoverage: {
      actions: clampNonNegativeInt(input.story.actionCount),
      notices: clampNonNegativeInt(input.story.noticeCount),
      spendingPoints: clampNonNegativeInt(input.story.spendingPointCount),
      bidders: clampNonNegativeInt(input.story.bidderCount),
      exactSources: exactSourceCount
    }
  };
}

function buildEmptyCoverage(): ContractStorySourceCoverage {
  return {
    actions: 0,
    notices: 0,
    spendingPoints: 0,
    bidders: 0,
    exactSources: 0
  };
}

function clampNonNegativeInt(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
