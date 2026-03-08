import { Badge, type BadgeTone } from './Badge';
import type { LaunchJepScore } from '@/lib/types/jep';
import {
  dedupeTrajectoryReasonLabels,
  formatTrajectoryFieldConfidenceLabel,
  formatTrajectoryAuthorityTierLabel,
  formatTrajectoryQualityStateLabel
} from '@/lib/trajectory/trajectoryEvidencePresentation';

export type JepLocationMode = 'user' | 'pad_fallback';
export type JepFallbackReason = 'denied' | 'unsupported' | 'timeout' | 'unavailable' | 'error' | null;

export function JepScorePanel({
  score,
  padTimezone,
  locationMode,
  fallbackReason,
  personalizationLoading = false
}: {
  score: LaunchJepScore;
  padTimezone: string;
  locationMode?: JepLocationMode;
  fallbackReason?: JepFallbackReason;
  personalizationLoading?: boolean;
}) {
  const probability = clampProbability(score.probability);
  const isProbabilityMode = score.mode === 'probability';
  const band = isProbabilityMode && probability != null ? probabilityBand(probability) : scoreBand(score.score);
  const calibrationTone = calibrationBandTone(score.calibrationBand);
  const weatherSourceLabel = formatWeatherSource(score.source.weather);
  const computedLabel = formatDateTime(score.computedAt, padTimezone);
  const expiresLabel = formatDateTime(score.expiresAt, padTimezone);
  const snapshotLabel = formatDateTime(score.snapshotAt || score.computedAt, padTimezone);
  const resolvedLocationMode = locationMode ?? (score.observer.personalized ? 'user' : 'pad_fallback');
  const locationLabel = resolvedLocationMode === 'user' ? 'Using your location' : 'Using launch pad (fallback)';
  const fallbackReasonLabel = formatFallbackReason(fallbackReason ?? null);
  const observerLabel = resolvedLocationMode === 'user' ? 'Personalized observer tile' : 'Pad observer fallback';
  const primaryValue = isProbabilityMode && probability != null ? formatProbability(probability) : `${score.score}/100`;
  const primaryLabel = isProbabilityMode ? 'Chance to see it' : 'Visibility score';
  const scaleSummary = isProbabilityMode
    ? '0% = almost no chance. 100% = very likely.'
    : '0 = very unlikely to see it. 100 = best setup.';
  const scenarioWindows = Array.isArray(score.scenarioWindows) ? score.scenarioWindows : [];
  const hasGuidanceSummary =
    score.bestWindow != null || score.directionBand != null || score.elevationBand != null || scenarioWindows.length > 0;
  const trajectoryReasonLabels = score.trajectory
    ? dedupeTrajectoryReasonLabels([
        ...(score.trajectory.publishPolicy?.reasons ?? []),
        ...(score.trajectory.publishPolicy?.missingFields ?? []),
        ...(score.trajectory.publishPolicy?.blockingReasons ?? []),
        ...score.trajectory.confidenceReasons
      ])
    : [];
  const readinessReasonLabels = score.readiness.reasons.map(formatReadinessReasonLabel);
  const readinessSummary = formatReadinessSummary(score);
  const modelSummary = isProbabilityMode
    ? 'Estimated chance of seeing the jellyfish effect from your location.'
    : '0-100 score for how likely the jellyfish effect is to be visible from your location.';

  return (
    <section className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Visibility estimate</div>
          <h2 className="text-xl font-semibold text-text1">Jellyfish Exposure Potential</h2>
          <p className="mt-1 max-w-2xl text-sm text-text3">{modelSummary}</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{primaryLabel}</div>
            <div className="mt-1 text-3xl font-semibold text-text1">{primaryValue}</div>
            <p className="mt-2 max-w-2xl text-sm text-text2">{primaryInterpretation(band.label)}</p>
            <p className="mt-2 max-w-2xl text-xs text-text3">{scaleSummary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={band.tone}>{band.label}</Badge>
            <Badge tone={calibrationTone}>{score.calibrationBand.replace('_', ' ')}</Badge>
            {!isProbabilityMode && <Badge tone="neutral">Visibility score</Badge>}
            {score.isSnapshot && <Badge tone="info">Snapshot</Badge>}
            {score.isStale && <Badge tone="warning">Stale</Badge>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={resolvedLocationMode === 'user' ? 'success' : 'neutral'} subtle>
            {locationLabel}
          </Badge>
          {fallbackReasonLabel && (
            <Badge tone="warning" subtle>
              {fallbackReasonLabel}
            </Badge>
          )}
          {personalizationLoading && (
            <Badge tone="info" subtle>
              Refining for your location...
            </Badge>
          )}
        </div>

        {hasGuidanceSummary && (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {score.bestWindow && (
              <Metric label="Best viewing window" value={score.bestWindow.label} note={score.bestWindow.reason} />
            )}
            {score.directionBand && (
              <Metric
                label="Look toward"
                value={score.directionBand.label}
                note={`${formatDegrees(score.directionBand.fromAzDeg)} to ${formatDegrees(score.directionBand.toAzDeg)}`}
              />
            )}
            {score.elevationBand && (
              <Metric label="Height above horizon" value={score.elevationBand.label} note="Above your local horizon" />
            )}
          </div>
        )}

        {scenarioWindows.length > 0 && (
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            <div className="text-[11px] uppercase tracking-[0.08em] text-text3">If Launch Timing Changes</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {scenarioWindows.map((scenario) => (
                <Badge key={scenario.offsetMinutes} tone={scenarioTone(scenario.trend)} subtle>
                  {scenario.label} • {scenario.score}/100 • {scenario.trend}
                </Badge>
              ))}
            </div>
            <div className="mt-2 text-[11px] text-text3">
              Only launch time changes here. Path and weather stay the same.
            </div>
          </div>
        )}
      </div>

      <details className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-text1">What Moves This Number</summary>

        <div className="mt-3 grid gap-3 md:grid-cols-6">
          <Metric label="Visibility score" value={`${score.score}/100`} />
          <Metric label={isProbabilityMode ? 'Chance to see it' : 'Showing'} value={isProbabilityMode ? formatProbability(probability) : '0-100 score'} />
          <Metric label="Chance estimate" value={isProbabilityMode ? 'Shown' : 'Not shown yet'} note={readinessSummary} />
          <Metric label="Rocket in sunlight" value={formatFactor(score.factors.illumination)} />
          <Metric label="Dark sky" value={formatFactor(score.factors.darkness)} />
          <Metric label="Open view" value={formatFactor(score.factors.lineOfSight)} />
          <Metric label="Clouds" value={formatFactor(score.factors.weather)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <Metric label="Cloud cover" value={formatPct(score.factors.cloudCoverPct)} />
          <Metric label="Low clouds" value={formatPct(score.factors.cloudCoverLowPct)} />
          <Metric label="Sun below horizon" value={formatDegrees(score.factors.solarDepressionDeg)} />
          <Metric label="Sunlight margin" value={formatKm(score.sunlitMarginKm)} />
          <Metric label="Visible flight path" value={formatProbability(score.losVisibleFraction)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Metric
            label="Confirmed reports"
            value={formatReadinessThreshold(score.readiness.labeledOutcomes, score.readiness.minLabeledOutcomes)}
          />
          <Metric label="Calibration error (ECE)" value={formatCalibrationMetric(score.readiness.currentEce, score.readiness.maxEce)} />
          <Metric
            label="Forecast error (Brier)"
            value={formatCalibrationMetric(score.readiness.currentBrier, score.readiness.maxBrier)}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone={confidenceTone(score.confidence.time)} subtle>
            Time {score.confidence.time}
          </Badge>
          <Badge tone={confidenceTone(score.confidence.trajectory)} subtle>
            Trajectory {score.confidence.trajectory}
          </Badge>
          <Badge tone={confidenceTone(score.confidence.weather)} subtle>
            Weather {score.confidence.weather}
          </Badge>
          {score.trajectory && (
            <Badge tone={trajectoryAuthorityTone(score.trajectory.authorityTier)} subtle>
              Trajectory evidence {formatTrajectoryAuthorityTierLabel(score.trajectory.authorityTier)}
            </Badge>
          )}
        </div>

        {score.trajectory?.fieldProvenance && (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Metric
              label="Direction source"
              value={formatTrajectoryAuthorityTierLabel(score.trajectory.fieldProvenance.azimuth.authorityTier)}
              note={`${formatTrajectoryFieldConfidenceLabel(score.trajectory.fieldProvenance.azimuth.confidenceLabel)} • ${score.trajectory.fieldProvenance.azimuth.summary}`}
            />
            <Metric
              label="Altitude source"
              value={formatTrajectoryAuthorityTierLabel(score.trajectory.fieldProvenance.altitude.authorityTier)}
              note={`${formatTrajectoryFieldConfidenceLabel(score.trajectory.fieldProvenance.altitude.confidenceLabel)} • ${score.trajectory.fieldProvenance.altitude.summary}`}
            />
            <Metric
              label="Milestones source"
              value={formatTrajectoryAuthorityTierLabel(score.trajectory.fieldProvenance.milestones.authorityTier)}
              note={`${formatTrajectoryFieldConfidenceLabel(score.trajectory.fieldProvenance.milestones.confidenceLabel)} • ${score.trajectory.fieldProvenance.milestones.summary}`}
            />
            <Metric
              label="Uncertainty source"
              value={formatTrajectoryAuthorityTierLabel(score.trajectory.fieldProvenance.uncertainty.authorityTier)}
              note={`${formatTrajectoryFieldConfidenceLabel(score.trajectory.fieldProvenance.uncertainty.confidenceLabel)} • ${score.trajectory.fieldProvenance.uncertainty.summary}`}
            />
          </div>
        )}

        <div className="mt-3 text-xs text-text3">
          <div>Weather data: {weatherSourceLabel}</div>
          <div>Direction data: {formatSourceValue(score.source.azimuth)}</div>
          <div>Observer location: {observerLabel}</div>
          {score.observer.usingPadFallback && resolvedLocationMode === 'pad_fallback' && (
            <div>Fallback: using launch-pad geometry until your score refreshes.</div>
          )}
          <div>Chance estimate: {score.readiness.probabilityReady ? 'ready' : 'score only'}</div>
          <div>Validation: {score.readiness.validationReady ? 'ready' : 'in progress'}</div>
          <div>Model notes: {score.readiness.modelCardPublished ? 'published' : 'pending'}</div>
          <div>Confirmed reports: {formatReadinessThreshold(score.readiness.labeledOutcomes, score.readiness.minLabeledOutcomes)}</div>
          <div>Calibration error (ECE): {formatCalibrationMetric(score.readiness.currentEce, score.readiness.maxEce)}</div>
          <div>Forecast error (Brier): {formatCalibrationMetric(score.readiness.currentBrier, score.readiness.maxBrier)}</div>
          {readinessReasonLabels.length > 0 && <div>Why chance mode is held back: {readinessReasonLabels.join(', ')}</div>}
          <div>Calibration: {score.calibrationBand.replace('_', ' ')}</div>
          {score.weatherFreshnessMinutes != null && <div>Weather age: {score.weatherFreshnessMinutes} min</div>}
          {score.explainability.reasonCodes.length > 0 && <div>Reasons: {score.explainability.reasonCodes.join(', ')}</div>}
          {score.trajectory && <div>Trajectory evidence: {score.trajectory.evidenceLabel}</div>}
          {score.trajectory && <div>Trajectory confidence: {score.trajectory.confidenceBadgeLabel}</div>}
          {score.trajectory && score.trajectory.freshnessState && <div>Trajectory freshness: {score.trajectory.freshnessState}</div>}
          {score.trajectory && <div>Trajectory detail level: {formatTrajectoryQualityStateLabel(score.trajectory.qualityState)}</div>}
          {score.trajectory?.safeModeActive && <div>Trajectory guidance: widened into safe mode rather than claiming precision.</div>}
          {score.trajectory?.publishPolicy?.enforcePadOnly && (
            <div>Trajectory guardrail: precise guidance withheld and pad-only fallback enforced.</div>
          )}
          {score.bestWindow && <div>Best viewing window: {score.bestWindow.label}</div>}
          {score.directionBand && <div>Look toward: {score.directionBand.label}</div>}
          {score.elevationBand && <div>Height above horizon: {score.elevationBand.label}</div>}
          {scenarioWindows.length > 0 && (
            <div>
              If launch timing changes: {scenarioWindows.map((scenario) => `${scenario.label} ${scenario.score}/100 (${scenario.trend})`).join(', ')}
            </div>
          )}
          {score.trajectory && !score.trajectory.lineageComplete && <div>Trajectory sourcing: partial.</div>}
          {trajectoryReasonLabels.length > 0 && <div>Trajectory caveats: {trajectoryReasonLabels.join(', ')}</div>}
          <div>Model version: {score.modelVersion}</div>
          {score.isSnapshot && snapshotLabel && <div>Snapshot captured: {snapshotLabel}</div>}
          {computedLabel && <div>Updated: {computedLabel}</div>}
          {!score.isSnapshot && expiresLabel && <div>Refresh due: {expiresLabel}</div>}
          {score.source.geometryOnlyFallback && <div>Weather fallback: geometry-only estimate (no usable forecast).</div>}
        </div>
      </details>

      <p className="mt-3 text-xs text-text3">
        <a href="/jellyfish-effect" className="text-primary hover:text-primary/80">
          Read the jellyfish effect and JEP FAQ
        </a>
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  prominent,
  note
}: {
  label: string;
  value: string;
  prominent?: boolean;
  note?: string | null;
}) {
  return (
    <div className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{label}</div>
      <div className={prominent ? 'mt-1 text-2xl font-semibold text-text1' : 'mt-1 text-sm text-text1'}>{value}</div>
      {note ? <div className="mt-1 text-[11px] text-text3">{note}</div> : null}
    </div>
  );
}

function scoreBand(score: number): { label: string; tone: BadgeTone } {
  if (score >= 70) return { label: 'High', tone: 'success' };
  if (score >= 30) return { label: 'Moderate', tone: 'warning' };
  return { label: 'Low', tone: 'danger' };
}

function confidenceTone(confidence: string): BadgeTone {
  if (confidence === 'HIGH') return 'success';
  if (confidence === 'MEDIUM') return 'info';
  if (confidence === 'LOW') return 'warning';
  return 'neutral';
}

function trajectoryAuthorityTone(authorityTier: string): BadgeTone {
  if (authorityTier === 'partner_feed' || authorityTier === 'official_numeric') return 'success';
  if (authorityTier === 'regulatory_constrained' || authorityTier === 'supplemental_ephemeris') return 'info';
  if (authorityTier === 'public_metadata') return 'warning';
  return 'neutral';
}

function calibrationBandTone(band: string): BadgeTone {
  if (band === 'VERY_HIGH' || band === 'HIGH') return 'success';
  if (band === 'MEDIUM') return 'info';
  if (band === 'LOW') return 'warning';
  if (band === 'VERY_LOW') return 'danger';
  return 'neutral';
}

function scenarioTone(trend: 'better' | 'similar' | 'worse'): BadgeTone {
  if (trend === 'better') return 'success';
  if (trend === 'worse') return 'warning';
  return 'neutral';
}

function formatFactor(value: number) {
  return `${Math.round(value * 100)}%`;
}

function clampProbability(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function probabilityBand(probability: number): { label: string; tone: BadgeTone } {
  if (probability >= 0.7) return { label: 'High', tone: 'success' };
  if (probability >= 0.3) return { label: 'Moderate', tone: 'warning' };
  return { label: 'Low', tone: 'danger' };
}

function primaryInterpretation(label: string) {
  if (label === 'High') {
    return 'Good setup for a visible jellyfish plume.';
  }
  if (label === 'Moderate') {
    return 'You may see it, but conditions are mixed.';
  }
  return 'A visible jellyfish plume is unlikely from this location.';
}

function formatReadinessSummary(score: LaunchJepScore) {
  if (score.readiness.probabilityPublicEligible) {
    return 'Showing the percent chance.';
  }
  if (score.readiness.probabilityReady) {
    return 'Chance mode is ready, but this page is still using the score.';
  }
  return 'Showing the 0-100 score for now.';
}

function formatReadinessReasonLabel(reason: LaunchJepScore['readiness']['reasons'][number]) {
  switch (reason) {
    case 'public_release_disabled':
      return 'held back for this rollout';
    case 'validation_incomplete':
      return 'validation still in progress';
    case 'model_card_unpublished':
      return 'model notes not published yet';
    case 'labeled_outcome_threshold_unconfigured':
      return 'confirmed-report target not set';
    case 'labeled_outcome_count_unreported':
      return 'confirmed-report count missing';
    case 'insufficient_labeled_outcomes':
      return 'not enough confirmed reports yet';
    case 'ece_threshold_unconfigured':
      return 'ECE limit not set';
    case 'ece_unreported':
      return 'ECE missing';
    case 'ece_above_threshold':
      return 'ECE still above target';
    case 'brier_threshold_unconfigured':
      return 'Brier limit not set';
    case 'brier_unreported':
      return 'Brier score missing';
    case 'brier_above_threshold':
      return 'Brier score still above target';
    default:
      return reason;
  }
}

function formatReadinessThreshold(current: number | null, minimum: number | null) {
  if (minimum == null) return 'Not configured';
  if (current == null) return `Need ${minimum}+`;
  return `${current} / ${minimum}+`;
}

function formatCalibrationMetric(current: number | null, threshold: number | null) {
  if (threshold == null) return 'Not configured';
  if (current == null) return `<= ${formatMetricDecimal(threshold)} required`;
  return `${formatMetricDecimal(current)} / <= ${formatMetricDecimal(threshold)}`;
}

function formatMetricDecimal(value: number) {
  if (!Number.isFinite(value)) return 'Unknown';
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatFallbackReason(reason: JepFallbackReason) {
  if (reason === 'denied') return 'Location permission denied';
  if (reason === 'unsupported') return 'Location not supported';
  if (reason === 'timeout') return 'Location request timed out';
  if (reason === 'unavailable') return 'Location unavailable';
  if (reason === 'error') return 'Location lookup failed';
  return null;
}

function formatProbability(value: number | null) {
  const bounded = clampProbability(value);
  if (bounded == null) return '—';
  return `${Math.round(bounded * 100)}%`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatKm(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${(Math.round(value * 10) / 10).toFixed(1)} km`;
}

function formatDegrees(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)} deg`;
}

function formatWeatherSource(source: string | null) {
  const normalized = (source || '').trim().toLowerCase();
  if (normalized === 'open_meteo') return 'Open-Meteo';
  if (normalized === 'nws') return 'NOAA NWS';
  if (normalized === 'none') return 'None (geometry only)';
  return formatSourceValue(source);
}

function formatSourceValue(value: string | null) {
  if (!value) return 'Unknown';
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

function formatDateTime(value: string | null, tz: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short'
  }).format(new Date(parsed));
}
