import { formatTrajectoryMilestoneOffsetLabel } from './trajectory/milestones';

export type MissionTimelinePhase = 'prelaunch' | 'postlaunch' | 'timeline' | null | undefined;

export function formatMissionTimelineTimeLabel(time?: string | null, phase?: MissionTimelinePhase) {
  const normalizedTime = typeof time === 'string' ? time.trim() : '';
  if (!normalizedTime) {
    return null;
  }

  const signedOffsetSeconds = parseMissionTimelineOffsetSeconds(normalizedTime, phase);
  if (signedOffsetSeconds != null) {
    return formatTrajectoryMilestoneOffsetLabel(signedOffsetSeconds) ?? normalizedTime;
  }

  return normalizedTime;
}

function parseMissionTimelineOffsetSeconds(value: string, phase?: MissionTimelinePhase): number | null {
  const explicit = parseExplicitMissionClock(value);
  if (explicit != null) {
    return explicit;
  }

  const isoDurationMs = parseIsoDurationToMs(value);
  if (isoDurationMs != null) {
    const offsetSeconds = Math.round(isoDurationMs / 1000);
    return applyTimelinePhase(offsetSeconds, phase);
  }

  const unsignedClockSeconds = parseUnsignedMissionClock(value);
  if (unsignedClockSeconds != null) {
    return applyTimelinePhase(unsignedClockSeconds, phase);
  }

  return null;
}

function applyTimelinePhase(offsetSeconds: number, phase?: MissionTimelinePhase) {
  if (phase === 'prelaunch') {
    return -Math.abs(offsetSeconds);
  }
  if (phase === 'postlaunch') {
    return Math.abs(offsetSeconds);
  }
  return null;
}

function parseExplicitMissionClock(value: string) {
  const match = value.match(/^T?\s*([+-])\s*(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/i);
  if (!match) {
    return null;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const first = Number(match[2]);
  const second = Number(match[3]);
  const third = match[4] != null ? Number(match[4]) : 0;
  if (![first, second, third].every(Number.isFinite)) {
    return null;
  }

  const totalSeconds = match[4] != null ? first * 3600 + second * 60 + third : first * 60 + second;
  return sign * totalSeconds;
}

function parseUnsignedMissionClock(value: string) {
  const match = value.match(/^(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] != null ? Number(match[3]) : 0;
  if (![first, second, third].every(Number.isFinite)) {
    return null;
  }

  return match[3] != null ? first * 3600 + second * 60 + third : first * 60 + second;
}

function parseIsoDurationToMs(value?: string | null) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) {
    return null;
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) {
    return null;
  }

  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}
