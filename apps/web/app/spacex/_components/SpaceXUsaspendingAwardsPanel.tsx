'use client';

import { useMemo, useState } from 'react';
import type { ProgramUsaspendingAwardSummary } from '@/lib/server/usaspendingProgramAwards';
import type { ContractStoryDetail } from '@/lib/types/contractsStory';
import { buildUsaspendingSearchUrl, normalizeUsaspendingPublicUrl } from '@/lib/utils/usaspending';

type SpacexUsaspendingApiPayload = {
  items: ProgramUsaspendingAwardSummary[];
  total: number | null;
  offset: number;
  limit: number;
  hasMore: boolean;
};

const INITIAL_VISIBLE_ROWS = 80;
const LOAD_MORE_STEP = 200;
const EXPAND_ALL_STEP = 500;

export function SpaceXUsaspendingAwardsPanel({
  initialItems,
  initialTotal,
  initialHasMore
}: {
  initialItems: ProgramUsaspendingAwardSummary[];
  initialTotal: number | null;
  initialHasMore: boolean;
}) {
  const [items, setItems] = useState<ProgramUsaspendingAwardSummary[]>(initialItems);
  const [total, setTotal] = useState<number | null>(initialTotal);
  const [hasMoreServer, setHasMoreServer] = useState<boolean>(initialHasMore);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ROWS);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedStoryRows, setExpandedStoryRows] = useState<Record<string, boolean>>({});
  const [storyDetails, setStoryDetails] = useState<Record<string, ContractStoryDetail | null>>({});
  const [storyLoading, setStoryLoading] = useState<Record<string, boolean>>({});
  const [storyErrors, setStoryErrors] = useState<Record<string, string>>({});

  const boundedVisibleCount = Math.min(Math.max(visibleCount, INITIAL_VISIBLE_ROWS), items.length || INITIAL_VISIBLE_ROWS);
  const visibleRows = useMemo(
    () => items.slice(0, boundedVisibleCount),
    [items, boundedVisibleCount]
  );
  const knownTotal = total ?? items.length;
  const canLoadMore = hasMoreServer || items.length < knownTotal;

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">USASpending awards (SpaceX scope)</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-text3">
          {knownTotal} rows
        </span>
      </div>
      <p className="mt-2 text-sm text-text2">
        Direct row-level USASpending records filtered to SpaceX scope. Links are normalized to public USASpending pages for user click-through.
      </p>

      {errorMessage ? (
        <p className="mt-2 text-xs text-warning">{errorMessage}</p>
      ) : null}

      {items.length ? (
        <div className="mt-3 space-y-3">
          <ul className="grid gap-3 md:grid-cols-2">
            {visibleRows.map((award) => {
              const rowKey = summaryKey(award);
              const sourceUrl =
                normalizeUsaspendingPublicUrl(award.sourceUrl, award.awardId) ||
                buildUsaspendingSearchUrl(award.awardId);
              const storySummary = award.contractStory || null;
              const storyPresentation = award.storyPresentation;
              const storyExpanded = Boolean(expandedStoryRows[rowKey]);
              const storyPending = Boolean(storyLoading[rowKey]);
              const storyDetail = storyDetails[rowKey] || null;
              const storyError = storyErrors[rowKey] || null;
              return (
                <li
                  key={`usaspending:${rowKey}`}
                  className="rounded-lg border border-stroke bg-surface-0 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-text1">{award.title || award.awardId || 'USASpending award'}</p>
                    <span className="text-xs text-text3">{award.awardedOn ? formatDateLabel(award.awardedOn) : 'Date pending'}</span>
                  </div>
                  <p className="mt-1 text-xs text-text3">{award.recipient || 'Recipient pending'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text3">
                    <span className="rounded-full border border-stroke px-2 py-0.5">
                      {award.obligatedAmount != null ? formatContractAmount(award.obligatedAmount) : 'Amount pending'}
                    </span>
                    <span className="rounded-full border border-stroke px-2 py-0.5">
                      {formatUsaspendingAwardFamily(award.awardFamily)}
                    </span>
                    <span className="rounded-full border border-stroke px-2 py-0.5">
                      Mission {formatProgramMissionLabel(award.missionKey)}
                    </span>
                    <span className="rounded-full border border-stroke px-2 py-0.5">
                      {award.sourceFieldCount} fields
                    </span>
                    {sourceUrl ? (
                      <a href={sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                        Source record
                      </a>
                    ) : null}
                    {storyPresentation?.state === 'exact' ? (
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                        In-house page
                      </span>
                    ) : storyPresentation?.state === 'lead' ? (
                      <span className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                        Unmatched records {storyPresentation.leadCount}
                      </span>
                    ) : (
                      <span className="rounded-full border border-stroke px-2 py-0.5">
                        Page pending
                      </span>
                    )}
                  </div>
                  {storySummary ? (
                    <div className="mt-2 rounded-md border border-stroke/70 bg-surface-1/40 p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text3">
                        <span>
                          {storySummary.actionCount} actions • {storySummary.noticeCount} notices • {storySummary.spendingPointCount} spending points
                        </span>
                        <button
                          type="button"
                          disabled={storyPending}
                          onClick={() => void handleToggleStory(rowKey, storySummary.storyKey)}
                          className="rounded border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text2 hover:text-text1 disabled:opacity-60"
                        >
                          {storyPending ? 'Loading…' : storyExpanded ? 'Hide story' : 'Open story'}
                        </button>
                      </div>
                      {storyError ? (
                        <p className="mt-1 text-[11px] text-warning">{storyError}</p>
                      ) : null}
                      {storyExpanded && storyDetail ? (
                        <div className="mt-2 space-y-1 text-[11px] text-text3">
                          <p>
                            Bidders: {storyDetail.bidders.length || 0}
                            {storyDetail.summary.latestActionDate ? ` • Last action ${formatDateLabel(storyDetail.summary.latestActionDate)}` : ''}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {storyDetail.links.usaspendingUrl ? (
                              <a
                                href={storyDetail.links.usaspendingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:text-primary/80"
                              >
                                USASpending
                              </a>
                            ) : null}
                            {storyDetail.links.samSearchUrl ? (
                              <a
                                href={storyDetail.links.samSearchUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:text-primary/80"
                              >
                                SAM
                              </a>
                            ) : null}
                            {storyDetail.links.canonicalPath ? (
                              <a href={storyDetail.links.canonicalPath} className="text-primary hover:text-primary/80">
                                Open in-house page
                              </a>
                            ) : null}
                            {storyDetail.links.artemisStoryHref ? (
                              <a href={storyDetail.links.artemisStoryHref} className="text-primary hover:text-primary/80">
                                Open contract page
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : storyPresentation?.state === 'lead' ? (
                    <p className="mt-2 text-[11px] text-text3">
                      {storyPresentation.leadCount} related SAM record{storyPresentation.leadCount === 1 ? '' : 's'} are still waiting for a confident match to an in-house page.
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] text-text3">
                      No in-house contract page is attached yet.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text3">
            <span>Showing {visibleRows.length} of {knownTotal}</span>
            <div className="flex flex-wrap gap-2">
              {canLoadMore ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handleLoadMore(LOAD_MORE_STEP)}
                    disabled={loading}
                    className="rounded-md border border-stroke px-3 py-1.5 uppercase tracking-[0.08em] hover:text-text1 disabled:opacity-60"
                  >
                    {loading ? 'Loading…' : `Load ${LOAD_MORE_STEP} more`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleExpandToAll()}
                    disabled={loading}
                    className="rounded-md border border-stroke px-3 py-1.5 uppercase tracking-[0.08em] hover:text-text1 disabled:opacity-60"
                  >
                    {loading ? 'Loading…' : 'Expand to all'}
                  </button>
                </>
              ) : null}
              {boundedVisibleCount > INITIAL_VISIBLE_ROWS ? (
                <button
                  type="button"
                  onClick={() => setVisibleCount(INITIAL_VISIBLE_ROWS)}
                  className="rounded-md border border-stroke px-3 py-1.5 uppercase tracking-[0.08em] hover:text-text1"
                >
                  Show first {INITIAL_VISIBLE_ROWS}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text3">No scoped USASpending awards are currently available for SpaceX.</p>
      )}
    </section>
  );

  async function handleLoadMore(requestedLimit: number) {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const payload = await fetchPage(items.length, requestedLimit);
      if (!payload) return;
      const merged = mergeByKey(items, payload.items);
      setItems(merged);
      if (typeof payload.total === 'number') setTotal(payload.total);
      setHasMoreServer(payload.hasMore);
      setVisibleCount(Math.min(merged.length, boundedVisibleCount + requestedLimit));
    } catch (error) {
      console.error('spacex usaspending load-more error', error);
      setErrorMessage('Unable to load additional awards right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleExpandToAll() {
    if (loading) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      let workingItems = [...items];
      let workingTotal = total;
      let workingHasMore = hasMoreServer;
      let safety = 0;

      while (workingHasMore && safety < 120) {
        const payload = await fetchPage(workingItems.length, EXPAND_ALL_STEP);
        if (!payload) break;
        workingItems = mergeByKey(workingItems, payload.items);
        if (typeof payload.total === 'number') workingTotal = payload.total;
        workingHasMore = payload.hasMore;
        if (payload.items.length < 1) break;
        safety += 1;
      }

      setItems(workingItems);
      if (typeof workingTotal === 'number') setTotal(workingTotal);
      setHasMoreServer(workingHasMore);
      setVisibleCount(workingItems.length);
    } catch (error) {
      console.error('spacex usaspending expand-all error', error);
      setErrorMessage('Unable to load all awards right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStory(rowKey: string, storyKey: string) {
    setExpandedStoryRows((current) => {
      const next = !current[rowKey];
      return { ...current, [rowKey]: next };
    });

    if (storyDetails[rowKey] || storyLoading[rowKey]) return;

    setStoryLoading((current) => ({ ...current, [rowKey]: true }));
    setStoryErrors((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    try {
      const detail = await fetchContractStoryDetail(storyKey);
      setStoryDetails((current) => ({ ...current, [rowKey]: detail }));
    } catch (error) {
      console.error('spacex usaspending contract story detail error', error);
      setStoryErrors((current) => ({
        ...current,
        [rowKey]: 'Unable to load contract story detail right now.'
      }));
    } finally {
      setStoryLoading((current) => ({ ...current, [rowKey]: false }));
    }
  }
}

async function fetchPage(offset: number, limit: number) {
  const qs = new URLSearchParams();
  qs.set('offset', String(Math.max(0, Math.trunc(offset))));
  qs.set('limit', String(Math.max(1, Math.trunc(limit))));
  const res = await fetch(`/api/public/spacex/usaspending?${qs.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `http_${res.status}`
    );
  }
  return (await res.json()) as SpacexUsaspendingApiPayload;
}

async function fetchContractStoryDetail(storyKey: string) {
  const res = await fetch(`/api/public/contracts/story/${encodeURIComponent(storyKey)}`, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(
      body && typeof body === 'object' && 'error' in body
        ? String(body.error)
        : `http_${res.status}`
    );
  }
  return (await res.json()) as ContractStoryDetail;
}

function mergeByKey(
  existing: ProgramUsaspendingAwardSummary[],
  incoming: ProgramUsaspendingAwardSummary[]
) {
  const map = new Map<string, ProgramUsaspendingAwardSummary>();
  for (const row of existing) {
    map.set(summaryKey(row), row);
  }
  for (const row of incoming) {
    const key = summaryKey(row);
    const current = map.get(key);
    if (!current) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...current,
      ...row,
      contractStory: row.contractStory || current.contractStory || null,
      storyPresentation: mergeStoryPresentation(
        current.storyPresentation,
        row.storyPresentation
      )
    });
  }
  return [...map.values()];
}

function mergeStoryPresentation(
  existing: ProgramUsaspendingAwardSummary['storyPresentation'],
  incoming: ProgramUsaspendingAwardSummary['storyPresentation']
) {
  const preferred =
    storyPresentationRank(incoming) >= storyPresentationRank(existing)
      ? incoming
      : existing;
  const fallback = preferred === incoming ? existing : incoming;

  return {
    ...fallback,
    ...preferred,
    leadCount: Math.max(existing?.leadCount || 0, incoming?.leadCount || 0),
    canonicalPath: preferred?.canonicalPath || fallback?.canonicalPath || null,
    sourceCoverage: {
      actions: Math.max(
        existing?.sourceCoverage.actions || 0,
        incoming?.sourceCoverage.actions || 0
      ),
      notices: Math.max(
        existing?.sourceCoverage.notices || 0,
        incoming?.sourceCoverage.notices || 0
      ),
      spendingPoints: Math.max(
        existing?.sourceCoverage.spendingPoints || 0,
        incoming?.sourceCoverage.spendingPoints || 0
      ),
      bidders: Math.max(
        existing?.sourceCoverage.bidders || 0,
        incoming?.sourceCoverage.bidders || 0
      ),
      exactSources: Math.max(
        existing?.sourceCoverage.exactSources || 0,
        incoming?.sourceCoverage.exactSources || 0
      )
    }
  };
}

function storyPresentationRank(
  value: ProgramUsaspendingAwardSummary['storyPresentation'] | null | undefined
) {
  if (!value) return 0;
  if (value.state === 'exact') return 3;
  if (value.state === 'lead') return 2;
  return 1;
}

function summaryKey(value: ProgramUsaspendingAwardSummary) {
  return [
    value.awardId || '',
    value.awardedOn || '',
    value.programScope || '',
    value.missionKey || ''
  ].join('|');
}

function formatDateLabel(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(parsed));
}

function formatContractAmount(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatUsaspendingAwardFamily(value: ProgramUsaspendingAwardSummary['awardFamily']) {
  if (value === 'contracts') return 'Contracts';
  if (value === 'idvs') return 'IDVs';
  if (value === 'grants') return 'Grants';
  if (value === 'loans') return 'Loans';
  if (value === 'direct_payments') return 'Direct Payments';
  if (value === 'other_financial_assistance') return 'Other Assistance';
  return 'Unclassified';
}

function formatProgramMissionLabel(value: string | null) {
  const normalized = (value || 'program').trim().toLowerCase();
  if (!normalized) return 'Program';
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}
