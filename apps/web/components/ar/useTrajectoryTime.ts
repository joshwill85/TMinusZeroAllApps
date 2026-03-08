import { useEffect, useMemo, useState } from 'react';

export type TrajectoryTimeMode = 'LIVE' | 'SCRUB';

export function formatTPlus(seconds: number) {
  return `T+${formatTimecode(seconds)}`;
}

export function formatTMinus(seconds: number) {
  return `T-${formatTimecode(seconds)}`;
}

function formatTimecode(rawSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(rawSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad2 = (value: number) => String(value).padStart(2, '0');
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export type TrajectoryTimeState = {
  mode: TrajectoryTimeMode;
  setMode: (mode: TrajectoryTimeMode) => void;
  tNowSec: number;
  tSelectedSec: number;
  setSelectedSec: (next: number) => void;
  isBeforeLiftoff: boolean;
  countdownSec: number | null;
};

export function useTrajectoryTime({
  netIso,
  durationSec
}: {
  netIso?: string | null;
  durationSec: number;
}): TrajectoryTimeState {
  const [mode, setMode] = useState<TrajectoryTimeMode>('LIVE');
  const [selectedSec, setSelectedSecState] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const liftoffAtMs = useMemo(() => {
    if (!netIso) return null;
    const parsed = Date.parse(netIso);
    return Number.isFinite(parsed) ? parsed : null;
  }, [netIso]);

  const isBeforeLiftoff = liftoffAtMs != null ? nowMs < liftoffAtMs : false;
  const countdownSec = liftoffAtMs != null && nowMs < liftoffAtMs ? Math.ceil((liftoffAtMs - nowMs) / 1000) : null;

  const tNowSec = useMemo(() => {
    if (liftoffAtMs == null) return 0;
    const raw = (nowMs - liftoffAtMs) / 1000;
    return clamp(raw, 0, Math.max(0, durationSec));
  }, [durationSec, liftoffAtMs, nowMs]);

  const setSelectedSec = (next: number) => {
    setSelectedSecState(clamp(next, 0, Math.max(0, durationSec)));
  };

  useEffect(() => {
    if (mode !== 'LIVE') return;
    setSelectedSecState(tNowSec);
  }, [mode, tNowSec]);

  const tSelectedSec = mode === 'LIVE' ? tNowSec : clamp(selectedSec, 0, Math.max(0, durationSec));

  return {
    mode,
    setMode,
    tNowSec,
    tSelectedSec,
    setSelectedSec,
    isBeforeLiftoff,
    countdownSec
  };
}

