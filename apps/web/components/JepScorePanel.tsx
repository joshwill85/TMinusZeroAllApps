import { Badge, type BadgeTone } from './Badge';
import { deriveJepWeatherImpact } from '@/lib/jep/weather';
import type { LaunchJepScore } from '@/lib/types/jep';

export type JepLocationMode = 'user' | 'pad_fallback';
export type JepFallbackReason = 'denied' | 'unsupported' | 'timeout' | 'unavailable' | 'error' | null;

type NarrativeItem = {
  title: string;
  detail: string;
  tone: BadgeTone;
  rank: number;
};

type GuidancePresentation = {
  mode: 'visible' | 'conditional' | 'sunlit_only' | 'path_only';
  badgeLabel: string | null;
  badgeTone: BadgeTone;
  windowLabel: string;
  windowNote: string | null;
  directionLabel: string;
  directionNote: string | null;
  elevationLabel: string;
  elevationNote: string | null;
};

type ScoreNarrative = {
  summary: string;
  whyNow: NarrativeItem[];
  guidance: GuidancePresentation;
};

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
  const primaryValue = isProbabilityMode && probability != null ? formatProbability(probability) : `${score.score}/100`;
  const primaryLabel = isProbabilityMode ? 'Chance to see it' : 'Visibility score';
  const scaleSummary = isProbabilityMode
    ? '0% = almost no chance. 100% = very likely.'
    : '0 = very unlikely to see it. 100 = best setup.';
  const hasGuidanceSummary = score.bestWindow != null || score.directionBand != null || score.elevationBand != null;
  const readinessSummary = formatReadinessSummary(score);
  const modelSummary = isProbabilityMode
    ? 'Estimated chance of seeing the jellyfish effect from your location.'
    : '0-100 score for how likely the jellyfish effect is to be visible from your location.';
  const narrative = deriveScoreNarrative(score);
  const guidancePresentation = narrative.guidance;
  const hasNarrative = narrative.whyNow.length > 0;
  const shouldShowGuidanceSummary =
    hasGuidanceSummary && (guidancePresentation.mode === 'visible' || guidancePresentation.mode === 'conditional');
  const observerMetricLabel = resolvedLocationMode === 'user' ? 'Your location' : 'Launch pad fallback';

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

        {hasNarrative && (
          <div className="mt-4">
            <NarrativePanel heading="Why This Score" summary={narrative.summary} items={narrative.whyNow} />
          </div>
        )}

        {shouldShowGuidanceSummary && (
          <div className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
            {guidancePresentation.badgeLabel && (
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge tone={guidancePresentation.badgeTone} subtle>
                  {guidancePresentation.badgeLabel}
                </Badge>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-3">
              {score.bestWindow && (
                <Metric
                  label={guidancePresentation.windowLabel}
                  value={score.bestWindow.label}
                  note={guidancePresentation.mode === 'visible' ? score.bestWindow.reason : guidancePresentation.windowNote}
                />
              )}
              {score.directionBand && (
                <Metric
                  label={guidancePresentation.directionLabel}
                  value={score.directionBand.label}
                  note={joinNotes(
                    `${formatDegrees(score.directionBand.fromAzDeg)} to ${formatDegrees(score.directionBand.toAzDeg)}`,
                    guidancePresentation.directionNote
                  )}
                />
              )}
              {score.elevationBand && (
                <Metric
                  label={guidancePresentation.elevationLabel}
                  value={score.elevationBand.label}
                  note={guidancePresentation.elevationNote}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <details className="mt-4 rounded-xl border border-stroke bg-surface-0 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-text1">Score Breakdown</summary>

        <div className="mt-3 grid gap-3 md:grid-cols-7">
          <Metric label="Visibility score" value={`${score.score}/100`} />
          <Metric label={isProbabilityMode ? 'Chance to see it' : 'Showing'} value={isProbabilityMode ? formatProbability(probability) : '0-100 score'} />
          <Metric label="Chance estimate" value={isProbabilityMode ? 'Shown' : 'Not shown yet'} note={readinessSummary} />
          <Metric label="Rocket in sunlight" value={formatFactor(score.factors.illumination)} />
          <Metric label="Twilight timing" value={formatFactor(score.factors.darkness)} />
          <Metric label="Visible path" value={formatFactor(score.factors.lineOfSight)} />
          <Metric
            label="Sky clarity"
            value={formatFactor(score.factors.weather)}
            note="Low clouds count most, then mid clouds, then high clouds. Total cloud is a soft ceiling."
          />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-7">
          <Metric
            label="Total cloud cover"
            value={formatPct(score.factors.cloudCoverPct)}
            note="Any cloud layer counts here, not just low overcast."
          />
          <Metric label="Low clouds" value={formatPct(score.factors.cloudCoverLowPct)} />
          <Metric label="Mid clouds" value={formatPct(score.factors.cloudCoverMidPct)} />
          <Metric label="High clouds" value={formatPct(score.factors.cloudCoverHighPct)} />
          <Metric label="Sun below horizon" value={formatDegrees(score.factors.solarDepressionDeg)} />
          <Metric label="Sunlight margin" value={formatKm(score.sunlitMarginKm)} />
          <Metric label="Visible flight path" value={formatProbability(score.losVisibleFraction)} />
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <Metric label="Weather data" value={weatherSourceLabel} />
          <Metric
            label="Observer location"
            value={observerMetricLabel}
            note={
              score.observer.usingPadFallback && resolvedLocationMode === 'pad_fallback'
                ? 'Using launch-pad geometry until your score refreshes.'
                : null
            }
          />
          {computedLabel ? <Metric label="Updated" value={computedLabel} /> : null}
          {score.isSnapshot ? (
            snapshotLabel ? <Metric label="Snapshot captured" value={snapshotLabel} /> : null
          ) : expiresLabel ? (
            <Metric label="Refresh due" value={expiresLabel} />
          ) : null}
        </div>

        <div className="mt-3 text-xs text-text3">
          {score.source.geometryOnlyFallback && <div>Weather fallback: geometry-only estimate because no usable forecast was available.</div>}
          {fallbackReasonLabel && resolvedLocationMode === 'pad_fallback' && <div>Browser location note: {fallbackReasonLabel}.</div>}
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

function NarrativePanel({
  heading,
  summary,
  items
}: {
  heading: string;
  summary?: string;
  items: NarrativeItem[];
}) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text3">{heading}</div>
      {summary ? <p className="mt-2 text-sm text-text2">{summary}</p> : null}
      <div className="mt-3 space-y-3">
        {items.map((item) => (
          <div key={`${heading}-${item.title}`} className="rounded-xl border border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={item.tone} subtle>
                {narrativeToneLabel(item.tone)}
              </Badge>
              <div className="text-sm font-semibold text-text1">{item.title}</div>
            </div>
            <div className="mt-2 text-sm text-text3">{item.detail}</div>
          </div>
        ))}
      </div>
    </div>
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

function deriveScoreNarrative(score: LaunchJepScore): ScoreNarrative {
  const guidance = deriveGuidancePresentation(score);
  const whyNow = sortNarrativeItems(buildWhyNowItems(score));
  const summary =
    score.score === 0
      ? 'No visible jellyfish plume is currently expected from this location.'
      : score.score < 30
        ? 'The setup is weak right now because multiple parts of the visibility chain are underperforming.'
        : score.score < 70
          ? 'The setup is mixed right now. Some parts of the visibility chain work, but important pieces are still limiting it.'
          : 'The setup is favorable right now, but the score still depends on timing, geometry, and weather holding together.';

  return {
    summary,
    whyNow,
    guidance
  };
}

function buildWhyNowItems(score: LaunchJepScore): NarrativeItem[] {
  const items: NarrativeItem[] = [];
  const cloudCover = toPctNumber(score.factors.cloudCoverPct);
  const lowClouds = toPctNumber(score.factors.cloudCoverLowPct);
  const midClouds = toPctNumber(score.factors.cloudCoverMidPct);
  const highClouds = toPctNumber(score.factors.cloudCoverHighPct);
  const sunBelow = score.factors.solarDepressionDeg;
  const weatherImpact = deriveJepWeatherImpact({
    cloudCoverTotal: score.factors.cloudCoverPct,
    cloudCoverLow: score.factors.cloudCoverLowPct,
    cloudCoverMid: score.factors.cloudCoverMidPct,
    cloudCoverHigh: score.factors.cloudCoverHighPct
  });
  const detailedWeatherItem = buildDetailedWeatherWhyItem(score.weatherDetails);

  if (detailedWeatherItem) {
    items.push(detailedWeatherItem);
  } else if (score.factors.weather <= 0.15 || weatherImpact.blockerStrength === 'severe') {
    items.push(primaryWeatherNarrative({
      cloudCover,
      lowClouds,
      midClouds,
      highClouds,
      weatherFactor: score.factors.weather,
      dominantBlocker: weatherImpact.dominantBlocker,
      blockerStrength: weatherImpact.blockerStrength
    }));
  } else if (score.factors.weather < 0.55 || weatherImpact.dominantBlocker !== 'unknown') {
    items.push(secondaryWeatherNarrative({
      cloudCover,
      lowClouds,
      midClouds,
      highClouds,
      weatherFactor: score.factors.weather,
      dominantBlocker: weatherImpact.dominantBlocker
    }));
  }

  if (score.factors.illumination === 0) {
    items.push({
      title: 'No sunlit plume window is modeled',
      detail: 'The model does not place the useful part of ascent in sunlight from this location at the current launch time.',
      tone: 'danger',
      rank: 95
    });
  } else if (score.factors.illumination < 0.25) {
    items.push({
      title: 'Only a small part of the plume is sunlit',
      detail: `Only ${formatFactor(score.factors.illumination)} of the scored ascent window is modeled in sunlight.`,
      tone: 'warning',
      rank: 68
    });
  }

  if (score.factors.illumination > 0 && score.factors.lineOfSight === 0) {
    items.push({
      title: 'The sunlit part never clears your horizon enough',
      detail: 'From this location, the sunlit segment is not modeled as clearly visible above the viewing threshold.',
      tone: 'danger',
      rank: 90
    });
  } else if (score.factors.illumination > 0 && score.factors.lineOfSight < 0.25) {
    items.push({
      title: 'Only a small part of the sunlit path is viewable',
      detail: `The visible part of the sunlit path is limited to ${formatFactor(score.factors.lineOfSight)} of the scoring window.`,
      tone: 'warning',
      rank: 64
    });
  }

  if (score.factors.darkness <= 0.15 && sunBelow != null) {
    items.push({
      title: 'Twilight timing is poor',
      detail: `The Sun is ${formatDegrees(sunBelow)} below the horizon, which is well past the twilight sweet spot that usually produces the best jellyfish contrast.`,
      tone: 'warning',
      rank: 66
    });
  } else if (score.factors.darkness < 0.4 && sunBelow != null) {
    items.push({
      title: 'Twilight timing is only partly favorable',
      detail: `The Sun is ${formatDegrees(sunBelow)} below the horizon, so the plume timing is not in the strongest twilight band.`,
      tone: 'info',
      rank: 48
    });
  }

  return items;
}

function deriveGuidancePresentation(score: LaunchJepScore): GuidancePresentation {
  if (score.factors.illumination > 0 && score.factors.lineOfSight > 0) {
    if (score.score > 0) {
      return {
        mode: 'visible',
        badgeLabel: null,
        badgeTone: 'success',
        windowLabel: 'Best viewing window',
        windowNote: null,
        directionLabel: 'Look toward',
        directionNote: null,
        elevationLabel: 'Height above horizon',
        elevationNote: 'Above your local horizon'
      };
    }
    return {
      mode: 'conditional',
      badgeLabel: 'Visibility blocked by current conditions',
      badgeTone: 'warning',
      windowLabel: 'If conditions improve',
      windowNote: 'This is the strongest modeled viewing geometry if current blockers like clouds or timing improve.',
      directionLabel: 'Look toward',
      directionNote: 'Direction if current blockers improve.',
      elevationLabel: 'Height above horizon',
      elevationNote: 'Above your local horizon if current blockers improve.'
    };
  }

  if (score.factors.illumination > 0) {
    return {
      mode: 'sunlit_only',
      badgeLabel: 'Sunlit path is not clearly visible',
      badgeTone: 'warning',
      windowLabel: 'Sunlit path peak',
      windowNote: 'The plume may be sunlit here, but the modeled sunlit segment is not clearly viewable from this location.',
      directionLabel: 'Path direction',
      directionNote: 'Geometry only. This is not a predicted visible plume window.',
      elevationLabel: 'Path height',
      elevationNote: 'Geometry only, not a predicted visible plume window.'
    };
  }

  return {
    mode: 'path_only',
    badgeLabel: 'Modeled path only',
    badgeTone: 'neutral',
    windowLabel: 'Modeled flight path peak',
    windowNote: 'This is the rocket’s highest modeled path from your observer, not a predicted visible plume window.',
    directionLabel: 'Path direction',
    directionNote: 'Geometry only. This is not a predicted visible plume window.',
    elevationLabel: 'Path height',
    elevationNote: 'Geometry only, not a predicted visible plume window.'
  };
}

function sortNarrativeItems(items: NarrativeItem[]) {
  const deduped = new Map<string, NarrativeItem>();
  for (const item of items) {
    const existing = deduped.get(item.title);
    if (!existing || item.rank > existing.rank) deduped.set(item.title, item);
  }
  return [...deduped.values()].sort((a, b) => b.rank - a.rank).slice(0, 3);
}

function narrativeToneLabel(tone: BadgeTone) {
  if (tone === 'danger') return 'Hard stop';
  if (tone === 'warning') return 'Main drag';
  if (tone === 'success') return 'Would help';
  return 'Also matters';
}

function buildDetailedWeatherWhyItem(weatherDetails: LaunchJepScore['weatherDetails']): NarrativeItem | null {
  if (!weatherDetails) return null;
  switch (weatherDetails.mainBlocker) {
    case 'observer_low_ceiling':
      return {
        title: 'Low cloud over your location is the main weather blocker',
        detail:
          weatherDetails.observer?.note ||
          'The forecast puts a low cloud deck over your location, which is the strongest weather blocker in the current model.',
        tone: 'danger',
        rank: 100
      };
    case 'observer_sky_cover':
      return {
        title: 'Cloud cover over your location is the main weather blocker',
        detail:
          weatherDetails.observer?.note ||
          'The weather model expects heavy cloud cover over your location at launch time.',
        tone: 'danger',
        rank: 94
      };
    case 'path_low_ceiling':
      return {
        title: 'Low cloud along the plume path is the main weather blocker',
        detail:
          weatherDetails.alongPath?.note ||
          'The modeled plume path runs under a low cloud deck, which makes blockage likely even if your local sky is somewhat better.',
        tone: 'danger',
        rank: 96
      };
    case 'path_sky_cover':
      return {
        title: 'Cloud cover along the plume path is the main weather blocker',
        detail:
          weatherDetails.alongPath?.note ||
          'The modeled plume path sits under heavy cloud cover, which is the strongest weather blocker in the current model.',
        tone: 'warning',
        rank: 88
      };
    case 'observer_low_clouds':
      return {
        title: 'Low clouds are the main weather drag',
        detail:
          weatherDetails.observer?.note ||
          'Low clouds over your location are the largest weather penalty in the current model.',
        tone: 'warning',
        rank: 82
      };
    case 'observer_mid_clouds':
      return {
        title: 'Mid-level cloud is softening the setup',
        detail:
          weatherDetails.observer?.note ||
          'Mid-level cloud is currently the main weather drag over your location.',
        tone: 'warning',
        rank: 74
      };
    case 'observer_high_clouds':
      return {
        title: 'High cloud is reducing contrast',
        detail:
          weatherDetails.observer?.note ||
          'The current weather model does not treat this like a solid low overcast deck, but it does expect high cloud to wash out contrast.',
        tone: 'info',
        rank: 62
      };
    case 'mixed':
      return {
        title: 'Several weather layers are working against the view',
        detail: weatherDetails.alongPath?.note || weatherDetails.observer?.note || 'No single cloud layer dominates the forecast right now.',
        tone: 'warning',
        rank: 68
      };
    default:
      return null;
  }
}

function joinNotes(primary: string | null, secondary: string | null) {
  if (primary && secondary) return `${primary}. ${secondary}`;
  return primary || secondary || null;
}

function scoreBand(score: number): { label: string; tone: BadgeTone } {
  if (score >= 70) return { label: 'High', tone: 'success' };
  if (score >= 30) return { label: 'Moderate', tone: 'warning' };
  return { label: 'Low', tone: 'danger' };
}

function calibrationBandTone(band: string): BadgeTone {
  if (band === 'VERY_HIGH' || band === 'HIGH') return 'success';
  if (band === 'MEDIUM') return 'info';
  if (band === 'LOW') return 'warning';
  if (band === 'VERY_LOW') return 'danger';
  return 'neutral';
}

function formatFactor(value: number) {
  return `${Math.round(value * 100)}%`;
}

function primaryWeatherNarrative({
  cloudCover,
  lowClouds,
  midClouds,
  highClouds,
  weatherFactor,
  dominantBlocker,
  blockerStrength
}: {
  cloudCover: number | null;
  lowClouds: number | null;
  midClouds: number | null;
  highClouds: number | null;
  weatherFactor: number;
  dominantBlocker: ReturnType<typeof deriveJepWeatherImpact>['dominantBlocker'];
  blockerStrength: ReturnType<typeof deriveJepWeatherImpact>['blockerStrength'];
}): NarrativeItem {
  if (dominantBlocker === 'low' && lowClouds != null) {
    return {
      title: 'A low cloud deck is the main weather blocker',
      detail: `Low clouds are ${formatPct(lowClouds)} right now. The current model weights low clouds most heavily because they are most likely to block the plume directly.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`,
      tone: 'danger',
      rank: blockerStrength === 'severe' ? 100 : 88
    };
  }

  if (dominantBlocker === 'mid' && midClouds != null) {
    return {
      title: 'Mid-level cloud is the main weather blocker',
      detail: `Mid clouds are ${formatPct(midClouds)} right now, which is a stronger drag than the low and high layers in the current model.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`,
      tone: 'danger',
      rank: 84
    };
  }

  if (dominantBlocker === 'high' && highClouds != null) {
    return {
      title: 'High cloud is overhead, but it is not treated like low overcast',
      detail: `Most of the cloud signal is coming from high cloud at ${formatPct(highClouds)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} The weather term still falls to ${formatFactor(weatherFactor)}, but this is a softer drag than a solid low deck.`,
      tone: 'warning',
      rank: 78
    };
  }

  return {
    title: 'Several cloud layers are softening the view',
    detail: `The current weather term is ${formatFactor(weatherFactor)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} The model weights low clouds most, then mid clouds, then high clouds.`,
    tone: weatherFactor <= 0.2 ? 'danger' : 'warning',
    rank: weatherFactor <= 0.2 ? 82 : 66
  };
}

function secondaryWeatherNarrative({
  cloudCover,
  lowClouds,
  midClouds,
  highClouds,
  weatherFactor,
  dominantBlocker
}: {
  cloudCover: number | null;
  lowClouds: number | null;
  midClouds: number | null;
  highClouds: number | null;
  weatherFactor: number;
  dominantBlocker: ReturnType<typeof deriveJepWeatherImpact>['dominantBlocker'];
}): NarrativeItem {
  if (dominantBlocker === 'high' && highClouds != null) {
    return {
      title: 'High cloud is reducing contrast',
      detail: `High clouds are ${formatPct(highClouds)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} In the current model that softens the weather term without treating it as a hard stop.`,
      tone: 'info',
      rank: 54
    };
  }

  if (dominantBlocker === 'low' && lowClouds != null) {
    return {
      title: 'Low clouds are the main weather drag',
      detail: `Low clouds are ${formatPct(lowClouds)} right now, which is the largest weather penalty in the current model.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`,
      tone: 'warning',
      rank: 72
    };
  }

  if (dominantBlocker === 'mid' && midClouds != null) {
    return {
      title: 'Mid-level cloud is softening the setup',
      detail: `Mid clouds are ${formatPct(midClouds)} right now.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} That keeps the weather term at ${formatFactor(weatherFactor)}.`,
      tone: 'warning',
      rank: 62
    };
  }

  return {
    title: 'Clouds are part of the drag',
    detail: `The weather term is ${formatFactor(weatherFactor)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`,
    tone: 'info',
    rank: 48
  };
}

function appendCloudProfile(cloudCover: number | null, lowClouds: number | null, midClouds: number | null, highClouds: number | null) {
  const pieces = [
    cloudCover != null ? `total ${formatPct(cloudCover)}` : null,
    lowClouds != null ? `low ${formatPct(lowClouds)}` : null,
    midClouds != null ? `mid ${formatPct(midClouds)}` : null,
    highClouds != null ? `high ${formatPct(highClouds)}` : null
  ].filter((value): value is string => Boolean(value));

  if (!pieces.length) return '';
  return ` Cloud mix: ${pieces.join(', ')}.`;
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

function toPctNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
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
  if (normalized === 'mixed') return 'NOAA NWS + Open-Meteo';
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
