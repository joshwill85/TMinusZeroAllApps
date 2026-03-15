export type JepForecastPhase = 'week_ahead' | 'day_ahead' | 'same_day' | 'near_launch' | 'post_launch';
export type JepForecastConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type JepWeatherSourceKey = 'nbm_ndfd' | 'hrrr' | 'goes_nowcast' | 'open_meteo_fallback';

export type JepForecastHorizon = {
  hoursToNet: number;
  phase: JepForecastPhase;
  confidence: JepForecastConfidence;
  label: string;
  note: string;
  sourcePlan: JepWeatherSourceKey[];
};

export function deriveJepForecastHorizon({
  launchNetIso,
  isUsLaunch,
  nowMs = Date.now()
}: {
  launchNetIso: string | null;
  isUsLaunch: boolean;
  nowMs?: number;
}): JepForecastHorizon {
  const netMs = launchNetIso ? Date.parse(launchNetIso) : Number.NaN;
  const hoursToNet = Number.isFinite(netMs) ? (netMs - nowMs) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(hoursToNet)) {
    return {
      hoursToNet,
      phase: 'week_ahead',
      confidence: 'LOW',
      label: 'Planning forecast',
      note: 'Launch time is uncertain, so weather planning should stay broad until the schedule firms up.',
      sourcePlan: isUsLaunch ? ['nbm_ndfd', 'open_meteo_fallback'] : ['open_meteo_fallback']
    };
  }

  if (hoursToNet <= 0) {
    return {
      hoursToNet,
      phase: 'post_launch',
      confidence: 'HIGH',
      label: 'Launch window closed',
      note: 'Forecast planning is no longer relevant because the primary launch window has passed.',
      sourcePlan: isUsLaunch ? ['goes_nowcast', 'hrrr', 'nbm_ndfd'] : ['open_meteo_fallback']
    };
  }

  if (hoursToNet <= 6) {
    return {
      hoursToNet,
      phase: 'near_launch',
      confidence: isUsLaunch ? 'HIGH' : 'MEDIUM',
      label: 'Near-launch forecast',
      note: 'Use the highest-resolution short-range forecast available and nowcast data where supported.',
      sourcePlan: isUsLaunch ? ['goes_nowcast', 'hrrr', 'nbm_ndfd', 'open_meteo_fallback'] : ['open_meteo_fallback']
    };
  }

  if (hoursToNet <= 24) {
    return {
      hoursToNet,
      phase: 'same_day',
      confidence: isUsLaunch ? 'HIGH' : 'MEDIUM',
      label: 'Same-day forecast',
      note: 'Strong enough for wake-up decisions, but still subject to meaningful cloud shifts before launch.',
      sourcePlan: isUsLaunch ? ['hrrr', 'nbm_ndfd', 'open_meteo_fallback'] : ['open_meteo_fallback']
    };
  }

  if (hoursToNet <= 72) {
    return {
      hoursToNet,
      phase: 'day_ahead',
      confidence: 'MEDIUM',
      label: 'Day-ahead planning forecast',
      note: 'Useful for planning travel or early alarms, with moderate weather uncertainty still in play.',
      sourcePlan: isUsLaunch ? ['nbm_ndfd', 'hrrr', 'open_meteo_fallback'] : ['open_meteo_fallback']
    };
  }

  return {
    hoursToNet,
    phase: 'week_ahead',
    confidence: 'LOW',
    label: 'Week-ahead planning forecast',
    note: 'Useful for early planning, but cloud obstruction should be treated as directional guidance rather than a precise launch-hour promise.',
    sourcePlan: isUsLaunch ? ['nbm_ndfd', 'open_meteo_fallback'] : ['open_meteo_fallback']
  };
}
