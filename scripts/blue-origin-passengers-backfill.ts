import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fetchBlueOriginPassengers } from '@/lib/server/blueOriginPeoplePayloads';
import type { BlueOriginPassenger } from '@/lib/types/blueOrigin';
import {
  buildBlueOriginTravelerSlug,
  extractBlueOriginFlightCodeFromText,
  isBlueOriginOpenSourceProfileUrl,
  normalizeBlueOriginTravelerProfileUrl,
  normalizeBlueOriginTravelerRole,
  type BlueOriginMissionKey
} from '@/lib/utils/blueOrigin';

type LaunchCacheRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  provider: string | null;
};

type PassengerUpsertRow = {
  mission_key: BlueOriginMissionKey;
  flight_code: string | null;
  flight_slug: string | null;
  traveler_slug: string;
  name: string;
  role: string | null;
  nationality: string | null;
  launch_id: string;
  launch_name: string | null;
  launch_date: string | null;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updated_at: string;
};

type TravelerProfileUpsertRow = {
  traveler_slug: string;
  canonical_name: string;
  bio_short: string | null;
  primary_image_url: string | null;
  primary_profile_url: string | null;
  nationality: string | null;
  source_confidence: 'high' | 'medium' | 'low';
  metadata: Record<string, unknown>;
  updated_at: string;
};

type TravelerSourceUpsertRow = {
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
  attribution: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low';
  content_sha256: string | null;
  captured_at: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

const BLUE_ORIGIN_OR_FILTER = [
  'provider.ilike.%Blue Origin%',
  'name.ilike.%Blue Origin%',
  'mission_name.ilike.%Blue Origin%',
  'name.ilike.%New Shepard%',
  'mission_name.ilike.%New Shepard%',
  'name.ilike.%New Glenn%',
  'mission_name.ilike.%New Glenn%',
  'name.ilike.%Blue Moon%',
  'mission_name.ilike.%Blue Moon%',
  'name.ilike.%Blue Ring%',
  'mission_name.ilike.%Blue Ring%'
].join(',');

const UPSERT_CHUNK_SIZE = 500;

async function main() {
  const url = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase configuration (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

  const launchRows = await fetchBlueOriginLaunches(supabase);
  const launchById = new Map<string, LaunchCacheRow>();
  const launchesByFlightCode = new Map<string, LaunchCacheRow[]>();
  for (const row of launchRows) {
    launchById.set(row.launch_id, row);
    const code = resolveFlightCode(row.name, row.mission_name);
    if (!code) continue;
    const existing = launchesByFlightCode.get(code);
    if (existing) {
      existing.push(row);
    } else {
      launchesByFlightCode.set(code, [row]);
    }
  }

  const passengers = await fetchBlueOriginPassengers('all');
  const normalizedRows = normalizePassengerRows(passengers.items, launchById, launchesByFlightCode);
  const dedupedRows = dedupePassengerRows(normalizedRows);

  if (!dedupedRows.length) {
    console.log('[blue-origin-passengers-backfill] no rows to upsert');
    return;
  }

  await upsertPassengerRows(supabase, dedupedRows);
  console.log(`[blue-origin-passengers-backfill] upserted ${dedupedRows.length} passenger rows`);

  const travelerProfiles = buildTravelerProfileRows(dedupedRows);
  const travelerSources = buildTravelerSourceRows(dedupedRows);
  await upsertTravelerCanonicalRows(supabase, travelerProfiles, travelerSources);

  const nsCoverage = summarizeNewShepardCoverage(dedupedRows, 1, 17);
  for (const entry of nsCoverage) {
    console.log(`${entry.flightCode}: travelers=${entry.travelers}`);
    if (entry.names.length) {
      console.log(`  ${entry.names.join(', ')}`);
    }
  }
}

function sanitizeEnvValue(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

async function fetchBlueOriginLaunches(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id,name,mission_name,net,provider')
    .or(BLUE_ORIGIN_OR_FILTER)
    .order('net', { ascending: true })
    .limit(1600);

  if (error) throw error;
  return (data || []) as LaunchCacheRow[];
}

function normalizePassengerRows(
  rows: BlueOriginPassenger[],
  launchById: Map<string, LaunchCacheRow>,
  launchesByFlightCode: Map<string, LaunchCacheRow[]>
) {
  const nowIso = new Date().toISOString();
  const normalized: PassengerUpsertRow[] = [];

  for (const row of rows) {
    const name = String(row.name || '').trim();
    if (!name) continue;

    const missionKey = row.missionKey;
    const flightCode = resolveFlightCode(row.flightCode, row.launchName);
    if (!flightCode) continue;

    const explicitLaunchId = String(row.launchId || '').trim();
    const launchRow =
      (explicitLaunchId ? launchById.get(explicitLaunchId) : null) ||
      chooseClosestLaunch(launchesByFlightCode.get(flightCode) || [], row.launchDate);
    if (!launchRow?.launch_id) continue;

    const metadata: Record<string, unknown> = {
      profileUrl: normalizeTravelerProfileUrl(row.profileUrl || null),
      imageUrl: row.imageUrl || null,
      bio: row.bio || null,
      launchName: launchRow.name || row.launchName || null,
      launchDate: launchRow.net || row.launchDate || null,
      backfilledAt: nowIso
    };

    normalized.push({
      mission_key: missionKey,
      flight_code: flightCode,
      flight_slug: flightCode,
      traveler_slug: row.travelerSlug || buildBlueOriginTravelerSlug(name),
      name,
      role: normalizeBlueOriginTravelerRole(row.role),
      nationality: row.nationality || null,
      launch_id: launchRow.launch_id,
      launch_name: launchRow.name || row.launchName || null,
      launch_date: launchRow.net || row.launchDate || null,
      source: row.source || 'script:blue-origin-passengers-backfill',
      confidence: row.confidence || 'medium',
      metadata,
      updated_at: nowIso
    });
  }

  return normalized;
}

function dedupePassengerRows(rows: PassengerUpsertRow[]) {
  const deduped = new Map<string, PassengerUpsertRow>();

  for (const row of rows) {
    const key = `${row.launch_id}:${normalizeNameKey(row.name)}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, row);
      continue;
    }

    const preferred = preferPassengerRow(existing, row);
    deduped.set(key, preferred);
  }

  return [...deduped.values()].sort((left, right) => {
    const leftDate = Date.parse(left.launch_date || '');
    const rightDate = Date.parse(right.launch_date || '');
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) {
      return leftDate - rightDate;
    }
    return left.name.localeCompare(right.name);
  });
}

async function upsertPassengerRows(
  supabase: ReturnType<typeof createClient>,
  rows: PassengerUpsertRow[]
) {
  for (let index = 0; index < rows.length; index += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + UPSERT_CHUNK_SIZE);
    let { error } = await supabase.from('blue_origin_passengers').upsert(chunk, {
      onConflict: 'launch_id,name_normalized'
    });

    if (error && isMissingTravelerSlugColumn(error)) {
      const fallbackChunk = chunk.map(({ traveler_slug: _, ...rest }) => rest);
      ({ error } = await supabase.from('blue_origin_passengers').upsert(fallbackChunk, {
        onConflict: 'launch_id,name_normalized'
      }));
    }

    if (error) throw error;
  }
}

async function upsertTravelerCanonicalRows(
  supabase: ReturnType<typeof createClient>,
  profileRows: TravelerProfileUpsertRow[],
  sourceRows: TravelerSourceUpsertRow[]
) {
  if (!profileRows.length) return;

  try {
    for (let index = 0; index < profileRows.length; index += UPSERT_CHUNK_SIZE) {
      const chunk = profileRows.slice(index, index + UPSERT_CHUNK_SIZE);
      const { error } = await supabase.from('blue_origin_travelers').upsert(chunk, {
        onConflict: 'traveler_slug'
      });
      if (error) throw error;
    }

    for (let index = 0; index < sourceRows.length; index += UPSERT_CHUNK_SIZE) {
      const chunk = sourceRows.slice(index, index + UPSERT_CHUNK_SIZE);
      const { error } = await supabase.from('blue_origin_traveler_sources').upsert(chunk, {
        onConflict: 'source_key'
      });
      if (error) throw error;
    }

    console.log(
      `[blue-origin-passengers-backfill] upserted ${profileRows.length} traveler profiles and ${sourceRows.length} traveler sources`
    );
  } catch (error) {
    if (isMissingTravelerCanonicalSchema(error)) {
      console.warn(
        `[blue-origin-passengers-backfill] skipped traveler canonical upserts: ${stringifyError(error)}`
      );
      return;
    }
    throw error;
  }
}

function preferPassengerRow(left: PassengerUpsertRow, right: PassengerUpsertRow) {
  const leftScore = passengerRowScore(left);
  const rightScore = passengerRowScore(right);
  if (rightScore > leftScore) return mergePassengerRow(right, left);
  return mergePassengerRow(left, right);
}

function passengerRowScore(row: PassengerUpsertRow) {
  let score = 0;
  if (row.source.toLowerCase().startsWith('blue-origin-wayback:new-shepard-mission-page')) score += 50;
  if (row.source.toLowerCase().startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) score += 45;
  if (row.source.toLowerCase().startsWith('ll2-api:')) score += 40;
  if (row.source.toLowerCase().startsWith('wikipedia:')) score += 25;
  if (row.confidence === 'high') score += 12;
  if (row.confidence === 'medium') score += 8;
  if (hasText(readTravelerProfileUrl(row.metadata, ['profileUrl', 'profile_url']))) score += 5;
  if (hasText(readMetadataUrl(row.metadata, ['imageUrl', 'image_url']))) score += 4;
  if (hasText(readMetadataText(row.metadata, ['bio', 'summary', 'description']))) score += 3;
  return score;
}

function mergePassengerRow(primary: PassengerUpsertRow, secondary: PassengerUpsertRow): PassengerUpsertRow {
  const mergedMeta = { ...secondary.metadata, ...primary.metadata };
  return {
    ...primary,
    traveler_slug: primary.traveler_slug || secondary.traveler_slug || buildBlueOriginTravelerSlug(primary.name),
    role: primary.role || secondary.role || null,
    nationality: primary.nationality || secondary.nationality || null,
    launch_name: primary.launch_name || secondary.launch_name || null,
    launch_date: primary.launch_date || secondary.launch_date || null,
    metadata: mergedMeta
  };
}

function buildTravelerProfileRows(rows: PassengerUpsertRow[]) {
  const grouped = new Map<string, PassengerUpsertRow[]>();
  for (const row of rows) {
    const slug = row.traveler_slug || buildBlueOriginTravelerSlug(row.name);
    const bucket = grouped.get(slug) || [];
    bucket.push(row);
    grouped.set(slug, bucket);
  }

  const nowIso = new Date().toISOString();
  const profiles: TravelerProfileUpsertRow[] = [];
  for (const [slug, bucket] of grouped.entries()) {
    const sorted = [...bucket].sort((left, right) => passengerRowScore(right) - passengerRowScore(left));
    const best = sorted[0] as PassengerUpsertRow;
    const profileUrls = dedupeText(
      sorted.map((row) => readTravelerProfileUrl(row.metadata, ['profileUrl', 'profile_url', 'wiki']))
    );
    const imageUrls = dedupeText(
      sorted.map((row) =>
        readMetadataUrl(row.metadata, ['imageUrl', 'image_url', 'profileImage', 'profile_image'])
      )
    );
    const bios = dedupeText(sorted.map((row) => readMetadataText(row.metadata, ['bio', 'summary', 'description'])));
    const nationalities = dedupeText(sorted.map((row) => row.nationality));
    const flightCodes = dedupeText(sorted.map((row) => row.flight_code));
    const sourceTypes = dedupeText(sorted.map((row) => normalizeSourceType(row.source)));

    profiles.push({
      traveler_slug: slug,
      canonical_name: best.name,
      bio_short: trimText(bios[0] || null, 1200),
      primary_image_url: imageUrls[0] || null,
      primary_profile_url: profileUrls[0] || null,
      nationality: nationalities[0] || null,
      source_confidence: highestConfidence(sorted.map((row) => row.confidence)),
      metadata: {
        sourceCount: sorted.length,
        launchCount: new Set(sorted.map((row) => row.launch_id)).size,
        flightCodes,
        sourceTypes,
        generatedBy: 'blue-origin-passengers-backfill'
      },
      updated_at: nowIso
    });
  }

  return profiles;
}

function buildTravelerSourceRows(rows: PassengerUpsertRow[]) {
  const nowIso = new Date().toISOString();
  const deduped = new Map<string, TravelerSourceUpsertRow>();

  for (const row of rows) {
    const profileUrl = readTravelerProfileUrl(row.metadata, ['profileUrl', 'profile_url', 'wiki']) || null;
    const imageUrl =
      readMetadataUrl(row.metadata, ['imageUrl', 'image_url', 'profileImage', 'profile_image']) || null;
    const bioFull = trimText(readMetadataText(row.metadata, ['bio', 'summary', 'description']), 8000);
    const sourceUrl =
      profileUrl ||
      readTravelerProfileUrl(row.metadata, ['sourceUrl', 'source_url', 'url', 'missionUrl', 'mission_url']) ||
      null;
    const sourceType = normalizeSourceType(row.source);
    const sourceSeed = [
      row.traveler_slug,
      row.launch_id || 'na',
      row.flight_code || 'na',
      sourceType,
      profileUrl || 'na',
      imageUrl || 'na',
      trimText(bioFull, 260) || 'na'
    ].join('|');
    const sourceKey = `bo-traveler-source:${sha256Hex(sourceSeed)}`;

    deduped.set(sourceKey, {
      source_key: sourceKey,
      traveler_slug: row.traveler_slug,
      launch_id: row.launch_id,
      flight_code: row.flight_code,
      source_type: sourceType,
      source_url: sourceUrl,
      source_document_id: null,
      profile_url: profileUrl,
      image_url: imageUrl,
      bio_full: bioFull || null,
      bio_excerpt: trimText(bioFull, 460),
      attribution: {
        source: row.source,
        role: row.role || null,
        nationality: row.nationality || null,
        launchName: row.launch_name || null
      },
      confidence: row.confidence,
      content_sha256: sha256Hex([profileUrl || '', imageUrl || '', bioFull || '', row.name].join('|')),
      captured_at: normalizeIsoText(readMetadataText(row.metadata, ['capturedAt', 'captured_at', 'backfilledAt', 'backfilled_at']) || row.launch_date),
      metadata: {
        missionKey: row.mission_key,
        launchName: row.launch_name || null,
        generatedBy: 'blue-origin-passengers-backfill'
      },
      updated_at: nowIso
    });
  }

  return [...deduped.values()];
}

function resolveFlightCode(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const direct = String(value || '').trim().toLowerCase();
    if (/^(ns|ng)-\d{1,3}$/.test(direct)) return direct;
    const extracted = extractBlueOriginFlightCodeFromText(value);
    if (extracted) return extracted;
  }
  return null;
}

function chooseClosestLaunch(rows: LaunchCacheRow[], launchDate: string | null) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0] as LaunchCacheRow;

  const targetMs = Date.parse(String(launchDate || ''));
  if (!Number.isFinite(targetMs)) return rows[0] as LaunchCacheRow;

  let best = rows[0] as LaunchCacheRow;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const rowMs = Date.parse(String(row.net || ''));
    if (!Number.isFinite(rowMs)) continue;
    const delta = Math.abs(rowMs - targetMs);
    if (delta < bestDelta) {
      best = row;
      bestDelta = delta;
    }
  }
  return best;
}

function normalizeNameKey(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function summarizeNewShepardCoverage(rows: PassengerUpsertRow[], start: number, end: number) {
  const byCode = new Map<string, Set<string>>();
  for (const row of rows) {
    const code = resolveFlightCode(row.flight_code);
    if (!code || !code.startsWith('ns-')) continue;
    const bucket = byCode.get(code) || new Set<string>();
    bucket.add(row.name);
    byCode.set(code, bucket);
  }

  const coverage: Array<{ flightCode: string; travelers: number; names: string[] }> = [];
  for (let flight = start; flight <= end; flight += 1) {
    const code = `ns-${flight}`;
    const names = [...(byCode.get(code) || new Set<string>())];
    coverage.push({
      flightCode: code,
      travelers: names.length,
      names: names.slice(0, 8)
    });
  }
  return coverage;
}

function readMetadataUrl(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (!normalized) continue;
    try {
      return new URL(normalized).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function readTravelerProfileUrl(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    const normalized = normalizeTravelerProfileUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeTravelerProfileUrl(value: string | null | undefined) {
  const normalized = normalizeBlueOriginTravelerProfileUrl(value);
  if (!normalized) return null;
  if (isBlueOriginOpenSourceProfileUrl(normalized)) return null;
  return normalized;
}

function readMetadataText(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'string') continue;
    const normalized = value.trim().replace(/\s+/g, ' ');
    if (normalized) return normalized;
  }
  return null;
}

function dedupeText(values: Array<string | null>) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function highestConfidence(values: Array<'high' | 'medium' | 'low'>): 'high' | 'medium' | 'low' {
  if (values.includes('high')) return 'high';
  if (values.includes('medium')) return 'medium';
  return 'low';
}

function normalizeSourceType(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized.startsWith('blue-origin-wayback:new-shepard-mission-page')) return 'blue_origin_mission_page';
  if (normalized.startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) return 'blue_origin_astronaut_directory';
  if (normalized.startsWith('wikipedia:')) return 'wikipedia';
  if (normalized.startsWith('ll2')) return 'll2';
  return normalized.replace(/[^a-z0-9_.-]/g, '-').slice(0, 80) || 'unknown';
}

function trimText(value: string | null | undefined, limit: number) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function normalizeIsoText(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isMissingTravelerSlugColumn(error: unknown) {
  const message = stringifyError(error);
  return /traveler_slug/i.test(message) && /(column|schema|cache|exist|unknown)/i.test(message);
}

function isMissingTravelerCanonicalSchema(error: unknown) {
  const message = stringifyError(error);
  return (
    /blue_origin_travelers|blue_origin_traveler_sources/i.test(message) ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  );
}

function stringifyError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || 'unknown');
  }
  return String(error || 'unknown');
}

main().catch((error) => {
  console.error('[blue-origin-passengers-backfill] failed', error);
  process.exit(1);
});
