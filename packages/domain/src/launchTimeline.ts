import {
  formatTrajectoryMilestoneOffsetLabel,
  resolveTrajectoryMilestones,
  type LaunchExternalContentLike,
  type Ll2TimelineEventLike,
  type TrajectoryMilestoneDraft,
  type TrajectoryMilestoneSourceType
} from './trajectory/milestones';

export type MissionTimelinePhase = 'prelaunch' | 'postlaunch' | 'timeline' | null | undefined;
export type ResolvedMissionTimelineItem = {
  id: string;
  label: string;
  time: string | null;
  description: string | null;
  kind: string | null;
  phase: Exclude<MissionTimelinePhase, undefined>;
  sourceTitle: string | null;
  sourceType: TrajectoryMilestoneSourceType;
  offsetSeconds: number | null;
};

type MissionTimelineExternalContentLike = LaunchExternalContentLike & {
  title?: string | null;
};

const MISSION_TIMELINE_MERGE_WINDOW_SEC = 10;
const MISSION_TIMELINE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'the',
  'to',
  'with'
]);
const MISSION_TIMELINE_TOKEN_ALIASES: Record<string, string> = {
  confirmed: 'confirm',
  confirms: 'confirm',
  confirming: 'confirm',
  deployment: 'deploy',
  deployments: 'deploy',
  ignition: 'ignite',
  ignitions: 'ignite',
  jettison: 'separation',
  jettisons: 'separation',
  loaded: 'load',
  loading: 'load',
  propellant: 'prop',
  propellants: 'prop',
  sep: 'separation',
  separates: 'separation',
  separated: 'separation',
  separation: 'separation',
  startup: 'start',
  startups: 'start',
  verifies: 'verify',
  verified: 'verify',
  verifying: 'verify'
};

export function buildLaunchMissionTimeline({
  ll2Timeline,
  providerExternalContent,
  includeFamilyTemplate = false
}: {
  ll2Timeline?: unknown[] | null;
  providerExternalContent?: MissionTimelineExternalContentLike[] | null;
  includeFamilyTemplate?: boolean;
}): ResolvedMissionTimelineItem[] {
  const sourceTitleByRef = buildMissionTimelineSourceTitleMap(providerExternalContent || []);
  const resolvedMilestones = resolveTrajectoryMilestones({
    ll2Timeline: normalizeLaunchTimelineEvents(ll2Timeline),
    providerExternalContent: providerExternalContent || [],
    includeFamilyTemplate
  });
  const dedupedMilestones = dedupeEquivalentMissionTimelineMilestones(resolvedMilestones);

  return dedupedMilestones.map((milestone, index) => ({
    id: `${milestone.key}:${milestone.tPlusSec ?? milestone.timeText ?? index}`,
    label: milestone.label,
    time: formatTrajectoryMilestoneOffsetLabel(milestone.tPlusSec, milestone.timeText) ?? milestone.timeText ?? null,
    description: milestone.description ?? null,
    kind: null,
    phase: mapTrajectoryPhaseToMissionTimelinePhase(milestone),
    sourceTitle: selectMissionTimelineSourceTitle(sourceTitleByRef, milestone.sourceRefIds),
    sourceType: milestone.sourceType,
    offsetSeconds: resolveMissionTimelineOccurrenceSec(milestone)
  }));
}

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

function normalizeLaunchTimelineEvents(events?: unknown[] | null): Ll2TimelineEventLike[] {
  if (!Array.isArray(events)) return [];
  return events
    .map((event) => normalizeLaunchTimelineEvent(event))
    .filter((event): event is Ll2TimelineEventLike => event != null);
}

function normalizeLaunchTimelineEvent(event: unknown): Ll2TimelineEventLike | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const entry = event as Record<string, unknown>;
  const typeValue = entry.type;
  const typeRecord =
    typeValue && typeof typeValue === 'object'
      ? (typeValue as Record<string, unknown>)
      : typeof typeValue === 'string'
        ? ({ name: typeValue } as Record<string, unknown>)
        : null;

  return {
    relative_time: typeof entry.relative_time === 'string' ? entry.relative_time : null,
    name: typeof entry.name === 'string' ? entry.name : null,
    type: typeRecord
      ? {
          id: typeof typeRecord.id === 'number' ? typeRecord.id : null,
          abbrev: typeof typeRecord.abbrev === 'string' ? typeRecord.abbrev : null,
          description: typeof typeRecord.description === 'string' ? typeRecord.description : null,
          name: typeof typeRecord.name === 'string' ? typeRecord.name : null
        }
      : null
  };
}

function dedupeEquivalentMissionTimelineMilestones(milestones: TrajectoryMilestoneDraft[]) {
  const merged: TrajectoryMilestoneDraft[] = [];

  for (const milestone of milestones) {
    const existingIndex = merged.findIndex((candidate) => areEquivalentMissionTimelineMilestones(candidate, milestone));
    if (existingIndex === -1) {
      merged.push({ ...milestone, sourceRefIds: [...milestone.sourceRefIds] });
      continue;
    }

    merged[existingIndex] = mergeMissionTimelineMilestones(merged[existingIndex], milestone);
  }

  return merged;
}

function areEquivalentMissionTimelineMilestones(left: TrajectoryMilestoneDraft, right: TrajectoryMilestoneDraft) {
  const leftOccurrenceSec = resolveMissionTimelineOccurrenceSec(left);
  const rightOccurrenceSec = resolveMissionTimelineOccurrenceSec(right);
  if (leftOccurrenceSec != null && rightOccurrenceSec != null) {
    if (Math.abs(leftOccurrenceSec - rightOccurrenceSec) > MISSION_TIMELINE_MERGE_WINDOW_SEC) {
      return false;
    }
  } else {
    const leftTime = normalizeMissionTimelineText(left.timeText);
    const rightTime = normalizeMissionTimelineText(right.timeText);
    if (!leftTime || !rightTime || leftTime !== rightTime) {
      return false;
    }
  }

  if (left.key === right.key) {
    return true;
  }

  const leftComparable = normalizeMissionTimelineComparableText(left.label);
  const rightComparable = normalizeMissionTimelineComparableText(right.label);
  if (
    leftComparable &&
    rightComparable &&
    Math.min(leftComparable.length, rightComparable.length) >= 12 &&
    (leftComparable.includes(rightComparable) || rightComparable.includes(leftComparable))
  ) {
    return true;
  }

  const leftTokens = tokenizeMissionTimelineLabel(left.label);
  const rightTokens = tokenizeMissionTimelineLabel(right.label);
  if (leftTokens.size < 2 || rightTokens.size < 2) {
    return false;
  }

  const sharedCount = countSharedMissionTimelineTokens(leftTokens, rightTokens);
  const minSize = Math.min(leftTokens.size, rightTokens.size);
  const maxSize = Math.max(leftTokens.size, rightTokens.size);

  if (sharedCount === minSize && minSize >= 2) {
    return true;
  }

  return sharedCount >= 3 && sharedCount / maxSize >= 0.75;
}

function mergeMissionTimelineMilestones(left: TrajectoryMilestoneDraft, right: TrajectoryMilestoneDraft): TrajectoryMilestoneDraft {
  const winner = compareMissionTimelineMilestonePreference(left, right) >= 0 ? left : right;
  const loser = winner === left ? right : left;

  return {
    ...winner,
    description: winner.description ?? loser.description ?? null,
    tPlusSec: winner.tPlusSec ?? loser.tPlusSec,
    timeText: winner.timeText ?? loser.timeText ?? null,
    sourceRefIds: uniqueMissionTimelineSourceRefs([...winner.sourceRefIds, ...loser.sourceRefIds])
  };
}

function compareMissionTimelineMilestonePreference(left: TrajectoryMilestoneDraft, right: TrajectoryMilestoneDraft) {
  const leftSourcePriority = missionTimelineSourcePriority(left.sourceType);
  const rightSourcePriority = missionTimelineSourcePriority(right.sourceType);
  if (leftSourcePriority !== rightSourcePriority) {
    return leftSourcePriority - rightSourcePriority;
  }

  const leftDescription = Number(Boolean(normalizeMissionTimelineText(left.description)));
  const rightDescription = Number(Boolean(normalizeMissionTimelineText(right.description)));
  if (leftDescription !== rightDescription) {
    return leftDescription - rightDescription;
  }

  const leftTokenCount = tokenizeMissionTimelineLabel(left.label).size;
  const rightTokenCount = tokenizeMissionTimelineLabel(right.label).size;
  if (leftTokenCount !== rightTokenCount) {
    return leftTokenCount - rightTokenCount;
  }

  return left.label.length - right.label.length;
}

function missionTimelineSourcePriority(sourceType: TrajectoryMilestoneSourceType) {
  switch (sourceType) {
    case 'provider_timeline':
      return 3;
    case 'll2_timeline':
      return 2;
    default:
      return 1;
  }
}

function mapTrajectoryPhaseToMissionTimelinePhase(milestone: TrajectoryMilestoneDraft): Exclude<MissionTimelinePhase, undefined> {
  if (milestone.phase === 'prelaunch') {
    return 'prelaunch';
  }

  if (typeof milestone.tPlusSec === 'number' && Number.isFinite(milestone.tPlusSec) && milestone.tPlusSec < 0) {
    return 'prelaunch';
  }

  return 'timeline';
}

function resolveMissionTimelineOccurrenceSec(milestone: TrajectoryMilestoneDraft) {
  if (typeof milestone.tPlusSec === 'number' && Number.isFinite(milestone.tPlusSec)) {
    return Math.round(milestone.tPlusSec);
  }

  const normalizedTime = normalizeMissionTimelineText(milestone.timeText);
  if (!normalizedTime) {
    return null;
  }

  return parseMissionTimelineOffsetSeconds(normalizedTime, mapTrajectoryPhaseToMissionTimelinePhase(milestone));
}

function tokenizeMissionTimelineLabel(value: string) {
  const tokens = new Set<string>();
  const normalized = normalizeMissionTimelineText(value).toLowerCase();
  if (!normalized) {
    return tokens;
  }

  for (const rawToken of normalized.replace(/[^a-z0-9]+/g, ' ').split(/\s+/)) {
    const canonicalToken = canonicalizeMissionTimelineToken(rawToken);
    if (!canonicalToken || MISSION_TIMELINE_STOP_WORDS.has(canonicalToken) || canonicalToken.length < 2) {
      continue;
    }
    tokens.add(canonicalToken);
  }

  return tokens;
}

function normalizeMissionTimelineComparableText(value: string) {
  return [...tokenizeMissionTimelineLabel(value)].join(' ');
}

function canonicalizeMissionTimelineToken(token: string) {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const aliased = MISSION_TIMELINE_TOKEN_ALIASES[normalized] ?? normalized;
  if (aliased.endsWith('ies') && aliased.length > 4) {
    return `${aliased.slice(0, -3)}y`;
  }
  if (aliased.endsWith('ing') && aliased.length > 5) {
    return aliased.slice(0, -3);
  }
  if (aliased.endsWith('ed') && aliased.length > 4) {
    return aliased.slice(0, -2);
  }
  if (aliased.endsWith('s') && aliased.length > 4) {
    return aliased.slice(0, -1);
  }
  return aliased;
}

function countSharedMissionTimelineTokens(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

function buildMissionTimelineSourceTitleMap(items: MissionTimelineExternalContentLike[]) {
  const titles = new Map<string, string>();

  for (const item of items) {
    const title = normalizeMissionTimelineText(item.title);
    if (!title) continue;
    titles.set(buildMissionTimelineSourceRefId(item), title);
  }

  return titles;
}

function selectMissionTimelineSourceTitle(sourceTitleByRef: Map<string, string>, sourceRefIds: string[]) {
  for (const sourceRefId of sourceRefIds) {
    const title = sourceTitleByRef.get(sourceRefId);
    if (title) {
      return title;
    }
  }
  return null;
}

function buildMissionTimelineSourceRefId(item: MissionTimelineExternalContentLike) {
  const sourceValue = slugifyMissionTimelineValue(normalizeMissionTimelineText(item.source) || 'external');
  const contentTypeValue = slugifyMissionTimelineValue(normalizeMissionTimelineText(item.contentType) || 'content');
  const sourceIdValue = slugifyMissionTimelineValue(normalizeMissionTimelineText(item.sourceId) || 'resource');
  return `external:${sourceValue}:${contentTypeValue}:${sourceIdValue}`;
}

function slugifyMissionTimelineValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'value';
}

function uniqueMissionTimelineSourceRefs(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim().length > 0))];
}

function normalizeMissionTimelineText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
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
