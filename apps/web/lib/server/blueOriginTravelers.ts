import { cache } from 'react';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { fetchBlueOriginPassengersDatabaseOnly } from '@/lib/server/blueOriginPeoplePayloads';
import { createSupabasePrivilegedReadClient } from '@/lib/server/supabaseServer';
import type {
  BlueOriginPassenger,
  BlueOriginTravelerIndexItem,
  BlueOriginTravelerIndexResponse,
  BlueOriginTravelerProfile,
  BlueOriginTravelerSource
} from '@/lib/types/blueOrigin';
import {
  buildBlueOriginTravelerSlug,
  isBlueOriginNonHumanCrewEntry,
  isBlueOriginOpenSourceProfileUrl,
  normalizeBlueOriginTravelerProfileUrl,
  normalizeBlueOriginTravelerRole,
  parseBlueOriginTravelerSlug
} from '@/lib/utils/blueOrigin';
import { buildLaunchHref } from '@/lib/utils/launchLinks';

const MAX_TRAVELER_ROWS = 4_000;
const SOURCE_CHUNK_SIZE = 250;
const withCache =
  typeof cache === 'function'
    ? cache
    : (<T extends (...args: any[]) => any>(fn: T): T => fn);

type TravelerDirectory = Map<string, BlueOriginPassenger[]>;
type TravelerCanonicalDirectory = Map<
  string,
  {
    profile: BlueOriginTravelerProfile;
    sources: BlueOriginTravelerSource[];
  }
>;

type TravelerProfileRow = {
  id: string;
  traveler_slug: string;
  canonical_name: string;
  bio_short: string | null;
  primary_image_url: string | null;
  primary_profile_url: string | null;
  nationality: string | null;
  source_confidence: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type TravelerSourceRow = {
  id: string;
  source_key: string;
  traveler_slug: string;
  launch_id: string | null;
  flight_code: string | null;
  source_type: string;
  source_url: string | null;
  source_document_id: string | null;
  profile_url: string | null;
  image_url: string | null;
  bio_full: string | null;
  bio_excerpt: string | null;
  attribution: Record<string, unknown> | null;
  confidence: string | null;
  content_sha256: string | null;
  captured_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

export type BlueOriginTravelerFlightRecord = {
  key: string;
  launchId: string | null;
  flightCode: string | null;
  launchName: string | null;
  launchDate: string | null;
  launchHref: string | null;
  roles: string[];
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
};

export type BlueOriginTravelerDetail = {
  slug: string;
  canonicalSlug: string;
  name: string;
  roles: string[];
  nationalities: string[];
  bio: string | null;
  profileUrls: string[];
  imageUrls: string[];
  flights: BlueOriginTravelerFlightRecord[];
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
};

const fetchBlueOriginTravelerCanonicalDirectory = withCache(async (): Promise<TravelerCanonicalDirectory> => {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) return new Map();

  const supabase = createSupabasePrivilegedReadClient();
  const { data: profileRows, error: profileError } = await supabase
    .from('blue_origin_travelers')
    .select('id,traveler_slug,canonical_name,bio_short,primary_image_url,primary_profile_url,nationality,source_confidence,metadata,updated_at')
    .order('canonical_name', { ascending: true })
    .limit(MAX_TRAVELER_ROWS);

  if (profileError) {
    if (isMissingCanonicalTravelerSchema(profileError)) return new Map();
    console.error('blue origin traveler profiles query error', profileError);
    return new Map();
  }

  const profiles = ((profileRows || []) as TravelerProfileRow[])
    .map(mapTravelerProfileRow)
    .filter((row) => Boolean(row.travelerSlug));
  if (!profiles.length) return new Map();

  const profileBySlug = new Map<string, BlueOriginTravelerProfile>();
  for (const profile of profiles) {
    const slug = parseBlueOriginTravelerSlug(profile.travelerSlug);
    if (!slug) continue;
    profileBySlug.set(slug, profile);
  }
  if (!profileBySlug.size) return new Map();

  const sources = [] as BlueOriginTravelerSource[];
  const slugs = [...profileBySlug.keys()];
  for (const chunk of chunkArray(slugs, SOURCE_CHUNK_SIZE)) {
    const { data: sourceRows, error: sourceError } = await supabase
      .from('blue_origin_traveler_sources')
      .select('id,source_key,traveler_slug,launch_id,flight_code,source_type,source_url,source_document_id,profile_url,image_url,bio_full,bio_excerpt,attribution,confidence,content_sha256,captured_at,metadata,updated_at')
      .in('traveler_slug', chunk)
      .order('captured_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(MAX_TRAVELER_ROWS * 8);

    if (sourceError) {
      if (isMissingCanonicalTravelerSchema(sourceError)) return new Map();
      console.error('blue origin traveler sources query error', sourceError);
      return new Map();
    }

    for (const row of (sourceRows || []) as TravelerSourceRow[]) {
      const mapped = mapTravelerSourceRow(row);
      if (!mapped) continue;
      sources.push(mapped);
    }
  }

  const sourceBySlug = new Map<string, BlueOriginTravelerSource[]>();
  for (const source of sources) {
    const slug = parseBlueOriginTravelerSlug(source.travelerSlug);
    if (!slug) continue;
    const bucket = sourceBySlug.get(slug) || [];
    bucket.push(source);
    sourceBySlug.set(slug, bucket);
  }

  const directory: TravelerCanonicalDirectory = new Map();
  for (const [slug, profile] of profileBySlug.entries()) {
    directory.set(slug, {
      profile,
      sources: sourceBySlug.get(slug) || []
    });
  }

  return directory;
});

const fetchBlueOriginTravelerDirectory = withCache(async (): Promise<TravelerDirectory> => {
  const dbPassengers = await fetchBlueOriginPassengersDatabaseOnly('all');
  return buildTravelerDirectory(dbPassengers.items);
});

export const fetchBlueOriginTravelerSlugs = withCache(async (): Promise<string[]> => {
  const canonicalDirectory = await fetchBlueOriginTravelerCanonicalDirectory();
  if (canonicalDirectory.size > 0) {
    const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
    return [...canonicalDirectory.entries()]
      .map(([slug, entry]) => buildTravelerDetailFromCanonical(slug, entry, fallbackDirectory.get(slug) || []))
      .filter((detail) => !shouldSuppressBlueOriginCrewDetail(detail))
      .map((detail) => detail.canonicalSlug)
      .sort((left, right) => left.localeCompare(right));
  }

  const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
  return [...fallbackDirectory.keys()].sort((left, right) => left.localeCompare(right));
});

export const fetchBlueOriginTravelerIndex = withCache(async (): Promise<BlueOriginTravelerIndexResponse> => {
  const generatedAt = new Date().toISOString();

  const canonicalDirectory = await fetchBlueOriginTravelerCanonicalDirectory();
  if (canonicalDirectory.size > 0) {
    const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
    const items = [...canonicalDirectory.entries()]
      .map(([slug, entry]) => buildTravelerDetailFromCanonical(slug, entry, fallbackDirectory.get(slug) || []))
      .filter((detail) => !shouldSuppressBlueOriginCrewDetail(detail))
      .map((detail) => buildTravelerIndexItem(detail))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { generatedAt, items };
  }

  const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
  const items = [...fallbackDirectory.entries()]
    .map(([slug, rows]) => buildTravelerIndexItem(buildTravelerDetailFromPassengerRows(slug, rows)))
    .sort((left, right) => left.name.localeCompare(right.name));

  return { generatedAt, items };
});

export const fetchBlueOriginTravelerDetailBySlug = withCache(
  async (slug: string): Promise<BlueOriginTravelerDetail | null> => {
    const normalizedSlug = parseBlueOriginTravelerSlug(slug);
    if (!normalizedSlug) return null;

    const canonicalDirectory = await fetchBlueOriginTravelerCanonicalDirectory();
    const canonicalEntry = canonicalDirectory.get(normalizedSlug);
    if (canonicalEntry) {
      const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
      const detail = buildTravelerDetailFromCanonical(
        normalizedSlug,
        canonicalEntry,
        fallbackDirectory.get(normalizedSlug) || []
      );
      return shouldSuppressBlueOriginCrewDetail(detail) ? null : detail;
    }

    const fallbackDirectory = await fetchBlueOriginTravelerDirectory();
    const matched = fallbackDirectory.get(normalizedSlug) || [];
    if (!matched.length) return null;
    return buildTravelerDetailFromPassengerRows(normalizedSlug, matched);
  }
);

function buildTravelerIndexItem(detail: BlueOriginTravelerDetail): BlueOriginTravelerIndexItem {
  const latestFlight = detail.flights[0] || null;
  const launchIdSet = new Set(
    detail.flights
      .map((flight) => normalizeKeyValue(flight.launchId))
      .filter(Boolean)
  );
  const flightCodeSet = new Set(
    detail.flights
      .map((flight) => normalizeFlightCode(flight.flightCode))
      .filter(Boolean)
  );

  return {
    travelerSlug: parseBlueOriginTravelerSlug(detail.canonicalSlug) || detail.slug,
    name: detail.name,
    roles: detail.roles,
    nationalities: detail.nationalities,
    confidence: detail.confidence,
    imageUrl: detail.imageUrls[0] || null,
    launchCount: launchIdSet.size,
    flightCount: flightCodeSet.size || detail.flights.length,
    latestFlightCode: latestFlight?.flightCode || null,
    latestLaunchDate: latestFlight?.launchDate || null,
    latestLaunchName: latestFlight?.launchName || null,
    latestLaunchHref: latestFlight?.launchHref || null
  };
}

function buildTravelerDetailFromCanonical(
  requestedSlug: string,
  entry: {
    profile: BlueOriginTravelerProfile;
    sources: BlueOriginTravelerSource[];
  },
  passengerRows: BlueOriginPassenger[]
): BlueOriginTravelerDetail {
  const canonicalSlug =
    parseBlueOriginTravelerSlug(entry.profile.travelerSlug) ||
    buildBlueOriginTravelerSlug(entry.profile.canonicalName);

  const roles = dedupeTextValues([
    ...passengerRows.map((row) => normalizeBlueOriginTravelerRole(row.role)),
    ...entry.sources.map((source) =>
      normalizeBlueOriginTravelerRole(readObjectText(source.attribution, ['role']))
    ),
    ...entry.sources.map((source) =>
      normalizeBlueOriginTravelerRole(readObjectText(source.metadata, ['role']))
    )
  ]);
  const nationalities = dedupeTextValues([
    entry.profile.nationality,
    ...passengerRows.map((row) => row.nationality || null),
    ...entry.sources.map((source) => readObjectText(source.attribution, ['nationality'])),
    ...entry.sources.map((source) => readObjectText(source.metadata, ['nationality']))
  ]);
  const profileUrls = dedupeTextValues([
    normalizeTravelerProfileUrl(entry.profile.primaryProfileUrl),
    ...passengerRows.map((row) => normalizeTravelerProfileUrl(row.profileUrl || null, row.source)),
    ...entry.sources.map((source) => normalizeTravelerProfileUrl(source.profileUrl, source.sourceType)),
    ...entry.sources.map((source) => normalizeTravelerProfileUrl(source.sourceUrl, source.sourceType))
  ]);
  const imageUrls = dedupeTextValues([
    entry.profile.primaryImageUrl,
    ...passengerRows.map((row) => row.imageUrl || null),
    ...entry.sources.map((source) => source.imageUrl)
  ]);
  const bios = dedupeTextValues([
    entry.profile.bioShort,
    ...passengerRows.map((row) => row.bio || null),
    ...entry.sources.map((source) => source.bioExcerpt),
    ...entry.sources.map((source) => source.bioFull)
  ]);
  const sources = dedupeTextValues([
    ...passengerRows.map((row) => row.source || null),
    ...entry.sources.map((source) => source.sourceType),
    ...entry.sources.map((source) => normalizeTravelerProfileUrl(source.sourceUrl, source.sourceType))
  ]);

  return {
    slug: requestedSlug,
    canonicalSlug,
    name: entry.profile.canonicalName,
    roles,
    nationalities,
    bio: bios[0] || null,
    profileUrls,
    imageUrls,
    flights: passengerRows.length ? buildTravelerFlightsFromPassengerRows(passengerRows) : buildTravelerFlightsFromSourceRows(entry.sources),
    sources,
    confidence: inferTravelerConfidenceFromCanonical(entry.profile, entry.sources)
  };
}

function buildTravelerDetailFromPassengerRows(
  requestedSlug: string,
  rows: BlueOriginPassenger[]
): BlueOriginTravelerDetail {
  const bestRow = pickBestTravelerRow(rows);
  const name = bestRow.name;
  const canonicalSlug = buildBlueOriginTravelerSlug(name);

  const roles = dedupeTextValues(rows.map((row) => normalizeBlueOriginTravelerRole(row.role)));
  const nationalities = dedupeTextValues(rows.map((row) => row.nationality || null));
  const bios = dedupeTextValues(rows.map((row) => row.bio || null));
  const profileUrls = dedupeTextValues(rows.map((row) => normalizeTravelerProfileUrl(row.profileUrl || null, row.source)));
  const imageUrls = dedupeTextValues(rows.map((row) => row.imageUrl || null));
  const sources = dedupeTextValues(rows.map((row) => row.source || null));

  return {
    slug: requestedSlug,
    canonicalSlug,
    name,
    roles,
    nationalities,
    bio: bios[0] || null,
    profileUrls,
    imageUrls,
    flights: buildTravelerFlightsFromPassengerRows(rows),
    sources,
    confidence: inferTravelerConfidenceFromPassengerRows(rows)
  };
}

function mapTravelerProfileRow(row: TravelerProfileRow): BlueOriginTravelerProfile {
  return {
    id: row.id,
    travelerSlug: row.traveler_slug,
    canonicalName: row.canonical_name,
    bioShort: normalizeText(row.bio_short),
    primaryImageUrl: normalizeText(row.primary_image_url),
    primaryProfileUrl: normalizeText(row.primary_profile_url),
    nationality: normalizeText(row.nationality),
    sourceConfidence: normalizeConfidence(row.source_confidence),
    metadata: row.metadata || {},
    updatedAt: normalizeText(row.updated_at)
  };
}

function mapTravelerSourceRow(row: TravelerSourceRow): BlueOriginTravelerSource | null {
  const slug = parseBlueOriginTravelerSlug(row.traveler_slug);
  if (!slug) return null;

  return {
    id: row.id,
    sourceKey: row.source_key,
    travelerSlug: slug,
    launchId: normalizeText(row.launch_id),
    flightCode: normalizeFlightCode(row.flight_code),
    sourceType: normalizeText(row.source_type) || 'unknown',
    sourceUrl: normalizeText(row.source_url),
    sourceDocumentId: normalizeText(row.source_document_id),
    profileUrl: normalizeText(row.profile_url),
    imageUrl: normalizeText(row.image_url),
    bioFull: normalizeText(row.bio_full),
    bioExcerpt: normalizeText(row.bio_excerpt),
    attribution: row.attribution || {},
    confidence: normalizeConfidence(row.confidence),
    contentSha256: normalizeText(row.content_sha256),
    capturedAt: normalizeText(row.captured_at),
    metadata: row.metadata || {},
    updatedAt: normalizeText(row.updated_at)
  };
}

function pickBestTravelerRow(rows: BlueOriginPassenger[]) {
  return [...rows].sort((left, right) => {
    const confidenceDelta = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;

    const rightScore = travelerRowScore(right);
    const leftScore = travelerRowScore(left);
    if (rightScore !== leftScore) return rightScore - leftScore;

    const leftDateMs = Date.parse(left.launchDate || '');
    const rightDateMs = Date.parse(right.launchDate || '');
    if (Number.isFinite(leftDateMs) && Number.isFinite(rightDateMs) && rightDateMs !== leftDateMs) {
      return rightDateMs - leftDateMs;
    }

    return right.name.length - left.name.length;
  })[0] as BlueOriginPassenger;
}

function travelerRowScore(row: BlueOriginPassenger) {
  let score = 0;
  if (row.profileUrl) score += 3;
  if (row.imageUrl) score += 2;
  if (row.bio) score += 2;
  if (row.nationality) score += 1;
  if (row.role) score += 1;
  return score;
}

function inferTravelerConfidenceFromPassengerRows(rows: BlueOriginPassenger[]) {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, confidenceRank(row.confidence));
  }
  if (max >= 3) return 'high';
  if (max === 2) return 'medium';
  return 'low';
}

function inferTravelerConfidenceFromCanonical(
  profile: BlueOriginTravelerProfile,
  sources: BlueOriginTravelerSource[]
) {
  let max = confidenceRank(profile.sourceConfidence);
  for (const source of sources) {
    max = Math.max(max, confidenceRank(source.confidence));
  }
  if (max >= 3) return 'high';
  if (max === 2) return 'medium';
  return 'low';
}

function buildTravelerFlightsFromPassengerRows(rows: BlueOriginPassenger[]) {
  const byKey = new Map<
    string,
    {
      launchId: string | null;
      flightCode: string | null;
      launchName: string | null;
      launchDate: string | null;
      roles: Set<string>;
      sources: Set<string>;
      confidence: 'high' | 'medium' | 'low';
    }
  >();

  for (const row of rows) {
    const key = buildPassengerFlightKey(row);
    const existing = byKey.get(key);
    const normalizedRole = normalizeBlueOriginTravelerRole(row.role);
    if (!existing) {
      byKey.set(key, {
        launchId: row.launchId || null,
        flightCode: row.flightCode || null,
        launchName: row.launchName || null,
        launchDate: row.launchDate || null,
        roles: new Set<string>(normalizedRole ? [normalizedRole] : []),
        sources: new Set<string>(row.source ? [row.source] : []),
        confidence: row.confidence
      });
      continue;
    }

    if (!existing.launchId && row.launchId) existing.launchId = row.launchId;
    if (!existing.flightCode && row.flightCode) existing.flightCode = row.flightCode;
    if (!existing.launchName && row.launchName) existing.launchName = row.launchName;
    if (!existing.launchDate && row.launchDate) existing.launchDate = row.launchDate;
    if (normalizedRole) existing.roles.add(normalizedRole);
    if (row.source) existing.sources.add(row.source);
    if (confidenceRank(row.confidence) > confidenceRank(existing.confidence)) {
      existing.confidence = row.confidence;
    }
  }

  return sortTravelerFlightRecords(
    [...byKey.entries()].map(([key, value]) =>
      toTravelerFlightRecord({
        key,
        launchId: value.launchId,
        flightCode: value.flightCode,
        launchName: value.launchName,
        launchDate: value.launchDate,
        roles: [...value.roles],
        sources: [...value.sources],
        confidence: value.confidence
      })
    )
  );
}

function buildTravelerFlightsFromSourceRows(rows: BlueOriginTravelerSource[]) {
  const byKey = new Map<
    string,
    {
      launchId: string | null;
      flightCode: string | null;
      launchName: string | null;
      launchDate: string | null;
      roles: Set<string>;
      sources: Set<string>;
      confidence: 'high' | 'medium' | 'low';
    }
  >();

  for (const row of rows) {
    const key = buildSourceFlightKey(row);
    const existing = byKey.get(key);
    const role = normalizeBlueOriginTravelerRole(
      readObjectText(row.attribution, ['role']) || readObjectText(row.metadata, ['role'])
    );
    const launchName =
      readObjectText(row.metadata, ['launchName', 'launch_name']) ||
      readObjectText(row.attribution, ['launchName', 'launch_name']) ||
      null;
    const launchDate =
      readObjectText(row.metadata, ['launchDate', 'launch_date']) ||
      row.capturedAt ||
      null;

    if (!existing) {
      byKey.set(key, {
        launchId: row.launchId,
        flightCode: row.flightCode,
        launchName,
        launchDate,
        roles: new Set<string>(role ? [role] : []),
        sources: new Set<string>(row.sourceType ? [row.sourceType] : []),
        confidence: row.confidence
      });
      continue;
    }

    if (!existing.launchId && row.launchId) existing.launchId = row.launchId;
    if (!existing.flightCode && row.flightCode) existing.flightCode = row.flightCode;
    if (!existing.launchName && launchName) existing.launchName = launchName;
    if (!existing.launchDate && launchDate) existing.launchDate = launchDate;
    if (role) existing.roles.add(role);
    if (row.sourceType) existing.sources.add(row.sourceType);
    if (confidenceRank(row.confidence) > confidenceRank(existing.confidence)) {
      existing.confidence = row.confidence;
    }
  }

  return sortTravelerFlightRecords(
    [...byKey.entries()].map(([key, value]) =>
      toTravelerFlightRecord({
        key,
        launchId: value.launchId,
        flightCode: value.flightCode,
        launchName: value.launchName,
        launchDate: value.launchDate,
        roles: [...value.roles],
        sources: [...value.sources],
        confidence: value.confidence
      })
    )
  );
}

function toTravelerFlightRecord(row: {
  key: string;
  launchId: string | null;
  flightCode: string | null;
  launchName: string | null;
  launchDate: string | null;
  roles: string[];
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
}): BlueOriginTravelerFlightRecord {
  const fallbackName =
    row.launchName ||
    (row.flightCode ? `Blue Origin ${row.flightCode.toUpperCase()}` : 'Blue Origin launch');
  const launchHref = row.launchId
    ? buildLaunchHref({ id: row.launchId, name: fallbackName, slug: undefined })
    : null;

  return {
    key: row.key,
    launchId: row.launchId,
    flightCode: row.flightCode,
    launchName: row.launchName,
    launchDate: row.launchDate,
    launchHref,
    roles: row.roles,
    sources: row.sources,
    confidence: row.confidence
  };
}

function sortTravelerFlightRecords(rows: BlueOriginTravelerFlightRecord[]) {
  return [...rows].sort((left, right) => {
    const leftDate = Date.parse(left.launchDate || '');
    const rightDate = Date.parse(right.launchDate || '');
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && rightDate !== leftDate) {
      return rightDate - leftDate;
    }
    if (left.flightCode && right.flightCode && left.flightCode !== right.flightCode) {
      return right.flightCode.localeCompare(left.flightCode, undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    }
    return (right.launchName || '').localeCompare(left.launchName || '');
  });
}

function buildPassengerFlightKey(row: BlueOriginPassenger) {
  const launchId = normalizeKeyValue(row.launchId);
  if (launchId) return `launch:${launchId}`;

  const flightCode = normalizeKeyValue(row.flightCode);
  if (flightCode) return `flight:${flightCode}`;

  const name = normalizeKeyValue(row.launchName);
  const launchDate = normalizeIsoDateKey(row.launchDate);
  return `name:${name || 'na'}:${launchDate || 'na'}`;
}

function buildSourceFlightKey(row: BlueOriginTravelerSource) {
  const launchId = normalizeKeyValue(row.launchId);
  if (launchId) return `launch:${launchId}`;

  const flightCode = normalizeKeyValue(row.flightCode);
  if (flightCode) return `flight:${flightCode}`;

  return `source:${normalizeKeyValue(row.sourceKey) || row.id}`;
}

function dedupeTextValues(items: Array<string | null>) {
  const seen = new Set<string>();
  const values: string[] = [];

  for (const item of items) {
    const normalized = String(item || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }

  return values;
}

function normalizeTravelerProfileUrl(url: string | null | undefined, sourceType?: string | null) {
  if (isOpenSourceTravelerSourceType(sourceType)) return null;
  const normalized = normalizeBlueOriginTravelerProfileUrl(url);
  if (!normalized) return null;
  if (isBlueOriginOpenSourceProfileUrl(normalized)) return null;
  return normalized;
}

function isOpenSourceTravelerSourceType(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.startsWith('ll2') ||
    normalized.startsWith('wikipedia') ||
    normalized.includes('open-source') ||
    normalized.includes('opensource')
  );
}

function confidenceRank(value: BlueOriginPassenger['confidence']) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
}

function normalizeText(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeFlightCode(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (/^(ns|ng)-\d{1,3}$/.test(normalized)) return normalized;
  return normalized;
}

function normalizeKeyValue(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function normalizeIsoDateKey(value: string | null | undefined) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function readObjectText(
  value: Record<string, unknown> | null | undefined,
  keys: string[]
) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim();
    if (normalized) return normalized;
  }
  return null;
}

function buildTravelerDirectory(items: BlueOriginPassenger[]): TravelerDirectory {
  const directory: TravelerDirectory = new Map();

  for (const item of items) {
    const explicitSlug = parseBlueOriginTravelerSlug(item.travelerSlug || null);
    const slug = explicitSlug || parseBlueOriginTravelerSlug(buildBlueOriginTravelerSlug(item.name));
    if (!slug) continue;

    const existing = directory.get(slug);
    if (existing) {
      existing.push(item);
      continue;
    }

    directory.set(slug, [item]);
  }

  return directory;
}

function shouldSuppressBlueOriginCrewDetail(detail: Pick<BlueOriginTravelerDetail, 'name' | 'roles'>) {
  return isBlueOriginNonHumanCrewEntry(detail.name, detail.roles.join(' '));
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const out = [] as T[][];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isMissingCanonicalTravelerSchema(error: unknown) {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: string }).message || '')
      : String(error || '');
  return (
    /blue_origin_travelers|blue_origin_traveler_sources/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  );
}
