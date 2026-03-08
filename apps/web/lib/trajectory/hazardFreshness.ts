export type HazardScanState = {
  scannedAtMs: number | null;
  matchedAtMs: number | null;
  latestScanMatched: boolean | null;
};

export function emptyHazardScanState(): HazardScanState {
  return {
    scannedAtMs: null,
    matchedAtMs: null,
    latestScanMatched: null
  };
}

export function mergeHazardScanState(
  current: HazardScanState,
  {
    signalAtMs,
    matched
  }: {
    signalAtMs: number;
    matched: boolean;
  }
): HazardScanState {
  if (!Number.isFinite(signalAtMs)) return current;

  const next: HazardScanState = {
    scannedAtMs: current.scannedAtMs,
    matchedAtMs: current.matchedAtMs,
    latestScanMatched: current.latestScanMatched
  };

  if (next.scannedAtMs == null || signalAtMs > next.scannedAtMs) {
    next.scannedAtMs = signalAtMs;
    next.latestScanMatched = matched;
  }

  if (matched) {
    next.matchedAtMs =
      typeof next.matchedAtMs === 'number' && Number.isFinite(next.matchedAtMs)
        ? Math.max(next.matchedAtMs, signalAtMs)
        : signalAtMs;
  }

  return next;
}

export function shouldSuppressHazardConstraintFromScanState({
  fetchedAtMs,
  sourceState
}: {
  fetchedAtMs: number | null;
  sourceState: HazardScanState | null;
}) {
  if (fetchedAtMs == null || !Number.isFinite(fetchedAtMs) || !sourceState) return false;
  if (sourceState.scannedAtMs == null || !Number.isFinite(sourceState.scannedAtMs) || sourceState.scannedAtMs <= fetchedAtMs) {
    return false;
  }
  return sourceState.latestScanMatched === false;
}
