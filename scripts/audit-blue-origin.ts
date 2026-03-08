import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildBlueOriginTravelerIdentityKey,
  extractBlueOriginFlightCodeFromText
} from '@/lib/utils/blueOrigin';

config({ path: '.env.local' });
config();

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

const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE = 'blueorigin_multisource';
const BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPES = [
  'bo_official_sources',
  'bo_manifest_passengers',
  'bo_manifest_payloads',
  'bo_mission_facts'
] as const;

const INVALID_SOURCE_STATUS_CODES = new Set([404, 410, 451]);
const DEFAULT_LAUNCH_LIMIT = 1600;
const DEFAULT_URL_CHECK_LIMIT = 2500;
const FETCH_TIMEOUT_MS = 20_000;
const URL_CHECK_CONCURRENCY = 6;
const NEW_SHEPARD_TRAVELER_CAPACITY = 6;

type LaunchRow = {
  launch_id: string;
  ll2_launch_uuid: string | null;
  name: string | null;
  mission_name: string | null;
  mission_description: string | null;
  net: string | null;
  provider: string | null;
};

type PassengerRow = {
  id: string;
  mission_key: string | null;
  flight_code: string | null;
  launch_id: string | null;
  launch_date: string | null;
  name: string | null;
  role: string | null;
  nationality: string | null;
  source: string | null;
  confidence: string | null;
  metadata: unknown;
};

type PayloadRow = {
  id: string;
  mission_key: string | null;
  flight_code: string | null;
  launch_id: string | null;
  launch_date: string | null;
  name: string | null;
  payload_type: string | null;
  orbit: string | null;
  agency: string | null;
  source: string | null;
  confidence: string | null;
};

type ConstraintRow = {
  launch_id: string;
  constraint_type: string;
  data: any;
  fetched_at: string | null;
};

type UrlCheck = {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  kind: 'ok' | 'broken' | 'error';
  error?: string;
};

type AuditLaunchRecord = {
  launchId: string;
  ll2LaunchUuid: string | null;
  flightCode: string | null;
  name: string | null;
  missionName: string | null;
  net: string | null;

  passengers: {
    total: number;
    verifiedForManifest: number;
    verifiedForLaunchDetail: number;
    sample: Array<{
      name: string;
      role: string | null;
      source: string | null;
      confidence: string | null;
    }>;
  };

  payloads: {
    total: number;
    verifiedForManifest: number;
    verifiedForLaunchDetail: number;
    sample: Array<{
      name: string;
      payloadType: string | null;
      agency: string | null;
      source: string | null;
      confidence: string | null;
    }>;
  };

  enhancements: {
    missionSummary: string | null;
    failureReason: string | null;
    officialSourcePages: Array<{
      canonicalUrl: string | null;
      url: string | null;
      provenance: string | null;
      archiveSnapshotUrl: string | null;
      title: string | null;
      fetchedAt: string | null;
    }>;
  };

  officialSourceHealth: {
    checked: number;
    broken: number;
    errors: number;
  };

  anomalies: string[];
};

const { values } = parseArgs({
  options: {
    limit: { type: 'string', default: String(DEFAULT_LAUNCH_LIMIT) },
    launchId: { type: 'string' },
    flightCode: { type: 'string' },
    checkUrls: { type: 'boolean' },
    skipUrlChecks: { type: 'boolean' },
    urlLimit: { type: 'string', default: String(DEFAULT_URL_CHECK_LIMIT) },
    outJson: { type: 'string', default: 'tmp/blue-origin-audit.json' },
    outCsv: { type: 'string', default: 'tmp/blue-origin-audit.csv' }
  }
});

async function main() {
  const supabaseUrl = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const limit = clampInt(Number(values.limit || DEFAULT_LAUNCH_LIMIT), 1, 5000);
  const targetLaunchId = normalizeOptionalText(values.launchId) || null;
  const targetFlightCode = normalizeOptionalText(values.flightCode)?.toLowerCase() || null;
  const shouldCheckUrls = Boolean(values.checkUrls ?? !values.skipUrlChecks);
  const urlLimit = clampInt(Number(values.urlLimit || DEFAULT_URL_CHECK_LIMIT), 1, 50_000);
  const outJson = normalizeOptionalText(values.outJson) || 'tmp/blue-origin-audit.json';
  const outCsv = normalizeOptionalText(values.outCsv) || 'tmp/blue-origin-audit.csv';

  const { data: launchRows, error: launchError } = await supabase
    .from('launches_public_cache')
    .select('launch_id,ll2_launch_uuid,name,mission_name,mission_description,net,provider')
    .or(BLUE_ORIGIN_OR_FILTER)
    .order('net', { ascending: false })
    .limit(limit);
  if (launchError) throw launchError;

  let launches = (launchRows || []) as LaunchRow[];
  if (targetLaunchId) {
    launches = launches.filter((row) => normalizeOptionalText(row.launch_id) === targetLaunchId);
  }

  if (targetFlightCode) {
    launches = launches.filter((row) => {
      const combined = `${row.name || ''} ${row.mission_name || ''}`;
      const code = normalizeOptionalText(extractBlueOriginFlightCodeFromText(combined))?.toLowerCase() || null;
      return code === targetFlightCode;
    });
  }

  const launchIds = [...new Set(launches.map((row) => normalizeOptionalText(row.launch_id)).filter((id): id is string => Boolean(id)))];

  const { data: passengerRows, error: passengerError } = await supabase
    .from('blue_origin_passengers')
    .select('id,mission_key,flight_code,launch_id,launch_date,name,role,nationality,source,confidence,metadata')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .limit(10_000);
  if (passengerError) throw passengerError;
  const passengers = (passengerRows || []) as PassengerRow[];

  const { data: payloadRows, error: payloadError } = await supabase
    .from('blue_origin_payloads')
    .select('id,mission_key,flight_code,launch_id,launch_date,name,payload_type,orbit,agency,source,confidence')
    .order('launch_date', { ascending: false, nullsFirst: false })
    .limit(20_000);
  if (payloadError) throw payloadError;
  const payloads = (payloadRows || []) as PayloadRow[];

  const constraintsByLaunchId = new Map<string, ConstraintRow[]>();
  if (launchIds.length > 0) {
    for (const chunk of chunkArray(launchIds, 200)) {
      const { data, error } = await supabase
        .from('launch_trajectory_constraints')
        .select('launch_id,constraint_type,data,fetched_at')
        .in('launch_id', chunk)
        .eq('source', BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_SOURCE)
        .in('constraint_type', [...BLUE_ORIGIN_MULTISOURCE_CONSTRAINT_TYPES])
        .order('fetched_at', { ascending: false })
        .limit(50_000);
      if (error) throw error;
      for (const row of (data || []) as ConstraintRow[]) {
        const id = normalizeOptionalText(row.launch_id);
        if (!id) continue;
        const existing = constraintsByLaunchId.get(id) || [];
        existing.push(row);
        constraintsByLaunchId.set(id, existing);
      }
    }
  }

  const urlCache = new Map<string, Promise<UrlCheck>>();
  const urlChecksRequested: string[] = [];

  const audit: AuditLaunchRecord[] = [];
  for (const launch of launches) {
    const launchId = normalizeOptionalText(launch.launch_id) || '';
    const combined = `${launch.name || ''} ${launch.mission_name || ''}`;
    const flightCode = normalizeOptionalText(extractBlueOriginFlightCodeFromText(combined))?.toLowerCase() || null;

  const matchedPassengers = passengers.filter((row) =>
      matchesBlueOriginLaunchRecord(launchId, flightCode, row.launch_id, row.flight_code)
    );
    const matchedPayloads = payloads.filter((row) =>
      matchesBlueOriginLaunchRecord(launchId, flightCode, row.launch_id, row.flight_code)
    );

    const verifiedManifestPassengers = matchedPassengers.filter(isVerifiedBlueOriginManifestPassengerRow);
    const verifiedLaunchDetailPassengers = matchedPassengers.filter(isVerifiedBlueOriginLaunchDetailPassengerRow);
    const verifiedManifestPayloads = matchedPayloads.filter(isVerifiedBlueOriginManifestPayloadRow);
    const verifiedLaunchDetailPayloads = matchedPayloads.filter(isVerifiedBlueOriginLaunchDetailPayloadRow);

    const manifestPassengerPayloads = verifiedManifestPassengers.filter(shouldTreatBlueOriginPassengerAsPayload);
    const manifestTravelerPassengers = verifiedManifestPassengers.filter((row) => !shouldTreatBlueOriginPassengerAsPayload(row));
    const launchDetailPassengerPayloads = verifiedLaunchDetailPassengers.filter(shouldTreatBlueOriginPassengerAsPayload);
    const launchDetailTravelerPassengers = verifiedLaunchDetailPassengers.filter((row) => !shouldTreatBlueOriginPassengerAsPayload(row));
    const manifestTravelerIdentityCount = countUniqueTravelerIdentities(manifestTravelerPassengers, flightCode);

    const constraints = constraintsByLaunchId.get(launchId) || [];
    const enhancements = readBlueOriginEnhancements(constraints);

    const sourcePages = enhancements.officialSourcePages;
    const openSourceUrls = sourcePages
      .map((page) => resolveBlueOriginSourcePageOpenUrl(page))
      .filter((url): url is string => Boolean(url));
    const urlsToCheck = shouldCheckUrls ? openSourceUrls.slice(0, 250) : [];

    for (const url of urlsToCheck) {
      if (urlChecksRequested.length >= urlLimit) break;
      if (!urlCache.has(url)) {
        urlChecksRequested.push(url);
        urlCache.set(url, checkUrl(url));
      }
    }

    const syntheticPayloadsFromSummary =
      verifiedManifestPayloads.length === 0
        ? deriveSyntheticPayloadNamesFromMissionSummary(enhancements.missionSummary)
        : [];

    const anomalies: string[] = [];
    if (manifestTravelerPassengers.length > 0 && launchDetailTravelerPassengers.length === 0) {
      anomalies.push('ghost_traveler_manifest_vs_launch_detail');
    }
    if (
      verifiedManifestPayloads.length + manifestPassengerPayloads.length + syntheticPayloadsFromSummary.length === 0 &&
      mentionsPayloadLikeWork(enhancements.missionSummary)
    ) {
      anomalies.push('mission_summary_mentions_payloads_but_manifest_payloads_empty');
    }
    if (sourcePages.length > 0 && openSourceUrls.length === 0) {
      anomalies.push('official_sources_present_but_no_clickable_urls');
    }
    if (manifestTravelerPassengers.length > manifestTravelerIdentityCount) {
      anomalies.push('traveler_manifest_contains_alias_duplicates');
    }
    if (isNewShepardFlight(flightCode) && manifestTravelerPassengers.length > NEW_SHEPARD_TRAVELER_CAPACITY) {
      anomalies.push('traveler_manifest_exceeds_new_shepard_capacity');
    }

    audit.push({
      launchId,
      ll2LaunchUuid: normalizeOptionalText(launch.ll2_launch_uuid),
      flightCode,
      name: normalizeOptionalText(launch.name),
      missionName: normalizeOptionalText(launch.mission_name),
      net: normalizeOptionalText(launch.net),
      passengers: {
        total: matchedPassengers.length,
        verifiedForManifest: manifestTravelerPassengers.length,
        verifiedForLaunchDetail: launchDetailTravelerPassengers.length,
        sample: matchedPassengers
          .slice(0, 8)
          .map((row) => ({
            name: normalizeOptionalText(row.name) || '',
            role: normalizeOptionalText(row.role),
            source: normalizeOptionalText(row.source),
            confidence: normalizeOptionalText(row.confidence)
          }))
          .filter((row) => row.name)
      },
      payloads: {
        total: matchedPayloads.length,
        verifiedForManifest: verifiedManifestPayloads.length + manifestPassengerPayloads.length + syntheticPayloadsFromSummary.length,
        verifiedForLaunchDetail: verifiedLaunchDetailPayloads.length + launchDetailPassengerPayloads.length,
        sample: matchedPayloads
          .slice(0, 8)
          .map((row) => ({
            name: normalizeOptionalText(row.name) || '',
            payloadType: normalizeOptionalText(row.payload_type),
            agency: normalizeOptionalText(row.agency),
            source: normalizeOptionalText(row.source),
            confidence: normalizeOptionalText(row.confidence)
          }))
          .filter((row) => row.name)
      },
      enhancements: {
        missionSummary: enhancements.missionSummary,
        failureReason: enhancements.failureReason,
        officialSourcePages: sourcePages
      },
      officialSourceHealth: {
        checked: 0,
        broken: 0,
        errors: 0
      },
      anomalies
    });
  }

  if (shouldCheckUrls && urlChecksRequested.length > 0) {
    const uniqueUrls = [...new Set(urlChecksRequested)].slice(0, urlLimit);
    const results = await mapWithConcurrency(uniqueUrls, URL_CHECK_CONCURRENCY, async (url) => {
      const promise = urlCache.get(url);
      return promise ? await promise : await checkUrl(url);
    });
    const checkByUrl = new Map(results.map((result) => [result.url, result]));

    for (const record of audit) {
      const urls = record.enhancements.officialSourcePages
        .map((page) => resolveBlueOriginSourcePageOpenUrl(page))
        .filter((url): url is string => Boolean(url));
      const checks = urls.map((url) => checkByUrl.get(url)).filter((entry): entry is UrlCheck => Boolean(entry));
      record.officialSourceHealth.checked = checks.length;
      record.officialSourceHealth.broken = checks.filter((entry) => entry.kind === 'broken').length;
      record.officialSourceHealth.errors = checks.filter((entry) => entry.kind === 'error').length;
      if (record.officialSourceHealth.broken > 0) record.anomalies.push('official_source_pages_include_broken_links');
    }
  }

  ensureParentDir(outJson);
  fs.writeFileSync(outJson, JSON.stringify({ generatedAt: new Date().toISOString(), launches: audit }, null, 2));
  ensureParentDir(outCsv);
  fs.writeFileSync(outCsv, toCsv(audit));

  const summary = summarizeAudit(audit);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

function summarizeAudit(records: AuditLaunchRecord[]) {
  const countByAnomaly = new Map<string, number>();
  for (const record of records) {
    for (const anomaly of record.anomalies) {
      countByAnomaly.set(anomaly, (countByAnomaly.get(anomaly) || 0) + 1);
    }
  }
  const anomalies = [...countByAnomaly.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));

  const brokenSources = records.filter((r) => r.officialSourceHealth.broken > 0).length;
  const ghostTravelers = records.filter((r) => r.anomalies.includes('ghost_traveler_manifest_vs_launch_detail')).length;
  const overCapacityTravelerManifests = records.filter((r) =>
    r.anomalies.includes('traveler_manifest_exceeds_new_shepard_capacity')
  ).length;
  const payloadSummaryMismatches = records.filter((r) =>
    r.anomalies.includes('mission_summary_mentions_payloads_but_manifest_payloads_empty')
  ).length;

  return {
    launchesScanned: records.length,
    launchesWithBrokenOfficialSources: brokenSources,
    ghostTravelerMismatches: ghostTravelers,
    overCapacityTravelerManifests,
    missionSummaryPayloadMismatches: payloadSummaryMismatches,
    anomalies
  };
}

function ensureParentDir(filePath: string) {
  const dir = path.dirname(path.resolve(filePath));
  fs.mkdirSync(dir, { recursive: true });
}

function toCsv(records: AuditLaunchRecord[]) {
  const headers = [
    'launchId',
    'flightCode',
    'name',
    'net',
    'passengersTotal',
    'passengersVerifiedManifest',
    'passengersVerifiedLaunchDetail',
    'payloadsTotal',
    'payloadsVerifiedManifest',
    'payloadsVerifiedLaunchDetail',
    'officialSources',
    'officialSourcesBroken',
    'anomalies'
  ];
  const rows = records.map((r) => [
    r.launchId,
    r.flightCode || '',
    r.name || '',
    r.net || '',
    String(r.passengers.total),
    String(r.passengers.verifiedForManifest),
    String(r.passengers.verifiedForLaunchDetail),
    String(r.payloads.total),
    String(r.payloads.verifiedForManifest),
    String(r.payloads.verifiedForLaunchDetail),
    String(r.enhancements.officialSourcePages.length),
    String(r.officialSourceHealth.broken),
    r.anomalies.join('|')
  ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function csvEscape(value: string) {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/\"/g, '""')}"`;
  }
  return raw;
}

function sanitizeEnvValue(value: string | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeOptionalText(value: unknown) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function normalizeLower(value: unknown) {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toLowerCase() : null;
}

function matchesBlueOriginLaunchRecord(
  launchId: string | null,
  flightCode: string | null,
  rowLaunchId: string | null,
  rowFlightCode: string | null
) {
  const normalizedLaunchId = normalizeLower(rowLaunchId);
  if (launchId && normalizedLaunchId && launchId === normalizedLaunchId) return true;

  const normalizedFlightCode = normalizeLower(rowFlightCode);
  if (flightCode && normalizedFlightCode && flightCode === normalizedFlightCode) return true;
  return false;
}

function isNewShepardFlight(flightCode: string | null) {
  return typeof flightCode === 'string' && /^ns-\d{1,3}$/i.test(flightCode);
}

function countUniqueTravelerIdentities(rows: Array<Pick<PassengerRow, 'name'>>, flightCode: string | null) {
  const identities = new Set<string>();
  for (const row of rows) {
    const key = buildBlueOriginTravelerIdentityKey(row.name, flightCode);
    if (key) identities.add(key);
  }
  return identities.size;
}

function isExcludedBlueOriginManifestSource(source: string | null | undefined) {
  const normalized = normalizeOptionalText(source);
  if (!normalized) return false;
  return /\b(?:launches_public_cache\.(?:crew|payloads))\b/i.test(normalized);
}

function shouldTreatBlueOriginPassengerAsPayload(row: Pick<PassengerRow, 'name' | 'role'>) {
  const role = normalizeOptionalText(row.role) || '';
  const name = normalizeOptionalText(row.name) || '';
  const normalizedRole = role.toLowerCase();
  const normalizedName = name.toLowerCase();

  if (!normalizedRole && !normalizedName) return false;
  if (/\b(?:anthropomorphic|test\s+device|atd|dummy)\b/i.test(normalizedRole)) return true;
  if (/\bmannequin\b/i.test(normalizedName)) return true;
  return false;
}

function isLikelyBlueOriginManifestPassengerName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (/[|=]/.test(normalized)) return false;
  if (!/\p{L}/u.test(normalized)) return false;
  if (normalized.length > 96) return false;
  if (/\b(?:share on|follow us|subscribe|watch on|press release|media kit)\b/i.test(normalized)) return false;
  if (
    /\b(?:share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|payload|experiment|installation|device|deorbit|program|mission|patch|media|news|timeline|update|updates|gallery|video|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  const tokenized = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokenized.length < 2 || tokenized.length > 6) return false;
  if (!tokenized.some((token) => token.length >= 2)) return false;
  return true;
}

function isLikelyBlueOriginManifestPayloadName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (/[|=]/.test(normalized)) return false;
  if (!/\p{L}/u.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 96) return false;
  if (
    /\b(?:share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|watch|subscribe|follow|mission|launch|flight|crew|passenger|traveler|news|timeline|status|update|updates|media|gallery)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  const tokenized = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokenized.length < 1 || tokenized.length > 8) return false;
  return tokenized.some((token) => token.length >= 2);
}

function isVerifiedBlueOriginManifestPassengerRow(row: PassengerRow) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginManifestPassengerName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isVerifiedBlueOriginManifestPayloadRow(row: PayloadRow) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginManifestPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isLikelyBlueOriginLaunchDetailCrewName(value: string | null | undefined) {
  // Similar to the launch detail page heuristic, but Unicode-aware to avoid dropping valid names with diacritics.
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (/\b(ns-\d+|mission|launch|flight|payload)\b/i.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 90) return false;
  if (
    /\b(?:mission|launch|payload|news|timeline|profile|booster|capsule|spacecraft|vehicle|status|public|media|pod|video|image|gallery|infographic|patch|update|updates|share|facebook|linkedin|reddit|twitter|instagram|youtube|tiktok|club|future|nasa|kennedy|research|institute|laboratory|lab|center|experiment|installation|device|deorbit|program|watch|subscribe|follow|new shepard|new glenn|experience|parachute|parachutes)\b/i.test(
      normalized
    )
  ) {
    return false;
  }
  if (!/\p{L}/u.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;

  // Require at least one token that looks like a proper name word (starts with an uppercase letter).
  return words.some((word) => /^\p{Lu}[\p{L}.'’\-]*$/u.test(word));
}

function isLikelyBlueOriginLaunchDetailPayloadName(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  if (normalized.length < 3 || normalized.length > 90) return false;
  if (
    /\b(?:mission|launch|flight|blue origin|new shepard|new glenn|booster|capsule|crew|people|passengers|spaceflight|suborbital|orbital|news|timeline|statistics|profile|infographic|update|updates)\b/i.test(
      normalized
    )
  ) {
    return false;
  }
  return /\p{L}/u.test(normalized) && normalized.split(/\s+/).filter(Boolean).length <= 8;
}

function isVerifiedBlueOriginLaunchDetailPassengerRow(row: PassengerRow) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginLaunchDetailCrewName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function isVerifiedBlueOriginLaunchDetailPayloadRow(row: PayloadRow) {
  const name = normalizeOptionalText(row.name);
  if (!name) return false;
  if (!isLikelyBlueOriginLaunchDetailPayloadName(name)) return false;
  if (isExcludedBlueOriginManifestSource(row.source)) return false;
  return row.confidence === 'high' || row.confidence === 'medium';
}

function readBlueOriginEnhancements(rows: ConstraintRow[]) {
  let missionSummary: string | null = null;
  let failureReason: string | null = null;
  const officialSourcePages: AuditLaunchRecord['enhancements']['officialSourcePages'] = [];

  for (const row of rows) {
    const type = normalizeOptionalText(row.constraint_type);
    if (!type) continue;
    const data = row.data && typeof row.data === 'object' ? row.data : null;
    if (!data) continue;

    if (type === 'bo_mission_facts') {
      const facts = Array.isArray((data as any).facts) ? (data as any).facts : [];
      for (const fact of facts) {
        if (!fact || typeof fact !== 'object') continue;
        const key = normalizeOptionalText((fact as any).key)?.toLowerCase() || '';
        const value = normalizeOptionalText((fact as any).value);
        if (!value) continue;
        if (key === 'mission_summary') missionSummary = pickRicherText(missionSummary, value);
        if (key === 'failure_reason') failureReason = pickRicherText(failureReason, value);
      }
    }

    if (type === 'bo_official_sources') {
      const sourcePages = Array.isArray((data as any).sourcePages) ? (data as any).sourcePages : [];
      for (const page of sourcePages) {
        if (!page || typeof page !== 'object') continue;
        officialSourcePages.push({
          canonicalUrl: normalizeOptionalText((page as any).canonicalUrl),
          url: normalizeOptionalText((page as any).url),
          provenance: normalizeOptionalText((page as any).provenance),
          archiveSnapshotUrl: normalizeOptionalText((page as any).archiveSnapshotUrl),
          title: normalizeOptionalText((page as any).title),
          fetchedAt: normalizeOptionalText((page as any).fetchedAt)
        });
      }
    }
  }

  return {
    missionSummary,
    failureReason,
    officialSourcePages
  };
}

function resolveBlueOriginSourcePageOpenUrl(page: { url: string | null; provenance: string | null; archiveSnapshotUrl: string | null }) {
  if (page.provenance === 'wayback' && page.archiveSnapshotUrl) return page.archiveSnapshotUrl;
  return page.url;
}

function mentionsPayloadLikeWork(text: string | null) {
  const normalized = normalizeOptionalText(text);
  if (!normalized) return false;
  return /\b(payload|payloads|experiment|experiments|microgravity|research)\b/i.test(normalized);
}

function deriveSyntheticPayloadNamesFromMissionSummary(missionSummary: string | null) {
  const summary = normalizeOptionalText(missionSummary);
  if (!summary) return [] as string[];

  const lower = summary.toLowerCase();
  const experimentMatch = summary.match(/\b(\d{1,4})\s+experiments?\b/i);
  if (experimentMatch?.[1]) {
    const count = Number(experimentMatch[1] || '');
    if (Number.isFinite(count) && count > 0) return [`Experiments (${count})`];
  }

  const payloadCountMatch = summary.match(
    /\b(?:more\s+than\s+|over\s+|around\s+|approximately\s+|roughly\s+)?(\d{1,4})\s+[^.\n]{0,60}?\bpayloads?\b/i
  );
  if (payloadCountMatch?.[1]) {
    const count = Number(payloadCountMatch[1] || '');
    if (Number.isFinite(count) && count > 0) {
      const label = lower.includes('microgravity')
        ? 'Microgravity research payloads'
        : lower.includes('commercial')
          ? 'Commercial payloads'
          : lower.includes('research') || lower.includes('science') || lower.includes('scientific')
            ? 'Research payloads'
            : 'Payloads';
      return [`${label} (${count})`];
    }
  }

  if (lower.includes('blue ring') && lower.includes('payload')) {
    return ['Blue Ring prototype payload'];
  }

  if (/\bpayloads?\b/i.test(summary)) {
    const label = lower.includes('lunar gravity')
      ? 'Lunar gravity payloads'
      : lower.includes('microgravity') || lower.includes('weightlessness')
        ? 'Microgravity research payloads'
        : lower.includes('commercial') || lower.includes('customer')
          ? 'Commercial payloads'
          : lower.includes('postcard')
            ? 'Postcards payload'
            : lower.includes('payload mission')
              ? 'Mission payload set'
              : 'Mission payloads';
    return [label];
  }

  return [] as string[];
}

function pickRicherText(existing: string | null, candidate: string | null) {
  const left = normalizeOptionalText(existing);
  const right = normalizeOptionalText(candidate);
  if (!left) return right;
  if (!right) return left;
  if (right.length > left.length) return right;
  return left;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await worker(items[current] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

async function checkUrl(url: string): Promise<UrlCheck> {
  const normalized = normalizeOptionalText(url);
  if (!normalized) {
    return { url, ok: false, status: null, finalUrl: null, contentType: null, kind: 'error', error: 'empty_url' };
  }

  const attempt = async (method: 'HEAD' | 'GET'): Promise<UrlCheck> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(normalized, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          // Be explicit; some endpoints behave differently without UA/accept.
          'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const status = res.status;
      const finalUrl = res.url || null;
      const contentType = res.headers.get('content-type');
      const ok = res.ok;
      const kind: UrlCheck['kind'] =
        ok ? 'ok' : INVALID_SOURCE_STATUS_CODES.has(status) ? 'broken' : 'error';

      return {
        url: normalized,
        ok,
        status,
        finalUrl,
        contentType,
        kind
      };
    } catch (err) {
      return {
        url: normalized,
        ok: false,
        status: null,
        finalUrl: null,
        contentType: null,
        kind: 'error',
        error: String(err instanceof Error ? err.message : err)
      };
    } finally {
      clearTimeout(timeout);
    }
  };

  const head = await attempt('HEAD');
  if (head.ok) return head;
  // HEAD is often blocked; fall back to GET for a better signal.
  if (head.status === 405 || head.status === 403 || head.status == null) {
    const get = await attempt('GET');
    return get;
  }
  return head;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
