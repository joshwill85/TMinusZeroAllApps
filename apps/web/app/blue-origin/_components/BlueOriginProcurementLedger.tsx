'use client';

import { useMemo, useState } from 'react';
import { BlueOriginLocalTime } from '@/app/blue-origin/_components/BlueOriginLocalTime';
import type {
  ContractStoryDetail,
  ContractStoryPresentation,
  ContractStorySummary
} from '@/lib/types/contractsStory';
import { formatUsdAmount } from '@/lib/utils/formatters';

export type ProcurementEntry = {
  id: string;
  type: 'sam-opportunity' | 'sam-contract-award' | 'usaspending';
  noticeId?: string;
  awardId?: string;
  title: string;
  postedDate: string;
  amount?: number | null;
  agency?: string | null;
  status?: string;
  url?: string | null;
  sourceLabel?: string;
  linkTo?: string; // ID of related procurement entry
  contractStory?: ContractStorySummary | null;
  storyPresentation: ContractStoryPresentation;
};

type BlueOriginProcurementApiResponse = {
  items: ProcurementEntry[];
  total: number;
  limit: number;
  hasMore: boolean;
};

const INITIAL_VISIBLE_ROWS = 25;
const LOAD_MORE_STEP = 250;
const EXPAND_ALL_STEP = 1000;
const MAX_FETCH_LIMIT = 50_000;

export function BlueOriginProcurementLedger({
  entries,
  initialTotal,
  initialFetchLimit,
  initialHasMore
}: {
  entries: ProcurementEntry[];
  initialTotal: number;
  initialFetchLimit: number;
  initialHasMore: boolean;
}) {
  const [loadedEntries, setLoadedEntries] = useState<ProcurementEntry[]>(entries);
  const [total, setTotal] = useState<number>(Math.max(initialTotal, entries.length));
  const [fetchLimit, setFetchLimit] = useState(Math.max(initialFetchLimit, entries.length));
  const [hasMoreServer, setHasMoreServer] = useState(initialHasMore);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedStoryRows, setExpandedStoryRows] = useState<Record<string, boolean>>({});
  const [storyDetails, setStoryDetails] = useState<Record<string, ContractStoryDetail | null>>({});
  const [storyLoading, setStoryLoading] = useState<Record<string, boolean>>({});
  const [storyErrors, setStoryErrors] = useState<Record<string, string>>({});

  const visibleEntries = useMemo(
    () => (showAll ? loadedEntries : loadedEntries.slice(0, INITIAL_VISIBLE_ROWS)),
    [loadedEntries, showAll]
  );
  const knownTotal = Math.max(total, loadedEntries.length);
  const canExpand = loadedEntries.length > INITIAL_VISIBLE_ROWS;
  const canLoadMore =
    (hasMoreServer || loadedEntries.length < knownTotal) &&
    fetchLimit < MAX_FETCH_LIMIT;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between border-b border-stroke pb-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-text1">Financial Audit Trail</h3>
        <div className="flex flex-wrap items-center justify-end gap-3 text-[10px] font-bold uppercase tracking-widest text-text3">
          <span className="rounded-full border border-stroke px-2 py-1 text-[9px]">
            {knownTotal} records
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary/50"></span>
            SAM Opportunity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-info/60"></span>
            SAM Contract Award
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success/50"></span>
            USASpending Award
          </span>
        </div>
      </header>

      {errorMessage ? (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {errorMessage}
        </p>
      ) : null}
      
      <div className="flex flex-col gap-2">
        {visibleEntries.map((entry) => {
          const tone = resolveEntryTone(entry.type);
          const storySummary = entry.contractStory || null;
          const storyPresentation = entry.storyPresentation;
          const storyExpanded = Boolean(expandedStoryRows[entry.id]);
          const storyPending = Boolean(storyLoading[entry.id]);
          const storyDetail = storyDetails[entry.id] || null;
          const storyError = storyErrors[entry.id] || null;
          const primaryUrl = resolvePrimaryEntryUrl(entry);
          return (
            <div
              key={entry.id}
              className={`group relative flex items-start gap-6 rounded-lg border bg-surface-1/40 p-4 transition-all hover:bg-surface-1 ${tone.cardBorderClass}`}
            >
              <div
                className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${tone.dotClass}`}
                title={tone.dotTitle}
              />

              <div className="grid w-full gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_125px_120px_110px] md:items-start">
                <div className="min-w-0 flex-grow">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-tighter text-text3">
                      {entry.noticeId || entry.awardId || 'ID PENDING'}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text3">
                      {entry.agency || 'AGENCY UNKNOWN'}
                    </span>
                    {entry.sourceLabel ? (
                      <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${tone.badgeClass}`}>
                        {entry.sourceLabel}
                      </span>
                    ) : null}
                  </div>
                  {primaryUrl ? (
                    <a
                      href={primaryUrl}
                      target={isExternalHref(primaryUrl) ? '_blank' : undefined}
                      rel={isExternalHref(primaryUrl) ? 'noreferrer' : undefined}
                      className="mt-1 line-clamp-2 text-[13px] font-semibold text-text1 hover:text-primary"
                    >
                      {entry.title}
                    </a>
                  ) : (
                    <p className="mt-1 line-clamp-2 text-[13px] font-semibold text-text1">{entry.title}</p>
                  )}
                </div>

                <div className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-text3">Date</span>
                  <BlueOriginLocalTime
                    value={entry.postedDate}
                    variant="date"
                    className="font-mono text-[11px] text-text2"
                    fallback="Date TBD"
                  />
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-text3">Value</span>
                  {entry.amount != null ? (
                    <span className="font-mono text-[11px] font-bold text-text1">{formatUsdAmount(entry.amount)}</span>
                  ) : (
                    <span className="text-[11px] text-text3">N/A</span>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-text3">Status</span>
                  <span className="text-[10px] font-bold uppercase tracking-tighter text-text3">
                    {entry.status || 'N/A'}
                  </span>
                </div>
              </div>

              {storySummary ? (
                <div className="mt-2 ml-9 mr-1 rounded-md border border-stroke/70 bg-surface-1/40 p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                        In-house page
                      </span>
                      <span>
                        {storySummary.actionCount} actions • {storySummary.noticeCount} notices
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={storyPending}
                      onClick={() => void handleToggleStory(entry.id, storySummary.storyKey)}
                      className="rounded border border-stroke px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-text2 hover:text-text1 disabled:opacity-60"
                    >
                      {storyPending ? 'Loading…' : storyExpanded ? 'Hide page' : 'Open page'}
                    </button>
                  </div>
                  {storyError ? (
                    <p className="mt-1 text-[11px] text-warning">{storyError}</p>
                  ) : null}
                  {storyExpanded && storyDetail ? (
                    <div className="mt-2 space-y-1 text-[11px] text-text3">
                      <p>
                        Bidders: {storyDetail.bidders.length}
                        {storyDetail.summary.latestNoticeDate ? ` • Last notice ${storyDetail.summary.latestNoticeDate}` : ''}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {storyDetail.links.usaspendingUrl ? (
                          <a href={storyDetail.links.usaspendingUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                            USASpending
                          </a>
                        ) : null}
                        {storyDetail.links.samSearchUrl ? (
                          <a href={storyDetail.links.samSearchUrl} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
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
                <div className="mt-2 ml-9 mr-1 rounded-md border border-warning/20 bg-warning/5 p-2 text-[11px] text-text3">
                  {storyPresentation.leadCount} related SAM record{storyPresentation.leadCount === 1 ? '' : 's'} are still waiting for a confident match to an in-house page.
                </div>
              ) : (
                <div className="mt-2 ml-9 mr-1 rounded-md border border-stroke/70 bg-surface-1/40 p-2 text-[11px] text-text3">
                  In-house page pending.
                </div>
              )}

              {entry.linkTo ? (
                <div className="absolute -bottom-4 left-[1.125rem] z-10 h-4 w-px bg-stroke group-hover:bg-primary/40" />
              ) : null}
            </div>
          );
        })}
      </div>

      {canExpand || canLoadMore ? (
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.08em] text-text3">
              Showing {visibleEntries.length} of {knownTotal}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {canLoadMore ? (
                <button
                  type="button"
                  onClick={() => void handleLoadMore()}
                  disabled={loading}
                  className="rounded-full border border-stroke px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text1 transition hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Loading…' : `Load ${LOAD_MORE_STEP} More`}
                </button>
              ) : null}
              {canLoadMore ? (
                <button
                  type="button"
                  onClick={() => void handleExpandToAll()}
                  disabled={loading}
                  className="rounded-full border border-stroke px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text1 transition hover:border-primary/60 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'Loading…' : `Expand to All (${knownTotal})`}
                </button>
              ) : null}
              {canExpand ? (
                <button
                  type="button"
                  onClick={() => setShowAll((current) => !current)}
                  className="rounded-full border border-stroke px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-text1 transition hover:border-primary/60 hover:text-primary"
                >
                  {showAll ? `Show First ${INITIAL_VISIBLE_ROWS}` : `Show Loaded (${loadedEntries.length} of ${knownTotal})`}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  async function handleLoadMore() {
    if (loading || !canLoadMore) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const targetLimit = Math.min(MAX_FETCH_LIMIT, fetchLimit + LOAD_MORE_STEP);
      const payload = await fetchProcurementPage(targetLimit);
      const deduped = dedupeById(payload.items);
      setLoadedEntries(deduped);
      setTotal(Math.max(payload.total, deduped.length));
      setFetchLimit(payload.limit);
      setHasMoreServer(payload.hasMore);
      setShowAll(true);
    } catch (error) {
      console.error('blue origin procurement load-more error', error);
      setErrorMessage('Unable to load more procurement records right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleExpandToAll() {
    if (loading || !canLoadMore) {
      if (!loading && canExpand) setShowAll(true);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    try {
      let targetLimit = fetchLimit;
      let nextTotal = total;
      let nextHasMore: boolean = hasMoreServer;
      let nextItems = loadedEntries;
      let safety = 0;
      while (nextHasMore && targetLimit < MAX_FETCH_LIMIT && safety < 80) {
        targetLimit = Math.min(MAX_FETCH_LIMIT, targetLimit + EXPAND_ALL_STEP);
        const payload = await fetchProcurementPage(targetLimit);
        nextItems = dedupeById(payload.items);
        nextTotal = Math.max(nextTotal, payload.total, nextItems.length);
        targetLimit = payload.limit;
        nextHasMore = payload.hasMore;
        if (payload.items.length < 1) break;
        safety += 1;
      }
      setLoadedEntries(nextItems);
      setTotal(nextTotal);
      setFetchLimit(targetLimit);
      setHasMoreServer(nextHasMore);
      setShowAll(true);
    } catch (error) {
      console.error('blue origin procurement expand-all error', error);
      setErrorMessage('Unable to load the full procurement feed right now.');
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStory(entryId: string, storyKey: string) {
    setExpandedStoryRows((current) => ({
      ...current,
      [entryId]: !current[entryId]
    }));

    if (storyDetails[entryId] || storyLoading[entryId]) return;

    setStoryLoading((current) => ({ ...current, [entryId]: true }));
    setStoryErrors((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
    try {
      const detail = await fetchContractStoryDetail(storyKey);
      setStoryDetails((current) => ({ ...current, [entryId]: detail }));
    } catch (error) {
      console.error('blue origin contract story detail error', error);
      setStoryErrors((current) => ({
        ...current,
        [entryId]: 'Unable to load contract story detail right now.'
      }));
    } finally {
      setStoryLoading((current) => ({ ...current, [entryId]: false }));
    }
  }
}

async function fetchProcurementPage(
  limit: number
): Promise<BlueOriginProcurementApiResponse> {
  const qs = new URLSearchParams();
  qs.set('limit', String(Math.max(1, Math.trunc(limit))));
  const res = await fetch(`/api/public/blue-origin/procurement?${qs.toString()}`, {
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
  return (await res.json()) as BlueOriginProcurementApiResponse;
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

function dedupeById(entries: ProcurementEntry[]) {
  const map = new Map<string, ProcurementEntry>();
  for (const entry of entries) {
    const current = map.get(entry.id);
    if (!current) {
      map.set(entry.id, entry);
      continue;
    }
    map.set(entry.id, {
      ...current,
      ...entry,
      contractStory: entry.contractStory || current.contractStory || null,
      storyPresentation: mergeStoryPresentation(
        current.storyPresentation,
        entry.storyPresentation
      )
    });
  }
  return [...map.values()];
}

function mergeStoryPresentation(
  existing: ContractStoryPresentation,
  incoming: ContractStoryPresentation
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

function storyPresentationRank(value: ContractStoryPresentation | null | undefined) {
  if (!value) return 0;
  if (value.state === 'exact') return 3;
  if (value.state === 'lead') return 2;
  return 1;
}

function resolveEntryTone(type: ProcurementEntry['type']) {
  if (type === 'sam-contract-award') {
    return {
      dotClass: 'bg-info/60',
      dotTitle: 'SAM.gov Contract Award',
      badgeClass: 'border-info/40 bg-info/10 text-info',
      cardBorderClass: 'border-stroke hover:border-info/50'
    };
  }
  if (type === 'usaspending') {
    return {
      dotClass: 'bg-success/50',
      dotTitle: 'USASpending Award',
      badgeClass: 'border-success/40 bg-success/10 text-success',
      cardBorderClass: 'border-stroke hover:border-success/50'
    };
  }
  return {
    dotClass: 'bg-primary/50',
    dotTitle: 'SAM.gov Opportunity',
    badgeClass: 'border-primary/40 bg-primary/10 text-primary',
    cardBorderClass: 'border-stroke hover:border-primary/50'
  };
}

function resolvePrimaryEntryUrl(entry: ProcurementEntry) {
  if (!entry.url) return entry.storyPresentation?.canonicalPath || null;
  if (isGenericSamSearchUrl(entry.url) && entry.storyPresentation?.canonicalPath) {
    return entry.storyPresentation.canonicalPath;
  }
  return entry.url;
}

function isExternalHref(value: string) {
  return /^https?:\/\//i.test(value);
}

function isGenericSamSearchUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.endsWith('sam.gov') && parsed.pathname.replace(/\/+$/, '') === '/search';
  } catch {
    return false;
  }
}
