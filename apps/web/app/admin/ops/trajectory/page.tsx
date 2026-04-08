'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import InfoCard from '../../_components/InfoCard';
import SectionCard from '../../_components/SectionCard';
import { useAdminResource } from '../../_hooks/useAdminResource';
import { FALLBACK_ADMIN_SUMMARY, parseAdminSummary } from '../../_lib/summary';

type TrajectoryInspectorEligibleLaunch = {
  launchId: string;
  net: string | null;
  expiresAt: string;
  name: string;
  provider: string | null;
  vehicle: string | null;
  padName: string | null;
  locationName: string | null;
};

type TrajectoryInspectorGapSummary = {
  counts: {
    landing: number;
    orbit: number;
    hazard: number;
    missionInfographic: number;
    orbitTruth: number;
    orbitDerived: number;
    hazardWithGeometry: number;
    hazardNearNet: number;
  };
  signals: {
    hasLandingLatLon: boolean;
    hasOrbitFlightAzimuth: boolean;
    hasOrbitInclination: boolean;
    hasOrbitAltitude: boolean;
    hasTruthTierOrbit: boolean;
    hasDerivedOnlyOrbit: boolean;
    hasHazardGeometry: boolean;
    hasHazardWindowNearNet: boolean;
    hasDirectionalConstraint: boolean;
    hasConstraintBackedDirectionalSource: boolean;
  };
  freshness: {
    missingProduct: boolean;
    productStale: boolean;
  };
  product: {
    qualityLabel: string | null;
    confidenceTier: string | null;
    freshnessState: string | null;
    lineageComplete: boolean | null;
    sourceSummaryCode: string | null;
    sourceSummaryLabel: string | null;
    directionalSourceCode: string;
    directionalSourceLabel: string;
    usedConstraintCount: number | null;
  };
  gapReasons: Array<{ code: string; label: string }>;
  primaryGap: { code: string; label: string } | null;
};

type TrajectoryInspectorResult = {
  generatedAt: string;
  eligibleLaunchIds: string[];
  launch: Record<string, unknown> | null;
  product: {
    launchId: string;
    version: string;
    quality: number;
    generatedAt: string;
    confidenceTier: string | null;
    freshnessState: string | null;
    lineageComplete: boolean | null;
    sourceSufficiency: Record<string, unknown> | null;
    product: unknown;
  } | null;
  productMeta: {
    qualityLabel: string | null;
    sampleCount: number;
    eventCount: number;
    assumptionCount: number;
    durationS: number | null;
    stepS: number | null;
  } | null;
  missingProduct: boolean;
  productStale: boolean;
  productStaleReasons: Array<{ constraintType: string; newestFetchedAt: string }>;
  constraints: Array<Record<string, unknown>>;
  constraintSummary: Array<{ constraintType: string; count: number; newestFetchedAt: string | null }>;
  opsGapSummary: TrajectoryInspectorGapSummary;
};

function formatPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNum(value: number | null | undefined, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function formatProfileLabel(profile: string) {
  if (profile === 'android_chrome') return 'Android Chrome';
  if (profile === 'android_samsung_internet') return 'Samsung Internet';
  if (profile === 'ios_webkit') return 'iOS WebKit';
  if (profile === 'android_fallback') return 'Android fallback';
  return profile;
}

function formatPoseModeLabel(mode: 'webxr' | 'sensor_fused' | null) {
  if (mode === 'webxr') return 'WebXR first';
  if (mode === 'sensor_fused') return 'Sensor first';
  return 'Hold default';
}

function formatBool(value: boolean | null | undefined) {
  return value ? 'yes' : 'no';
}

function formatValue(value: string | number | null | undefined) {
  if (value == null) return '—';
  const text = String(value).trim();
  return text.length > 0 ? text : '—';
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return '—';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

function adapterStatusClass(status: 'operational' | 'degraded' | 'down' | 'unknown') {
  if (status === 'operational') return 'text-emerald-300';
  if (status === 'degraded') return 'text-warning';
  if (status === 'down') return 'text-danger';
  return 'text-text3';
}

function formatTelemetryRuntimeFamilyLabel(runtimeFamily: 'web' | 'ios_native' | 'android_native' | 'unknown') {
  if (runtimeFamily === 'web') return 'Web';
  if (runtimeFamily === 'ios_native') return 'iOS native';
  if (runtimeFamily === 'android_native') return 'Android native';
  return 'Unknown';
}

function findCompletenessField(
  fields: Array<{
    key: string;
    label: string;
    applicableSessions: number;
    filledSessions: number;
    fillRate: number | null;
  }>,
  key: string
) {
  return fields.find((field) => field.key === key) ?? null;
}

export default function AdminTrajectoryPage() {
  const { data: summary, status: summaryStatus, error: summaryError } = useAdminResource('/api/admin/summary', {
    initialData: FALLBACK_ADMIN_SUMMARY,
    parse: parseAdminSummary
  });

  const [trajectoryEligible, setTrajectoryEligible] = useState<TrajectoryInspectorEligibleLaunch[]>([]);
  const [trajectoryEligibleStatus, setTrajectoryEligibleStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [trajectoryEligibleError, setTrajectoryEligibleError] = useState<string | null>(null);
  const [trajectoryInspections, setTrajectoryInspections] = useState<Record<string, TrajectoryInspectorResult>>({});
  const [trajectoryInspectionErrors, setTrajectoryInspectionErrors] = useState<Record<string, string>>({});
  const [trajectoryInspectingId, setTrajectoryInspectingId] = useState<string | null>(null);

  useEffect(() => {
    if (summaryStatus !== 'ready') return;
    let cancelled = false;
    setTrajectoryEligibleStatus('loading');
    setTrajectoryEligibleError(null);
    fetch('/api/admin/trajectory/eligible', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || 'Failed to load trajectory eligible launches');
        }
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setTrajectoryEligible(Array.isArray(json.launches) ? (json.launches as TrajectoryInspectorEligibleLaunch[]) : []);
        setTrajectoryEligibleStatus('ready');
      })
      .catch((err) => {
        console.error('trajectory eligible fetch error', err);
        if (!cancelled) {
          setTrajectoryEligibleStatus('error');
          setTrajectoryEligibleError(err.message || 'Failed to load eligible launches');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [summaryStatus]);

  async function refreshTrajectoryEligible() {
    if (summaryStatus !== 'ready' || trajectoryEligibleStatus === 'loading') return;
    setTrajectoryEligibleStatus('loading');
    setTrajectoryEligibleError(null);
    try {
      const res = await fetch('/api/admin/trajectory/eligible', { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to load trajectory eligible launches');
      }
      const json = await res.json();
      const launches = Array.isArray(json.launches) ? (json.launches as TrajectoryInspectorEligibleLaunch[]) : [];
      setTrajectoryEligible(launches);
      setTrajectoryInspections((prev) => {
        const next: Record<string, TrajectoryInspectorResult> = {};
        for (const launch of launches) {
          const cached = prev[launch.launchId];
          if (cached) next[launch.launchId] = cached;
        }
        return next;
      });
      setTrajectoryInspectionErrors((prev) => {
        const next: Record<string, string> = {};
        for (const launch of launches) {
          const cached = prev[launch.launchId];
          if (cached) next[launch.launchId] = cached;
        }
        return next;
      });
      setTrajectoryEligibleStatus('ready');
    } catch (err: any) {
      setTrajectoryEligibleStatus('error');
      setTrajectoryEligibleError(err?.message || 'Failed to load eligible launches');
    }
  }

  async function loadTrajectoryInspection(launchId: string, { force = false }: { force?: boolean } = {}) {
    if (summaryStatus !== 'ready') return;
    if (!force && trajectoryInspections[launchId]) return;
    if (trajectoryInspectingId) return;
    setTrajectoryInspectingId(launchId);
    setTrajectoryInspectionErrors((prev) => {
      const next = { ...prev };
      delete next[launchId];
      return next;
    });
    try {
      const res = await fetch(`/api/admin/trajectory/inspect/${launchId}`, { cache: 'no-store' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to load trajectory inspection');
      }
      const json = (await res.json()) as TrajectoryInspectorResult;
      setTrajectoryInspections((prev) => ({ ...prev, [launchId]: json }));
    } catch (err: any) {
      setTrajectoryInspectionErrors((prev) => ({ ...prev, [launchId]: err?.message || 'Failed to load inspection' }));
    } finally {
      setTrajectoryInspectingId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.1em] text-text3">Admin</p>
          <h1 className="text-3xl font-semibold text-text1">Trajectory</h1>
          <p className="text-sm text-text2">Pipeline freshness + per-launch inputs and product metadata.</p>
        </div>
        <Link href="/admin/ops" className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]">
          Back to ops
        </Link>
      </div>

      {summaryStatus === 'loading' && (
        <div className="rounded-xl border border-stroke bg-surface-1 p-3 text-sm text-text3">Loading…</div>
      )}

      {summaryStatus === 'unauthorized' && (
        <div className="rounded-xl border border-warning bg-[rgba(251,191,36,0.08)] p-3 text-sm text-warning">
          {summaryError || 'Admin access required. Sign in with an admin account to continue.'}
        </div>
      )}

      {summaryStatus === 'error' && (
        <div className="rounded-xl border border-danger bg-[rgba(251,113,133,0.08)] p-3 text-sm text-danger">
          {summaryError || 'Failed to load admin summary.'}
        </div>
      )}

      {summaryStatus === 'ready' && (
        <SectionCard
          title="Trajectory pipeline"
          description={
            <>
              Uses <span className="font-mono text-[11px]">system_settings.trajectory_products_top3_ids</span> and compares constraints vs product generated_at.
            </>
          }
          actions={
            <span className="text-xs uppercase tracking-[0.1em] text-text3">
              {summary.trajectoryPipeline ? 'Freshness' : 'Unavailable'}
            </span>
          }
        >
          {!summary.trajectoryPipeline && (
            <div className="text-sm text-text3">Trajectory pipeline summary unavailable (requires service role).</div>
          )}
          {summary.trajectoryPipeline && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <InfoCard label="Eligible" value={summary.trajectoryPipeline.eligibleLaunchIds.length} />
                <InfoCard label="Missing products" value={summary.trajectoryPipeline.missingProductsCount} />
                <InfoCard label="Stale products" value={summary.trajectoryPipeline.staleProductsCount} />
                <InfoCard label="Precision stale" value={summary.trajectoryPipeline.precisionStaleProductsCount} />
              </div>
              {summary.trajectoryPipeline.eligibleLaunchIds.length > 0 && (
                <div className="mt-3 break-words font-mono text-xs text-text3">
                  Eligible: {summary.trajectoryPipeline.eligibleLaunchIds.join(', ')}
                </div>
              )}
              {summary.trajectoryPipeline.missingLaunchIds.length > 0 && (
                <div className="mt-2 break-words font-mono text-xs text-danger">
                  Missing: {summary.trajectoryPipeline.missingLaunchIds.join(', ')}
                </div>
              )}
              {summary.trajectoryPipeline.staleLaunchIds.length > 0 && (
                <div className="mt-2 break-words font-mono text-xs text-warning">
                  Stale: {summary.trajectoryPipeline.staleLaunchIds.join(', ')}
                </div>
              )}
              {summary.trajectoryPipeline.precisionStaleLaunchIds.length > 0 && (
                <div className="mt-2 break-words font-mono text-xs text-warning">
                  Precision stale: {summary.trajectoryPipeline.precisionStaleLaunchIds.join(', ')}
                </div>
              )}
              <div className="mt-3 text-xs text-text3">Checked: {new Date(summary.trajectoryPipeline.checkedAt).toLocaleString()}</div>

              <div className="mt-4 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">Launch catalog family coverage</div>
                <div className="mt-1 text-xs text-text3">
                  Future launches: {summary.trajectoryPipeline.catalogCoverage.futureLaunches}
                  {' • '}
                  repairable means blank <span className="font-mono">rocket_family</span> with a usable{' '}
                  <span className="font-mono">ll2_rocket_config_id</span> {'->'}{' '}
                  <span className="font-mono">ll2_rocket_configs.family</span> join
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <InfoCard label="Family filled" value={`${summary.trajectoryPipeline.catalogCoverage.rocketFamilyFilled}/${summary.trajectoryPipeline.catalogCoverage.futureLaunches}`} />
                  <InfoCard label="Family fill rate" value={formatPct(summary.trajectoryPipeline.catalogCoverage.rocketFamilyFillRate)} />
                  <InfoCard label="Config joinable" value={`${summary.trajectoryPipeline.catalogCoverage.ll2RocketConfigFilled}/${summary.trajectoryPipeline.catalogCoverage.futureLaunches}`} />
                  <InfoCard label="Config family available" value={formatPct(summary.trajectoryPipeline.catalogCoverage.configFamilyAvailableRate)} />
                  <InfoCard label="Repairable missing" value={summary.trajectoryPipeline.catalogCoverage.repairableMissingRocketFamily} />
                  <InfoCard label="Repairable share" value={formatPct(summary.trajectoryPipeline.catalogCoverage.repairableMissingRocketFamilyRate)} />
                  <InfoCard label="Unrepairable missing" value={summary.trajectoryPipeline.catalogCoverage.unrepairableMissingRocketFamily} />
                  <InfoCard label="Unrepairable share" value={formatPct(summary.trajectoryPipeline.catalogCoverage.unrepairableMissingRocketFamilyRate)} />
                </div>
                {summary.trajectoryPipeline.catalogCoverage.sampleRepairableLaunchIds.length > 0 && (
                  <div className="mt-2 break-words text-xs text-text3">
                    Repairable sample:{' '}
                    <span className="font-mono">
                      {summary.trajectoryPipeline.catalogCoverage.sampleRepairableLaunchIds.join(', ')}
                    </span>
                  </div>
                )}
                {summary.trajectoryPipeline.catalogCoverage.sampleUnrepairableLaunchIds.length > 0 && (
                  <div className="mt-2 break-words text-xs text-warning">
                    Unrepairable sample:{' '}
                    <span className="font-mono">
                      {summary.trajectoryPipeline.catalogCoverage.sampleUnrepairableLaunchIds.join(', ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">SpaceX adapter health</div>
                <div className="mt-1 text-xs text-text3">
                  Admitted scope: infographic corroboration and landing-hint extraction only.
                </div>
                <div className={`mt-2 text-sm font-semibold ${adapterStatusClass(summary.trajectoryPipeline.providerAdapters.spacexInfographics.status)}`}>
                  {summary.trajectoryPipeline.providerAdapters.spacexInfographics.status}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <InfoCard label="Last run" value={formatTimestamp(summary.trajectoryPipeline.providerAdapters.spacexInfographics.lastRunAt)} />
                  <InfoCard label="Last success" value={formatTimestamp(summary.trajectoryPipeline.providerAdapters.spacexInfographics.lastSuccessAt)} />
                  <InfoCard label="Consecutive failures" value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.consecutiveFailures ?? 0} />
                  <InfoCard label="Last run success" value={formatBool(summary.trajectoryPipeline.providerAdapters.spacexInfographics.lastRunSuccess)} />
                  <InfoCard
                    label="Matched launches"
                    value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats?.matched ?? '—'}
                  />
                  <InfoCard
                    label="Skipped no match"
                    value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats?.skippedNoMatch ?? '—'}
                  />
                  <InfoCard
                    label="Constraint writes"
                    value={
                      summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats
                        ? summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.constraintRowsInserted +
                          summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.constraintRowsUpdated
                        : '—'
                    }
                  />
                  <InfoCard
                    label={`Infographics (${summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.windowDays}d)`}
                    value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.missionInfographicRows}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <InfoCard
                    label={`Landing hints (${summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.windowDays}d)`}
                    value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.landingHintRows}
                  />
                  <InfoCard
                    label="Latest infographic"
                    value={formatTimestamp(summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.latestMissionInfographicAt)}
                  />
                  <InfoCard
                    label="Latest landing hint"
                    value={formatTimestamp(summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.latestLandingHintAt)}
                  />
                  <InfoCard
                    label="Run errors"
                    value={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats?.errorCount ?? '—'}
                  />
                </div>
                {summary.trajectoryPipeline.providerAdapters.spacexInfographics.lastError && (
                  <div className="mt-2 break-words text-xs text-danger">
                    Last error: <span className="font-mono">{summary.trajectoryPipeline.providerAdapters.spacexInfographics.lastError}</span>
                  </div>
                )}
                {summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats && (
                  <div className="mt-2 break-words text-xs text-text3">
                    Run detail:{' '}
                    <span className="font-mono">
                      candidates={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.candidates}
                      {' • '}considered={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.considered}
                      {' • '}missionsFetched={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.missionsFetched}
                      {' • '}skippedNoBundle={summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.skippedNoBundle}
                      {' • '}bundleWrites=
                      {summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.bundleRowsInserted +
                        summary.trajectoryPipeline.providerAdapters.spacexInfographics.latestRunStats.bundleRowsUpdated}
                    </span>
                  </div>
                )}
                {summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.parserRules.length > 0 && (
                  <div className="mt-2 break-words text-xs text-text3">
                    Parser rules:{' '}
                    <span className="font-mono">
                      {summary.trajectoryPipeline.providerAdapters.spacexInfographics.outputs.parserRules
                        .map(
                          (row) =>
                            `${row.constraintType}:${row.parseRuleId || 'unknown'}@${row.parserVersion || 'unknown'} rows=${row.rows} latest=${formatValue(row.latestFetchedAt)}`
                        )
                        .join(' • ')}
                    </span>
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">
                  Source freshness thresholds ({summary.trajectoryPipeline.sourceFreshness.alertsEnabled ? 'alerts enabled' : 'alerts disabled'})
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {[
                    { label: 'Orbit', value: summary.trajectoryPipeline.sourceFreshness.orbit },
                    { label: 'Landing', value: summary.trajectoryPipeline.sourceFreshness.landing },
                    { label: 'Hazard', value: summary.trajectoryPipeline.sourceFreshness.hazard }
                  ].map((row) => (
                    <div key={row.label} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                      <div className="font-semibold text-text1">{row.label}</div>
                      <div className="text-text3">Threshold: {row.value.thresholdHours}h</div>
                      <div className="text-text3">With data: {row.value.launchesWithData}</div>
                      <div className={row.value.staleLaunchIds.length > 0 ? 'text-warning' : 'text-text3'}>
                        Stale: {row.value.staleLaunchIds.length}
                      </div>
                      <div className={row.value.missingLaunchIds.length > 0 ? 'text-danger' : 'text-text3'}>
                        Missing: {row.value.missingLaunchIds.length}
                      </div>
                      {row.value.staleLaunchIds.length > 0 && (
                        <div className="mt-1 break-words font-mono text-[11px] text-warning">
                          stale {'->'} {row.value.staleLaunchIds.join(', ')}
                        </div>
                      )}
                      {row.value.missingLaunchIds.length > 0 && (
                        <div className="mt-1 break-words font-mono text-[11px] text-danger">
                          missing {'->'} {row.value.missingLaunchIds.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">Per-launch ingest coverage</div>
                <div className="mt-1 text-xs text-text3">
                  Orbit run: {summary.trajectoryPipeline.coverage.orbitLastEndedAt ? new Date(summary.trajectoryPipeline.coverage.orbitLastEndedAt).toLocaleString() : '—'}
                  {' • '}
                  Landing run:{' '}
                  {summary.trajectoryPipeline.coverage.landingLastEndedAt
                    ? new Date(summary.trajectoryPipeline.coverage.landingLastEndedAt).toLocaleString()
                    : '—'}
                  {' • '}
                  Hazard run: {summary.trajectoryPipeline.coverage.hazardLastEndedAt ? new Date(summary.trajectoryPipeline.coverage.hazardLastEndedAt).toLocaleString() : '—'}
                </div>

                {summary.trajectoryPipeline.coverage.launches.length === 0 && (
                  <div className="mt-2 text-sm text-text3">No eligible launches for coverage counters.</div>
                )}

                {summary.trajectoryPipeline.coverage.launches.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {summary.trajectoryPipeline.coverage.launches.map((row) => {
                      const orbitSignals = [
                        row.orbit.usedSupgp ? 'supgp' : null,
                        row.orbit.usedHazard ? 'hazard' : null,
                        row.orbit.usedHeuristic ? 'heuristic' : null
                      ]
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <div key={row.launchId} className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                          <div className="break-words font-mono text-text2">{row.launchId}</div>
                          <div className="mt-1 text-text3">
                            Orbit: docs={row.orbit.docsWithParsedOrbit}, candidates={row.orbit.selectedCandidates}, constraints={row.orbit.constraintsPrepared}
                            {orbitSignals ? ` (${orbitSignals})` : ''}
                          </div>
                          <div className="text-text3">
                            Landing: rows={row.landing.rowsPrepared}, fetched={row.landing.landingsFetched}
                            {row.landing.skippedNoLl2Id ? ' (skipped_no_ll2_id)' : ''}
                          </div>
                          <div className="text-text3">
                            Hazard: constraints={row.hazard.constraintsUpserted}, areas={row.hazard.hazardAreasMatched}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] p-3">
                <div className="text-xs uppercase tracking-[0.08em] text-text3">
                  Accuracy observability ({summary.trajectoryPipeline.accuracy.windowDays}d)
                </div>
                <div className="mt-1 text-xs text-text3">
                  Window start: {new Date(summary.trajectoryPipeline.accuracy.windowStart).toLocaleString()}
                  {' • '}sessions: {summary.trajectoryPipeline.accuracy.sampledSessions}
                  {summary.trajectoryPipeline.accuracy.truncated
                    ? ` • capped at ${summary.trajectoryPipeline.accuracy.sampleLimit}`
                    : ''}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <InfoCard label="Lock attempt rate" value={formatPct(summary.trajectoryPipeline.accuracy.lock.attemptRate)} />
                  <InfoCard label="Lock acquire rate" value={formatPct(summary.trajectoryPipeline.accuracy.lock.acquisitionRate)} />
                  <InfoCard label="Fallback rate" value={formatPct(summary.trajectoryPipeline.accuracy.fallback.rate)} />
                  <InfoCard label="Auto-lock sessions" value={summary.trajectoryPipeline.accuracy.lock.autoModeSessions} />
                  <InfoCard
                    label={`Sigma <= ${formatNum(summary.trajectoryPipeline.accuracy.precision.sigmaGoodThresholdDeg, 1)}°`}
                    value={formatPct(summary.trajectoryPipeline.accuracy.precision.sigmaGoodRate)}
                  />
                  <InfoCard label="Trajectory coverage" value={formatPct(summary.trajectoryPipeline.accuracy.precision.trajectoryCoverageRate)} />
                  <InfoCard label="Contract A/B rate" value={formatPct(summary.trajectoryPipeline.accuracy.precision.contractTierABRate)} />
                  <InfoCard label="Avg lock loss count" value={formatNum(summary.trajectoryPipeline.accuracy.lock.avgLossCount)} />
                </div>

                <div className="mt-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                  <div className="font-semibold text-text1">Telemetry completeness</div>
                  <div className="mt-1 text-text3">
                    Overall required-field fill: {formatPct(summary.trajectoryPipeline.accuracy.completeness.overallFillRate)}
                    {' • '}
                    {summary.trajectoryPipeline.accuracy.completeness.filledFieldValues}/
                    {summary.trajectoryPipeline.accuracy.completeness.requiredFieldValues} required values present
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <InfoCard
                      label="Runtime family"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'runtime_family')?.fillRate)}
                    />
                    <InfoCard
                      label="Release profile"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'release_profile')?.fillRate)}
                    />
                    <InfoCard
                      label="Mode entered"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'mode_entered')?.fillRate)}
                    />
                    <InfoCard
                      label="Time to usable"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'time_to_usable_ms')?.fillRate)}
                    />
                    <InfoCard
                      label="Pose mode"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'pose_mode')?.fillRate)}
                    />
                    <InfoCard
                      label="Vision backend"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'vision_backend')?.fillRate)}
                    />
                    <InfoCard
                      label="Native location fix"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'location_fix_state')?.fillRate)}
                    />
                    <InfoCard
                      label="Native alignment ready"
                      value={formatPct(findCompletenessField(summary.trajectoryPipeline.accuracy.completeness.fields, 'alignment_ready')?.fillRate)}
                    />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="text-text3">
                      {summary.trajectoryPipeline.accuracy.completeness.fields
                        .map((field) => `${field.key}=${formatPct(field.fillRate)} (${field.filledSessions}/${field.applicableSessions})`)
                        .join(' • ')}
                    </div>
                    {summary.trajectoryPipeline.accuracy.completeness.runtimeFamilies.map((runtimeFamily) => (
                      <div key={runtimeFamily.runtimeFamily} className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
                        <div className="font-semibold text-text1">
                          {formatTelemetryRuntimeFamilyLabel(runtimeFamily.runtimeFamily)} ({runtimeFamily.sessions} sessions)
                        </div>
                        <div className="mt-1 text-text3">
                          {runtimeFamily.fields
                            .map((field) => `${field.key}=${formatPct(field.fillRate)} (${field.filledSessions}/${field.applicableSessions})`)
                            .join(' • ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                    <div className="font-semibold text-text1">Fallback reasons</div>
                    <div className="mt-1 text-text3">sky_compass_sessions: {summary.trajectoryPipeline.accuracy.fallback.skyCompassSessions}</div>
                    <div className="mt-1 text-text3">
                      {Object.entries(summary.trajectoryPipeline.accuracy.fallback.reasons).length === 0
                        ? 'No explicit fallback reasons captured.'
                        : Object.entries(summary.trajectoryPipeline.accuracy.fallback.reasons)
                            .sort((a, b) => b[1] - a[1])
                            .map(([reason, count]) => `${reason}=${count}`)
                            .join(' • ')}
                    </div>
                  </div>

                  <div className="rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                    <div className="font-semibold text-text1">Time to lock buckets</div>
                    <div className="mt-1 text-text3">
                      {Object.entries(summary.trajectoryPipeline.accuracy.lock.timeToLockBuckets)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([bucket, count]) => `${bucket}=${count}`)
                        .join(' • ')}
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                  <div className="font-semibold text-text1">Daily trend</div>
                  {summary.trajectoryPipeline.accuracy.trend.length === 0 && (
                    <div className="mt-1 text-text3">No telemetry sessions in the configured window.</div>
                  )}
                  {summary.trajectoryPipeline.accuracy.trend.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {summary.trajectoryPipeline.accuracy.trend
                        .slice(-7)
                        .map((row) => (
                          <div key={row.day} className="flex flex-wrap items-center justify-between gap-2 text-text3">
                            <span className="font-mono">{row.day}</span>
                            <span>
                              sessions={row.sessions}
                              {' • '}lock={formatPct(row.lockAcquisitionRate)}
                              {' • '}fallback={formatPct(row.fallbackRate)}
                              {' • '}sigma={formatPct(row.sigmaGoodRate)}
                              {' • '}traj={formatPct(row.trajectoryCoverageRate)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                <div className="mt-3 rounded-lg border border-stroke bg-surface-0 px-3 py-2 text-xs">
                  <div className="font-semibold text-text1">Runtime policy recommendations</div>
                  <div className="mt-1 text-text3">
                    Telemetry-backed promotion/demotion signals for `webxr-first` vs `sensor-first`.
                  </div>
                  <div className="mt-2 space-y-2">
                    {summary.trajectoryPipeline.accuracy.runtimePolicies.profiles.map((row) => (
                      <div key={row.profile} className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-text1">{formatProfileLabel(row.profile)}</div>
                          <div className="text-text3">
                            Default: {formatPoseModeLabel(row.defaultPoseMode)}
                            {' • '}Recommendation: {formatPoseModeLabel(row.recommendedPoseMode)}
                            {' • '}Confidence: {row.confidence}
                            {' • '}Field ready: {row.fieldReady ? 'yes' : 'no'}
                            {row.applyInRuntime ? ' • runtime override active' : ''}
                          </div>
                        </div>
                        <div className="mt-1 text-text3">
                          sessions={row.sampleCount}
                          {' • '}ar={formatPct(row.metrics.arEntryRate)}
                          {' • '}fallback={formatPct(row.metrics.fallbackRate)}
                          {' • '}smooth={formatPct(row.metrics.smoothSessionRate)}
                          {' • '}lowDeg={formatPct(row.metrics.lowDegradationRate)}
                          {' • '}xrHealthy={formatPct(row.metrics.xrHealthyRate)}
                          {' • '}lockUseful={formatPct(row.metrics.lockUsefulRate)}
                          {' • '}fastLock={formatPct(row.metrics.fastLockRate)}
                        </div>
                        <div className="mt-1 text-text3">
                          xr_used={row.xrUsedSessions}
                          {' • '}xr_healthy={row.xrHealthySessions}
                          {' • '}lock_attempts={row.lockAttemptedSessions}
                          {' • '}lock_acquired={row.lockAcquiredSessions}
                          {' • '}restart_free_ar={formatPct(row.metrics.restartFreeArRate)}
                        </div>
                        <div className="mt-1 text-text3">
                          support_groups={row.supportGroupCount}
                          {' • '}qualified_groups={row.qualifiedSupportGroupCount}
                          {' • '}xr_groups={row.xrQualifiedSupportGroupCount}
                        </div>
                        {row.supportGroups.length > 0 && (
                          <div className="mt-1 text-text3">
                            {row.supportGroups
                              .map((group) => {
                                const parts = [group.clientEnv || 'unknown', group.screenBucket || 'unknown'].join('/');
                                return `${parts} sessions=${group.sampleCount} xr=${group.xrUsedSessions} useful=${group.lockUsefulSessions}`;
                              })
                              .join(' • ')}
                          </div>
                        )}
                        <div className="mt-1 text-text3">
                          {row.reasons.length > 0 ? row.reasons.join(' • ') : 'No recommendation reasons recorded.'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </SectionCard>
      )}

      {summaryStatus === 'ready' && (
        <SectionCard
          title="Trajectory inspector"
          description="Inputs + product details for the current production AR-eligible window."
          actions={
            <button
              type="button"
              className="btn-secondary rounded-full px-3 py-1 text-xs uppercase tracking-[0.1em]"
              onClick={refreshTrajectoryEligible}
              disabled={trajectoryEligibleStatus === 'loading' || summaryStatus !== 'ready'}
            >
              {trajectoryEligibleStatus === 'loading' ? 'Loading…' : 'Refresh'}
            </button>
          }
        >
          {trajectoryEligibleStatus === 'error' && (
            <div className="text-sm text-warning">{trajectoryEligibleError || 'Failed to load eligible launches.'}</div>
          )}

          {trajectoryEligibleStatus === 'ready' && trajectoryEligible.length === 0 && (
            <div className="text-sm text-text3">No launches are currently inside the production AR-eligible window.</div>
          )}

          {trajectoryEligibleStatus === 'ready' && trajectoryEligible.length > 0 && (
            <div className="space-y-2">
              {trajectoryEligible.map((launch, idx) => {
                const inspection = trajectoryInspections[launch.launchId];
                const inspectError = trajectoryInspectionErrors[launch.launchId] || null;
                const loading = trajectoryInspectingId === launch.launchId;
                return (
                  <details
                    key={launch.launchId}
                    className="rounded-lg border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2"
                    onToggle={(event) => {
                      const el = event.currentTarget as HTMLDetailsElement;
                      if (!el.open) return;
                      loadTrajectoryInspection(launch.launchId);
                    }}
                  >
                    <summary className="cursor-pointer list-none">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-text1">
                            {idx + 1}) {launch.name}
                          </div>
                          <div className="text-xs text-text3">
                            {launch.provider ? launch.provider : '—'}
                            {launch.vehicle ? ` • ${launch.vehicle}` : ''}
                            {launch.net ? ` • NET ${new Date(launch.net).toLocaleString()}` : ''}
                          </div>
                          <div className="text-xs text-text3">AR expires {new Date(launch.expiresAt).toLocaleString()}</div>
                          <div className="text-xs text-text3">
                            {launch.padName ? launch.padName : '—'}
                            {launch.locationName ? ` • ${launch.locationName}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {inspection?.productStale && (
                            <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-warning">
                              Stale
                            </span>
                          )}
                          {inspection?.missingProduct && (
                            <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-danger">
                              Missing product
                            </span>
                          )}
                          <span className="rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-text3">
                            {inspection ? 'Loaded' : loading ? 'Loading…' : 'Expand'}
                          </span>
                        </div>
                      </div>
                    </summary>

                    <div className="mt-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-xs text-text3">{launch.launchId}</div>
                        <button
                          type="button"
                          className="btn-secondary rounded-lg border border-stroke px-3 py-2 text-xs text-text1"
                          onClick={() => loadTrajectoryInspection(launch.launchId, { force: true })}
                          disabled={loading || summaryStatus !== 'ready'}
                        >
                          {loading ? 'Loading…' : 'Refresh details'}
                        </button>
                      </div>

                      {inspectError && <div className="mt-2 text-sm text-warning">{inspectError}</div>}

                      {inspection && (
                        <>
                          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                            <InfoCard label="Quality" value={inspection.productMeta?.qualityLabel ?? inspection.product?.quality ?? '—'} />
                            <InfoCard label="Generated" value={inspection.product?.generatedAt ?? '—'} />
                            <InfoCard label="Samples" value={inspection.productMeta?.sampleCount ?? 0} />
                            <InfoCard label="Events" value={inspection.productMeta?.eventCount ?? 0} />
                            <InfoCard label="Assumptions" value={inspection.productMeta?.assumptionCount ?? 0} />
                            <InfoCard label="Stale" value={inspection.productStale ? 'yes' : 'no'} />
                          </div>

                          {inspection.productStaleReasons?.length > 0 && (
                            <div className="mt-2 text-xs text-warning">
                              Newer constraints:{' '}
                              {inspection.productStaleReasons.map((r) => `${r.constraintType}@${r.newestFetchedAt}`).join(' • ')}
                            </div>
                          )}

                          <div className="mt-3 rounded-lg border border-stroke bg-surface-0 px-3 py-3 text-xs">
                            <div className="text-xs uppercase tracking-[0.08em] text-text3">Gap summary</div>
                            <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
                              <InfoCard label="Direction source" value={inspection.opsGapSummary.product.directionalSourceLabel} />
                              <InfoCard label="Truth orbit" value={formatBool(inspection.opsGapSummary.signals.hasTruthTierOrbit)} />
                              <InfoCard label="Hazard near NET" value={formatBool(inspection.opsGapSummary.signals.hasHazardWindowNearNet)} />
                              <InfoCard label="Primary gap" value={inspection.opsGapSummary.primaryGap?.label ?? '—'} />
                            </div>

                            <div className="mt-3 text-text3">
                              Product basis: {formatValue(inspection.opsGapSummary.product.sourceSummaryLabel)}
                              {' • '}quality label: {formatValue(inspection.opsGapSummary.product.qualityLabel)}
                              {' • '}confidence: {formatValue(inspection.opsGapSummary.product.confidenceTier)}
                              {' • '}freshness: {formatValue(inspection.opsGapSummary.product.freshnessState)}
                              {' • '}lineage:{' '}
                              {inspection.opsGapSummary.product.lineageComplete == null
                                ? '—'
                                : inspection.opsGapSummary.product.lineageComplete
                                  ? 'complete'
                                  : 'partial'}
                            </div>

                            <div className="mt-1 text-text3">
                              Inputs: landing coords={formatBool(inspection.opsGapSummary.signals.hasLandingLatLon)}
                              {' • '}orbit azimuth={formatBool(inspection.opsGapSummary.signals.hasOrbitFlightAzimuth)}
                              {' • '}orbit inclination={formatBool(inspection.opsGapSummary.signals.hasOrbitInclination)}
                              {' • '}orbit altitude={formatBool(inspection.opsGapSummary.signals.hasOrbitAltitude)}
                              {' • '}hazard geometry={formatBool(inspection.opsGapSummary.signals.hasHazardGeometry)}
                              {' • '}constraint-backed direction={formatBool(
                                inspection.opsGapSummary.signals.hasConstraintBackedDirectionalSource
                              )}
                            </div>

                            <div className="mt-1 text-text3">
                              Counts: landing={inspection.opsGapSummary.counts.landing}
                              {' • '}orbit={inspection.opsGapSummary.counts.orbit}
                              {' • '}hazard={inspection.opsGapSummary.counts.hazard}
                              {' • '}hazard near NET={inspection.opsGapSummary.counts.hazardNearNet}
                              {' • '}used constraints={formatValue(inspection.opsGapSummary.product.usedConstraintCount)}
                            </div>

                            {inspection.opsGapSummary.gapReasons.length > 0 && (
                              <div className="mt-2 text-warning">
                                Gap reasons: {inspection.opsGapSummary.gapReasons.map((reason) => reason.label).join(' • ')}
                              </div>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className="text-xs uppercase tracking-[0.08em] text-text3">Constraints</div>
                            {inspection.constraintSummary.length === 0 && (
                              <div className="mt-1 text-sm text-text3">No constraints found for this launch.</div>
                            )}
                            {inspection.constraintSummary.length > 0 && (
                              <div className="mt-2 space-y-1 text-sm text-text2">
                                {inspection.constraintSummary.map((row) => (
                                  <div key={row.constraintType} className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-mono text-[12px]">{row.constraintType}</span>
                                    <span className="text-xs text-text3">
                                      {row.count} • newest{' '}
                                      {row.newestFetchedAt ? new Date(row.newestFetchedAt).toLocaleString() : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <details className="mt-4">
                            <summary className="cursor-pointer text-sm text-text1">Launch row (JSON)</summary>
                            <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-stroke bg-surface-0 p-3 text-[11px] text-text2">
                              {JSON.stringify(inspection.launch, null, 2)}
                            </pre>
                          </details>

                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm text-text1">Constraints (JSON)</summary>
                            <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-stroke bg-surface-0 p-3 text-[11px] text-text2">
                              {JSON.stringify(inspection.constraints, null, 2)}
                            </pre>
                          </details>

                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm text-text1">Trajectory product (JSON)</summary>
                            <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-stroke bg-surface-0 p-3 text-[11px] text-text2">
                              {JSON.stringify(inspection.product, null, 2)}
                            </pre>
                          </details>
                        </>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
