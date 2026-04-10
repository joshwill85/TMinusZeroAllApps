'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import InfoCard from '../../_components/InfoCard';
import SectionCard from '../../_components/SectionCard';
import { useAdminResource } from '../../_hooks/useAdminResource';

const STATE_OPTIONS = ['FL', 'CA', 'TX'] as const;
const GATE_OPTIONS = [
  { value: 'all', label: 'All shadow rows' },
  { value: 'open', label: 'Gate open only' },
  { value: 'closed', label: 'Gate closed only' }
] as const;
const SORT_OPTIONS = [
  { value: 'abs_delta', label: 'Largest change' },
  { value: 'delta_desc', label: 'Highest delta' },
  { value: 'delta_asc', label: 'Lowest delta' },
  { value: 'net', label: 'Soonest launch' }
] as const;

type StateCode = (typeof STATE_OPTIONS)[number];
type GateFilter = (typeof GATE_OPTIONS)[number]['value'];
type SortFilter = (typeof SORT_OPTIONS)[number]['value'];

type ShadowReviewStateSummary = {
  state: string;
  launches: number;
  withShadow: number;
  gateOpen: number;
  avgDelta: number | null;
};

type ShadowReviewLaunch = {
  launchId: string;
  net: string | null;
  state: string | null;
  name: string | null;
  provider: string | null;
  padName: string | null;
  locationName: string | null;
  vehicle: string | null;
  rocketFullName: string | null;
  rocketFamily: string | null;
  ll2RocketConfigId: number | null;
  baselineScore: number | null;
  baselineModelVersion: string | null;
  shadowAvailable: boolean;
  shadowScore: number | null;
  shadowRawScore: number | null;
  scoreDelta: number | null;
  gateOpen: boolean | null;
  updatedAt: string | null;
  missionProfile: {
    availability: string | null;
    factor: number | null;
    familyKey: string | null;
    familyLabel: string | null;
    matchMode: string | null;
    analystConfidence: string | null;
    sourceTitle: string | null;
    sourceRevision: string | null;
  } | null;
  pendingFamilies: string[];
  reasonCodes: string[];
};

type ShadowReviewData = {
  generatedAt: string | null;
  modelVersion: string;
  states: StateCode[];
  shadowReady: boolean;
  minAbsDelta: number | null;
  gate: GateFilter;
  sort: SortFilter;
  limit: number;
  returnedLaunches: number;
  summary: {
    targetLaunches: number;
    baselineRows: number;
    shadowRows: number;
    gateOpen: number;
    positiveDelta: number;
    negativeDelta: number;
    avgDelta: number | null;
    maxAbsDelta: number | null;
    byState: ShadowReviewStateSummary[];
  };
  launches: ShadowReviewLaunch[];
};

const EMPTY_DATA: ShadowReviewData = {
  generatedAt: null,
  modelVersion: 'jep_v6',
  states: [...STATE_OPTIONS],
  shadowReady: false,
  minAbsDelta: null,
  gate: 'all',
  sort: 'abs_delta',
  limit: 60,
  returnedLaunches: 0,
  summary: {
    targetLaunches: 0,
    baselineRows: 0,
    shadowRows: 0,
    gateOpen: 0,
    positiveDelta: 0,
    negativeDelta: 0,
    avgDelta: null,
    maxAbsDelta: null,
    byState: []
  },
  launches: []
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}`;
}

function formatDelta(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

function formatFactor(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatText(value: string | null | undefined) {
  const text = String(value || '').trim();
  return text.length ? text : '—';
}

function deltaTone(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'text-text2';
  return value > 0 ? 'text-emerald-300' : 'text-warning';
}

function gateTone(value: boolean | null | undefined) {
  if (value === true) return 'text-emerald-300';
  if (value === false) return 'text-warning';
  return 'text-text3';
}

function normalizeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizeStateCodes(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is StateCode => typeof item === 'string' && STATE_OPTIONS.includes(item as StateCode))
    : [];
}

function parseShadowReviewData(json: unknown): ShadowReviewData {
  if (!json || typeof json !== 'object') return EMPTY_DATA;
  const record = json as Record<string, unknown>;
  const summaryRecord = record.summary && typeof record.summary === 'object' ? (record.summary as Record<string, unknown>) : {};
  const byState = Array.isArray(summaryRecord.byState)
    ? summaryRecord.byState
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => ({
          state: normalizeText(item.state) || 'UNKNOWN',
          launches: normalizeNumber(item.launches) ?? 0,
          withShadow: normalizeNumber(item.withShadow) ?? 0,
          gateOpen: normalizeNumber(item.gateOpen) ?? 0,
          avgDelta: normalizeNumber(item.avgDelta)
        }))
    : [];

  const launches = Array.isArray(record.launches)
    ? record.launches
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        .map((item) => {
          const missionProfileRecord =
            item.missionProfile && typeof item.missionProfile === 'object' ? (item.missionProfile as Record<string, unknown>) : null;
          return {
            launchId: normalizeText(item.launchId) || '',
            net: normalizeText(item.net),
            state: normalizeText(item.state),
            name: normalizeText(item.name),
            provider: normalizeText(item.provider),
            padName: normalizeText(item.padName),
            locationName: normalizeText(item.locationName),
            vehicle: normalizeText(item.vehicle),
            rocketFullName: normalizeText(item.rocketFullName),
            rocketFamily: normalizeText(item.rocketFamily),
            ll2RocketConfigId: normalizeNumber(item.ll2RocketConfigId),
            baselineScore: normalizeNumber(item.baselineScore),
            baselineModelVersion: normalizeText(item.baselineModelVersion),
            shadowAvailable: item.shadowAvailable === true,
            shadowScore: normalizeNumber(item.shadowScore),
            shadowRawScore: normalizeNumber(item.shadowRawScore),
            scoreDelta: normalizeNumber(item.scoreDelta),
            gateOpen: normalizeBoolean(item.gateOpen),
            updatedAt: normalizeText(item.updatedAt),
            missionProfile: missionProfileRecord
              ? {
                  availability: normalizeText(missionProfileRecord.availability),
                  factor: normalizeNumber(missionProfileRecord.factor),
                  familyKey: normalizeText(missionProfileRecord.familyKey),
                  familyLabel: normalizeText(missionProfileRecord.familyLabel),
                  matchMode: normalizeText(missionProfileRecord.matchMode),
                  analystConfidence: normalizeText(missionProfileRecord.analystConfidence),
                  sourceTitle: normalizeText(missionProfileRecord.sourceTitle),
                  sourceRevision: normalizeText(missionProfileRecord.sourceRevision)
                }
              : null,
            pendingFamilies: normalizeStringArray(item.pendingFamilies),
            reasonCodes: normalizeStringArray(item.reasonCodes)
          } satisfies ShadowReviewLaunch;
        })
        .filter((item) => item.launchId.length > 0)
    : [];

  return {
    generatedAt: normalizeText(record.generatedAt),
    modelVersion: normalizeText(record.modelVersion) || 'jep_v6',
    states: normalizeStateCodes(record.states).length ? normalizeStateCodes(record.states) : [...STATE_OPTIONS],
    shadowReady: record.shadowReady === true,
    minAbsDelta: normalizeNumber(record.minAbsDelta),
    gate:
      record.gate === 'open' || record.gate === 'closed'
        ? record.gate
        : 'all',
    sort:
      record.sort === 'net' || record.sort === 'delta_desc' || record.sort === 'delta_asc'
        ? record.sort
        : 'abs_delta',
    limit: normalizeNumber(record.limit) ?? EMPTY_DATA.limit,
    returnedLaunches: normalizeNumber(record.returnedLaunches) ?? launches.length,
    summary: {
      targetLaunches: normalizeNumber(summaryRecord.targetLaunches) ?? 0,
      baselineRows: normalizeNumber(summaryRecord.baselineRows) ?? 0,
      shadowRows: normalizeNumber(summaryRecord.shadowRows) ?? 0,
      gateOpen: normalizeNumber(summaryRecord.gateOpen) ?? 0,
      positiveDelta: normalizeNumber(summaryRecord.positiveDelta) ?? 0,
      negativeDelta: normalizeNumber(summaryRecord.negativeDelta) ?? 0,
      avgDelta: normalizeNumber(summaryRecord.avgDelta),
      maxAbsDelta: normalizeNumber(summaryRecord.maxAbsDelta),
      byState
    },
    launches
  };
}

export default function AdminJepShadowPage() {
  const [selectedStates, setSelectedStates] = useState<StateCode[]>([...STATE_OPTIONS]);
  const [gate, setGate] = useState<GateFilter>('all');
  const [sort, setSort] = useState<SortFilter>('abs_delta');
  const [minAbsDeltaInput, setMinAbsDeltaInput] = useState('');

  const minAbsDelta = useMemo(() => {
    const parsed = Number(minAbsDeltaInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [minAbsDeltaInput]);

  const resourceUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set('states', selectedStates.join(','));
    params.set('gate', gate);
    params.set('sort', sort);
    if (minAbsDelta != null) params.set('minAbsDelta', String(minAbsDelta));
    return `/api/admin/jep/shadow-review?${params.toString()}`;
  }, [gate, minAbsDelta, selectedStates, sort]);

  const { data, status, error, refresh, lastRefreshedAt } = useAdminResource(resourceUrl, {
    initialData: EMPTY_DATA,
    parse: parseShadowReviewData
  });

  function toggleState(state: StateCode) {
    setSelectedStates((current) => {
      if (current.includes(state)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== state);
      }
      return [...current, state];
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin / Ops</p>
          <h1 className="text-3xl font-semibold text-text1">JEP Shadow Review</h1>
          <p className="text-sm text-text2">
            Review current `jep_v5` versus shadow `{data.modelVersion}` for upcoming Florida, California, and Texas launches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/admin/ops" className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]">
            Back to Ops
          </Link>
          <button
            type="button"
            onClick={() => void refresh()}
            className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
            disabled={status === 'loading'}
          >
            {status === 'loading' ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <SectionCard
        title="Review Filters"
        description={
          <>
            Shadow rows are pad-observer only. This view is for analyst sanity checks, not public-serving decisions.
            {lastRefreshedAt ? ` Last refreshed ${formatTimestamp(lastRefreshedAt)}.` : ''}
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {STATE_OPTIONS.map((state) => {
              const active = selectedStates.includes(state);
              return (
                <button
                  key={state}
                  type="button"
                  onClick={() => toggleState(state)}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-xs uppercase tracking-[0.1em]',
                    active ? 'border-primary/60 bg-primary/10 text-text1' : 'border-stroke text-text3 hover:text-text1'
                  )}
                >
                  {state}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm text-text2">
              <span className="text-xs uppercase tracking-[0.08em] text-text3">Gate</span>
              <select
                value={gate}
                onChange={(event) => setGate(event.target.value as GateFilter)}
                className="rounded-xl border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              >
                {GATE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text2">
              <span className="text-xs uppercase tracking-[0.08em] text-text3">Sort</span>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortFilter)}
                className="rounded-xl border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm text-text2">
              <span className="text-xs uppercase tracking-[0.08em] text-text3">Minimum abs delta</span>
              <input
                inputMode="decimal"
                value={minAbsDeltaInput}
                onChange={(event) => setMinAbsDeltaInput(event.target.value)}
                placeholder="0"
                className="rounded-xl border border-stroke bg-surface-1 px-3 py-2 text-sm text-text1 placeholder:text-text3"
              />
            </label>
          </div>
        </div>
      </SectionCard>

      {status === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {error || 'Admin access required. Sign in with an admin account to continue.'}
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {error || 'Failed to load JEP shadow review.'}
        </div>
      )}

      {status === 'ready' && !data.shadowReady && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          Shadow candidates are not available yet for this environment. The page still shows eligible upcoming launches, but no `jep_v6` candidate rows were found.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <InfoCard label="Target launches" value={data.summary.targetLaunches} />
        <InfoCard label="Baseline rows" value={data.summary.baselineRows} />
        <InfoCard label="Shadow rows" value={data.summary.shadowRows} />
        <InfoCard label="Gate open" value={data.summary.gateOpen} />
        <InfoCard label="Avg delta" value={formatDelta(data.summary.avgDelta)} />
        <InfoCard label="Max abs delta" value={formatDelta(data.summary.maxAbsDelta)} />
        <InfoCard label="Positive deltas" value={data.summary.positiveDelta} />
        <InfoCard label="Negative deltas" value={data.summary.negativeDelta} />
      </div>

      <SectionCard
        title="State Coverage"
        description={`Model version ${data.modelVersion}. Generated ${formatTimestamp(data.generatedAt)}.`}
      >
        {data.summary.byState.length === 0 ? (
          <div className="text-sm text-text3">No state coverage rows yet.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {data.summary.byState.map((row) => (
              <div key={row.state} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">{row.state}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="text-text2">Launches</div>
                  <div className="text-right font-semibold text-text1">{row.launches}</div>
                  <div className="text-text2">With shadow</div>
                  <div className="text-right font-semibold text-text1">{row.withShadow}</div>
                  <div className="text-text2">Gate open</div>
                  <div className="text-right font-semibold text-text1">{row.gateOpen}</div>
                  <div className="text-text2">Avg delta</div>
                  <div className={clsx('text-right font-semibold', deltaTone(row.avgDelta))}>{formatDelta(row.avgDelta)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Upcoming Launches" description="Largest deltas and prior matches are shown first by default.">
        {status === 'loading' && <div className="text-sm text-text3">Loading JEP shadow review…</div>}
        {status === 'ready' && data.launches.length === 0 && (
          <div className="text-sm text-text3">No launches matched the current filter set.</div>
        )}
        {status === 'ready' && data.launches.length > 0 && data.returnedLaunches < data.summary.targetLaunches && (
          <div className="text-sm text-text3">
            Showing the first {data.returnedLaunches} of {data.summary.targetLaunches} filtered launches. Increase `limit` in the route if you need a larger review slice.
          </div>
        )}
        {status === 'ready' && data.launches.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.08em] text-text3">
                  <th className="px-3 py-1">Launch</th>
                  <th className="px-3 py-1">Scores</th>
                  <th className="px-3 py-1">Prior match</th>
                  <th className="px-3 py-1">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.launches.map((launch) => (
                  <tr key={launch.launchId} className="align-top">
                    <td className="rounded-l-xl border border-r-0 border-stroke bg-surface-1 px-3 py-3">
                      <div className="font-semibold text-text1">{formatText(launch.name)}</div>
                      <div className="mt-1 text-xs text-text3">
                        {formatTimestamp(launch.net)} · {formatText(launch.state)} · {formatText(launch.provider)}
                      </div>
                      <div className="mt-1 text-xs text-text3">
                        {formatText(launch.rocketFullName || launch.vehicle)} · {formatText(launch.padName)}
                      </div>
                      <div className="mt-1 text-[11px] text-text3">
                        config {launch.ll2RocketConfigId ?? '—'} · {formatText(launch.locationName)}
                      </div>
                    </td>
                    <td className="border border-r-0 border-stroke bg-surface-1 px-3 py-3">
                      <div className="grid gap-1 text-xs">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-text3">Baseline</span>
                          <span className="font-semibold text-text1">{formatScore(launch.baselineScore)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-text3">Shadow</span>
                          <span className="font-semibold text-text1">{launch.shadowAvailable ? formatScore(launch.shadowScore) : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-text3">Delta</span>
                          <span className={clsx('font-semibold', deltaTone(launch.scoreDelta))}>{formatDelta(launch.scoreDelta)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-text3">Gate</span>
                          <span className={clsx('font-semibold', gateTone(launch.gateOpen))}>
                            {launch.gateOpen === true ? 'Open' : launch.gateOpen === false ? 'Closed' : '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-text3">Updated</span>
                          <span className="text-text2">{formatTimestamp(launch.updatedAt)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="border border-r-0 border-stroke bg-surface-1 px-3 py-3">
                      <div className="font-semibold text-text1">
                        {formatText(launch.missionProfile?.familyLabel || launch.missionProfile?.familyKey)}
                      </div>
                      <div className="mt-1 text-xs text-text3">
                        match {formatText(launch.missionProfile?.matchMode)} · factor {formatFactor(launch.missionProfile?.factor)}
                      </div>
                      <div className="mt-1 text-xs text-text3">
                        availability {formatText(launch.missionProfile?.availability)} · confidence{' '}
                        {formatText(launch.missionProfile?.analystConfidence)}
                      </div>
                      <div className="mt-1 text-[11px] text-text3">
                        {formatText(launch.missionProfile?.sourceTitle)}
                        {launch.missionProfile?.sourceRevision ? ` · ${launch.missionProfile.sourceRevision}` : ''}
                      </div>
                    </td>
                    <td className="rounded-r-xl border border-stroke bg-surface-1 px-3 py-3">
                      <div className="text-xs text-text3">
                        Reason codes:{' '}
                        {launch.reasonCodes.length > 0 ? launch.reasonCodes.join(', ') : '—'}
                      </div>
                      <div className="mt-2 text-xs text-text3">
                        Pending families:{' '}
                        {launch.pendingFamilies.length > 0 ? launch.pendingFamilies.join(', ') : '—'}
                      </div>
                      <div className="mt-2 text-[11px] text-text3">
                        baseline model {formatText(launch.baselineModelVersion)} · raw shadow {formatFactor(launch.shadowRawScore)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
