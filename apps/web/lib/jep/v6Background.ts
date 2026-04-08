export const JEP_V6_BACKGROUND_FEATURE_FAMILY = 'background_contrast';

export type JepV6AnthropogenicFactorResult = {
  factor: number | null;
  percentileRank: number | null;
};

export function computeJepV6AnthropogenicFactor({
  radiancePercentile
}: {
  radiancePercentile: number | null;
}): JepV6AnthropogenicFactorResult {
  if (!Number.isFinite(radiancePercentile)) {
    return { factor: null, percentileRank: null };
  }

  const percentileRank = clamp(Number(radiancePercentile), 0, 1);
  return {
    factor: clamp(1 - 0.6 * percentileRank, 0.4, 1),
    percentileRank
  };
}

export function computeJepV6BackgroundFactor({
  sMoon,
  sAnthro
}: {
  sMoon: number | null;
  sAnthro: number | null;
}) {
  if (!Number.isFinite(sMoon) || !Number.isFinite(sAnthro)) return null;
  return clamp((2 * Number(sMoon) + Number(sAnthro)) / 3, 0.15, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
