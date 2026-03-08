import { createHash } from 'crypto';
import { STATIC_SEARCH_DOCS } from '@/lib/search/registry';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { fetchBlueOriginTravelerIndex } from '@/lib/server/blueOriginTravelers';
import { fetchCanonicalContractsIndex } from '@/lib/server/contracts';
import { fetchSpaceXDroneShipsIndex } from '@/lib/server/spacexDroneShips';
import { fetchSpaceXPassengers } from '@/lib/server/spacexProgram';

const SITE_SEARCH_SYNC_KEY = 'global';
const SITE_SEARCH_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

type SearchDocumentUpsertRow = {
  doc_id: string;
  source_type: string;
  doc_type: string;
  url: string;
  title: string;
  subtitle: string | null;
  summary: string | null;
  body_preview: string | null;
  aliases: string[];
  keywords: string[];
  badge: string | null;
  image_url: string | null;
  published_at: string | null;
  source_updated_at: string | null;
  boost: number;
  metadata: Record<string, unknown>;
  content_hash: string;
};

type SearchSyncStateRow = {
  sync_key: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  last_started_at: string | null;
  last_completed_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
};

export type SiteSearchSyncSummary = {
  ok: boolean;
  startedAt: string;
  completedAt: string;
  metadata: Record<string, unknown>;
  error?: string;
};

let inflightSync: Promise<SiteSearchSyncSummary> | null = null;

function buildContentHash(payload: Omit<SearchDocumentUpsertRow, 'content_hash'>) {
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function withHash(payload: Omit<SearchDocumentUpsertRow, 'content_hash'>): SearchDocumentUpsertRow {
  return {
    ...payload,
    content_hash: buildContentHash(payload)
  };
}

function compactList(values: Array<string | null | undefined>, maxItems = 24) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= maxItems) break;
  }

  return out;
}

function missionLabelFromKey(key: string | null) {
  const normalized = String(key || '').trim().toLowerCase();
  if (normalized === 'starship') return 'Starship';
  if (normalized === 'falcon-9') return 'Falcon 9';
  if (normalized === 'falcon-heavy') return 'Falcon Heavy';
  if (normalized === 'dragon') return 'Dragon';
  if (normalized === 'spacex-program') return 'SpaceX Program';
  return null;
}

function slugifyId(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'person'
  );
}

async function readSyncState() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('search_sync_state')
    .select('sync_key,status,last_started_at,last_completed_at,last_error,metadata')
    .eq('sync_key', SITE_SEARCH_SYNC_KEY)
    .maybeSingle();

  return (data as SearchSyncStateRow | null) || null;
}

async function hasSearchDocuments() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('search_documents').select('doc_id').limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function upsertSyncState(patch: Partial<SearchSyncStateRow>) {
  const admin = createSupabaseAdminClient();
  await admin.from('search_sync_state').upsert(
    {
      sync_key: SITE_SEARCH_SYNC_KEY,
      status: patch.status ?? 'idle',
      last_started_at: patch.last_started_at ?? null,
      last_completed_at: patch.last_completed_at ?? null,
      last_error: patch.last_error ?? null,
      metadata: patch.metadata ?? {},
      updated_at: new Date().toISOString()
    },
    { onConflict: 'sync_key' }
  );
}

async function replaceSourceDocuments(sourceType: string, docs: SearchDocumentUpsertRow[]) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('replace_search_documents_for_source', {
    source_type_in: sourceType,
    rows_in: docs
  });
  if (error) throw error;
}

function buildStaticDocuments() {
  return STATIC_SEARCH_DOCS.map((entry) =>
    withHash({
      doc_id: entry.docId,
      source_type: 'static',
      doc_type: entry.type,
      url: entry.url,
      title: entry.title,
      subtitle: entry.subtitle,
      summary: entry.summary,
      body_preview: entry.summary,
      aliases: compactList(entry.aliases),
      keywords: compactList(entry.keywords),
      badge: entry.badge,
      image_url: null,
      published_at: null,
      source_updated_at: null,
      boost: entry.boost,
      metadata: {}
    })
  );
}

async function buildContractDocuments() {
  const items = await fetchCanonicalContractsIndex();
  return items.map((item) =>
    withHash({
      doc_id: `contract:${item.uid}`,
      source_type: 'contract',
      doc_type: 'contract',
      url: item.canonicalPath || item.programPath || '/contracts',
      title: item.title,
      subtitle: compactList(
        [
          item.scope === 'spacex' ? 'SpaceX' : item.scope === 'blue-origin' ? 'Blue Origin' : 'Artemis',
          item.missionLabel,
          item.piid ? `PIID ${item.piid}` : null,
          item.usaspendingAwardId ? `Award ${item.usaspendingAwardId}` : null
        ],
        4
      ).join(' • ') || null,
      summary: item.description || null,
      body_preview: item.description || null,
      aliases: compactList([item.contractKey, item.piid, item.usaspendingAwardId]),
      keywords: compactList([item.scope, item.missionLabel, ...(item.keywords || []), 'contract', 'procurement', 'sam.gov', 'usaspending']),
      badge: 'Contract',
      image_url: null,
      published_at: item.awardedOn ? `${item.awardedOn}T00:00:00.000Z` : null,
      source_updated_at: item.updatedAt || (item.awardedOn ? `${item.awardedOn}T00:00:00.000Z` : null),
      boost: 42,
      metadata: {
        contractKey: item.contractKey,
        scope: item.scope,
        piid: item.piid,
        usaspendingAwardId: item.usaspendingAwardId
      }
    })
  );
}

async function buildPersonDocuments() {
  const [spaceXPassengers, blueOriginTravelers] = await Promise.all([
    fetchSpaceXPassengers('all'),
    fetchBlueOriginTravelerIndex()
  ]);

  const byName = new Map<
    string,
    {
      name: string;
      roles: Set<string>;
      nationalities: Set<string>;
      missionKeys: Set<string>;
      launchNames: Set<string>;
      latestLaunchDate: string | null;
      latestFlightSlug: string | null;
    }
  >();

  for (const row of spaceXPassengers.items) {
    const key = row.name.trim().toLowerCase();
    if (!key) continue;
    const bucket = byName.get(key) || {
      name: row.name,
      roles: new Set<string>(),
      nationalities: new Set<string>(),
      missionKeys: new Set<string>(),
      launchNames: new Set<string>(),
      latestLaunchDate: null as string | null,
      latestFlightSlug: null as string | null
    };

    if (row.role) bucket.roles.add(row.role);
    if (row.nationality) bucket.nationalities.add(row.nationality);
    if (row.missionKey) bucket.missionKeys.add(row.missionKey);
    if (row.launchName) bucket.launchNames.add(row.launchName);

    const currentMs = bucket.latestLaunchDate ? Date.parse(bucket.latestLaunchDate) : Number.NEGATIVE_INFINITY;
    const nextMs = row.launchDate ? Date.parse(row.launchDate) : Number.NEGATIVE_INFINITY;
    if (Number.isFinite(nextMs) && nextMs > currentMs) {
      bucket.latestLaunchDate = row.launchDate;
      bucket.latestFlightSlug = row.flightSlug;
    }

    byName.set(key, bucket);
  }

  const spaceXDocs = [...byName.values()].map((entry) =>
    withHash({
      doc_id: `person:spacex:${slugifyId(entry.name)}`,
      source_type: 'person',
      doc_type: 'person',
      url: entry.latestFlightSlug ? `/spacex/flights/${entry.latestFlightSlug}` : '/spacex',
      title: entry.name,
      subtitle:
        compactList(
          [
            'SpaceX',
            [...entry.roles][0] || 'Crew/Passenger',
            missionLabelFromKey([...entry.missionKeys][0] || null),
            [...entry.launchNames][0] ? `Latest: ${[...entry.launchNames][0]}` : null
          ],
          4
        ).join(' • ') || null,
      summary: null,
      body_preview: null,
      aliases: compactList([...entry.roles, ...entry.nationalities]),
      keywords: compactList([entry.name, ...entry.missionKeys, ...entry.launchNames, 'spacex', 'crew', 'passenger', 'traveler', 'astronaut']),
      badge: 'Person',
      image_url: null,
      published_at: entry.latestLaunchDate,
      source_updated_at: entry.latestLaunchDate,
      boost: 36,
      metadata: {
        kind: 'spacex-passenger'
      }
    })
  );

  const blueOriginDocs = blueOriginTravelers.items.map((entry) =>
    withHash({
      doc_id: `person:blue-origin:${entry.travelerSlug}`,
      source_type: 'person',
      doc_type: 'person',
      url: `/blue-origin/travelers/${encodeURIComponent(entry.travelerSlug)}`,
      title: entry.name,
      subtitle:
        compactList(
          [
            'Blue Origin',
            entry.roles[0] || 'Crew',
            entry.latestFlightCode ? entry.latestFlightCode.toUpperCase() : null,
            entry.latestLaunchName ? `Latest: ${entry.latestLaunchName}` : null
          ],
          4
        ).join(' • ') || null,
      summary: null,
      body_preview: null,
      aliases: compactList([entry.travelerSlug, ...entry.roles, ...entry.nationalities]),
      keywords: compactList([entry.name, entry.latestFlightCode, entry.latestLaunchName, 'blue origin', 'crew', 'traveler', 'passenger', 'astronaut']),
      badge: 'Person',
      image_url: entry.imageUrl || null,
      published_at: entry.latestLaunchDate,
      source_updated_at: entry.latestLaunchDate,
      boost: 36,
      metadata: {
        kind: 'blue-origin-traveler'
      }
    })
  );

  return [...spaceXDocs, ...blueOriginDocs];
}

async function buildRecoveryDocuments() {
  const payload = await fetchSpaceXDroneShipsIndex();
  return payload.items.map((entry) =>
    withHash({
      doc_id: `recovery:spacex:${entry.slug}`,
      source_type: 'recovery',
      doc_type: 'recovery',
      url: `/spacex/drone-ships/${entry.slug}`,
      title: entry.name,
      subtitle:
        compactList(
          [
            entry.abbrev || null,
            entry.status ? `Status: ${entry.status}` : null,
            entry.kpis.assignmentsKnown > 0 ? `${entry.kpis.assignmentsKnown} assignments` : null
          ],
          3
        ).join(' • ') || null,
      summary: entry.description || null,
      body_preview: entry.description || null,
      aliases: compactList([entry.abbrev]),
      keywords: compactList([entry.name, entry.abbrev, entry.status, 'spacex', 'drone ship', 'recovery', 'landing platform']),
      badge: 'Recovery',
      image_url: null,
      published_at: null,
      source_updated_at: payload.generatedAt,
      boost: 34,
      metadata: {
        slug: entry.slug,
        kind: 'spacex-drone-ship'
      }
    })
  );
}

async function refreshDerivedSources() {
  const [staticDocs, contractDocs, personDocs, recoveryDocs] = await Promise.all([
    Promise.resolve(buildStaticDocuments()),
    buildContractDocuments(),
    buildPersonDocuments(),
    buildRecoveryDocuments()
  ]);

  await replaceSourceDocuments('static', staticDocs);
  await replaceSourceDocuments('contract', contractDocs);
  await replaceSourceDocuments('person', personDocs);
  await replaceSourceDocuments('recovery', recoveryDocs);

  return {
    staticDocs: staticDocs.length,
    contractDocs: contractDocs.length,
    personDocs: personDocs.length,
    recoveryDocs: recoveryDocs.length
  };
}

export async function runSiteSearchSync() {
  const startedAt = new Date().toISOString();
  const metadata: Record<string, unknown> = {};

  await upsertSyncState({
    status: 'running',
    last_started_at: startedAt,
    last_completed_at: null,
    last_error: null,
    metadata: {}
  });

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('refresh_search_documents_db_sources');
    if (error) throw error;

    metadata.db = data || {};
    metadata.derived = await refreshDerivedSources();

    const completedAt = new Date().toISOString();
    await upsertSyncState({
      status: 'complete',
      last_started_at: startedAt,
      last_completed_at: completedAt,
      last_error: null,
      metadata
    });

    return {
      ok: true,
      startedAt,
      completedAt,
      metadata
    } satisfies SiteSearchSyncSummary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completedAt = new Date().toISOString();
    await upsertSyncState({
      status: 'error',
      last_started_at: startedAt,
      last_completed_at: completedAt,
      last_error: message,
      metadata
    });

    return {
      ok: false,
      startedAt,
      completedAt,
      metadata,
      error: message
    } satisfies SiteSearchSyncSummary;
  }
}

export async function ensureSiteSearchFresh({ requireReady = true, force = false }: { requireReady?: boolean; force?: boolean } = {}) {
  if (!isSupabaseAdminConfigured()) {
    return { ok: false, skipped: true, reason: 'admin_not_configured' as const };
  }

  const [state, ready] = await Promise.all([readSyncState(), hasSearchDocuments()]);
  const lastCompletedAt = state?.last_completed_at ? Date.parse(state.last_completed_at) : Number.NEGATIVE_INFINITY;
  const isFresh = Number.isFinite(lastCompletedAt) && Date.now() - lastCompletedAt <= SITE_SEARCH_SYNC_MAX_AGE_MS;

  if (!force && ready && isFresh && state?.status === 'complete') {
    return { ok: true, skipped: true, reason: 'fresh' as const };
  }

  if (!inflightSync) {
    inflightSync = runSiteSearchSync().finally(() => {
      inflightSync = null;
    });
  }

  if (requireReady || !ready) {
    return inflightSync;
  }

  return { ok: true, skipped: true, reason: 'refresh_started' as const };
}
