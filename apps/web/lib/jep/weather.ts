export type JepWeatherInputs = {
  cloudCoverTotal: number | null;
  cloudCoverLow: number | null;
  cloudCoverMid?: number | null;
  cloudCoverHigh?: number | null;
};

export type JepWeatherBlocker = 'low' | 'mid' | 'high' | 'total' | 'mixed' | 'unknown';
export type JepCloudObstructionLevel = 'clear' | 'partly_obstructed' | 'likely_blocked' | 'unknown';

export type JepWeatherImpact = {
  factor: number;
  detailedLayersAvailable: boolean;
  dominantBlocker: JepWeatherBlocker;
  blockerStrength: 'light' | 'moderate' | 'strong' | 'severe';
  penalties: {
    low: number;
    mid: number;
    high: number;
    total: number;
    combined: number;
  };
};

export type JepCloudObstructionInput = {
  skyCoverPct: number | null;
  ceilingFt?: number | null;
  elevationDeg?: number | null;
};

export type JepCloudObstructionImpact = {
  factor: number;
  level: JepCloudObstructionLevel;
  ceilingBand: 'very_low' | 'low' | 'mid' | 'high' | 'unknown';
  penalties: {
    sky: number;
    ceiling: number;
    combined: number;
  };
};

const LOW_WEIGHT = 0.85;
const MID_WEIGHT = 0.5;
const HIGH_WEIGHT = 0.25;
const TOTAL_WEIGHT_DETAILED = 0.2;
const TOTAL_WEIGHT_FALLBACK = 0.55;

const CONTRAST_LOW_WEIGHT = 0.18;
const CONTRAST_MID_WEIGHT = 0.34;
const CONTRAST_HIGH_WEIGHT = 0.28;
const CONTRAST_TOTAL_WEIGHT_DETAILED = 0.16;
const CONTRAST_TOTAL_WEIGHT_FALLBACK = 0.3;
const OBSTRUCTION_SKY_WEIGHT = 0.48;
const OBSTRUCTION_MIN_FACTOR = 0.08;

export function computeJepWeatherFactor(input: JepWeatherInputs) {
  return deriveJepWeatherImpact(input).factor;
}

export function computeJepWeatherContrastFactor(input: JepWeatherInputs) {
  return deriveJepWeatherContrastImpact(input).factor;
}

export function deriveJepWeatherContrastImpact({
  cloudCoverTotal,
  cloudCoverLow,
  cloudCoverMid = null,
  cloudCoverHigh = null
}: JepWeatherInputs): JepWeatherImpact {
  const total = normalizePct(cloudCoverTotal);
  const low = normalizePct(cloudCoverLow);
  const mid = normalizePct(cloudCoverMid);
  const high = normalizePct(cloudCoverHigh);
  const detailedLayersAvailable = mid != null || high != null;

  const lowPenalty = scaledPenalty(low, 35, 100, CONTRAST_LOW_WEIGHT);
  const midPenalty = scaledPenalty(mid, 25, 100, CONTRAST_MID_WEIGHT);
  const highPenalty = scaledPenalty(high, 30, 100, CONTRAST_HIGH_WEIGHT);
  const totalPenalty = detailedLayersAvailable
    ? scaledPenalty(total, 65, 100, CONTRAST_TOTAL_WEIGHT_DETAILED)
    : scaledPenalty(total, 35, 100, CONTRAST_TOTAL_WEIGHT_FALLBACK);
  const combined = clamp(lowPenalty + midPenalty + highPenalty + totalPenalty, 0, 0.82);

  return {
    factor: round(clamp(1 - combined, 0.18, 1), 3),
    detailedLayersAvailable,
    dominantBlocker: dominantBlocker(
      {
        low: lowPenalty,
        mid: midPenalty,
        high: highPenalty,
        total: totalPenalty
      },
      detailedLayersAvailable
    ),
    blockerStrength: blockerStrength(combined),
    penalties: {
      low: round(lowPenalty, 3),
      mid: round(midPenalty, 3),
      high: round(highPenalty, 3),
      total: round(totalPenalty, 3),
      combined: round(combined, 3)
    }
  };
}

export function computeJepCloudObstructionFactor(input: JepCloudObstructionInput) {
  return deriveJepCloudObstructionImpact(input).factor;
}

export function deriveJepCloudObstructionImpact({
  skyCoverPct,
  ceilingFt = null,
  elevationDeg = null
}: JepCloudObstructionInput): JepCloudObstructionImpact {
  const skyCover = normalizePct(skyCoverPct);
  const ceiling = ceilingFt != null && Number.isFinite(ceilingFt) && ceilingFt > 0 ? ceilingFt : null;

  const skyPenalty = scaledPenalty(skyCover, 45, 100, OBSTRUCTION_SKY_WEIGHT);
  let ceilingPenalty = ceilingPenaltyForFeet(ceiling);

  if (ceilingPenalty > 0 && elevationDeg != null && Number.isFinite(elevationDeg)) {
    if (elevationDeg >= 50) {
      ceilingPenalty *= 0.82;
    } else if (elevationDeg >= 25) {
      ceilingPenalty *= 0.92;
    } else if (elevationDeg <= 10) {
      ceilingPenalty *= 1.08;
    }
  }

  const combined = clamp(skyPenalty + ceilingPenalty, 0, 1 - OBSTRUCTION_MIN_FACTOR);
  return {
    factor: round(clamp(1 - combined, OBSTRUCTION_MIN_FACTOR, 1), 3),
    level: obstructionLevel(combined, skyCover, ceiling),
    ceilingBand: ceilingBand(ceiling),
    penalties: {
      sky: round(skyPenalty, 3),
      ceiling: round(ceilingPenalty, 3),
      combined: round(combined, 3)
    }
  };
}

export function combineJepWeatherFactors({
  obstructionFactor,
  contrastFactor,
  minFactor = OBSTRUCTION_MIN_FACTOR
}: {
  obstructionFactor: number | null;
  contrastFactor: number | null;
  minFactor?: number;
}) {
  const obstruction = obstructionFactor != null && Number.isFinite(obstructionFactor) ? clamp(obstructionFactor, minFactor, 1) : null;
  const contrast = contrastFactor != null && Number.isFinite(contrastFactor) ? clamp(contrastFactor, minFactor, 1) : null;
  if (obstruction == null && contrast == null) return 1;
  if (obstruction == null) return contrast!;
  if (contrast == null) return obstruction;
  return round(clamp(obstruction * contrast, minFactor, 1), 3);
}

export function deriveJepWeatherImpact({
  cloudCoverTotal,
  cloudCoverLow,
  cloudCoverMid = null,
  cloudCoverHigh = null
}: JepWeatherInputs): JepWeatherImpact {
  const total = normalizePct(cloudCoverTotal);
  const low = normalizePct(cloudCoverLow);
  const mid = normalizePct(cloudCoverMid);
  const high = normalizePct(cloudCoverHigh);
  const detailedLayersAvailable = mid != null || high != null;

  const lowPenalty = scaledPenalty(low, 10, 90, LOW_WEIGHT);
  const midPenalty = scaledPenalty(mid, 20, 95, MID_WEIGHT);
  const highPenalty = scaledPenalty(high, 30, 100, HIGH_WEIGHT);
  const totalPenalty = detailedLayersAvailable
    ? scaledPenalty(total, 60, 100, TOTAL_WEIGHT_DETAILED)
    : scaledPenalty(total, 25, 95, TOTAL_WEIGHT_FALLBACK);
  const combined = clamp(lowPenalty + midPenalty + highPenalty + totalPenalty, 0, 1);

  return {
    factor: round(clamp(1 - combined, 0, 1), 3),
    detailedLayersAvailable,
    dominantBlocker: dominantBlocker(
      {
        low: lowPenalty,
        mid: midPenalty,
        high: highPenalty,
        total: totalPenalty
      },
      detailedLayersAvailable
    ),
    blockerStrength: blockerStrength(combined),
    penalties: {
      low: round(lowPenalty, 3),
      mid: round(midPenalty, 3),
      high: round(highPenalty, 3),
      total: round(totalPenalty, 3),
      combined: round(combined, 3)
    }
  };
}

function dominantBlocker(penalties: Omit<JepWeatherImpact['penalties'], 'combined'>, detailedLayersAvailable: boolean): JepWeatherBlocker {
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

function obstructionLevel(combinedPenalty: number, skyCover: number | null, ceiling: number | null): JepCloudObstructionLevel {
  if (skyCover == null && ceiling == null) return 'unknown';
  if (combinedPenalty >= 0.68) return 'likely_blocked';
  if (combinedPenalty >= 0.32) return 'partly_obstructed';
  return 'clear';
}

function ceilingBand(value: number | null): JepCloudObstructionImpact['ceilingBand'] {
  if (value == null) return 'unknown';
  if (value <= 1500) return 'very_low';
  if (value <= 4000) return 'low';
  if (value <= 8000) return 'mid';
  return 'high';
}

function ceilingPenaltyForFeet(value: number | null) {
  if (value == null) return 0;
  if (value <= 1500) return 0.44;
  if (value <= 4000) return interpolateDescending(value, 1500, 4000, 0.44, 0.25);
  if (value <= 8000) return interpolateDescending(value, 4000, 8000, 0.25, 0.08);
  if (value <= 12000) return interpolateDescending(value, 8000, 12000, 0.08, 0.02);
  return 0;
}

function interpolateDescending(value: number, start: number, end: number, atStart: number, atEnd: number) {
  if (value <= start) return atStart;
  if (value >= end) return atEnd;
  const t = (value - start) / (end - start);
  return atStart + (atEnd - atStart) * t;
}

function scaledPenalty(value: number | null, start: number, end: number, weight: number) {
  if (value == null) return 0;
  if (end <= start) return value > start ? weight : 0;
  if (value <= start) return 0;
  if (value >= end) return weight;
  return ((value - start) / (end - start)) * weight;
}

function normalizePct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return null;
  return clamp(value, 0, 100);
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
