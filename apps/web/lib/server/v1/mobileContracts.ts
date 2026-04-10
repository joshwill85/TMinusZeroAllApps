import {
  canonicalContractDetailSchemaV1,
  canonicalContractsPageSchemaV1,
  canonicalContractsResponseSchemaV1
} from '@tminuszero/contracts';
import {
  buildCanonicalContractSearchText,
  fetchCanonicalContractDetailByUid,
  fetchCanonicalContractsPage,
  fetchCanonicalContractsIndex,
  normalizeCanonicalContractUid,
  type CanonicalContractDetail,
  type CanonicalContractSummary
} from '@/lib/server/contracts';

function normalizeQuery(value: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function parseScope(value: string | null) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'spacex' || normalized === 'blue-origin' || normalized === 'artemis') {
    return normalized;
  }
  return 'all';
}

function mapCanonicalSummary(contract: CanonicalContractSummary) {
  return {
    uid: contract.uid,
    scope: contract.scope,
    storyStatus: contract.story?.storyKey ? 'exact' : 'pending',
    title: contract.title,
    description: contract.description,
    contractKey: contract.contractKey,
    piid: contract.piid,
    usaspendingAwardId: contract.usaspendingAwardId,
    missionKey: contract.missionKey,
    missionLabel: contract.missionLabel,
    agency: contract.agency,
    customer: contract.customer,
    recipient: contract.recipient,
    amount: contract.amount,
    awardedOn: contract.awardedOn,
    sourceUrl: contract.sourceUrl,
    sourceLabel: contract.sourceLabel,
    status: contract.status,
    updatedAt: contract.updatedAt,
    canonicalPath: contract.canonicalPath,
    programPath: contract.programPath,
    keywords: contract.keywords,
    actionCount: contract.story?.actionCount ?? 0,
    noticeCount: contract.story?.noticeCount ?? 0,
    spendingCount: contract.story?.spendingPointCount ?? 0,
    bidderCount: contract.story?.bidderCount ?? 0
  } as const;
}

function buildTotals(contracts: CanonicalContractSummary[]) {
  return {
    all: contracts.length,
    exact: contracts.filter((contract) => Boolean(contract.story?.storyKey)).length,
    pending: contracts.filter((contract) => !contract.story?.storyKey).length,
    spacex: contracts.filter((contract) => contract.scope === 'spacex').length,
    blueOrigin: contracts.filter((contract) => contract.scope === 'blue-origin').length,
    artemis: contracts.filter((contract) => contract.scope === 'artemis').length
  };
}

function buildFacts(detail: CanonicalContractDetail) {
  return [
    ['Mission', detail.contract.missionLabel],
    ['Status', detail.contract.story?.storyKey ? 'Exact story' : 'Story pending'],
    ['Awarded on', detail.contract.awardedOn || 'n/a'],
    ['Amount', detail.contract.amount != null ? formatCurrency(detail.contract.amount) : 'Not disclosed'],
    ['Agency', detail.contract.agency || 'n/a'],
    ['Customer', detail.contract.customer || 'n/a'],
    ['Recipient', detail.contract.recipient || 'n/a'],
    ['Actions', String(detail.actionsCount)],
    ['Notices', String(detail.noticesCount)],
    ['Spending points', String(detail.spendingCount)],
    ['Bidders', String(detail.biddersCount)]
  ].map(([label, value]) => ({ label, value }));
}

function buildLinks(detail: CanonicalContractDetail) {
  return [
    { label: 'Canonical route', href: detail.contract.canonicalPath, external: false },
    { label: 'Program detail', href: detail.contract.programPath, external: false },
    ...(detail.contract.sourceUrl ? [{ label: detail.contract.sourceLabel || 'Source record', href: detail.contract.sourceUrl, external: true }] : [])
  ];
}

function buildFamilyMembers(detail: CanonicalContractDetail) {
  if (detail.sourcePayload.scope !== 'artemis') {
    return [mapCanonicalSummary(detail.contract)];
  }

  return detail.sourcePayload.story.members.map((member, index) => ({
    uid: `${detail.contract.uid}:${index + 1}`,
    scope: 'artemis' as const,
    storyStatus: detail.contract.story?.storyKey ? 'exact' : 'pending',
    title: member.description?.trim() || member.contractKey,
    description: member.description,
    contractKey: member.contractKey,
    piid: member.piid,
    usaspendingAwardId: null,
    missionKey: member.missionKey,
    missionLabel: detail.contract.missionLabel,
    agency: member.agencyCode,
    customer: null,
    recipient: member.awardeeName,
    amount: null,
    awardedOn: member.baseAwardDate,
    sourceUrl: member.sourceUrl,
    sourceLabel: member.sourceUrl ? 'Source record' : null,
    status: member.contractType,
    updatedAt: member.updatedAt,
    canonicalPath: detail.contract.canonicalPath,
    programPath: detail.contract.programPath,
    keywords: detail.contract.keywords,
    actionCount: detail.actionsCount,
    noticeCount: detail.noticesCount,
    spendingCount: detail.spendingCount,
    bidderCount: detail.biddersCount
  }));
}

export async function loadCanonicalContractsPayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const allContracts = await fetchCanonicalContractsIndex();
  const query = normalizeQuery(searchParams.get('q'));
  const scope = parseScope(searchParams.get('scope'));
  const filteredByScope = scope === 'all' ? allContracts : allContracts.filter((contract) => contract.scope === scope);
  const items = query
    ? filteredByScope.filter((contract) => buildCanonicalContractSearchText(contract).includes(query))
    : filteredByScope;

  return canonicalContractsResponseSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Government Contracts',
    description: 'Canonical contract stories and pending rows across SpaceX, Blue Origin, and Artemis.',
    query: query || null,
    scope,
    totalRows: items.length,
    totals: buildTotals(allContracts),
    items: items.map(mapCanonicalSummary)
  });
}

export async function loadCanonicalContractsPagePayload(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeQuery(searchParams.get('q')) || null;
  const scope = parseScope(searchParams.get('scope'));
  const limit = clampInt(searchParams.get('limit'), 100, 1, 500);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 1_000_000);
  const page = await fetchCanonicalContractsPage({
    scope,
    query,
    limit,
    offset
  });

  return canonicalContractsPageSchemaV1.parse({
    generatedAt: page.generatedAt,
    query: page.query,
    scope: page.scope,
    totalRows: page.totalRows,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.hasMore,
    totals: page.totals,
    items: page.items.map(mapCanonicalSummary)
  });
}

export async function loadCanonicalContractDetailPayload(contractUid: string) {
  const normalizedUid = normalizeCanonicalContractUid(contractUid);
  if (!normalizedUid) {
    return null;
  }

  const detail = await fetchCanonicalContractDetailByUid(normalizedUid);
  if (!detail) {
    return null;
  }

  return canonicalContractDetailSchemaV1.parse({
    generatedAt: detail.generatedAt,
    title: detail.contract.title,
    description: detail.contract.description || 'Canonical contract detail.',
    contract: mapCanonicalSummary(detail.contract),
    facts: buildFacts(detail),
    links: buildLinks(detail),
    familyMembers: buildFamilyMembers(detail)
  });
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value == null ? Number.NaN : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
