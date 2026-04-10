export type Ws45OperationalTone = 'normal' | 'watch' | 'warning' | 'critical';

export type Ws45NormalizedAlert = {
  id: string;
  weatherType: string | null;
  status: string | null;
  subtext: string | null;
  label: string;
  detail: string | null;
  phase: 'phase_1' | 'phase_2' | null;
  tone: Ws45OperationalTone;
  startTime: string | null;
  endTime: string | null;
  cancellationTimestamp: string | null;
  ringName: string | null;
  raw: Record<string, unknown>;
};

export type Ws45NormalizedRing = {
  id: string;
  name: string;
  activeAlerts: Ws45NormalizedAlert[];
};

export type Ws45NormalizedAgency = {
  id: string;
  name: string;
  activeWind: Ws45NormalizedAlert | null;
  lightningRings: Ws45NormalizedRing[];
  activeLightningCount: number;
  activePhase1Count: number;
  activePhase2Count: number;
  tone: Ws45OperationalTone;
  summary: string;
};

export type Ws45LiveBoardSnapshot = {
  agencyCount: number;
  ringCount: number;
  activePhase1Count: number;
  activePhase2Count: number;
  activeWindCount: number;
  activeSevereCount: number;
  summary: string;
  agencies: Ws45NormalizedAgency[];
  lightningRings: Array<{
    agencyName: string;
    ringId: string;
    ringName: string;
    activeAlerts: Ws45NormalizedAlert[];
  }>;
  raw: unknown;
};

export type Ws45LaunchBoardContext = {
  launchName?: string | null;
  missionName?: string | null;
  padName?: string | null;
  padShortCode?: string | null;
  padLocationName?: string | null;
  padState?: string | null;
};

export type Ws45LaunchOperationalSummary = {
  agencyName: string;
  tone: Ws45OperationalTone;
  summary: string;
  lightningLabel: string;
  lightningDetail: string | null;
  windLabel: string;
  windDetail: string | null;
  rangeStatus: string;
  rangeDetail: string | null;
  relevantRingNames: string[];
};

export function getWs45LiveCadenceMinutes(launchAtIso: string | null | undefined, nowMs = Date.now()) {
  const launchMs = Date.parse(String(launchAtIso || ''));
  if (!Number.isFinite(launchMs)) return null;
  const deltaMs = launchMs - nowMs;
  if (deltaMs < 0) return 15;
  if (deltaMs <= 60 * 60 * 1000) return 15;
  if (deltaMs <= 4 * 60 * 60 * 1000) return 30;
  if (deltaMs <= 12 * 60 * 60 * 1000) return 60;
  if (deltaMs <= 24 * 60 * 60 * 1000) return 120;
  return null;
}

export function normalizeWs45LiveBoardPayload(raw: unknown): Ws45LiveBoardSnapshot {
  const agenciesInput = Array.isArray(raw) ? raw : [];
  const agencies = agenciesInput
    .map((agencyRaw) => normalizeAgency(agencyRaw))
    .filter((agency): agency is Ws45NormalizedAgency => Boolean(agency));
  const lightningRings = agencies.flatMap((agency) =>
    agency.lightningRings.map((ring) => ({
      agencyName: agency.name,
      ringId: ring.id,
      ringName: ring.name,
      activeAlerts: ring.activeAlerts
    }))
  );
  const activePhase1Count = agencies.reduce((sum, agency) => sum + agency.activePhase1Count, 0);
  const activePhase2Count = agencies.reduce((sum, agency) => sum + agency.activePhase2Count, 0);
  const activeWindCount = agencies.reduce((sum, agency) => sum + (agency.activeWind ? 1 : 0), 0);
  const activeSevereCount = agencies.reduce((sum, agency) => sum + (agency.tone === 'critical' ? 1 : 0), 0);
  const ringCount = lightningRings.length;
  const summaryParts: string[] = [];
  if (activePhase2Count > 0) summaryParts.push(`${activePhase2Count} Phase 2 ring${activePhase2Count === 1 ? '' : 's'}`);
  if (activePhase1Count > 0) summaryParts.push(`${activePhase1Count} Phase 1 ring${activePhase1Count === 1 ? '' : 's'}`);
  if (activeWindCount > 0) summaryParts.push(`${activeWindCount} active wind alert${activeWindCount === 1 ? '' : 's'}`);

  return {
    agencyCount: agencies.length,
    ringCount,
    activePhase1Count,
    activePhase2Count,
    activeWindCount,
    activeSevereCount,
    summary: summaryParts.length ? summaryParts.join(' • ') : 'No active lightning phases or wind alerts on the live board.',
    agencies,
    lightningRings,
    raw
  };
}

export function summarizeWs45LaunchOperational(
  snapshot: Pick<Ws45LiveBoardSnapshot, 'agencies'>,
  context: Ws45LaunchBoardContext
): Ws45LaunchOperationalSummary | null {
  const agencies = Array.isArray(snapshot.agencies) ? snapshot.agencies : [];
  if (!agencies.length) return null;

  const agencyName = resolveWs45AgencyName(context);
  const agency =
    (agencyName ? agencies.find((entry) => entry.name.toUpperCase() === agencyName.toUpperCase()) : null) ??
    agencies.find((entry) => entry.name.toUpperCase() === 'CCSFS') ??
    agencies.find((entry) => entry.name.toUpperCase() === 'KSC') ??
    agencies[0] ??
    null;

  if (!agency) return null;

  const relevantRings = selectRelevantRings(agency, context);
  const lightningAlerts = (relevantRings.length ? relevantRings : agency.lightningRings).flatMap((ring) => ring.activeAlerts);
  const strongestLightning = pickStrongestAlert(lightningAlerts);
  const wind = agency.activeWind;
  const tone = maxTone(strongestLightning?.tone ?? 'normal', wind?.tone ?? 'normal');

  const lightningLabel = strongestLightning ? strongestLightning.label : 'No active lightning phases';
  const lightningDetail = strongestLightning
    ? buildLightningDetail(lightningAlerts, relevantRings)
    : relevantRings.length
      ? `${relevantRings.map((ring) => ring.name).join(', ')} clear.`
      : null;
  const windLabel = wind ? wind.label : 'No active wind advisory';
  const windDetail = wind?.detail ?? null;
  const rangeStatus = tone === 'critical' ? 'Restricted' : tone === 'warning' || tone === 'watch' ? 'Weather watch' : 'Operational';
  const rangeDetail =
    tone === 'critical'
      ? 'Live range weather constraints are active.'
      : tone === 'warning' || tone === 'watch'
        ? 'Live board shows active weather risk near the range.'
        : 'No active lightning phases or wind alerts are posted for the selected range area.';

  const summary =
    strongestLightning && wind
      ? `${agency.name} live board shows ${lightningLabel.toLowerCase()} and ${windLabel.toLowerCase()}.`
      : strongestLightning
        ? `${agency.name} live board shows ${lightningLabel.toLowerCase()}.`
        : wind
          ? `${agency.name} live board shows ${windLabel.toLowerCase()}.`
          : `No active lightning phases or wind alerts on the ${agency.name} live board.`;

  return {
    agencyName: agency.name,
    tone,
    summary,
    lightningLabel,
    lightningDetail,
    windLabel,
    windDetail,
    rangeStatus,
    rangeDetail,
    relevantRingNames: relevantRings.map((ring) => ring.name)
  };
}

export function resolveWs45AgencyName(context: Ws45LaunchBoardContext): string | null {
  const haystack = [
    context.launchName,
    context.missionName,
    context.padName,
    context.padShortCode,
    context.padLocationName,
    context.padState
  ]
    .map((value) => normalizeToken(value))
    .filter(Boolean)
    .join(' ');

  if (!haystack) return null;
  if (haystack.includes('patrick') || haystack.includes('psfb')) return 'PSFB';
  if (haystack.includes('kennedy') || haystack.includes('ksc') || haystack.includes('39a') || haystack.includes('39b') || haystack.includes('lc39')) {
    return 'KSC';
  }
  if (
    haystack.includes('cape canaveral') ||
    haystack.includes('ccsfs') ||
    haystack.includes('slc') ||
    haystack.includes('lc36') ||
    haystack.includes('lc37') ||
    haystack.includes('lc40') ||
    haystack.includes('lc41') ||
    haystack.includes('launch complex')
  ) {
    return 'CCSFS';
  }
  return context.padState && String(context.padState).trim().toUpperCase() === 'FL' ? 'CCSFS' : null;
}

function normalizeAgency(raw: unknown): Ws45NormalizedAgency | null {
  if (!isRecord(raw)) return null;
  const name = normalizeString(raw.name) || 'Unknown agency';
  const lightningRings = Array.isArray(raw.lightningRings)
    ? raw.lightningRings
        .map((ringRaw) => normalizeRing(ringRaw))
        .filter((ring): ring is Ws45NormalizedRing => Boolean(ring))
    : [];
  const lightningAlerts = lightningRings.flatMap((ring) => ring.activeAlerts);
  const activeWind = normalizeAlert(raw.activeWindWWA, { fallbackType: 'WIND', ringName: null });
  const tone = [activeWind?.tone ?? 'normal', pickStrongestAlert(lightningAlerts)?.tone ?? 'normal'].reduce(maxTone, 'normal');

  return {
    id: normalizeId(raw.id),
    name,
    activeWind,
    lightningRings,
    activeLightningCount: lightningAlerts.length,
    activePhase1Count: lightningAlerts.filter((alert) => alert.phase === 'phase_1').length,
    activePhase2Count: lightningAlerts.filter((alert) => alert.phase === 'phase_2').length,
    tone,
    summary: buildAgencySummary(name, lightningAlerts, activeWind)
  };
}

function normalizeRing(raw: unknown): Ws45NormalizedRing | null {
  if (!isRecord(raw)) return null;
  const name = normalizeString(raw.name) || 'Unknown ring';
  const activeAlerts = Array.isArray(raw.activeLightningWWAs)
    ? raw.activeLightningWWAs
        .map((alertRaw) => normalizeAlert(alertRaw, { fallbackType: 'LIGHTNING', ringName: name }))
        .filter((alert): alert is Ws45NormalizedAlert => Boolean(alert))
    : [];

  return {
    id: normalizeId(raw.id),
    name,
    activeAlerts
  };
}

function normalizeAlert(
  raw: unknown,
  options: { fallbackType: string; ringName: string | null }
): Ws45NormalizedAlert | null {
  if (!isRecord(raw)) return null;
  const criteria = isRecord(raw.wwaCriteria) ? raw.wwaCriteria : {};
  const weatherType = normalizeString(criteria.weatherType) || normalizeString(raw.weatherType) || options.fallbackType;
  const status = normalizeString(criteria.status) || normalizeString(raw.status);
  const subtext = normalizeString(criteria.subtext) || normalizeString(raw.subtext);
  const phase = detectLightningPhase(weatherType, status, subtext);
  const label = buildAlertLabel(weatherType, status, phase);
  const detail = [subtext, buildTimeWindow(normalizeString(raw.startTime), normalizeString(raw.endTime), Boolean(criteria.isEndTimeUFN ?? raw.isEndTimeUFN))]
    .filter(Boolean)
    .join(' • ');
  const tone = resolveAlertTone(weatherType, status, phase);

  return {
    id: normalizeId(raw.id),
    weatherType,
    status,
    subtext,
    label,
    detail: detail || null,
    phase,
    tone,
    startTime: normalizeString(raw.startTime),
    endTime: normalizeString(raw.endTime),
    cancellationTimestamp: normalizeString(raw.cancellationTimestamp),
    ringName: options.ringName,
    raw: raw as Record<string, unknown>
  };
}

function selectRelevantRings(agency: Ws45NormalizedAgency, context: Ws45LaunchBoardContext) {
  const padTokens = extractPadTokens(context);
  if (!padTokens.length) return [];
  return agency.lightningRings.filter((ring) => {
    const normalizedName = normalizeToken(ring.name);
    return padTokens.some((token) => normalizedName.includes(token) || normalizedName.includes(token.replace(/[a-z]/g, '')));
  });
}

function extractPadTokens(context: Ws45LaunchBoardContext) {
  const haystack = [context.padShortCode, context.padName, context.padLocationName]
    .map((value) => normalizeToken(value))
    .filter(Boolean)
    .join(' ');
  if (!haystack) return [];

  const matches = new Set<string>();
  const tokenPattern = /\b(?:lc|slc|cx)?\s*-?\s*(\d{1,2}[a-z]?)\b/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(haystack))) {
    const token = normalizeToken(match[1]);
    if (token) matches.add(token);
  }
  if (haystack.includes('39a')) matches.add('39a');
  if (haystack.includes('39b')) matches.add('39b');
  return [...matches];
}

function buildAgencySummary(name: string, lightningAlerts: Ws45NormalizedAlert[], activeWind: Ws45NormalizedAlert | null) {
  const strongestLightning = pickStrongestAlert(lightningAlerts);
  if (strongestLightning && activeWind) {
    return `${name} has ${strongestLightning.label.toLowerCase()} and ${activeWind.label.toLowerCase()}.`;
  }
  if (strongestLightning) {
    return `${name} has ${strongestLightning.label.toLowerCase()}.`;
  }
  if (activeWind) {
    return `${name} has ${activeWind.label.toLowerCase()}.`;
  }
  return `${name} has no active lightning phases or wind alerts.`;
}

function buildLightningDetail(alerts: Ws45NormalizedAlert[], relevantRings: Ws45NormalizedRing[]) {
  const ringNames = [...new Set((relevantRings.length ? relevantRings : alerts.map((alert) => ({ name: alert.ringName || '' } as Ws45NormalizedRing))).map((ring) => ring.name).filter(Boolean))];
  const alertDetails = [...new Set(alerts.map((alert) => [alert.label, alert.detail].filter(Boolean).join(' • ')).filter(Boolean))];
  const parts = [];
  if (ringNames.length) parts.push(ringNames.join(', '));
  if (alertDetails.length) parts.push(alertDetails.join(' | '));
  return parts.join(' • ') || null;
}

function buildAlertLabel(weatherType: string | null, status: string | null, phase: 'phase_1' | 'phase_2' | null) {
  if (phase === 'phase_2') return 'Phase 2';
  if (phase === 'phase_1') return 'Phase 1';
  const typeLabel = formatLabelToken(weatherType);
  const statusLabel = formatLabelToken(status);
  if (typeLabel && statusLabel) return `${typeLabel} ${statusLabel}`;
  return typeLabel || statusLabel || 'Active advisory';
}

function buildTimeWindow(startTime: string | null, endTime: string | null, isOpenEnded: boolean) {
  const startLabel = formatBoardTime(startTime);
  const endLabel = formatBoardTime(endTime);
  if (!startTime && !endTime) return isOpenEnded ? 'Until further notice' : '';
  if (isOpenEnded && startLabel) return `Started ${startLabel}`;
  if (endLabel) return `Until ${endLabel}`;
  return startLabel ? `Started ${startLabel}` : '';
}

function detectLightningPhase(weatherType: string | null, status: string | null, subtext: string | null) {
  const haystack = [weatherType, status, subtext].map((value) => normalizeToken(value)).join(' ');
  if (haystack.includes('phase 2') || haystack.includes('phase2')) return 'phase_2';
  if (haystack.includes('phase 1') || haystack.includes('phase1')) return 'phase_1';
  return null;
}

function resolveAlertTone(weatherType: string | null, status: string | null, phase: 'phase_1' | 'phase_2' | null): Ws45OperationalTone {
  const type = normalizeToken(weatherType);
  const normalizedStatus = normalizeToken(status);
  if (phase === 'phase_2') return 'critical';
  if (phase === 'phase_1') return 'warning';
  if (normalizedStatus.includes('warning') || normalizedStatus.includes('damaging')) return 'critical';
  if (normalizedStatus.includes('watch') || normalizedStatus.includes('strong')) return 'warning';
  if (normalizedStatus.includes('steady') || normalizedStatus.includes('advisory') || normalizedStatus.includes('observed')) return 'watch';
  if (type.includes('wind') && normalizedStatus) return 'watch';
  return 'normal';
}

function pickStrongestAlert(alerts: Ws45NormalizedAlert[]) {
  return [...alerts].sort((left, right) => toneRank(right.tone) - toneRank(left.tone))[0] ?? null;
}

function maxTone(left: Ws45OperationalTone, right: Ws45OperationalTone): Ws45OperationalTone {
  return toneRank(left) >= toneRank(right) ? left : right;
}

function toneRank(tone: Ws45OperationalTone) {
  if (tone === 'critical') return 4;
  if (tone === 'warning') return 3;
  if (tone === 'watch') return 2;
  return 1;
}

function formatLabelToken(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeToken(value: unknown) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeString(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function formatBoardTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
