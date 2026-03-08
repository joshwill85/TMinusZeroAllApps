type GuidanceCategory = 'blocking' | 'lock_state' | 'corrective' | 'aligned' | 'unknown';

type DeriveBottomGuidanceOptions = {
  headingHint?: string | null;
  pitchHint?: string | null;
  rollHint?: string | null;
  reducedEffects?: boolean;
};

type BottomGuidanceView = {
  primaryGuidance: string;
  secondaryGuidance: string[];
};

const BLOCKING_HINTS = new Set([
  'enable motion',
  'waiting for gps',
  'heading unavailable',
  'hold steady for heading lock',
  'hold phone upright'
]);

const LOCK_STATE_HINTS = new Set(['locked on', 'tracking settling', 're-centering track', 'reacquiring']);
const ALIGNED_HINTS = new Set(['aligned', 'level', 'phone level']);

function normalizeGuidanceLabel(label: string | null | undefined) {
  return label?.trim() ?? '';
}

function classifyGuidanceLabel(label: string): GuidanceCategory {
  const normalized = label.toLowerCase();
  if (!normalized) return 'unknown';
  if (BLOCKING_HINTS.has(normalized)) return 'blocking';
  if (LOCK_STATE_HINTS.has(normalized)) return 'lock_state';
  if (ALIGNED_HINTS.has(normalized)) return 'aligned';
  if (
    normalized === 'turn left/right' ||
    normalized === 'tilt up/down' ||
    normalized === 'level phone' ||
    /^turn (left|right) \d+°$/.test(normalized) ||
    /^tilt (up|down|left|right) \d+°$/.test(normalized)
  ) {
    return 'corrective';
  }
  return 'unknown';
}

function dedupeGuidanceLabels(labels: string[]) {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const label of labels) {
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(label);
  }
  return deduped;
}

export function deriveArBottomGuidance({
  headingHint,
  pitchHint,
  rollHint,
  reducedEffects
}: DeriveBottomGuidanceOptions): BottomGuidanceView {
  const visibleLimit = reducedEffects ? 2 : 3;
  const rawLabels = dedupeGuidanceLabels(
    [headingHint, pitchHint, rollHint].map(normalizeGuidanceLabel).filter((label): label is string => label.length > 0)
  );

  const grouped = {
    blocking: rawLabels.filter((label) => classifyGuidanceLabel(label) === 'blocking'),
    lockState: rawLabels.filter((label) => classifyGuidanceLabel(label) === 'lock_state'),
    corrective: rawLabels.filter((label) => classifyGuidanceLabel(label) === 'corrective'),
    aligned: rawLabels.filter((label) => classifyGuidanceLabel(label) === 'aligned'),
    unknown: rawLabels.filter((label) => classifyGuidanceLabel(label) === 'unknown')
  };

  if (grouped.blocking.length > 0) {
    return {
      primaryGuidance: grouped.blocking[0],
      secondaryGuidance: grouped.blocking.slice(1, visibleLimit)
    };
  }

  if (grouped.lockState.length > 0) {
    return {
      primaryGuidance: grouped.lockState[0],
      secondaryGuidance: []
    };
  }

  if (grouped.corrective.length > 0) {
    return {
      primaryGuidance: grouped.corrective[0],
      secondaryGuidance: grouped.corrective.slice(1, visibleLimit)
    };
  }

  if (grouped.unknown.length > 0) {
    return {
      primaryGuidance: grouped.unknown[0],
      secondaryGuidance: grouped.unknown.slice(1, visibleLimit)
    };
  }

  if (grouped.aligned.length > 0) {
    return {
      primaryGuidance: 'On track',
      secondaryGuidance: []
    };
  }

  return {
    primaryGuidance: 'Scanning',
    secondaryGuidance: []
  };
}
