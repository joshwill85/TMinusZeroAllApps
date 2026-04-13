import type { LaunchJepScoreV1 } from '@tminuszero/contracts';

export const JEP_LOS_ELEVATION_THRESHOLD_DEG = 5;
export const JEP_TWILIGHT_SWEET_SPOT_MIN_DEG = 6;
export const JEP_TWILIGHT_SWEET_SPOT_MAX_DEG = 12;

export type JepPresentationTone = 'primary' | 'neutral' | 'warning' | 'danger' | 'success' | 'info';
export type JepFactorAssessmentKey = 'illumination' | 'darkness' | 'lineOfSight' | 'weather';
export type JepChangeOpportunityKey = 'timing' | 'weather' | 'lineOfSight';
type WeatherMainBlocker = NonNullable<LaunchJepScoreV1['weatherDetails']>['mainBlocker'];
export type JepVisibilityCall = NonNullable<LaunchJepScoreV1['visibilityCall']>;
export type JepViewpoint = NonNullable<LaunchJepScoreV1['viewpoint']>;
export type JepConfidenceLabel = NonNullable<LaunchJepScoreV1['confidenceLabel']>;

export type JepFactorAssessment = {
  key: JepFactorAssessmentKey;
  label: string;
  value: string;
  tone: JepPresentationTone;
  status: string;
  detail: string;
  rangeNote: string | null;
};

export type JepChangeOpportunity = {
  key: JepChangeOpportunityKey;
  title: string;
  detail: string;
  tone: JepPresentationTone;
  priority: number;
  rankLabel: string;
};

export type JepPresentation = {
  summary: string;
  factorAssessments: JepFactorAssessment[];
  changeOpportunities: JepChangeOpportunity[];
};

type JepObserverLike = Pick<LaunchJepScoreV1['observer'], 'personalized' | 'usingPadFallback'>;

export type JepObserverContext = {
  isPersonalized: boolean;
  launchAreaFallback: boolean;
  locationBadgeLabel: string;
  locationPhrase: string;
  areaPhrase: string;
  horizonPhrase: string;
  observerMetricLabel: string;
};

export type JepVisibilityCallPresentation = {
  key: JepVisibilityCall;
  label: string;
  detail: string;
  tone: JepPresentationTone;
};

export type JepScenarioTimelineEntry = {
  id: string;
  label: string;
  score: number;
  visibilityCall: JepVisibilityCall;
  tone: JepPresentationTone;
  trend: 'better' | 'similar' | 'worse';
  delta: number;
  current: boolean;
};

type WeatherNarrative = {
  detail: string;
};

type JepWeatherBlocker = 'low' | 'mid' | 'high' | 'total' | 'mixed' | 'unknown';

type JepWeatherImpact = {
  factor: number;
  dominantBlocker: JepWeatherBlocker;
  blockerStrength: 'light' | 'moderate' | 'strong' | 'severe';
};

export function buildJepPresentation(score: LaunchJepScoreV1): JepPresentation {
  const observerContext = buildJepObserverContext(score.observer);
  const factorAssessments = [
    buildTimingAssessment(score),
    buildWeatherAssessment(score, observerContext),
    buildLineOfSightAssessment(score, observerContext),
    buildIlluminationAssessment(score)
  ];
  const changeOpportunities = [
    buildTimingChangeOpportunity(score),
    buildWeatherChangeOpportunity(score),
    buildLocationChangeOpportunity(score, observerContext)
  ]
    .sort((a, b) => b.priority - a.priority)
    .map((item, index) => ({
      ...item,
      rankLabel: formatChangeRankLabel(index, item.priority)
    }));

  return {
    summary: buildJepSummary(score.score, observerContext),
    factorAssessments,
    changeOpportunities
  };
}

export function buildJepObserverContext(observer: JepObserverLike): JepObserverContext {
  const isPersonalized = observer.personalized && !observer.usingPadFallback;
  return {
    isPersonalized,
    launchAreaFallback: !isPersonalized,
    locationBadgeLabel: isPersonalized ? 'Using your location' : 'Launch-area fallback',
    locationPhrase: isPersonalized ? 'this location' : 'the launch-area reference viewpoint',
    areaPhrase: isPersonalized ? 'your location' : 'the launch-area reference area',
    horizonPhrase: isPersonalized ? 'your local horizon' : 'the launch-area reference horizon',
    observerMetricLabel: isPersonalized ? 'Your location' : 'Launch-area reference'
  };
}

export function buildJepViewpoint(score: LaunchJepScoreV1): JepViewpoint {
  if (score.viewpoint === 'personal' || score.viewpoint === 'launch_site_reference') {
    return score.viewpoint;
  }
  return buildJepObserverContext(score.observer).launchAreaFallback ? 'launch_site_reference' : 'personal';
}

export function buildJepVisibilityCall(score: LaunchJepScoreV1): JepVisibilityCall {
  if (
    score.visibilityCall === 'not_expected' ||
    score.visibilityCall === 'possible' ||
    score.visibilityCall === 'favorable' ||
    score.visibilityCall === 'highly_favorable'
  ) {
    return score.visibilityCall;
  }

  return deriveVisibilityCallFromScore(score.score, {
    darkness: score.factors.darkness,
    illumination: score.factors.illumination,
    lineOfSight: score.factors.lineOfSight
  });
}

export function buildJepConfidenceLabel(score: LaunchJepScoreV1): JepConfidenceLabel {
  if (score.confidenceLabel === 'low' || score.confidenceLabel === 'medium' || score.confidenceLabel === 'high') {
    return score.confidenceLabel;
  }

  return score.source.geometryOnlyFallback ? 'low' : 'medium';
}

export function buildJepVisibilityCallPresentation(
  score: LaunchJepScoreV1,
  observerContext = buildJepObserverContext(score.observer)
): JepVisibilityCallPresentation {
  const key = buildJepVisibilityCall(score);
  const referencePhrase = observerContext.launchAreaFallback ? 'near the launch site' : 'from your location';

  switch (key) {
    case 'not_expected':
      return {
        key,
        label: 'Not expected',
        tone: 'danger',
        detail: observerContext.launchAreaFallback
          ? 'No visible jellyfish-style plume is currently expected near the launch site.'
          : 'No visible jellyfish-style plume is currently expected from your location.'
      };
    case 'possible':
      return {
        key,
        label: 'Possible',
        tone: 'warning',
        detail: `A visible twilight plume is possible ${referencePhrase}, but it may be faint or easy to miss.`
      };
    case 'favorable':
      return {
        key,
        label: 'Favorable',
        tone: 'success',
        detail: `Conditions are favorable for a visible jellyfish-style plume ${referencePhrase}.`
      };
    default:
      return {
        key,
        label: 'Highly favorable',
        tone: 'success',
        detail: `Conditions are highly favorable for a strong visible jellyfish-style plume ${referencePhrase}.`
      };
  }
}

export function buildJepScenarioTimeline(score: LaunchJepScoreV1): JepScenarioTimelineEntry[] {
  const currentEntry: JepScenarioTimelineEntry = {
    id: 'net',
    label: 'NET',
    score: score.score,
    visibilityCall: buildJepVisibilityCall(score),
    tone: visibilityCallTone(buildJepVisibilityCall(score)),
    trend: 'similar',
    delta: 0,
    current: true
  };

  const shiftedEntries = (score.scenarioWindows || []).map((scenario) => {
    const visibilityCall = deriveVisibilityCallFromScore(scenario.score);
    return {
      id: `scenario-${scenario.offsetMinutes}`,
      label: scenario.label,
      score: scenario.score,
      visibilityCall,
      tone: visibilityCallTone(visibilityCall),
      trend: scenario.trend,
      delta: scenario.delta,
      current: false
    } satisfies JepScenarioTimelineEntry;
  });

  const meaningfulShiftedEntries = shiftedEntries.filter((entry, index, items) => {
    const previousScore = index === 0 ? currentEntry.score : items[index - 1]?.score ?? currentEntry.score;
    return entry.score !== previousScore;
  });

  if (meaningfulShiftedEntries.length === 0) return [];

  return [currentEntry, ...meaningfulShiftedEntries];
}

function buildJepSummary(score: number, observerContext: JepObserverContext) {
  if (observerContext.launchAreaFallback) {
    if (score === 0) {
      return 'The launch-area reference setup does not currently support a visible jellyfish plume.';
    }
    if (score < 30) {
      return 'Launch-area conditions look weak right now because multiple parts of the visibility chain are underperforming.';
    }
    if (score < 70) {
      return 'Launch-area conditions are mixed right now. This is a reference setup, not your personal visibility call.';
    }
    return 'Launch-area conditions look favorable right now, but this is still a reference setup rather than your personal visibility call.';
  }

  if (score === 0) {
    return 'No visible jellyfish plume is currently expected from this location.';
  }
  if (score < 30) {
    return 'The setup is weak right now because multiple parts of the visibility chain are underperforming.';
  }
  if (score < 70) {
    return 'The setup is mixed right now. Some parts of the visibility chain work, but important pieces are still limiting it.';
  }
  return 'The setup is favorable right now, but the score still depends on timing, geometry, and weather holding together.';
}

function deriveVisibilityCallFromScore(
  score: number,
  factors?: {
    darkness?: number | null;
    illumination?: number | null;
    lineOfSight?: number | null;
  }
): JepVisibilityCall {
  if (
    score <= 0 ||
    (factors?.darkness != null && factors.darkness <= 0) ||
    (factors?.illumination != null && factors.illumination <= 0) ||
    (factors?.lineOfSight != null && factors.lineOfSight <= 0)
  ) {
    return 'not_expected';
  }
  if (score >= 85) return 'highly_favorable';
  if (score >= 65) return 'favorable';
  return 'possible';
}

function visibilityCallTone(value: JepVisibilityCall): JepPresentationTone {
  if (value === 'not_expected') return 'danger';
  if (value === 'possible') return 'warning';
  return 'success';
}

function buildTimingAssessment(score: LaunchJepScoreV1): JepFactorAssessment {
  const factor = clampProbability(score.factors.darkness) ?? 0;
  const solarAngle = score.factors.solarDepressionDeg;
  const sweetSpot = formatTwilightSweetSpot();

  if (factor >= 0.95) {
    return {
      key: 'darkness',
      label: 'Twilight timing',
      value: formatFactor(factor),
      tone: 'success',
      status: 'Prime band',
      detail: `The Sun is ${formatSolarAngle(solarAngle)}, which sits in the strongest twilight band for jellyfish visibility.`,
      rangeNote: `Needed range: Sun about ${sweetSpot}.`
    };
  }

  if (solarAngle != null && solarAngle < 0) {
    return {
      key: 'darkness',
      label: 'Twilight timing',
      value: formatFactor(factor),
      tone: 'danger',
      status: 'Daylight',
      detail: `At NET the Sun is ${formatSolarAngle(solarAngle)}, so this setup is still in daylight rather than twilight.`,
      rangeNote: `Needed range: Sun about ${sweetSpot}.`
    };
  }

  if (solarAngle != null && solarAngle > JEP_TWILIGHT_SWEET_SPOT_MAX_DEG) {
    return {
      key: 'darkness',
      label: 'Twilight timing',
      value: formatFactor(factor),
      tone: 'warning',
      status: 'Too dark',
      detail: `At NET the Sun is ${formatSolarAngle(solarAngle)}, which is darker than the usual jellyfish sweet spot.`,
      rangeNote: `Needed range: Sun about ${sweetSpot}.`
    };
  }

  return {
    key: 'darkness',
    label: 'Twilight timing',
    value: formatFactor(factor),
    tone: factor >= 0.8 ? 'info' : 'warning',
    status: factor >= 0.8 ? 'Close' : 'Off band',
    detail:
      factor >= 0.8
        ? `The Sun is ${formatSolarAngle(solarAngle)}, which is close to the best twilight band but not centered in it.`
        : `The Sun is ${formatSolarAngle(solarAngle)}, so the launch is outside the strongest twilight band right now.`,
    rangeNote: `Needed range: Sun about ${sweetSpot}.`
  };
}

function buildWeatherAssessment(score: LaunchJepScoreV1, observerContext: JepObserverContext): JepFactorAssessment {
  const factor = clampProbability(score.factors.weather) ?? 0;
  const cloudCover = toPctNumber(score.factors.cloudCoverPct);
  const lowClouds = toPctNumber(score.factors.cloudCoverLowPct);
  const midClouds = toPctNumber(score.factors.cloudCoverMidPct);
  const highClouds = toPctNumber(score.factors.cloudCoverHighPct);
  const weatherImpact = deriveJepWeatherImpact({
    cloudCoverTotal: score.factors.cloudCoverPct,
    cloudCoverLow: score.factors.cloudCoverLowPct,
    cloudCoverMid: score.factors.cloudCoverMidPct,
    cloudCoverHigh: score.factors.cloudCoverHighPct
  });
  const narrative =
    buildDetailedWeatherNarrative(score.weatherDetails, observerContext) ??
    (factor <= 0.15 || weatherImpact.blockerStrength === 'severe'
      ? primaryWeatherNarrative({
          cloudCover,
          lowClouds,
          midClouds,
          highClouds,
          weatherFactor: factor,
          dominantBlocker: weatherImpact.dominantBlocker,
          blockerStrength: weatherImpact.blockerStrength
        })
      : secondaryWeatherNarrative({
          cloudCover,
          lowClouds,
          midClouds,
          highClouds,
          weatherFactor: factor,
          dominantBlocker: weatherImpact.dominantBlocker
        }));

  return {
    key: 'weather',
    label: 'Sky clarity',
    value: formatFactor(factor),
    tone: factor >= 0.8 ? 'success' : factor >= 0.45 ? 'warning' : 'danger',
    status: factor >= 0.8 ? 'Mostly clear' : factor >= 0.45 ? 'Mixed' : 'Main drag',
    detail: narrative.detail,
    rangeNote: 'Needed condition: clearer sky, with low clouds and ceilings improving first, then mid clouds, then high clouds.'
  };
}

function buildLineOfSightAssessment(score: LaunchJepScoreV1, observerContext: JepObserverContext): JepFactorAssessment {
  const factor = clampProbability(score.factors.lineOfSight) ?? 0;
  const visibleFraction = clampProbability(score.losVisibleFraction) ?? factor;
  const rangeNote = `Needed range: about ${JEP_LOS_ELEVATION_THRESHOLD_DEG}°+ above ${observerContext.horizonPhrase}.`;

  if (factor >= 0.85) {
    return {
      key: 'lineOfSight',
      label: 'Visible path',
      value: formatFactor(factor),
      tone: 'success',
      status: 'Working',
      detail: `About ${formatProbability(visibleFraction)} of the useful sunlit path clears the viewing threshold from ${observerContext.locationPhrase}.`,
      rangeNote
    };
  }

  if (factor === 0) {
    return {
      key: 'lineOfSight',
      label: 'Visible path',
      value: formatFactor(factor),
      tone: 'danger',
      status: 'Blocked',
      detail: `The modeled sunlit path does not clear ${observerContext.horizonPhrase} enough to count as visible from ${observerContext.locationPhrase}.`,
      rangeNote
    };
  }

  return {
    key: 'lineOfSight',
    label: 'Visible path',
    value: formatFactor(factor),
    tone: factor >= 0.45 ? 'warning' : 'danger',
    status: factor >= 0.45 ? 'Limited' : 'Low',
    detail: `Only ${formatProbability(visibleFraction)} of the useful sunlit path clears the viewing threshold from ${observerContext.locationPhrase}.`,
    rangeNote
  };
}

function buildIlluminationAssessment(score: LaunchJepScoreV1): JepFactorAssessment {
  const factor = clampProbability(score.factors.illumination) ?? 0;
  const margin = score.sunlitMarginKm != null && Number.isFinite(score.sunlitMarginKm) ? ` Sunlight margin: ${formatKm(score.sunlitMarginKm)}.` : '';

  if (factor >= 0.85) {
    return {
      key: 'illumination',
      label: 'Sunlit plume overlap',
      value: formatFactor(factor),
      tone: 'success',
      status: 'Working',
      detail: `Most of the scored ascent window is modeled in sunlight.${margin}`,
      rangeNote: 'Needed condition: enough of the scored ascent stays in sunlight. This usually changes with launch timing.'
    };
  }

  if (factor === 0) {
    return {
      key: 'illumination',
      label: 'Sunlit plume overlap',
      value: formatFactor(factor),
      tone: 'danger',
      status: 'Blocked',
      detail: `The useful part of ascent is not modeled in sunlight at this launch time.${margin}`,
      rangeNote: 'Needed condition: enough of the useful ascent stays sunlit. This usually improves with a different launch time.'
    };
  }

  return {
    key: 'illumination',
    label: 'Sunlit plume overlap',
    value: formatFactor(factor),
    tone: factor >= 0.45 ? 'warning' : 'danger',
    status: factor >= 0.45 ? 'Partial' : 'Low',
    detail: `Only ${formatFactor(factor)} of the scored ascent window is modeled in sunlight.${margin}`,
    rangeNote: 'Needed condition: enough of the useful ascent stays sunlit. This usually improves with a different launch time.'
  };
}

function buildTimingChangeOpportunity(score: LaunchJepScoreV1): Omit<JepChangeOpportunity, 'rankLabel'> {
  const darknessFactor = clampProbability(score.factors.darkness) ?? 0;
  const illuminationFactor = clampProbability(score.factors.illumination) ?? 0;
  const solarAngle = score.factors.solarDepressionDeg;
  const windowRange = score.solarWindowRange;
  const sweetSpot = formatTwilightSweetSpot();
  const windowSummary = windowRange ? formatSolarWindowRange(windowRange) : null;
  const maxScenarioDelta = score.scenarioWindows.reduce((best, scenario) => Math.max(best, scenario.delta), 0);
  const scenarioBoost = Math.max(0, maxScenarioDelta) / 100 * 0.12;
  const timingPriority =
    0.25 * (1 - darknessFactor) +
    0.35 * (1 - illuminationFactor) +
    (windowRange?.crossesTwilightSweetSpot ? 0.08 : 0);

  if (darknessFactor >= 0.95 && illuminationFactor >= 0.85) {
    return {
      key: 'timing',
      title: 'Launch timing is already mostly working',
      detail: 'The current NET already lands in the strongest twilight band and keeps most of the useful ascent sunlit.',
      tone: 'success',
      priority: 0.01
    };
  }

  if (solarAngle != null && solarAngle < 0) {
    const illuminationNote =
      illuminationFactor < 0.5
        ? ' It would also put more of the useful ascent into better Sun/rocket lighting.'
        : '';
    return {
      key: 'timing',
      title: windowRange?.crossesTwilightSweetSpot
        ? 'A later NET inside this window would help most'
        : 'The launch needs a later NET window first',
      detail: windowRange?.crossesTwilightSweetSpot && windowSummary
        ? `At NET the Sun is ${formatSolarAngle(solarAngle)}, so this starts in daylight. The current NET range spans ${windowSummary} and reaches the target band of ${sweetSpot} later in that range.${illuminationNote}`
        : `At NET the Sun is ${formatSolarAngle(solarAngle)}, so this is still daylight instead of twilight. JEP usually wants the Sun about ${sweetSpot}.${illuminationNote}`,
      tone: 'danger',
      priority: timingPriority + scenarioBoost + (windowRange?.crossesTwilightSweetSpot ? 0.1 : 0.03)
    };
  }

  if (solarAngle != null && solarAngle > JEP_TWILIGHT_SWEET_SPOT_MAX_DEG) {
    return {
      key: 'timing',
      title: 'An earlier NET would improve the view',
      detail: windowSummary
        ? `At NET the Sun is ${formatSolarAngle(solarAngle)}, which is darker than the strongest twilight band. The current window spans ${windowSummary}, so an earlier edge would move closer to the target band of ${sweetSpot}.`
        : `At NET the Sun is ${formatSolarAngle(solarAngle)}, which is darker than the strongest twilight band. Moving earlier toward ${sweetSpot} would improve the setup.`,
      tone: 'warning',
      priority: timingPriority + scenarioBoost
    };
  }

  if (illuminationFactor < 0.5) {
    return {
      key: 'timing',
      title: 'Launch timing needs more sunlit plume overlap',
      detail: `Twilight is not the main issue here. The useful part of ascent is only sunlit for ${formatFactor(illuminationFactor)} of the scoring window, so the launch would need a timing shift that keeps more of the plume above Earth's shadow.`,
      tone: illuminationFactor === 0 ? 'danger' : 'warning',
      priority: timingPriority + scenarioBoost
    };
  }

  const laterWindow = solarAngle != null && solarAngle < JEP_TWILIGHT_SWEET_SPOT_MIN_DEG;
  return {
    key: 'timing',
    title: laterWindow ? 'A slightly later NET would help timing' : 'A slightly earlier NET would help timing',
    detail: windowSummary
      ? `At NET the Sun is ${formatSolarAngle(solarAngle)}, which is near but not centered in the target band of ${sweetSpot}. The current window spans ${windowSummary}.`
      : `At NET the Sun is ${formatSolarAngle(solarAngle)}, which is near but not centered in the target band of ${sweetSpot}.`,
    tone: darknessFactor >= 0.8 ? 'info' : 'warning',
    priority: timingPriority + scenarioBoost
  };
}

function buildWeatherChangeOpportunity(score: LaunchJepScoreV1): Omit<JepChangeOpportunity, 'rankLabel'> {
  const factor = clampProbability(score.factors.weather) ?? 0;
  const weatherImpact = deriveJepWeatherImpact({
    cloudCoverTotal: score.factors.cloudCoverPct,
    cloudCoverLow: score.factors.cloudCoverLowPct,
    cloudCoverMid: score.factors.cloudCoverMidPct,
    cloudCoverHigh: score.factors.cloudCoverHighPct
  });

  return {
    key: 'weather',
    title: summarizeWeatherChangeTitle(score.weatherDetails?.mainBlocker, weatherImpact.dominantBlocker, factor),
    detail:
      factor >= 0.8
        ? 'Weather is not the first thing that needs to change right now.'
        : summarizeWeatherChangeDetail(score.weatherDetails?.mainBlocker, weatherImpact.dominantBlocker),
    tone: factor >= 0.8 ? 'success' : factor >= 0.45 ? 'warning' : 'danger',
    priority: 0.15 * (1 - factor) + (factor <= 0.25 ? 0.05 : 0)
  };
}

function buildLocationChangeOpportunity(
  score: LaunchJepScoreV1,
  observerContext: JepObserverContext
): Omit<JepChangeOpportunity, 'rankLabel'> {
  const factor = clampProbability(score.factors.lineOfSight) ?? 0;

  if (factor >= 0.85) {
    return {
      key: 'lineOfSight',
      title: 'Viewing geometry is already mostly working',
      detail: `From ${observerContext.locationPhrase}, enough of the useful path already clears ${observerContext.horizonPhrase}.`,
      tone: 'success',
      priority: 0.01
    };
  }

  if (factor === 0) {
    return {
      key: 'lineOfSight',
      title: 'You would need a clearer horizon or different viewing spot',
      detail: `From ${observerContext.locationPhrase} the path never clears the usual ${JEP_LOS_ELEVATION_THRESHOLD_DEG}° visibility threshold high enough to count as visible.`,
      tone: 'danger',
      priority: 0.25 * (1 - factor) + (score.factors.illumination > 0 ? 0.05 : 0)
    };
  }

  return {
    key: 'lineOfSight',
    title: 'A lower, clearer horizon would improve the view',
    detail: `${observerContext.locationPhrase === 'this location' ? 'This location' : 'The launch-area reference viewpoint'} only clears part of the useful path above the usual ${JEP_LOS_ELEVATION_THRESHOLD_DEG}° visibility threshold, so a cleaner horizon would help.`,
    tone: factor >= 0.45 ? 'warning' : 'danger',
    priority: 0.25 * (1 - factor)
  };
}

function buildDetailedWeatherNarrative(
  weatherDetails: LaunchJepScoreV1['weatherDetails'],
  observerContext: JepObserverContext
): WeatherNarrative | null {
  if (!weatherDetails) return null;
  switch (weatherDetails.mainBlocker) {
    case 'observer_low_ceiling':
      return {
        detail:
          weatherDetails.observer?.note ||
          `The forecast puts a low cloud deck over ${observerContext.areaPhrase}, which is the strongest weather blocker in the current model.`
      };
    case 'observer_sky_cover':
      return {
        detail:
          weatherDetails.observer?.note ||
          `The weather model expects heavy cloud cover over ${observerContext.areaPhrase} at launch time.`
      };
    case 'path_low_ceiling':
      return {
        detail:
          weatherDetails.alongPath?.note ||
          'The modeled plume path runs under a low cloud deck, which makes blockage likely even if your local sky is somewhat better.'
      };
    case 'path_sky_cover':
      return {
        detail:
          weatherDetails.alongPath?.note ||
          'The modeled plume path sits under heavy cloud cover, which is the strongest weather blocker in the current model.'
      };
    case 'observer_low_clouds':
      return {
        detail:
          weatherDetails.observer?.note ||
          `Low clouds over ${observerContext.areaPhrase} are the largest weather penalty in the current model.`
      };
    case 'observer_mid_clouds':
      return {
        detail:
          weatherDetails.observer?.note ||
          `Mid-level cloud is currently the main weather drag over ${observerContext.areaPhrase}.`
      };
    case 'observer_high_clouds':
      return {
        detail:
          weatherDetails.observer?.note ||
          'The current weather model does not treat this like a solid low overcast deck, but it does expect high cloud to wash out contrast.'
      };
    case 'mixed':
      return {
        detail: weatherDetails.alongPath?.note || weatherDetails.observer?.note || 'No single cloud layer dominates the forecast right now.'
      };
    default:
      return null;
  }
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
  dominantBlocker: JepWeatherBlocker;
  blockerStrength: JepWeatherImpact['blockerStrength'];
}): WeatherNarrative {
  if (dominantBlocker === 'low' && lowClouds != null) {
    return {
      detail: `Low clouds are ${formatPct(lowClouds)} right now. The current model weights low clouds most heavily because they are most likely to block the plume directly.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`
    };
  }

  if (dominantBlocker === 'mid' && midClouds != null) {
    return {
      detail: `Mid clouds are ${formatPct(midClouds)} right now, which is a stronger drag than the low and high layers in the current model.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`
    };
  }

  if (dominantBlocker === 'high' && highClouds != null) {
    return {
      detail: `Most of the cloud signal is coming from high cloud at ${formatPct(highClouds)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} The weather term still falls to ${formatFactor(weatherFactor)}, but this is a softer drag than a solid low deck.`
    };
  }

  return {
    detail: `The current weather term is ${formatFactor(weatherFactor)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} The model weights low clouds most, then mid clouds, then high clouds.${blockerStrength === 'severe' ? ' Weather is a major blocker right now.' : ''}`
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
  dominantBlocker: JepWeatherBlocker;
}): WeatherNarrative {
  if (dominantBlocker === 'high' && highClouds != null) {
    return {
      detail: `High clouds are ${formatPct(highClouds)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} In the current model that softens the weather term without treating it as a hard stop.`
    };
  }

  if (dominantBlocker === 'low' && lowClouds != null) {
    return {
      detail: `Low clouds are ${formatPct(lowClouds)} right now, which is the largest weather penalty in the current model.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`
    };
  }

  if (dominantBlocker === 'mid' && midClouds != null) {
    return {
      detail: `Mid clouds are ${formatPct(midClouds)} right now.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)} That keeps the weather term at ${formatFactor(weatherFactor)}.`
    };
  }

  return {
    detail: `The weather term is ${formatFactor(weatherFactor)}.${appendCloudProfile(cloudCover, lowClouds, midClouds, highClouds)}`
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

function summarizeWeatherChangeTitle(mainBlocker: WeatherMainBlocker | undefined, dominantBlocker: JepWeatherBlocker, factor: number) {
  if (factor >= 0.8) return 'Weather is already mostly working';
  if (mainBlocker === 'observer_low_ceiling' || mainBlocker === 'observer_low_clouds' || dominantBlocker === 'low') {
    return 'Low clouds need to thin first';
  }
  if (mainBlocker === 'path_low_ceiling') return 'Clouds along the plume path need to lift first';
  if (mainBlocker === 'path_sky_cover') return 'The plume path needs clearer sky first';
  if (mainBlocker === 'observer_mid_clouds' || dominantBlocker === 'mid') return 'Mid-level clouds need to thin';
  if (mainBlocker === 'observer_high_clouds' || dominantBlocker === 'high') return 'High cloud needs to thin to improve contrast';
  return 'The sky needs to clear';
}

function summarizeWeatherChangeDetail(mainBlocker: WeatherMainBlocker | undefined, dominantBlocker: JepWeatherBlocker) {
  if (mainBlocker === 'observer_low_ceiling' || mainBlocker === 'observer_low_clouds' || dominantBlocker === 'low') {
    return 'Low cloud and low ceilings are the first weather levers to improve because they block the plume most directly.';
  }
  if (mainBlocker === 'path_low_ceiling') {
    return 'Even if your local sky improves, the plume path itself still needs to get out from under a low deck.';
  }
  if (mainBlocker === 'path_sky_cover') {
    return 'The modeled plume path needs cleaner sky, not just your exact observing point.';
  }
  if (mainBlocker === 'observer_mid_clouds' || dominantBlocker === 'mid') {
    return 'Mid-level cloud is the main weather drag right now. Less mid cloud would improve contrast and visibility.';
  }
  if (mainBlocker === 'observer_high_clouds' || dominantBlocker === 'high') {
    return 'High cloud is softening contrast rather than acting like a full low overcast block. Cleaner upper sky would help.';
  }
  return 'There is no single magic cutoff here, but cleaner sky would improve the setup, with low clouds helping most, then mid, then high.';
}

function deriveJepWeatherImpact({
  cloudCoverTotal,
  cloudCoverLow,
  cloudCoverMid = null,
  cloudCoverHigh = null
}: {
  cloudCoverTotal: number | null;
  cloudCoverLow: number | null;
  cloudCoverMid?: number | null;
  cloudCoverHigh?: number | null;
}): JepWeatherImpact {
  const total = normalizePct(cloudCoverTotal);
  const low = normalizePct(cloudCoverLow);
  const mid = normalizePct(cloudCoverMid);
  const high = normalizePct(cloudCoverHigh);
  const detailedLayersAvailable = mid != null || high != null;

  const lowPenalty = scaledPenalty(low, 10, 90, 0.85);
  const midPenalty = scaledPenalty(mid, 20, 95, 0.5);
  const highPenalty = scaledPenalty(high, 30, 100, 0.25);
  const totalPenalty = detailedLayersAvailable
    ? scaledPenalty(total, 60, 100, 0.2)
    : scaledPenalty(total, 25, 95, 0.55);
  const combined = clamp(lowPenalty + midPenalty + highPenalty + totalPenalty, 0, 1);

  return {
    factor: round(clamp(1 - combined, 0, 1), 3),
    dominantBlocker: dominantBlocker(
      {
        low: lowPenalty,
        mid: midPenalty,
        high: highPenalty,
        total: totalPenalty
      },
      detailedLayersAvailable
    ),
    blockerStrength: blockerStrength(combined)
  };
}

function dominantBlocker(
  penalties: { low: number; mid: number; high: number; total: number },
  detailedLayersAvailable: boolean
): JepWeatherBlocker {
  const entries = (Object.entries(penalties) as Array<[JepWeatherBlocker, number]>).filter(
    ([key, value]) => value > 0.02 && (!detailedLayersAvailable || key !== 'total')
  );
  if (!entries.length) {
    return penalties.total > 0.02 ? 'total' : 'unknown';
  }

  entries.sort((a, b) => b[1] - a[1]);
  const [topKey, topValue] = entries[0];
  const secondKey = entries[1]?.[0] ?? 'unknown';
  const secondValue = entries[1]?.[1] ?? 0;
  if (topKey === 'total' && secondKey !== 'unknown' && secondKey !== 'total' && topValue - secondValue <= 0.12) {
    return secondKey;
  }
  if (topKey !== 'total' && secondKey === 'total' && topValue - secondValue <= 0.12) {
    return topKey;
  }
  if (secondValue > 0 && topValue - secondValue <= 0.04) return 'mixed';
  return topKey;
}

function blockerStrength(combinedPenalty: number): JepWeatherImpact['blockerStrength'] {
  if (combinedPenalty >= 0.8) return 'severe';
  if (combinedPenalty >= 0.55) return 'strong';
  if (combinedPenalty >= 0.25) return 'moderate';
  return 'light';
}

function formatChangeRankLabel(index: number, priority: number) {
  if (priority <= 0.03) return 'Already helping';
  if (index === 0) return 'First change';
  if (index === 1) return 'Next lever';
  if (index === 2) return 'Then';
  return 'Also matters';
}

function clampProbability(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function formatFactor(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatProbability(value: number | null) {
  const bounded = clampProbability(value);
  if (bounded == null) return '-';
  return `${Math.round(bounded * 100)}%`;
}

function formatPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function toPctNumber(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatKm(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(Math.round(value * 10) / 10).toFixed(1)} km`;
}

function formatSolarAngle(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  if (rounded < 0.05) return '0.0° on the horizon';
  return value >= 0 ? `${rounded.toFixed(1)}° below the horizon` : `${rounded.toFixed(1)}° above the horizon`;
}

function formatSolarWindowRange(range: LaunchJepScoreV1['solarWindowRange']) {
  if (!range) return '-';
  if (range.windowStartDeg != null && range.windowEndDeg != null) {
    return `${formatSolarAngle(range.windowStartDeg)} to ${formatSolarAngle(range.windowEndDeg)}`;
  }
  if (range.netDeg != null) return formatSolarAngle(range.netDeg);
  if (range.minDeg != null && range.maxDeg != null) {
    return `${formatSolarAngle(range.minDeg)} to ${formatSolarAngle(range.maxDeg)}`;
  }
  return '-';
}

function formatTwilightSweetSpot() {
  return `${JEP_TWILIGHT_SWEET_SPOT_MIN_DEG}° to ${JEP_TWILIGHT_SWEET_SPOT_MAX_DEG}° below the horizon`;
}

function normalizePct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return clamp(value, 0, 100);
}

function scaledPenalty(value: number | null, start: number, end: number, weight: number) {
  if (value == null) return 0;
  if (end <= start) return value > start ? weight : 0;
  if (value <= start) return 0;
  if (value >= end) return weight;
  return ((value - start) / (end - start)) * weight;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
