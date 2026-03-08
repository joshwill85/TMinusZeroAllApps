'use client';

import clsx from 'clsx';
import { type FormEvent, useMemo, useState } from 'react';
import InfoCard from '../_components/InfoCard';
import SectionCard from '../_components/SectionCard';
import { useAdminResource } from '../_hooks/useAdminResource';
import { formatTimestamp } from '../_lib/format';
import {
  ADMIN_USASPENDING_REVIEW_TIERS,
  ADMIN_USASPENDING_SCOPES,
  createEmptyAdminUsaspendingReviewCounts,
  type AdminUsaspendingReviewRow,
  type AdminUsaspendingReviewTier,
  type AdminUsaspendingReviewsResponse,
  type AdminUsaspendingScope
} from '@/lib/types/adminUsaspending';

const PAGE_SIZE = 100;
const SCOPE_LABELS: Record<AdminUsaspendingScope, string> = {
  artemis: 'Artemis',
  'blue-origin': 'Blue Origin',
  spacex: 'SpaceX'
};

const TIER_LABELS: Record<AdminUsaspendingReviewTier, string> = {
  candidate: 'Candidate',
  excluded: 'Excluded'
};

const EMPTY_RESPONSE: AdminUsaspendingReviewsResponse = {
  scope: 'blue-origin',
  tier: 'candidate',
  total: 0,
  offset: 0,
  limit: PAGE_SIZE,
  query: '',
  counts: createEmptyAdminUsaspendingReviewCounts(),
  items: []
};

export default function AdminUsaspendingPage() {
  const [activeScope, setActiveScope] = useState<AdminUsaspendingScope>('blue-origin');
  const [activeTier, setActiveTier] = useState<AdminUsaspendingReviewTier>('candidate');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [promotingKey, setPromotingKey] = useState<string | null>(null);

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams({
      scope: activeScope,
      tier: activeTier,
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
    if (query) params.set('query', query);
    return `/api/admin/usaspending/reviews?${params.toString()}`;
  }, [activeScope, activeTier, offset, query]);

  const { data, status, error, setError, refresh } = useAdminResource<AdminUsaspendingReviewsResponse>(requestUrl, {
    initialData: EMPTY_RESPONSE
  });

  const items = data.items || [];
  const currentStart = items.length > 0 ? data.offset + 1 : 0;
  const currentEnd = data.offset + items.length;
  const scopeTotal = countScopeTotal(data.counts, activeScope);
  const queryLabel = data.query ? `Matching "${data.query}"` : 'All rows';

  async function handlePromote(row: AdminUsaspendingReviewRow) {
    const rowKey = buildRowKey(row);
    setPromotingKey(rowKey);
    setMessage(null);
    setActionError(null);
    setError(null);

    try {
      const res = await fetch('/api/admin/usaspending/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote',
          awardIdentityKey: row.awardIdentityKey,
          programScope: row.programScope
        })
      });
      const json = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        throw new Error(readErrorMessage(json, 'Failed to promote review row.'));
      }

      setMessage(`Promoted ${row.awardId || row.title || 'award'} to exact for ${SCOPE_LABELS[row.programScope]}.`);
      if (items.length === 1 && data.offset > 0) {
        setOffset(Math.max(0, data.offset - data.limit));
      } else {
        await refresh();
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to promote review row.');
    } finally {
      setPromotingKey(null);
    }
  }

  function selectScope(scope: AdminUsaspendingScope) {
    setActiveScope(scope);
    setOffset(0);
    setMessage(null);
    setActionError(null);
  }

  function selectTier(tier: AdminUsaspendingReviewTier) {
    setActiveTier(tier);
    setOffset(0);
    setMessage(null);
    setActionError(null);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = queryInput.trim();
    setQuery(nextQuery);
    setOffset(0);
    setMessage(null);
    setActionError(null);
  }

  function clearSearch() {
    setQuery('');
    setQueryInput('');
    setOffset(0);
    setMessage(null);
    setActionError(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
          <h1 className="text-3xl font-semibold text-text1">USASpending Review Queue</h1>
          <p className="text-sm text-text2">
            Moderate candidate and excluded audit rows by hub. Open the public USAspending page, inspect the classifier
            evidence, and promote rows into the audited exact set.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
          disabled={status === 'loading'}
          onClick={() => {
            setMessage(null);
            setActionError(null);
            void refresh();
          }}
        >
          {status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {status === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          Admin access required. Sign in with an admin account to continue.
        </div>
      )}
      {(error || actionError) && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {actionError || error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-success/40 bg-[rgba(74,222,128,0.08)] p-3 text-sm text-success">
          {message}
        </div>
      )}

      <SectionCard
        title="Filters"
        description="Switch hub and tier, then page through the current review inventory. Search matches award ID, title, recipient, and mission key."
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text3">Program Hub</div>
            <div className="flex flex-wrap gap-2">
              {ADMIN_USASPENDING_SCOPES.map((scope) => {
                const total = countScopeTotal(data.counts, scope);
                return (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => selectScope(scope)}
                    className={clsx(
                      'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.08em]',
                      activeScope === scope
                        ? 'border-primary/60 bg-primary/10 text-text1'
                        : 'border-stroke text-text3 hover:text-text1'
                    )}
                  >
                    {SCOPE_LABELS[scope]} {formatCompactCount(total)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text3">Tier</div>
            <div className="flex flex-wrap gap-2">
              {ADMIN_USASPENDING_REVIEW_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => selectTier(tier)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.08em]',
                    activeTier === tier
                      ? 'border-primary/60 bg-primary/10 text-text1'
                      : 'border-stroke text-text3 hover:text-text1'
                  )}
                >
                  {TIER_LABELS[tier]} {formatCompactCount(data.counts[activeScope][tier])}
                </button>
              ))}
            </div>
          </div>

          <form className="flex flex-col gap-2 md:flex-row" onSubmit={submitSearch}>
            <input
              type="search"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Search award ID, title, recipient, mission key"
              className="min-w-0 flex-1 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-sm text-text1 outline-none ring-0 placeholder:text-text3"
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-secondary rounded-lg px-3 py-2 text-sm">
                Search
              </button>
              <button
                type="button"
                className="btn-secondary rounded-lg px-3 py-2 text-sm"
                onClick={clearSearch}
                disabled={!query && !queryInput}
              >
                Clear
              </button>
            </div>
          </form>
        </div>
      </SectionCard>

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard label="Hub flagged rows" value={scopeTotal.toLocaleString()} />
        <InfoCard label="Current tier rows" value={data.counts[activeScope][activeTier].toLocaleString()} />
        <InfoCard label="Showing" value={currentStart > 0 ? `${currentStart}-${currentEnd}` : '0'} />
        <InfoCard label="Search" value={queryLabel} />
      </div>

      <SectionCard
        title={`${SCOPE_LABELS[activeScope]} ${TIER_LABELS[activeTier]}`}
        description={`Showing ${currentStart > 0 ? `${currentStart}-${currentEnd}` : '0'} of ${data.total.toLocaleString()} rows in the current view.`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.08em]"
              onClick={() => setOffset(Math.max(0, data.offset - data.limit))}
              disabled={data.offset < 1 || status === 'loading'}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.08em]"
              onClick={() => setOffset(data.offset + data.limit)}
              disabled={currentEnd >= data.total || items.length < data.limit || status === 'loading'}
            >
              Next
            </button>
          </div>
        }
      >
        {status === 'loading' && <div className="text-sm text-text3">Loading review rows...</div>}
        {status === 'ready' && items.length === 0 && (
          <div className="rounded-xl border border-stroke bg-surface-0 px-4 py-5 text-sm text-text3">
            No {TIER_LABELS[activeTier].toLowerCase()} rows found for {SCOPE_LABELS[activeScope]}
            {data.query ? ` matching "${data.query}".` : '.'}
          </div>
        )}
        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((row) => {
              const rowKey = buildRowKey(row);
              const isPromoting = promotingKey === rowKey;
              return (
                <article key={rowKey} className="rounded-2xl border border-stroke bg-surface-0 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.08em] text-text3">
                        <span className="rounded-full border border-stroke px-2 py-0.5 font-mono">
                          {row.awardId || 'No award ID'}
                        </span>
                        <span className="rounded-full border border-stroke px-2 py-0.5">
                          {formatAwardFamily(row.awardFamily)}
                        </span>
                        {row.awardedOn && (
                          <span className="rounded-full border border-stroke px-2 py-0.5">
                            {formatDate(row.awardedOn)}
                          </span>
                        )}
                        {row.missionKey && (
                          <span className="rounded-full border border-stroke px-2 py-0.5">{row.missionKey}</span>
                        )}
                      </div>

                      <h2 className="mt-2 break-words text-base font-semibold text-text1">
                        {row.sourceUrl ? (
                          <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-text1">
                            {row.title || row.awardId || 'USASpending award'}
                          </a>
                        ) : (
                          row.title || row.awardId || 'USASpending award'
                        )}
                      </h2>

                      <div className="mt-1 text-sm text-text2">{row.recipient || 'Unknown recipient'}</div>

                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text3">
                        <span className="rounded-full border border-stroke px-2 py-0.5">
                          {formatCurrency(row.obligatedAmount)}
                        </span>
                        <span className="rounded-full border border-stroke px-2 py-0.5">
                          Auto {row.autoTier}
                        </span>
                        {row.finalTier && (
                          <span className="rounded-full border border-stroke px-2 py-0.5">
                            Final {row.finalTier}
                          </span>
                        )}
                        <span className="rounded-full border border-stroke px-2 py-0.5">
                          Review {row.reviewStatus}
                        </span>
                        {row.score != null && (
                          <span className="rounded-full border border-stroke px-2 py-0.5">Score {row.score}</span>
                        )}
                        {row.canonicalRecipientMatch === true && (
                          <span className="rounded-full border border-success/40 bg-[rgba(74,222,128,0.08)] px-2 py-0.5 text-success">
                            Canonical recipient
                          </span>
                        )}
                        {row.storyLinked === true && (
                          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-text1">
                            Story linked
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {row.sourceUrl && (
                        <a
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.08em]"
                        >
                          USAspending
                        </a>
                      )}
                      <button
                        type="button"
                        className="rounded-full border border-success/40 bg-[rgba(74,222,128,0.08)] px-3 py-1 text-xs uppercase tracking-[0.08em] text-success disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handlePromote(row)}
                        disabled={isPromoting}
                      >
                        {isPromoting ? 'Promoting…' : 'Promote'}
                      </button>
                    </div>
                  </div>

                  <ChipGroup label="Reason codes" items={row.reasonCodes} tone="warning" />
                  <ChipGroup label="Signals" items={row.signals} tone="neutral" />

                  {(row.liveRecipientName ||
                    row.liveParentRecipientName ||
                    row.declaredScopes.length > 0 ||
                    row.reviewNotes ||
                    hasSnapshotContent(row.signalSnapshot) ||
                    hasSnapshotContent(row.liveSourceSnapshot)) && (
                    <details className="mt-3 rounded-xl border border-stroke bg-surface-1 p-3">
                      <summary className="cursor-pointer list-none text-sm font-medium text-text2 [&::-webkit-details-marker]:hidden">
                        Inspect evidence
                      </summary>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <div className="space-y-2 text-sm text-text2">
                          <div>
                            <span className="text-text3">Source title:</span> {row.sourceTitle || 'USASpending award record'}
                          </div>
                          <div>
                            <span className="text-text3">Last updated:</span> {formatTimestamp(row.updatedAt)}
                          </div>
                          {row.liveRecipientName && (
                            <div>
                              <span className="text-text3">Live recipient:</span> {row.liveRecipientName}
                            </div>
                          )}
                          {row.liveParentRecipientName && (
                            <div>
                              <span className="text-text3">Live parent recipient:</span> {row.liveParentRecipientName}
                            </div>
                          )}
                          {row.declaredScopes.length > 0 && (
                            <div>
                              <span className="text-text3">Declared scopes:</span>{' '}
                              {row.declaredScopes.map((scope) => SCOPE_LABELS[scope]).join(', ')}
                            </div>
                          )}
                          {row.auditVersion && (
                            <div>
                              <span className="text-text3">Audit version:</span> {row.auditVersion}
                            </div>
                          )}
                          {row.reviewNotes && (
                            <div>
                              <span className="text-text3">Review notes:</span> {row.reviewNotes}
                            </div>
                          )}
                        </div>

                        <div className="space-y-3">
                          {hasSnapshotContent(row.signalSnapshot) && (
                            <SnapshotBlock title="Signal snapshot" value={row.signalSnapshot} />
                          )}
                          {hasSnapshotContent(row.liveSourceSnapshot) && (
                            <SnapshotBlock title="Live source snapshot" value={row.liveSourceSnapshot} />
                          )}
                        </div>
                      </div>
                    </details>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function ChipGroup({
  label,
  items,
  tone
}: {
  label: string;
  items: string[];
  tone: 'warning' | 'neutral';
}) {
  if (items.length < 1) return null;
  return (
    <div className="mt-3">
      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={`${label}:${item}`}
            className={clsx(
              'rounded-full border px-2 py-0.5 text-[11px]',
              tone === 'warning'
                ? 'border-warning/30 bg-[rgba(251,191,36,0.08)] text-warning'
                : 'border-stroke text-text2'
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function SnapshotBlock({ title, value }: { title: string; value: Record<string, unknown> | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text3">{title}</div>
      <pre className="max-h-64 overflow-auto rounded-xl border border-stroke bg-surface-0 p-3 text-xs text-text2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function hasSnapshotContent(value: Record<string, unknown> | null) {
  return Boolean(value && Object.keys(value).length > 0);
}

function buildRowKey(row: AdminUsaspendingReviewRow) {
  return `${row.programScope}:${row.awardIdentityKey}`;
}

function countScopeTotal(
  counts: AdminUsaspendingReviewsResponse['counts'],
  scope: AdminUsaspendingScope
) {
  return counts[scope].candidate + counts[scope].excluded;
}

function formatCompactCount(value: number) {
  return `(${value.toLocaleString()})`;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function formatCurrency(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Amount unavailable';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  }).format(value);
}

function formatAwardFamily(value: AdminUsaspendingReviewRow['awardFamily']) {
  if (value === 'direct_payments') return 'Direct payments';
  if (value === 'other_financial_assistance') return 'Other financial assistance';
  return value.toUpperCase().replace(/_/g, ' ');
}

function readErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') {
    return value.error;
  }
  return fallback;
}
