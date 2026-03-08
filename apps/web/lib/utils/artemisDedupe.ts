export type ArtemisContentIdentityInput = {
  kind: string | null | undefined;
  missionKey: string | null | undefined;
  url: string | null | undefined;
  title: string | null | undefined;
  sourceKey?: string | null | undefined;
  externalId?: string | null | undefined;
  platform?: string | null | undefined;
  imageUrl?: string | null | undefined;
  dataLabel?: string | null | undefined;
  dataValue?: number | string | null | undefined;
  dataUnit?: string | null | undefined;
};

export type ArtemisBudgetIdentityInput = {
  fiscalYear: number | null | undefined;
  agency: string | null | undefined;
  program: string | null | undefined;
  lineItem: string | null | undefined;
  amountRequested: number | null | undefined;
  amountEnacted: number | null | undefined;
  announcedTime?: string | null | undefined;
  sourceDocumentId?: string | null | undefined;
  sourceClass?: string | null | undefined;
  amountType?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  sourceTitle?: string | null | undefined;
  detail?: string | null | undefined;
};

export type ArtemisProcurementIdentityInput = {
  awardId: string | null | undefined;
  title: string | null | undefined;
  recipient: string | null | undefined;
  obligatedAmount: number | null | undefined;
  awardedOn: string | null | undefined;
  missionKey: string | null | undefined;
  sourceDocumentId?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  sourceTitle?: string | null | undefined;
  detail?: string | null | undefined;
};

export type ArtemisTimelineIdentityInput = {
  fingerprint?: string | null | undefined;
  missionKey: string | null | undefined;
  title: string | null | undefined;
  summary?: string | null | undefined;
  kind?: string | null | undefined;
  sourceType?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  sourceDocumentUrl?: string | null | undefined;
  eventTime?: string | null | undefined;
  announcedTime?: string | null | undefined;
};

const TRACKING_PARAM_KEYS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid']);

export function normalizeArtemisText(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeArtemisNumber(value: number | string | null | undefined): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'na';
    return value.toFixed(6);
  }
  if (typeof value !== 'string') return 'na';
  const trimmed = value.trim();
  if (!trimmed) return 'na';
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed.toFixed(6) : 'na';
}

export function normalizeArtemisDateBucket(value: string | null | undefined): string {
  if (!value) return 'na';
  const parsedMs = Date.parse(value);
  if (Number.isFinite(parsedMs)) {
    return new Date(parsedMs).toISOString().slice(0, 10);
  }
  return normalizeArtemisText(value).slice(0, 10) || 'na';
}

export function canonicalizeArtemisUrl(value: string | null | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';

    const params = [...parsed.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !lower.startsWith('utm_') && !TRACKING_PARAM_KEYS.has(lower);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : '';
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${query}`;
  } catch {
    return normalizeArtemisText(trimmed);
  }
}

export function buildArtemisUrlComparisonKey(value: string | null | undefined): string {
  const canonical = canonicalizeArtemisUrl(value);
  if (!canonical) return '';
  const strippedProtocol = canonical.replace(/^https?:\/\//, '');
  const withoutWww = strippedProtocol.startsWith('www.') ? strippedProtocol.slice(4) : strippedProtocol;
  return withoutWww.toLowerCase();
}

export function buildArtemisContentIdentityKey(input: ArtemisContentIdentityInput): string {
  const kind = normalizeArtemisText(input.kind) || 'unknown';
  const mission = normalizeArtemisText(input.missionKey) || 'program';
  const title = normalizeArtemisText(input.title) || 'untitled';
  const sourceKey = normalizeArtemisText(input.sourceKey) || 'na';
  const url = canonicalizeArtemisUrl(input.url) || 'na';
  const externalId = normalizeArtemisExternalId(input.externalId, input.url);

  if (kind === 'photo') {
    const imageUrl = canonicalizeArtemisUrl(input.imageUrl) || 'na';
    return ['photo', mission, title, url, sourceKey, externalId, imageUrl].join('|');
  }

  if (kind === 'social') {
    const platform = normalizeArtemisText(input.platform) || 'na';
    return ['social', mission, title, url, sourceKey, platform, externalId].join('|');
  }

  if (kind === 'data') {
    return [
      'data',
      mission,
      title,
      url,
      sourceKey,
      normalizeArtemisText(input.dataLabel) || 'na',
      normalizeArtemisNumber(input.dataValue),
      normalizeArtemisText(input.dataUnit) || 'na'
    ].join('|');
  }

  return ['article', mission, title, url, sourceKey, externalId].join('|');
}

export function buildArtemisBudgetIdentityKey(input: ArtemisBudgetIdentityInput): string {
  return [
    input.fiscalYear ?? 'na',
    normalizeArtemisText(input.agency) || 'na',
    normalizeArtemisText(input.program) || 'na',
    normalizeArtemisText(input.lineItem) || 'na',
    normalizeArtemisNumber(input.amountRequested),
    normalizeArtemisNumber(input.amountEnacted),
    normalizeArtemisDateBucket(input.announcedTime),
    normalizeArtemisText(input.sourceDocumentId) || 'na',
    normalizeArtemisText(input.sourceClass) || 'na',
    normalizeArtemisText(input.amountType) || 'na',
    canonicalizeArtemisUrl(input.sourceUrl) || 'na',
    normalizeArtemisText(input.sourceTitle) || 'na',
    normalizeArtemisText(input.detail) || 'na'
  ].join('|');
}

export function buildArtemisProcurementIdentityKey(input: ArtemisProcurementIdentityInput): string {
  const awardId = normalizeArtemisText(input.awardId);
  if (awardId) {
    return ['award', awardId, normalizeArtemisText(input.missionKey) || 'program'].join('|');
  }

  return [
    'award-fallback',
    normalizeArtemisText(input.title) || 'na',
    normalizeArtemisText(input.recipient) || 'na',
    normalizeArtemisNumber(input.obligatedAmount),
    normalizeArtemisDateBucket(input.awardedOn),
    normalizeArtemisText(input.missionKey) || 'program',
    normalizeArtemisText(input.sourceDocumentId) || 'na',
    canonicalizeArtemisUrl(input.sourceUrl) || 'na',
    normalizeArtemisText(input.sourceTitle) || 'na',
    normalizeArtemisText(input.detail) || 'na'
  ].join('|');
}

export function buildArtemisTimelineIdentityKey(input: ArtemisTimelineIdentityInput): string {
  const fingerprint = normalizeArtemisText(input.fingerprint);
  if (fingerprint) {
    return `fingerprint|${fingerprint}`;
  }

  return [
    normalizeArtemisText(input.missionKey) || 'program',
    normalizeArtemisText(input.title) || 'untitled',
    normalizeArtemisText(input.summary) || 'na',
    normalizeArtemisText(input.kind) || 'update',
    normalizeArtemisText(input.sourceType) || 'unknown',
    canonicalizeArtemisUrl(input.sourceUrl || input.sourceDocumentUrl) || 'na',
    normalizeArtemisDateBucket(input.eventTime || input.announcedTime)
  ].join('|');
}

export function isArtemisRefreshTimelineTitle(value: string | null | undefined): boolean {
  const normalized = normalizeArtemisText(value);
  if (!normalized) return false;
  return normalized.endsWith('refreshed') || normalized.includes(' context refreshed') || normalized.includes(' data refreshed');
}

export function buildArtemisTimelineRefreshCollapseKey(input: ArtemisTimelineIdentityInput): string | null {
  if (!isArtemisRefreshTimelineTitle(input.title)) return null;
  return [
    normalizeArtemisText(input.missionKey) || 'program',
    normalizeArtemisText(input.title) || 'untitled',
    normalizeArtemisText(input.sourceType) || 'unknown',
    normalizeArtemisDateBucket(input.eventTime || input.announcedTime)
  ].join('|');
}

function normalizeArtemisExternalId(value: string | null | undefined, url: string | null | undefined): string {
  const normalized = normalizeArtemisText(value);
  if (normalized) return normalized;

  const canonicalUrl = canonicalizeArtemisUrl(url);
  if (!canonicalUrl) return 'na';

  const socialMatch = canonicalUrl.match(/\/(?:status|statuses)\/(\d+)/i);
  if (socialMatch?.[1]) return socialMatch[1];
  return 'na';
}
