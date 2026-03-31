export type TrajectoryMilestoneTrackKind = 'core_up' | 'upper_stage_up' | 'booster_down';
export type TrajectoryMilestoneConfidence = 'low' | 'med' | 'high';
export type TrajectoryMilestonePhase =
  | 'prelaunch'
  | 'core_ascent'
  | 'upper_stage'
  | 'booster_return'
  | 'landing'
  | 'unknown';
export type TrajectoryMilestoneSourceType = 'provider_timeline' | 'll2_timeline' | 'family_template';
export type TrajectoryMilestoneProjectionReason =
  | 'phase_not_projectable'
  | 'missing_track'
  | 'outside_track_horizon'
  | 'unresolved_time';

export type Ll2TimelineEventLike = {
  relative_time?: string | null;
  name?: string | null;
  type?: {
    id?: number | null;
    abbrev?: string | null;
    description?: string | null;
    name?: string | null;
  } | null;
};

export type ProviderTimelineEventLike = {
  id?: string | null;
  label?: string | null;
  time?: string | null;
  description?: string | null;
  kind?: string | null;
  phase?: string | null;
};

export type LaunchExternalContentLike = {
  source?: string | null;
  sourceId?: string | null;
  contentType?: string | null;
  fetchedAt?: string | null;
  confidence?: number | null;
  timelineEvents?: ProviderTimelineEventLike[] | null;
};

export type LaunchExternalResourceRowLike = {
  source?: string | null;
  content_type?: string | null;
  source_id?: string | null;
  confidence?: number | null;
  fetched_at?: string | null;
  data?: unknown;
};

export type TrajectoryMilestoneDraft = {
  key: string;
  label: string;
  description?: string | null;
  tPlusSec: number | null;
  timeText?: string | null;
  phase: TrajectoryMilestonePhase;
  trackKind?: TrajectoryMilestoneTrackKind;
  sourceType: TrajectoryMilestoneSourceType;
  sourceRefIds: string[];
  confidence?: TrajectoryMilestoneConfidence;
  estimated: boolean;
  projectable: boolean;
  projectionReason?: TrajectoryMilestoneProjectionReason;
};

export type TrajectoryCompatibilityEvent = {
  key: string;
  tPlusSec: number;
  label: string;
  confidence?: TrajectoryMilestoneConfidence;
};

export type TrajectoryMilestoneTrackWindow = {
  trackKind: TrajectoryMilestoneTrackKind;
  minTPlusSec: number;
  maxTPlusSec: number;
};

export type TrajectoryMilestoneSummary = {
  total: number;
  fromTimeline: number;
  fromFallback: number;
  confidenceCounts: Record<TrajectoryMilestoneConfidence, number>;
  sourceCounts: Record<TrajectoryMilestoneSourceType, number>;
  phaseCounts: Record<TrajectoryMilestonePhase, number>;
  projectableCount: number;
  nonProjectableCount: number;
  outsideHorizonCount: number;
  missingTrackCount: number;
  unresolvedTimeCount: number;
  estimatedCount: number;
  trackCounts: Record<TrajectoryMilestoneTrackKind, number>;
};

type ProviderEntry = {
  label: string;
  timeText?: string | null;
  description?: string | null;
  kind?: string | null;
  phaseHint?: 'prelaunch' | 'postlaunch' | 'timeline' | null;
  sourceRefId: string;
  fetchedAt?: string | null;
  confidence?: number | null;
};

type CandidateMilestone = TrajectoryMilestoneDraft & {
  identityKey: string;
  fetchedAtMs: number | null;
  authorityScore: number;
};

const PROVIDER_ENTRY_SOURCE = 'provider_timeline' as const;
const LL2_ENTRY_SOURCE = 'll2_timeline' as const;
const FAMILY_TEMPLATE_SOURCE = 'family_template' as const;

const PHASE_TRACK_KIND: Partial<Record<TrajectoryMilestonePhase, TrajectoryMilestoneTrackKind>> = {
  core_ascent: 'core_up',
  upper_stage: 'upper_stage_up',
  booster_return: 'booster_down',
  landing: 'booster_down'
};

const SOURCE_PRIORITY: Record<TrajectoryMilestoneSourceType, number> = {
  provider_timeline: 3,
  ll2_timeline: 2,
  family_template: 1
};

const PHASES: TrajectoryMilestonePhase[] = ['prelaunch', 'core_ascent', 'upper_stage', 'booster_return', 'landing', 'unknown'];
const SOURCES: TrajectoryMilestoneSourceType[] = ['provider_timeline', 'll2_timeline', 'family_template'];
const TRACKS: TrajectoryMilestoneTrackKind[] = ['core_up', 'upper_stage_up', 'booster_down'];
const CONFIDENCE_LEVELS: TrajectoryMilestoneConfidence[] = ['low', 'med', 'high'];
const MILESTONE_OCCURRENCE_MERGE_WINDOW_SEC = 10;

type MilestoneDefinition = {
  key: string;
  defaultLabel: string;
  phase: TrajectoryMilestonePhase;
  matchers: RegExp[];
};

const MILESTONE_DEFINITIONS: MilestoneDefinition[] = [
  {
    key: 'LIFTOFF',
    defaultLabel: 'Liftoff',
    phase: 'core_ascent',
    matchers: [/\bliftoff\b/i, /^launch$/i]
  },
  {
    key: 'MAXQ',
    defaultLabel: 'Max-Q',
    phase: 'core_ascent',
    matchers: [/\bmax[\s-]?q\b/i, /\bmaximum dynamic pressure\b/i]
  },
  {
    key: 'MECO',
    defaultLabel: 'MECO',
    phase: 'core_ascent',
    matchers: [/\bmeco\b/i, /\bmain engine cutoff\b/i]
  },
  {
    key: 'STAGESEP',
    defaultLabel: 'Stage separation',
    phase: 'core_ascent',
    matchers: [/\bstage(?:\s*\d+)?[\s-]*(?:sep|separation)\b/i, /\bstaging\b/i]
  },
  {
    key: 'SECO',
    defaultLabel: 'SECO',
    phase: 'upper_stage',
    matchers: [/\bseco\b/i, /\bsecond engine cutoff\b/i]
  },
  {
    key: 'BOOSTBACK',
    defaultLabel: 'Boostback burn',
    phase: 'booster_return',
    matchers: [/\bboostback\b/i]
  },
  {
    key: 'ENTRY',
    defaultLabel: 'Entry burn',
    phase: 'booster_return',
    matchers: [/\bentry burn\b/i, /\bentry\b/i]
  },
  {
    key: 'LANDING_BURN',
    defaultLabel: 'Landing burn',
    phase: 'landing',
    matchers: [/\blanding burn\b/i]
  },
  {
    key: 'LANDING',
    defaultLabel: 'Landing',
    phase: 'landing',
    matchers: [/\blanding\b/i, /\btouchdown\b/i, /\blanded\b/i]
  }
];

const DEFAULT_TEMPLATE_MILESTONES: Array<{
  key: string;
  label: string;
  tPlusSec: number;
  phase: TrajectoryMilestonePhase;
}> = [
  { key: 'LIFTOFF', label: 'Liftoff', tPlusSec: 0, phase: 'core_ascent' },
  { key: 'MAXQ', label: 'Max-Q', tPlusSec: 70, phase: 'core_ascent' },
  { key: 'MECO', label: 'MECO', tPlusSec: 150, phase: 'core_ascent' }
];

const FALCON_TEMPLATE_MILESTONES: Array<{
  key: string;
  label: string;
  tPlusSec: number;
  phase: TrajectoryMilestonePhase;
}> = [
  ...DEFAULT_TEMPLATE_MILESTONES,
  { key: 'STAGESEP', label: 'Stage separation', tPlusSec: 155, phase: 'core_ascent' },
  { key: 'SECO', label: 'SECO', tPlusSec: 510, phase: 'upper_stage' }
];

export function resolveTrajectoryMilestones({
  ll2Timeline,
  providerExternalContent,
  providerResourceRows,
  rocketFamily,
  includeFamilyTemplate = true
}: {
  ll2Timeline?: Ll2TimelineEventLike[] | null;
  providerExternalContent?: LaunchExternalContentLike[] | null;
  providerResourceRows?: LaunchExternalResourceRowLike[] | null;
  rocketFamily?: string | null;
  includeFamilyTemplate?: boolean;
}): TrajectoryMilestoneDraft[] {
  const providerEntries = [
    ...extractProviderTimelineEntriesFromExternalContent(providerExternalContent || []),
    ...extractProviderTimelineEntriesFromResourceRows(providerResourceRows || [])
  ];
  const candidates: CandidateMilestone[] = [
    ...providerEntries.map((entry) => buildProviderCandidate(entry)),
    ...(Array.isArray(ll2Timeline) ? ll2Timeline.map((entry) => buildLl2Candidate(entry)) : []),
    ...(includeFamilyTemplate ? buildTemplateCandidates(rocketFamily) : [])
  ].filter((candidate): candidate is CandidateMilestone => candidate != null);

  const merged = new Map<string, CandidateMilestone[]>();
  for (const candidate of candidates) {
    const existingCandidates = merged.get(candidate.identityKey) || [];
    const existingIndex = findMilestoneOccurrenceIndex(existingCandidates, candidate);
    if (existingIndex === -1) {
      existingCandidates.push(candidate);
      merged.set(candidate.identityKey, existingCandidates);
      continue;
    }

    const existing = existingCandidates[existingIndex];
    const winner = compareMilestoneCandidates(candidate, existing) < 0 ? candidate : existing;
    const loser = winner === candidate ? existing : candidate;
    existingCandidates[existingIndex] = {
      ...winner,
      sourceRefIds: uniqueStrings([...winner.sourceRefIds, ...loser.sourceRefIds])
    };
    merged.set(candidate.identityKey, existingCandidates);
  }

  const mergedCandidates = [...merged.values()].flat();
  const canonicalKeysWithObservedSources = new Set(
    mergedCandidates
      .filter((candidate) => candidate.sourceType !== FAMILY_TEMPLATE_SOURCE)
      .map((candidate) => candidate.identityKey)
  );

  return mergedCandidates
    .filter(
      (candidate) =>
        candidate.sourceType !== FAMILY_TEMPLATE_SOURCE || !canonicalKeysWithObservedSources.has(candidate.identityKey)
    )
    .map(stripMilestoneIdentity)
    .sort(compareResolvedMilestones);
}

export function applyTrajectoryMilestoneProjection({
  milestones,
  trackWindows
}: {
  milestones: TrajectoryMilestoneDraft[];
  trackWindows: TrajectoryMilestoneTrackWindow[];
}): { milestones: TrajectoryMilestoneDraft[]; summary: TrajectoryMilestoneSummary } {
  const windows = new Map<TrajectoryMilestoneTrackKind, TrajectoryMilestoneTrackWindow>();
  for (const trackWindow of trackWindows) {
    windows.set(trackWindow.trackKind, trackWindow);
  }

  const projected = milestones.map((milestone) => {
    const next: TrajectoryMilestoneDraft = { ...milestone, sourceRefIds: [...milestone.sourceRefIds] };
    if (!next.projectable) return next;
    if (!next.trackKind) {
      next.projectable = false;
      next.projectionReason = next.projectionReason ?? 'phase_not_projectable';
      return next;
    }
    const trackWindow = windows.get(next.trackKind);
    if (!trackWindow) {
      next.projectable = false;
      next.projectionReason = 'missing_track';
      return next;
    }
    if (typeof next.tPlusSec !== 'number' || !Number.isFinite(next.tPlusSec)) {
      next.projectable = false;
      next.projectionReason = 'unresolved_time';
      return next;
    }
    if (next.tPlusSec < trackWindow.minTPlusSec || next.tPlusSec > trackWindow.maxTPlusSec) {
      next.projectable = false;
      next.projectionReason = 'outside_track_horizon';
      return next;
    }
    next.projectionReason = undefined;
    return next;
  });

  return {
    milestones: projected,
    summary: summarizeTrajectoryMilestones(projected)
  };
}

export function buildTrajectoryCompatibilityEvents(milestones: TrajectoryMilestoneDraft[]): TrajectoryCompatibilityEvent[] {
  const seen = new Set<string>();
  return milestones
    .filter(
      (milestone) =>
        milestone.projectable &&
        milestone.trackKind === 'core_up' &&
        typeof milestone.tPlusSec === 'number' &&
        Number.isFinite(milestone.tPlusSec) &&
        milestone.tPlusSec >= 0
    )
    .sort(compareResolvedMilestones)
    .filter((milestone) => {
      const key = `${milestone.key}:${milestone.tPlusSec}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((milestone) => ({
      key: milestone.key,
      tPlusSec: milestone.tPlusSec as number,
      label: milestone.label,
      confidence: milestone.confidence
    }));
}

export function summarizeTrajectoryMilestones(milestones: TrajectoryMilestoneDraft[]): TrajectoryMilestoneSummary {
  const confidenceCounts: Record<TrajectoryMilestoneConfidence, number> = { low: 0, med: 0, high: 0 };
  const sourceCounts: Record<TrajectoryMilestoneSourceType, number> = {
    provider_timeline: 0,
    ll2_timeline: 0,
    family_template: 0
  };
  const phaseCounts: Record<TrajectoryMilestonePhase, number> = {
    prelaunch: 0,
    core_ascent: 0,
    upper_stage: 0,
    booster_return: 0,
    landing: 0,
    unknown: 0
  };
  const trackCounts: Record<TrajectoryMilestoneTrackKind, number> = {
    core_up: 0,
    upper_stage_up: 0,
    booster_down: 0
  };

  let projectableCount = 0;
  let nonProjectableCount = 0;
  let outsideHorizonCount = 0;
  let missingTrackCount = 0;
  let unresolvedTimeCount = 0;
  let estimatedCount = 0;

  for (const milestone of milestones) {
    sourceCounts[milestone.sourceType] += 1;
    phaseCounts[milestone.phase] += 1;
    if (milestone.trackKind) trackCounts[milestone.trackKind] += 1;
    const confidence = milestone.confidence ?? 'low';
    confidenceCounts[confidence] += 1;
    if (milestone.estimated) estimatedCount += 1;
    if (milestone.projectable) {
      projectableCount += 1;
    } else {
      nonProjectableCount += 1;
      if (milestone.projectionReason === 'outside_track_horizon') outsideHorizonCount += 1;
      if (milestone.projectionReason === 'missing_track') missingTrackCount += 1;
      if (milestone.projectionReason === 'unresolved_time') unresolvedTimeCount += 1;
    }
  }

  return {
    total: milestones.length,
    fromTimeline: sourceCounts.provider_timeline + sourceCounts.ll2_timeline,
    fromFallback: sourceCounts.family_template,
    confidenceCounts,
    sourceCounts,
    phaseCounts,
    projectableCount,
    nonProjectableCount,
    outsideHorizonCount,
    missingTrackCount,
    unresolvedTimeCount,
    estimatedCount,
    trackCounts
  };
}

export function extractProviderTimelineEntriesFromExternalContent(
  items: LaunchExternalContentLike[]
): ProviderEntry[] {
  return items.flatMap((item) => {
    const events = Array.isArray(item.timelineEvents) ? item.timelineEvents : [];
    const sourceRefId = buildExternalSourceRefId({
      source: item.source,
      contentType: item.contentType,
      sourceId: item.sourceId
    });
    return events.flatMap((event, index) => {
      const label = normalizeText(event?.label);
      if (!label) return [];
      return [
        {
          label,
          timeText: normalizeText(event?.time) || null,
          description: normalizeText(event?.description) || null,
          kind: normalizeText(event?.kind) || null,
          phaseHint: normalizeProviderPhase(event?.phase),
          sourceRefId: sourceRefId || `external:content:${index}`,
          fetchedAt: normalizeText(item.fetchedAt) || null,
          confidence: toFiniteNumber(item.confidence)
        } satisfies ProviderEntry
      ];
    });
  });
}

export function extractProviderTimelineEntriesFromResourceRows(
  rows: LaunchExternalResourceRowLike[]
): ProviderEntry[] {
  const entries: ProviderEntry[] = [];

  for (const row of rows) {
    const data = asObject(row.data);
    if (!data) continue;
    const base = {
      sourceRefId: buildExternalSourceRefId({
        source: row.source,
        contentType: row.content_type,
        sourceId: row.source_id
      }),
      fetchedAt: normalizeText(row.fetched_at) || null,
      confidence: toFiniteNumber(row.confidence)
    };

    entries.push(
      ...normalizeProviderTimelineList(data.timelineEvents, 'timeline', base),
      ...normalizeProviderTimelineList(data.timeline, 'timeline', base),
      ...normalizeProviderTimelineList(data.preLaunchTimeline, 'prelaunch', base),
      ...normalizeProviderTimelineList(data.postLaunchTimeline, 'postlaunch', base)
    );

    const mission = asObject(data.mission);
    if (mission) {
      entries.push(
        ...normalizeProviderTimelineList(mission.preLaunchTimeline, 'prelaunch', base),
        ...normalizeProviderTimelineList(mission.postLaunchTimeline, 'postlaunch', base)
      );
    }
  }

  return dedupeProviderEntries(entries);
}

export function buildTrajectoryMilestoneTrackWindows(
  tracks: Array<{ trackKind?: string | null; samples?: Array<{ tPlusSec?: number | null }> | null }>
): TrajectoryMilestoneTrackWindow[] {
  const windows: TrajectoryMilestoneTrackWindow[] = [];
  for (const rawTrack of tracks) {
    const trackKind = normalizeTrackKind(rawTrack?.trackKind);
    const samples = Array.isArray(rawTrack?.samples) ? rawTrack.samples : [];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const sample of samples) {
      const tPlusSec = toFiniteNumber(sample?.tPlusSec);
      if (tPlusSec == null) continue;
      if (tPlusSec < min) min = tPlusSec;
      if (tPlusSec > max) max = tPlusSec;
    }
    if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) continue;
    windows.push({ trackKind, minTPlusSec: min, maxTPlusSec: max });
  }
  return windows.sort((left, right) => left.minTPlusSec - right.minTPlusSec);
}

export function formatTrajectoryMilestoneOffsetLabel(tPlusSec: number | null, timeText?: string | null): string | undefined {
  if (typeof tPlusSec === 'number' && Number.isFinite(tPlusSec)) {
    const sign = tPlusSec < 0 ? '-' : '+';
    const absSeconds = Math.abs(Math.round(tPlusSec));
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const seconds = absSeconds % 60;
    const clock =
      hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
    return `T${sign}${clock}`;
  }
  const fallback = normalizeText(timeText);
  return fallback || undefined;
}

function normalizeProviderTimelineList(
  value: unknown,
  phase: 'prelaunch' | 'postlaunch' | 'timeline',
  base: { sourceRefId: string; fetchedAt: string | null; confidence: number | null }
): ProviderEntry[] {
  if (!Array.isArray(value)) return [];

  const entries: ProviderEntry[] = [];
  for (const entry of value) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      const label = normalizeText(entry);
      if (!label) continue;
      entries.push({
        label,
        timeText: null,
        description: null,
        kind: null,
        phaseHint: phase,
        sourceRefId: base.sourceRefId,
        fetchedAt: base.fetchedAt,
        confidence: base.confidence
      });
      continue;
    }

    const object = asObject(entry);
    if (!object) continue;
    const label =
      normalizeText(object.label) ||
      normalizeText(object.title) ||
      normalizeText(object.name) ||
      normalizeText(object.event) ||
      normalizeText(object.relative_time) ||
      normalizeText(object.relativeTime);
    if (!label) continue;

    entries.push({
      label,
      timeText:
        normalizeText(object.time) ||
        normalizeText(object.relative_time) ||
        normalizeText(object.relativeTime) ||
        normalizeText(object.datetime) ||
        normalizeText(object.dateTime) ||
        normalizeText(object.date) ||
        null,
      description:
        normalizeText(object.description) ||
        normalizeText(object.text) ||
        normalizeText(object.subtitle) ||
        normalizeText(object.body) ||
        normalizeText(object.details) ||
        null,
      kind: normalizeText(object.kind) || normalizeText(object.type) || null,
      phaseHint: phase,
      sourceRefId: base.sourceRefId,
      fetchedAt: base.fetchedAt,
      confidence: base.confidence
    });
  }

  return entries;
}

function dedupeProviderEntries(entries: ProviderEntry[]) {
  const deduped = new Map<string, ProviderEntry>();
  for (const entry of entries) {
    const key = `${entry.phaseHint || 'timeline'}:${entry.label}:${entry.timeText || ''}`;
    const existing = deduped.get(key);
    if (!existing || compareProviderEntry(existing, entry) > 0) deduped.set(key, entry);
  }
  return [...deduped.values()];
}

function compareProviderEntry(left: ProviderEntry, right: ProviderEntry) {
  const leftFetched = parseIsoMs(left.fetchedAt);
  const rightFetched = parseIsoMs(right.fetchedAt);
  if (leftFetched !== rightFetched) return (rightFetched ?? -1) - (leftFetched ?? -1);
  const leftConfidence = toFiniteNumber(left.confidence) ?? -1;
  const rightConfidence = toFiniteNumber(right.confidence) ?? -1;
  return rightConfidence - leftConfidence;
}

function buildProviderCandidate(entry: ProviderEntry): CandidateMilestone | null {
  const parsedTime = parseMilestoneTime(entry.timeText, entry.phaseHint);
  const identity = canonicalizeMilestoneIdentity(entry.label, entry.kind);
  const phase = inferMilestonePhase({
    canonicalKey: identity.canonicalKey,
    phaseHint: entry.phaseHint,
    tPlusSec: parsedTime.tPlusSec,
    label: entry.label,
    kind: entry.kind
  });
  const trackKind = PHASE_TRACK_KIND[phase];
  const confidence = confidenceFromNumeric(entry.confidence, 'high', 'med');

  return {
    key: identity.outputKey,
    identityKey: identity.identityKey,
    label: entry.label || identity.defaultLabel,
    description: entry.description || null,
    tPlusSec: parsedTime.tPlusSec,
    timeText: parsedTime.timeText,
    phase,
    trackKind,
    sourceType: PROVIDER_ENTRY_SOURCE,
    sourceRefIds: [entry.sourceRefId],
    confidence,
    estimated: false,
    projectable: Boolean(trackKind) && parsedTime.tPlusSec != null,
    projectionReason: deriveBaseProjectionReason({ trackKind, tPlusSec: parsedTime.tPlusSec, phase }),
    fetchedAtMs: parseIsoMs(entry.fetchedAt),
    authorityScore: SOURCE_PRIORITY.provider_timeline
  };
}

function buildLl2Candidate(entry: Ll2TimelineEventLike): CandidateMilestone | null {
  const label =
    normalizeText(entry?.type?.abbrev) ||
    normalizeText(entry?.type?.description) ||
    normalizeText(entry?.type?.name) ||
    normalizeText(entry?.name);
  if (!label) return null;

  const parsedTime = parseMilestoneTime(normalizeText(entry.relative_time), 'timeline');
  const identity = canonicalizeMilestoneIdentity(label, normalizeText(entry?.type?.description));
  const phase = inferMilestonePhase({
    canonicalKey: identity.canonicalKey,
    phaseHint: 'timeline',
    tPlusSec: parsedTime.tPlusSec,
    label,
    kind: normalizeText(entry?.type?.description)
  });
  const trackKind = PHASE_TRACK_KIND[phase];
  const sourceRefId = `ll2:timeline:${normalizeText(String(entry?.type?.id ?? '')) || slugify(label) || 'event'}`;

  return {
    key: identity.outputKey,
    identityKey: identity.identityKey,
    label,
    description: normalizeText(entry?.type?.description) || null,
    tPlusSec: parsedTime.tPlusSec,
    timeText: parsedTime.timeText,
    phase,
    trackKind,
    sourceType: LL2_ENTRY_SOURCE,
    sourceRefIds: [sourceRefId],
    confidence: 'med',
    estimated: false,
    projectable: Boolean(trackKind) && parsedTime.tPlusSec != null,
    projectionReason: deriveBaseProjectionReason({ trackKind, tPlusSec: parsedTime.tPlusSec, phase }),
    fetchedAtMs: null,
    authorityScore: SOURCE_PRIORITY.ll2_timeline
  };
}

function buildTemplateCandidates(rocketFamily?: string | null): CandidateMilestone[] {
  const family = normalizeText(rocketFamily).toLowerCase();
  const templateMilestones =
    family.includes('falcon 9') || family.includes('falcon heavy') ? FALCON_TEMPLATE_MILESTONES : DEFAULT_TEMPLATE_MILESTONES;
  const templateKey = family ? family.replace(/\s+/g, '_') : 'generic';

  return templateMilestones.map((template) => {
    const trackKind = PHASE_TRACK_KIND[template.phase];
    return {
      key: template.key,
      identityKey: template.key,
      label: template.label,
      description: null,
      tPlusSec: template.tPlusSec,
      timeText: null,
      phase: template.phase,
      trackKind,
      sourceType: FAMILY_TEMPLATE_SOURCE,
      sourceRefIds: [`template:${templateKey}`],
      confidence: 'low',
      estimated: true,
      projectable: Boolean(trackKind),
      projectionReason: deriveBaseProjectionReason({ trackKind, tPlusSec: template.tPlusSec, phase: template.phase }),
      fetchedAtMs: null,
      authorityScore: SOURCE_PRIORITY.family_template
    } satisfies CandidateMilestone;
  });
}

function compareMilestoneCandidates(left: CandidateMilestone, right: CandidateMilestone) {
  const leftResolved = Number(left.tPlusSec != null);
  const rightResolved = Number(right.tPlusSec != null);
  if (leftResolved !== rightResolved) return rightResolved - leftResolved;
  if (left.authorityScore !== right.authorityScore) return right.authorityScore - left.authorityScore;
  const leftConfidence = confidenceRank(left.confidence);
  const rightConfidence = confidenceRank(right.confidence);
  if (leftConfidence !== rightConfidence) return rightConfidence - leftConfidence;
  if (left.fetchedAtMs !== right.fetchedAtMs) return (right.fetchedAtMs || 0) - (left.fetchedAtMs || 0);
  const leftEstimated = Number(left.estimated);
  const rightEstimated = Number(right.estimated);
  if (leftEstimated !== rightEstimated) return leftEstimated - rightEstimated;
  const leftLabel = left.label.toLowerCase();
  const rightLabel = right.label.toLowerCase();
  return leftLabel.localeCompare(rightLabel);
}

function stripMilestoneIdentity(candidate: CandidateMilestone): TrajectoryMilestoneDraft {
  return {
    key: candidate.key,
    label: candidate.label,
    description: candidate.description,
    tPlusSec: candidate.tPlusSec,
    timeText: candidate.timeText,
    phase: candidate.phase,
    trackKind: candidate.trackKind,
    sourceType: candidate.sourceType,
    sourceRefIds: candidate.sourceRefIds,
    confidence: candidate.confidence,
    estimated: candidate.estimated,
    projectable: candidate.projectable,
    projectionReason: candidate.projectionReason
  };
}

function findMilestoneOccurrenceIndex(candidates: CandidateMilestone[], candidate: CandidateMilestone) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const existing = candidates[index];
    const distance = milestoneOccurrenceDistanceSec(existing, candidate);
    if (distance == null) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function milestoneOccurrenceDistanceSec(left: CandidateMilestone, right: CandidateMilestone): number | null {
  if (left.identityKey !== right.identityKey) return null;

  const leftOccurrenceSec = resolveMilestoneOccurrenceSec(left);
  const rightOccurrenceSec = resolveMilestoneOccurrenceSec(right);
  if (leftOccurrenceSec != null && rightOccurrenceSec != null) {
    const delta = Math.abs(leftOccurrenceSec - rightOccurrenceSec);
    return delta <= MILESTONE_OCCURRENCE_MERGE_WINDOW_SEC ? delta : null;
  }

  const leftTimeText = normalizeText(left.timeText).toLowerCase();
  const rightTimeText = normalizeText(right.timeText).toLowerCase();
  if (leftTimeText && rightTimeText) return leftTimeText === rightTimeText ? 0 : null;
  if (!leftTimeText && !rightTimeText) {
    return slugify(left.label) === slugify(right.label) ? 0 : null;
  }

  return null;
}

function resolveMilestoneOccurrenceSec(candidate: CandidateMilestone): number | null {
  if (typeof candidate.tPlusSec === 'number' && Number.isFinite(candidate.tPlusSec)) return Math.round(candidate.tPlusSec);

  const timeText = normalizeText(candidate.timeText);
  if (!timeText) return null;

  const isoMs = parseIsoDurationToMsLocal(timeText);
  if (isoMs != null) return Math.round(isoMs / 1000);

  const explicitClock = parseExplicitTimelineClock(timeText);
  if (explicitClock != null) return explicitClock;

  const unsignedClock = parseUnsignedTimelineClock(timeText);
  if (unsignedClock != null) return unsignedClock;

  return null;
}

function compareResolvedMilestones(left: TrajectoryMilestoneDraft, right: TrajectoryMilestoneDraft) {
  const leftTime = typeof left.tPlusSec === 'number' && Number.isFinite(left.tPlusSec) ? left.tPlusSec : Number.POSITIVE_INFINITY;
  const rightTime = typeof right.tPlusSec === 'number' && Number.isFinite(right.tPlusSec) ? right.tPlusSec : Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return left.label.localeCompare(right.label);
}

function canonicalizeMilestoneIdentity(label: string, kind?: string | null) {
  const haystacks = [normalizeText(label), normalizeText(kind)].filter(Boolean);
  for (const definition of MILESTONE_DEFINITIONS) {
    if (definition.matchers.some((matcher) => haystacks.some((value) => matcher.test(value)))) {
      return {
        canonicalKey: definition.key,
        identityKey: definition.key,
        outputKey: definition.key,
        defaultLabel: definition.defaultLabel
      };
    }
  }

  const slug = slugify(label) || 'event';
  return {
    canonicalKey: 'CUSTOM',
    identityKey: `CUSTOM:${slug}`,
    outputKey: `CUSTOM:${slug}`,
    defaultLabel: label
  };
}

function inferMilestonePhase({
  canonicalKey,
  phaseHint,
  tPlusSec,
  label,
  kind
}: {
  canonicalKey: string;
  phaseHint?: 'prelaunch' | 'postlaunch' | 'timeline' | null;
  tPlusSec: number | null;
  label: string;
  kind?: string | null;
}): TrajectoryMilestonePhase {
  const canonicalPhase = MILESTONE_DEFINITIONS.find((definition) => definition.key === canonicalKey)?.phase;
  if (canonicalPhase) return canonicalPhase;
  if (phaseHint === 'prelaunch' || (tPlusSec != null && tPlusSec < 0)) return 'prelaunch';

  const raw = `${normalizeText(label)} ${normalizeText(kind)}`.trim();
  if (/\bstage(?:\s*\d+)?[\s-]*(?:sep|separation)\b/i.test(raw) || /\bstaging\b/i.test(raw) || /\bfairing\b/i.test(raw)) {
    return 'core_ascent';
  }
  if (/\bses(?:[-\s]?\d+)?\b/i.test(raw) || /\bengine start\b/i.test(raw) || /\bdeployment\b|\bdeploy\b/i.test(raw)) {
    return 'upper_stage';
  }
  if (/\bboostback\b/i.test(raw)) return 'booster_return';
  if (/\bentry\b/i.test(raw)) return 'booster_return';
  if (/\blanding\b|\btouchdown\b|\blanded\b/i.test(raw)) return 'landing';
  if (phaseHint === 'postlaunch') return 'unknown';
  return 'unknown';
}

function parseMilestoneTime(
  value?: string | null,
  phaseHint?: 'prelaunch' | 'postlaunch' | 'timeline' | null
): { tPlusSec: number | null; timeText: string | null } {
  const timeText = normalizeText(value);
  if (!timeText) return { tPlusSec: null, timeText: null };

  const isoMs = parseIsoDurationToMsLocal(timeText);
  if (isoMs != null) return { tPlusSec: Math.round(isoMs / 1000), timeText };

  const explicitClock = parseExplicitTimelineClock(timeText);
  if (explicitClock != null) return { tPlusSec: explicitClock, timeText };

  const unsignedClock = parseUnsignedTimelineClock(timeText);
  if (unsignedClock != null) {
    if (phaseHint === 'prelaunch') return { tPlusSec: -unsignedClock, timeText };
    if (phaseHint === 'postlaunch') return { tPlusSec: unsignedClock, timeText };
  }

  return { tPlusSec: null, timeText };
}

function parseExplicitTimelineClock(value: string): number | null {
  const match = value.match(/^T\s*([+-])\s*(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/i);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const first = Number(match[2]);
  const second = Number(match[3]);
  const third = match[4] != null ? Number(match[4]) : 0;
  if (![first, second, third].every(Number.isFinite)) return null;
  const totalSeconds = match[4] != null ? first * 3600 + second * 60 + third : first * 60 + second;
  return sign * totalSeconds;
}

function parseUnsignedTimelineClock(value: string): number | null {
  const match = value.match(/^(\d{1,2})(?::(\d{2}))(?::(\d{2}))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = match[3] != null ? Number(match[3]) : 0;
  if (![first, second, third].every(Number.isFinite)) return null;
  return match[3] != null ? first * 3600 + second * 60 + third : first * 60 + second;
}

function parseIsoDurationToMsLocal(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;
  const match = normalized.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  if (![days, hours, minutes, seconds].every(Number.isFinite)) return null;
  const totalSeconds = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
  return (negative ? -1 : 1) * totalSeconds * 1000;
}

function deriveBaseProjectionReason({
  trackKind,
  tPlusSec,
  phase
}: {
  trackKind?: TrajectoryMilestoneTrackKind;
  tPlusSec: number | null;
  phase: TrajectoryMilestonePhase;
}): TrajectoryMilestoneProjectionReason | undefined {
  if (!trackKind || phase === 'prelaunch' || phase === 'unknown') return 'phase_not_projectable';
  if (tPlusSec == null) return 'unresolved_time';
  return undefined;
}

function buildExternalSourceRefId({
  source,
  contentType,
  sourceId
}: {
  source?: string | null;
  contentType?: string | null;
  sourceId?: string | null;
}) {
  const sourceValue = slugify(normalizeText(source) || 'external');
  const contentTypeValue = slugify(normalizeText(contentType) || 'content');
  const sourceIdValue = slugify(normalizeText(sourceId) || 'resource');
  return `external:${sourceValue}:${contentTypeValue}:${sourceIdValue}`;
}

function normalizeProviderPhase(value?: string | null): 'prelaunch' | 'postlaunch' | 'timeline' | null {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('pre')) return 'prelaunch';
  if (normalized.includes('post')) return 'postlaunch';
  if (normalized.includes('timeline')) return 'timeline';
  return null;
}

function normalizeTrackKind(value?: string | null): TrajectoryMilestoneTrackKind {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.includes('upper') || normalized.includes('stage2') || normalized.includes('stage_2') || normalized.includes('second_stage')) {
    return 'upper_stage_up';
  }
  if (normalized.includes('booster')) return 'booster_down';
  return 'core_up';
}

function confidenceFromNumeric(
  value: number | null | undefined,
  highFallback: TrajectoryMilestoneConfidence,
  defaultValue: TrajectoryMilestoneConfidence
): TrajectoryMilestoneConfidence {
  if (value == null || !Number.isFinite(value)) return defaultValue;
  if (value >= 0.8) return highFallback;
  if (value >= 0.45) return 'med';
  return 'low';
}

function confidenceRank(value?: TrajectoryMilestoneConfidence) {
  switch (value) {
    case 'high':
      return 3;
    case 'med':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function slugify(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseIsoMs(value?: string | null): number | null {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

export const TRAJECTORY_MILESTONE_PHASES = PHASES;
export const TRAJECTORY_MILESTONE_SOURCES = SOURCES;
export const TRAJECTORY_MILESTONE_TRACKS = TRACKS;
export const TRAJECTORY_MILESTONE_CONFIDENCE_LEVELS = CONFIDENCE_LEVELS;
