import { createSupabasePublicClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchArtemisProgramIntel } from '@/lib/server/artemisProgramIntel';
import { buildArtemisContentIdentityKey } from '@/lib/utils/artemisDedupe';
import { resolveUsaspendingAwardSourceUrl } from '@/lib/utils/usaspending';
import type {
  ArtemisContentCoverage,
  ArtemisContentItem,
  ArtemisContentKind,
  ArtemisContentKindFilter,
  ArtemisContentMissionFilter,
  ArtemisContentMissionKey,
  ArtemisContentQuery,
  ArtemisContentResponse,
  ArtemisContentTierFilter,
  ArtemisSourceClass,
  ArtemisSourceTier
} from '@/lib/types/artemis';

const CONTENT_DEFAULT_LIMIT = 24;
const CONTENT_MAX_LIMIT = 60;
const FALLBACK_SCAN_LIMIT = 120;

const SCORE_WEIGHTS = {
  authority: 0.45,
  relevance: 0.25,
  freshness: 0.15,
  stability: 0.1,
  risk: 0.05
} as const;

type SourceRegistryRow = {
  source_key: string;
  source_type: string;
  source_tier: string;
  display_name: string;
  base_url: string | null;
  authority_score: number | null;
  active: boolean;
};

type SocialAccountRow = {
  platform: string;
  handle: string;
  mission_scope: string;
  source_tier: string;
  active: boolean;
};

type ContentItemRow = {
  id: string;
  fingerprint: string;
  kind: string;
  mission_key: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  captured_at: string | null;
  source_key: string | null;
  source_type: string;
  source_class: string;
  source_tier: string;
  authority_score: number | null;
  relevance_score: number | null;
  freshness_score: number | null;
  overall_score: number | null;
  image_url: string | null;
  external_id: string | null;
  platform: string | null;
  data_label: string | null;
  data_value: number | null;
  data_unit: string | null;
  metadata: Record<string, unknown> | null;
};

type SnapiRow = {
  snapi_uid: string;
  item_type: string;
  title: string;
  url: string;
  news_site: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
};

type SourceDocRow = {
  id: string;
  source_key: string;
  source_type: string;
  url: string;
  title: string | null;
  published_at: string | null;
  fetched_at: string | null;
  raw: Record<string, unknown> | null;
};

type LaunchSocialRow = {
  launch_id: string;
  name: string | null;
  mission_name: string | null;
  net: string | null;
  provider: string | null;
  social_primary_post_url: string | null;
  social_primary_post_platform: string | null;
  social_primary_post_handle: string | null;
  social_primary_post_id: string | null;
  social_primary_post_matched_at: string | null;
  spacex_x_post_url: string | null;
  spacex_x_post_id: string | null;
  spacex_x_post_captured_at: string | null;
};

type AllowlistedAccount = {
  platform: string;
  handle: string;
  missionScope: ArtemisContentMissionKey;
  tier: ArtemisSourceTier;
};

type RegistryMap = Map<
  string,
  {
    label: string;
    type: ArtemisSourceClass;
    tier: ArtemisSourceTier;
    authorityScore: number;
    baseUrl: string | null;
  }
>;

export async function fetchArtemisContentViewModel(query: ArtemisContentQuery): Promise<ArtemisContentResponse> {
  const generatedAt = new Date().toISOString();
  const mission = query.mission;
  const kind = query.kind;
  const tier = query.tier;
  const limit = clampInt(query.limit, CONTENT_DEFAULT_LIMIT, 1, CONTENT_MAX_LIMIT);
  const cursorOffset = decodeCursor(query.cursor);

  if (!isSupabaseConfigured()) {
    return {
      generatedAt,
      mission,
      kind,
      tier,
      items: [],
      nextCursor: null,
      sourceCoverage: emptyCoverage('fallback')
    };
  }

  const supabase = createSupabasePublicClient();
  const [registry, allowlist] = await Promise.all([loadSourceRegistry(supabase), loadAllowlistedAccounts(supabase)]);

  const unified = await fetchUnifiedContentItems({
    supabase,
    mission,
    kind,
    tier,
    limit,
    cursorOffset,
    registry,
    allowlist
  });

  if (unified.items.length > 0) {
    return {
      generatedAt,
      mission,
      kind,
      tier,
      items: unified.items,
      nextCursor: unified.nextCursor,
      sourceCoverage: buildCoverage('content_items', unified.items)
    };
  }

  const fallbackItems = await buildFallbackContent({
    supabase,
    mission,
    kind,
    tier,
    limit,
    cursorOffset,
    registry,
    allowlist,
    generatedAt
  });

  return {
    generatedAt,
    mission,
    kind,
    tier,
    items: fallbackItems.items,
    nextCursor: fallbackItems.nextCursor,
    sourceCoverage: buildCoverage('fallback', fallbackItems.items)
  };
}

export function parseArtemisContentMissionFilter(value: string | null): ArtemisContentMissionFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');
  if (normalized === 'all') return 'all';
  if (normalized === 'program' || normalized === 'artemis-program') return 'program';
  if (normalized === 'artemis-i' || normalized === 'artemisi' || normalized === 'artemis1' || normalized === 'i' || normalized === '1') return 'artemis-i';
  if (normalized === 'artemis-ii' || normalized === 'artemisii' || normalized === 'artemis2' || normalized === 'ii' || normalized === '2') return 'artemis-ii';
  if (normalized === 'artemis-iii' || normalized === 'artemisiii' || normalized === 'artemis3' || normalized === 'iii' || normalized === '3') return 'artemis-iii';
  if (normalized === 'artemis-iv' || normalized === 'artemisiv' || normalized === 'artemis4' || normalized === 'iv' || normalized === '4') return 'artemis-iv';
  if (normalized === 'artemis-v' || normalized === 'artemisv' || normalized === 'artemis5' || normalized === 'v' || normalized === '5') return 'artemis-v';
  if (normalized === 'artemis-vi' || normalized === 'artemisvi' || normalized === 'artemis6' || normalized === 'vi' || normalized === '6') return 'artemis-vi';
  if (normalized === 'artemis-vii' || normalized === 'artemisvii' || normalized === 'artemis7' || normalized === 'vii' || normalized === '7') return 'artemis-vii';
  return null;
}

export function parseArtemisContentKindFilter(value: string | null): ArtemisContentKindFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'article' || normalized === 'articles' || normalized === 'news') return 'article';
  if (normalized === 'photo' || normalized === 'photos' || normalized === 'image' || normalized === 'images') return 'photo';
  if (normalized === 'social' || normalized === 'tweet' || normalized === 'tweets') return 'social';
  if (normalized === 'data' || normalized === 'metric' || normalized === 'metrics') return 'data';
  return null;
}

export function parseArtemisContentTierFilter(value: string | null): ArtemisContentTierFilter | null {
  if (!value) return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (normalized === 'tier1' || normalized === 'tier-1' || normalized === 'official') return 'tier1';
  if (normalized === 'tier2' || normalized === 'tier-2' || normalized === 'mixed') return 'tier2';
  return null;
}

export function parseArtemisContentLimit(value: string | null) {
  if (value == null || value === '') return CONTENT_DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampInt(parsed, CONTENT_DEFAULT_LIMIT, 1, CONTENT_MAX_LIMIT);
}

export function parseArtemisContentCursor(value: string | null) {
  if (!value) return null;
  if (!/^\d+$/.test(value.trim())) return null;
  return value.trim();
}

async function fetchUnifiedContentItems({
  supabase,
  mission,
  kind,
  tier,
  limit,
  cursorOffset,
  registry,
  allowlist
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  mission: ArtemisContentMissionFilter;
  kind: ArtemisContentKindFilter;
  tier: ArtemisContentTierFilter;
  limit: number;
  cursorOffset: number;
  registry: RegistryMap;
  allowlist: AllowlistedAccount[];
}) {
  let query = supabase
    .from('artemis_content_items')
    .select(
      'id,fingerprint,kind,mission_key,title,summary,url,published_at,captured_at,source_key,source_type,source_class,source_tier,authority_score,relevance_score,freshness_score,overall_score,image_url,external_id,platform,data_label,data_value,data_unit,metadata'
    )
    .order('overall_score', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('captured_at', { ascending: false, nullsFirst: false })
    .range(cursorOffset, cursorOffset + limit);

  if (mission !== 'all') query = query.eq('mission_key', mission);
  if (kind !== 'all') query = query.eq('kind', kind);
  if (tier !== 'all') query = query.eq('source_tier', tier);

  const { data, error } = await query;
  if (error) {
    console.error('artemis content items query error', error);
    return { items: [] as ArtemisContentItem[], nextCursor: null };
  }

  const rows = ((data || []) as ContentItemRow[]).filter((row) => row.id && row.title && row.url);
  if (!rows.length) return { items: [] as ArtemisContentItem[], nextCursor: null };

  const mapped = rows.map((row) => mapContentRow(row, registry, allowlist));
  const deduped = dedupeContentItems(mapped);
  const slice = deduped.slice(0, limit);
  const nextCursor = rows.length > limit ? String(cursorOffset + limit) : null;
  return { items: slice, nextCursor };
}

async function buildFallbackContent({
  supabase,
  mission,
  kind,
  tier,
  limit,
  cursorOffset,
  registry,
  allowlist,
  generatedAt
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  mission: ArtemisContentMissionFilter;
  kind: ArtemisContentKindFilter;
  tier: ArtemisContentTierFilter;
  limit: number;
  cursorOffset: number;
  registry: RegistryMap;
  allowlist: AllowlistedAccount[];
  generatedAt: string;
}) {
  const [articles, photos, social, dataItems] = await Promise.all([
    kind === 'all' || kind === 'article' ? fetchFallbackArticles({ supabase, mission, tier, registry }) : Promise.resolve([] as ArtemisContentItem[]),
    kind === 'all' || kind === 'photo' ? fetchFallbackPhotos({ supabase, mission, tier, registry, generatedAt }) : Promise.resolve([] as ArtemisContentItem[]),
    kind === 'all' || kind === 'social'
      ? fetchFallbackSocial({ supabase, mission, tier, registry, allowlist, generatedAt })
      : Promise.resolve([] as ArtemisContentItem[]),
    kind === 'all' || kind === 'data' ? fetchFallbackData({ mission, tier, registry, generatedAt }) : Promise.resolve([] as ArtemisContentItem[])
  ]);

  const merged = dedupeContentItems([...articles, ...photos, ...social, ...dataItems]);
  merged.sort(compareContentItems);

  const paged = merged.slice(cursorOffset, cursorOffset + limit);
  const nextCursor = cursorOffset + paged.length < merged.length ? String(cursorOffset + paged.length) : null;
  return { items: paged, nextCursor };
}

async function fetchFallbackArticles({
  supabase,
  mission,
  tier,
  registry
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  mission: ArtemisContentMissionFilter;
  tier: ArtemisContentTierFilter;
  registry: RegistryMap;
}) {
  const { data, error } = await supabase
    .from('snapi_items')
    .select('snapi_uid,item_type,title,url,news_site,summary,image_url,published_at')
    .or('title.ilike.%Artemis%,summary.ilike.%Artemis%')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(FALLBACK_SCAN_LIMIT);

  if (error) {
    console.error('artemis fallback articles query error', error);
    return [] as ArtemisContentItem[];
  }

  const rows = ((data || []) as SnapiRow[]).filter((row) => row.snapi_uid && row.title && row.url);
  const items: ArtemisContentItem[] = [];

  for (const row of rows) {
    const missionKey = inferMissionFromText(`${row.title} ${row.summary || ''}`);
    if (!matchesMissionFilter(mission, missionKey)) continue;

    const host = getHostname(row.url);
    const sourceClass = mapSourceClassFromHost(host);
    const sourceTier = mapSourceTierFromHost(host);
    if (!matchesTierFilter(tier, sourceTier)) continue;

    const registryEntry = registry.get('snapi_artemis');
    const authority = registryEntry?.authorityScore ?? authorityScoreForClass(sourceClass);
    const relevance = relevanceScoreForMission(missionKey, mission, `${row.title} ${row.summary || ''}`);
    const freshness = freshnessScoreForDate(row.published_at);
    const stability = stabilityScoreForTier(sourceTier);
    const risk = riskScoreForTier(sourceTier);
    const overall = overallScore({ authority, relevance, freshness, stability, risk });

    items.push({
      id: `snapi:${row.snapi_uid}`,
      fingerprint: `article:${row.snapi_uid}`,
      kind: 'article',
      missionKey,
      title: row.title,
      summary: normalizeText(row.summary),
      url: row.url,
      publishedAt: normalizeDate(row.published_at),
      capturedAt: normalizeDate(row.published_at),
      sourceKey: 'snapi_artemis',
      sourceType: sourceClass,
      sourceClass,
      sourceTier,
      sourceLabel: row.news_site || host || registryEntry?.label || 'SNAPI Artemis feed',
      imageUrl: normalizeText(row.image_url),
      externalId: row.snapi_uid,
      platform: null,
      dataLabel: null,
      dataValue: null,
      dataUnit: null,
      missionLabel: missionLabelForKey(missionKey),
      score: {
        authority,
        relevance,
        freshness,
        stability,
        risk,
        overall
      },
      whyShown: buildWhyShown({
        kind: 'article',
        sourceTier,
        sourceClass,
        missionKey,
        missionFilter: mission,
        isAllowlisted: false
      }),
      metadata: {
        itemType: row.item_type,
        newsSite: row.news_site
      }
    });
  }

  return items;
}

async function fetchFallbackPhotos({
  supabase,
  mission,
  tier,
  registry,
  generatedAt
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  mission: ArtemisContentMissionFilter;
  tier: ArtemisContentTierFilter;
  registry: RegistryMap;
  generatedAt: string;
}) {
  const { data, error } = await supabase
    .from('artemis_source_documents')
    .select('id,source_key,source_type,url,title,published_at,fetched_at,raw')
    .eq('source_key', 'nasa_media_assets')
    .order('fetched_at', { ascending: false, nullsFirst: false })
    .limit(6);

  if (error) {
    console.error('artemis fallback photos query error', error);
    return [] as ArtemisContentItem[];
  }

  const docs = (data || []) as SourceDocRow[];
  if (!docs.length) return [] as ArtemisContentItem[];

  const registryEntry = registry.get('nasa_media_assets');
  const authority = registryEntry?.authorityScore ?? 0.95;
  const sourceTier: ArtemisSourceTier = 'tier1';
  if (!matchesTierFilter(tier, sourceTier)) return [];

  const items: ArtemisContentItem[] = [];
  for (const doc of docs) {
    const rawCollection = asRecord(doc.raw)?.collection;
    const rawItems = Array.isArray(asRecord(rawCollection)?.items) ? (asRecord(rawCollection)?.items as unknown[]) : [];

    for (const rawItem of rawItems.slice(0, 24)) {
      const row = asRecord(rawItem);
      if (!row) continue;

      const dataRows = Array.isArray(row.data) ? row.data : [];
      const dataRow = asRecord(dataRows[0]);
      const links = Array.isArray(row.links) ? row.links : [];
      const imageLink = links.map((entry) => asRecord(entry)).find((entry) => typeof entry?.href === 'string' && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(String(entry.href)));
      const imageUrl = normalizeText(imageLink?.href);

      const title = normalizeText(dataRow?.title) || normalizeText(doc.title) || 'NASA Artemis image';
      const description = normalizeText(dataRow?.description);
      const nasaId = normalizeText(dataRow?.nasa_id);
      const publishedAt = normalizeDate(normalizeText(dataRow?.date_created)) || normalizeDate(doc.published_at) || normalizeDate(doc.fetched_at) || generatedAt;
      const missionKey = inferMissionFromText(`${title} ${description || ''}`);
      if (!matchesMissionFilter(mission, missionKey)) continue;

      const relevance = relevanceScoreForMission(missionKey, mission, `${title} ${description || ''}`);
      const freshness = freshnessScoreForDate(publishedAt);
      const stability = 0.92;
      const risk = 0.94;
      const overall = overallScore({ authority, relevance, freshness, stability, risk });
      const pageUrl = nasaId ? `https://images.nasa.gov/details-${encodeURIComponent(nasaId)}` : doc.url;
      if (!pageUrl) continue;

      items.push({
        id: `photo:${doc.id}:${nasaId || title.slice(0, 48)}`,
        fingerprint: `photo:${nasaId || `${doc.id}:${title}`}`,
        kind: 'photo',
        missionKey,
        title,
        summary: description,
        url: pageUrl,
        publishedAt,
        capturedAt: normalizeDate(doc.fetched_at) || publishedAt,
        sourceKey: doc.source_key,
        sourceType: 'media',
        sourceClass: 'media',
        sourceTier,
        sourceLabel: registryEntry?.label || 'NASA Images API',
        imageUrl,
        externalId: nasaId,
        platform: null,
        dataLabel: null,
        dataValue: null,
        dataUnit: null,
        missionLabel: missionLabelForKey(missionKey),
        score: {
          authority,
          relevance,
          freshness,
          stability,
          risk,
          overall
        },
        whyShown: buildWhyShown({
          kind: 'photo',
          sourceTier,
          sourceClass: 'media',
          missionKey,
          missionFilter: mission,
          isAllowlisted: false
        }),
        metadata: {
          sourceDocumentId: doc.id,
          sourceUrl: doc.url,
          nasaId
        }
      });
    }
  }

  return items;
}

async function fetchFallbackSocial({
  supabase,
  mission,
  tier,
  registry,
  allowlist,
  generatedAt
}: {
  supabase: ReturnType<typeof createSupabasePublicClient>;
  mission: ArtemisContentMissionFilter;
  tier: ArtemisContentTierFilter;
  registry: RegistryMap;
  allowlist: AllowlistedAccount[];
  generatedAt: string;
}) {
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,name,mission_name,net,provider,social_primary_post_url,social_primary_post_platform,social_primary_post_handle,social_primary_post_id,social_primary_post_matched_at,spacex_x_post_url,spacex_x_post_id,spacex_x_post_captured_at'
    )
    .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
    .order('net', { ascending: false, nullsFirst: false })
    .limit(FALLBACK_SCAN_LIMIT);

  if (error) {
    console.error('artemis fallback social query error', error);
    return [] as ArtemisContentItem[];
  }

  const rows = (data || []) as LaunchSocialRow[];
  const registryEntry = registry.get('launch_social_links');
  const items: ArtemisContentItem[] = [];

  for (const row of rows) {
    const missionKey = inferMissionFromText(`${row.name || ''} ${row.mission_name || ''}`);
    if (!matchesMissionFilter(mission, missionKey)) continue;

    const candidates = [
      {
        url: normalizeText(row.social_primary_post_url),
        platform: normalizeText(row.social_primary_post_platform) || 'x',
        handle: normalizeHandle(row.social_primary_post_handle) || extractHandleFromSocialUrl(row.social_primary_post_url),
        externalId: normalizeText(row.social_primary_post_id),
        postedAt: normalizeDate(row.social_primary_post_matched_at) || normalizeDate(row.net) || generatedAt
      },
      {
        url: normalizeText(row.spacex_x_post_url),
        platform: 'x',
        handle: extractHandleFromSocialUrl(row.spacex_x_post_url),
        externalId: normalizeText(row.spacex_x_post_id),
        postedAt: normalizeDate(row.spacex_x_post_captured_at) || normalizeDate(row.net) || generatedAt
      }
    ];

    for (const candidate of candidates) {
      if (!candidate.url) continue;

      const allowlisted = findAllowlistedAccount(allowlist, candidate.platform, candidate.handle, missionKey);
      if (!allowlisted) continue;
      if (!matchesTierFilter(tier, allowlisted.tier)) continue;

      const authority = registryEntry?.authorityScore ?? 0.9;
      const relevance = relevanceScoreForMission(missionKey, mission, `${row.name || ''} ${row.mission_name || ''}`);
      const freshness = freshnessScoreForDate(candidate.postedAt);
      const stability = stabilityScoreForTier(allowlisted.tier);
      const risk = riskScoreForTier(allowlisted.tier);
      const overall = overallScore({ authority, relevance, freshness, stability, risk });
      const handleLabel = candidate.handle ? `@${candidate.handle}` : 'official account';

      items.push({
        id: `social:${row.launch_id}:${candidate.externalId || candidate.url}`,
        fingerprint: `social:${candidate.url}`,
        kind: 'social',
        missionKey,
        title: `${handleLabel} update linked to ${row.name || 'Artemis mission'}`,
        summary: normalizeText(row.provider) ? `Provider: ${row.provider}` : null,
        url: candidate.url,
        publishedAt: candidate.postedAt,
        capturedAt: candidate.postedAt,
        sourceKey: 'launch_social_links',
        sourceType: 'media',
        sourceClass: 'media',
        sourceTier: allowlisted.tier,
        sourceLabel: registryEntry?.label || 'Launch-linked official social',
        imageUrl: null,
        externalId: candidate.externalId,
        platform: candidate.platform,
        dataLabel: null,
        dataValue: null,
        dataUnit: null,
        missionLabel: missionLabelForKey(missionKey),
        score: {
          authority,
          relevance,
          freshness,
          stability,
          risk,
          overall
        },
        whyShown: buildWhyShown({
          kind: 'social',
          sourceTier: allowlisted.tier,
          sourceClass: 'media',
          missionKey,
          missionFilter: mission,
          isAllowlisted: true
        }),
        metadata: {
          launchId: row.launch_id,
          launchName: row.name,
          provider: row.provider,
          account: allowlisted.handle
        }
      });
    }
  }

  return items;
}

async function fetchFallbackData({
  mission,
  tier,
  registry,
  generatedAt
}: {
  mission: ArtemisContentMissionFilter;
  tier: ArtemisContentTierFilter;
  registry: RegistryMap;
  generatedAt: string;
}) {
  const intel = await fetchArtemisProgramIntel();
  const items: ArtemisContentItem[] = [];

  const budgetRegistry = registry.get('nasa_budget_docs');
  const procurementRegistry = registry.get('usaspending_awards');

  for (const line of intel.budgetLines) {
    const missionKey: ArtemisContentMissionKey = 'program';
    if (!matchesMissionFilter(mission, missionKey)) continue;
    const sourceTier: ArtemisSourceTier = 'tier1';
    if (!matchesTierFilter(tier, sourceTier)) continue;

    const authority = budgetRegistry?.authorityScore ?? 0.93;
    const relevance = relevanceScoreForMission(missionKey, mission, `${line.program || ''} ${line.lineItem || ''}`);
    const freshness = freshnessScoreForDate(line.announcedTime || intel.generatedAt);
    const stability = 0.9;
    const risk = 0.92;
    const overall = overallScore({ authority, relevance, freshness, stability, risk });

    const label = `FY ${line.fiscalYear || 'n/a'} ${line.lineItem || 'Budget line'}`;
    items.push({
      id: `data:budget:${line.fiscalYear || 'na'}:${line.lineItem || label}`,
      fingerprint: `data:budget:${line.fiscalYear || 'na'}:${line.lineItem || label}`,
      kind: 'data',
      missionKey,
      title: line.lineItem || 'Artemis budget line',
      summary: line.program ? `${line.program} budget context` : null,
      url: line.sourceUrl || 'https://www.nasa.gov/budget/',
      publishedAt: normalizeDate(line.announcedTime) || normalizeDate(intel.generatedAt) || generatedAt,
      capturedAt: normalizeDate(line.announcedTime) || normalizeDate(intel.generatedAt) || generatedAt,
      sourceKey: 'nasa_budget_docs',
      sourceType: 'budget',
      sourceClass: 'budget',
      sourceTier,
      sourceLabel: line.sourceTitle || budgetRegistry?.label || 'NASA budget documents',
      imageUrl: null,
      externalId: null,
      platform: null,
      dataLabel: label,
      dataValue: line.amountRequested,
      dataUnit: 'USD',
      missionLabel: missionLabelForKey(missionKey),
      score: {
        authority,
        relevance,
        freshness,
        stability,
        risk,
        overall
      },
      whyShown: buildWhyShown({
        kind: 'data',
        sourceTier,
        sourceClass: 'budget',
        missionKey,
        missionFilter: mission,
        isAllowlisted: false
      }),
      metadata: {
        amountRequested: line.amountRequested,
        amountEnacted: line.amountEnacted,
        agency: line.agency
      }
    });
  }

  for (const award of intel.procurementAwards) {
    const missionKey = normalizeMissionKey(award.missionKey) || 'program';
    if (!matchesMissionFilter(mission, missionKey)) continue;
    const sourceTier: ArtemisSourceTier = 'tier1';
    if (!matchesTierFilter(tier, sourceTier)) continue;

    const authority = procurementRegistry?.authorityScore ?? 0.9;
    const relevance = relevanceScoreForMission(missionKey, mission, `${award.title || ''} ${award.recipient || ''}`);
    const freshness = freshnessScoreForDate(award.awardedOn);
    const stability = 0.88;
    const risk = 0.9;
    const overall = overallScore({ authority, relevance, freshness, stability, risk });

    const fallbackId = `${award.awardId || award.title || award.recipient || 'procurement'}`;
    items.push({
      id: `data:procurement:${fallbackId}`,
      fingerprint: `data:procurement:${fallbackId}`,
      kind: 'data',
      missionKey,
      title: award.title || award.awardId || 'Artemis procurement award',
      summary: award.recipient,
      url:
        resolveUsaspendingAwardSourceUrl({
          awardId: award.awardId,
          sourceUrl: award.sourceUrl
        }) || 'https://www.usaspending.gov/',
      publishedAt: normalizeDate(award.awardedOn) || normalizeDate(intel.generatedAt) || generatedAt,
      capturedAt: normalizeDate(award.awardedOn) || normalizeDate(intel.generatedAt) || generatedAt,
      sourceKey: 'usaspending_awards',
      sourceType: 'procurement',
      sourceClass: 'procurement',
      sourceTier,
      sourceLabel: award.sourceTitle || procurementRegistry?.label || 'USASpending awards',
      imageUrl: null,
      externalId: award.awardId,
      platform: null,
      dataLabel: award.awardId || null,
      dataValue: award.obligatedAmount,
      dataUnit: 'USD',
      missionLabel: missionLabelForKey(missionKey),
      score: {
        authority,
        relevance,
        freshness,
        stability,
        risk,
        overall
      },
      whyShown: buildWhyShown({
        kind: 'data',
        sourceTier,
        sourceClass: 'procurement',
        missionKey,
        missionFilter: mission,
        isAllowlisted: false
      }),
      metadata: {
        recipient: award.recipient,
        awardedOn: award.awardedOn
      }
    });
  }

  return items;
}

async function loadSourceRegistry(supabase: ReturnType<typeof createSupabasePublicClient>) {
  const { data, error } = await supabase
    .from('artemis_source_registry')
    .select('source_key,source_type,source_tier,display_name,base_url,authority_score,active')
    .eq('active', true)
    .limit(200);

  if (error) {
    console.error('artemis source registry query error', error);
    return new Map() as RegistryMap;
  }

  const rows = (data || []) as SourceRegistryRow[];
  const map: RegistryMap = new Map();
  for (const row of rows) {
    const sourceType = normalizeSourceClass(row.source_type) || 'technical';
    const tier = normalizeSourceTier(row.source_tier) || 'tier2';
    map.set(row.source_key, {
      label: row.display_name,
      type: sourceType,
      tier,
      authorityScore: clampScore(row.authority_score ?? 0.5),
      baseUrl: row.base_url
    });
  }

  return map;
}

async function loadAllowlistedAccounts(supabase: ReturnType<typeof createSupabasePublicClient>) {
  const { data, error } = await supabase
    .from('artemis_social_accounts')
    .select('platform,handle,mission_scope,source_tier,active')
    .eq('active', true)
    .limit(200);

  if (error) {
    console.error('artemis social allowlist query error', error);
    return DEFAULT_ALLOWLIST;
  }

  const rows = (data || []) as SocialAccountRow[];
  if (!rows.length) return DEFAULT_ALLOWLIST;

  const parsed = rows
    .map((row) => {
      const platform = normalizePlatform(row.platform);
      const handle = normalizeHandle(row.handle);
      const missionScope = normalizeMissionKey(row.mission_scope) || 'program';
      const tier = normalizeSourceTier(row.source_tier) || 'tier1';
      if (!platform || !handle) return null;
      return { platform, handle, missionScope, tier } satisfies AllowlistedAccount;
    })
    .filter((row): row is AllowlistedAccount => Boolean(row));

  return parsed.length ? parsed : DEFAULT_ALLOWLIST;
}

function findAllowlistedAccount(
  allowlist: AllowlistedAccount[],
  platformRaw: string | null,
  handleRaw: string | null,
  missionKey: ArtemisContentMissionKey
) {
  const platform = normalizePlatform(platformRaw);
  const handle = normalizeHandle(handleRaw);
  if (!platform || !handle) return null;

  return (
    allowlist.find((entry) => entry.platform === platform && entry.handle === handle && (entry.missionScope === 'program' || entry.missionScope === missionKey)) ||
    null
  );
}

function mapContentRow(row: ContentItemRow, registry: RegistryMap, allowlist: AllowlistedAccount[]): ArtemisContentItem {
  const kind = normalizeContentKind(row.kind) || 'article';
  const missionKey = normalizeMissionKey(row.mission_key) || 'program';
  const sourceClass = normalizeSourceClass(row.source_class) || normalizeSourceClass(row.source_type) || 'technical';
  const sourceTier = normalizeSourceTier(row.source_tier) || 'tier2';

  const authority = clampScore(row.authority_score ?? authorityScoreForClass(sourceClass));
  const relevance = clampScore(row.relevance_score ?? relevanceScoreForMission(missionKey, 'all', `${row.title} ${row.summary || ''}`));
  const freshness = clampScore(row.freshness_score ?? freshnessScoreForDate(row.published_at));
  const stability = stabilityScoreForTier(sourceTier);
  const risk = riskScoreForTier(sourceTier);
  const overall = clampScore(row.overall_score ?? overallScore({ authority, relevance, freshness, stability, risk }));

  const registryEntry = row.source_key ? registry.get(row.source_key) : null;
  const allowlisted = kind === 'social' ? isAllowlistedSocial({ allowlist, missionKey, row }) : false;

  return {
    id: row.id,
    fingerprint: row.fingerprint,
    kind,
    missionKey,
    title: row.title,
    summary: row.summary,
    url: row.url,
    publishedAt: normalizeDate(row.published_at),
    capturedAt: normalizeDate(row.captured_at),
    sourceKey: row.source_key,
    sourceType: normalizeSourceClass(row.source_type) || sourceClass,
    sourceClass,
    sourceTier,
    sourceLabel: registryEntry?.label || row.source_key || row.source_type,
    imageUrl: row.image_url,
    externalId: row.external_id,
    platform: row.platform,
    dataLabel: row.data_label,
    dataValue: row.data_value,
    dataUnit: row.data_unit,
    missionLabel: missionLabelForKey(missionKey),
    score: {
      authority,
      relevance,
      freshness,
      stability,
      risk,
      overall
    },
    whyShown: buildWhyShown({
      kind,
      sourceTier,
      sourceClass,
      missionKey,
      missionFilter: 'all',
      isAllowlisted: allowlisted
    }),
    metadata: row.metadata || {}
  };
}

function isAllowlistedSocial({
  allowlist,
  missionKey,
  row
}: {
  allowlist: AllowlistedAccount[];
  missionKey: ArtemisContentMissionKey;
  row: ContentItemRow;
}) {
  const platform = normalizePlatform(row.platform);
  if (!platform) return false;

  const metadata = row.metadata || {};
  const rawHandle = typeof metadata.account === 'string' ? metadata.account : typeof metadata.handle === 'string' ? metadata.handle : null;
  const handle = normalizeHandle(rawHandle);
  if (!handle) return false;

  return Boolean(
    allowlist.find(
      (entry) =>
        entry.platform === platform &&
        entry.handle === handle &&
        (entry.missionScope === 'program' || entry.missionScope === missionKey)
    )
  );
}

function dedupeContentItems(items: ArtemisContentItem[]) {
  const dedupedByKey = new Map<string, ArtemisContentItem>();
  for (const item of items) {
    const key = buildArtemisContentIdentityKey({
      kind: item.kind,
      missionKey: item.missionKey,
      url: item.url,
      title: item.title,
      sourceKey: item.sourceKey,
      externalId: item.externalId,
      platform: item.platform,
      imageUrl: item.imageUrl,
      dataLabel: item.dataLabel,
      dataValue: item.dataValue,
      dataUnit: item.dataUnit
    });

    const existing = dedupedByKey.get(key);
    if (!existing || compareContentItems(item, existing) < 0) {
      dedupedByKey.set(key, item);
    }
  }

  return [...dedupedByKey.values()];
}

function compareContentItems(a: ArtemisContentItem, b: ArtemisContentItem) {
  if (a.score.overall !== b.score.overall) return b.score.overall - a.score.overall;
  const aMs = parseDateOrZero(a.publishedAt || a.capturedAt);
  const bMs = parseDateOrZero(b.publishedAt || b.capturedAt);
  if (aMs !== bMs) return bMs - aMs;
  return a.title.localeCompare(b.title);
}

function buildCoverage(generatedFrom: ArtemisContentCoverage['generatedFrom'], items: ArtemisContentItem[]): ArtemisContentCoverage {
  const byKind: Record<ArtemisContentKind, number> = {
    article: 0,
    photo: 0,
    social: 0,
    data: 0
  };
  const sourceKeys = new Set<string>();

  let tier1Items = 0;
  let tier2Items = 0;

  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    if (item.sourceTier === 'tier1') tier1Items += 1;
    if (item.sourceTier === 'tier2') tier2Items += 1;
    if (item.sourceKey) sourceKeys.add(item.sourceKey);
  }

  return {
    generatedFrom,
    totalItems: items.length,
    tier1Items,
    tier2Items,
    byKind,
    sourceKeys: [...sourceKeys].sort()
  };
}

function emptyCoverage(generatedFrom: ArtemisContentCoverage['generatedFrom']): ArtemisContentCoverage {
  return {
    generatedFrom,
    totalItems: 0,
    tier1Items: 0,
    tier2Items: 0,
    byKind: {
      article: 0,
      photo: 0,
      social: 0,
      data: 0
    },
    sourceKeys: []
  };
}

function matchesMissionFilter(filter: ArtemisContentMissionFilter, missionKey: ArtemisContentMissionKey) {
  if (filter === 'all') return true;
  if (filter === 'program') return missionKey === 'program';
  if (missionKey === filter) return true;
  return false;
}

function matchesTierFilter(filter: ArtemisContentTierFilter, tier: ArtemisSourceTier) {
  if (filter === 'all') return true;
  return filter === tier;
}

function inferMissionFromText(value: string): ArtemisContentMissionKey {
  const normalized = value.toLowerCase();
  if (/\bartemis\s*(vii|7)\b/.test(normalized)) return 'artemis-vii';
  if (/\bartemis\s*(vi|6)\b/.test(normalized)) return 'artemis-vi';
  if (/\bartemis\s*(v|5)\b/.test(normalized)) return 'artemis-v';
  if (/\bartemis\s*(iv|4)\b/.test(normalized)) return 'artemis-iv';
  if (/\bartemis\s*(iii|3)\b/.test(normalized)) return 'artemis-iii';
  if (/\bartemis\s*(ii|2)\b/.test(normalized)) return 'artemis-ii';
  if (/\bartemis\s*(i|1)\b/.test(normalized)) return 'artemis-i';
  return 'program';
}

function missionLabelForKey(key: ArtemisContentMissionKey) {
  if (key === 'program') return 'Artemis Program';
  if (key === 'artemis-i') return 'Artemis I';
  if (key === 'artemis-ii') return 'Artemis II';
  if (key === 'artemis-iii') return 'Artemis III';
  if (key === 'artemis-iv') return 'Artemis IV';
  if (key === 'artemis-v') return 'Artemis V';
  if (key === 'artemis-vi') return 'Artemis VI';
  if (key === 'artemis-vii') return 'Artemis VII';
  return 'Artemis Program';
}

function mapSourceClassFromHost(host: string | null): ArtemisSourceClass {
  if (!host) return 'technical';
  if (host.endsWith('oig.nasa.gov') || host.endsWith('gao.gov')) return 'oversight';
  if (host.endsWith('usaspending.gov')) return 'procurement';
  if (host.endsWith('nasa.gov')) return 'nasa_primary';
  return 'technical';
}

function mapSourceTierFromHost(host: string | null): ArtemisSourceTier {
  if (!host) return 'tier2';
  if (host.endsWith('nasa.gov') || host.endsWith('gao.gov') || host.endsWith('usaspending.gov')) return 'tier1';
  return 'tier2';
}

function authorityScoreForClass(sourceClass: ArtemisSourceClass) {
  if (sourceClass === 'nasa_primary') return 0.97;
  if (sourceClass === 'oversight') return 0.94;
  if (sourceClass === 'budget') return 0.93;
  if (sourceClass === 'procurement') return 0.91;
  if (sourceClass === 'media') return 0.9;
  if (sourceClass === 'll2-cache') return 0.88;
  if (sourceClass === 'curated-fallback') return 0.5;
  return 0.65;
}

function relevanceScoreForMission(missionKey: ArtemisContentMissionKey, filter: ArtemisContentMissionFilter, text: string) {
  const normalized = text.toLowerCase();
  const mentionsMission = missionKey !== 'program' && normalized.includes(missionKey.replace('-', ' '));
  if (filter === 'all') return mentionsMission ? 0.9 : missionKey === 'program' ? 0.68 : 0.82;
  if (filter === 'program') return missionKey === 'program' ? 0.92 : 0.55;
  if (missionKey === filter) return 0.96;
  if (missionKey === 'program') return 0.62;
  return 0.42;
}

function freshnessScoreForDate(value: string | null | undefined) {
  const ms = parseDateOrZero(value);
  if (!ms) return 0.35;
  const ageHours = Math.max(0, (Date.now() - ms) / 3_600_000);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.78;
  if (ageHours <= 168) return 0.65;
  if (ageHours <= 720) return 0.5;
  return 0.35;
}

function stabilityScoreForTier(tier: ArtemisSourceTier) {
  return tier === 'tier1' ? 0.9 : 0.62;
}

function riskScoreForTier(tier: ArtemisSourceTier) {
  return tier === 'tier1' ? 0.92 : 0.6;
}

function overallScore({
  authority,
  relevance,
  freshness,
  stability,
  risk
}: {
  authority: number;
  relevance: number;
  freshness: number;
  stability: number;
  risk: number;
}) {
  return clampScore(
    authority * SCORE_WEIGHTS.authority +
      relevance * SCORE_WEIGHTS.relevance +
      freshness * SCORE_WEIGHTS.freshness +
      stability * SCORE_WEIGHTS.stability +
      risk * SCORE_WEIGHTS.risk
  );
}

function buildWhyShown({
  kind,
  sourceTier,
  sourceClass,
  missionKey,
  missionFilter,
  isAllowlisted
}: {
  kind: ArtemisContentKind;
  sourceTier: ArtemisSourceTier;
  sourceClass: ArtemisSourceClass;
  missionKey: ArtemisContentMissionKey;
  missionFilter: ArtemisContentMissionFilter;
  isAllowlisted: boolean;
}) {
  const missionPart = missionFilter === 'all' ? `mission mapped to ${missionLabelForKey(missionKey)}` : `matches ${missionLabelForKey(missionFilter as ArtemisContentMissionKey)}`;
  const allowlistPart = isAllowlisted ? 'official social post' : 'authority-tier ranked source';
  return `${sourceTier.toUpperCase()} ${sourceClass.replace(/_/g, ' ')} ${kind}; ${missionPart}; ${allowlistPart}.`;
}

function normalizeSourceClass(value: string | null | undefined): ArtemisSourceClass | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'nasa_primary' ||
    normalized === 'oversight' ||
    normalized === 'budget' ||
    normalized === 'procurement' ||
    normalized === 'technical' ||
    normalized === 'media' ||
    normalized === 'll2-cache' ||
    normalized === 'curated-fallback'
  ) {
    return normalized;
  }
  if (normalized === 'nasa-official') return 'nasa_primary';
  return null;
}

function normalizeSourceTier(value: string | null | undefined): ArtemisSourceTier | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'tier1' || normalized === 'tier-1') return 'tier1';
  if (normalized === 'tier2' || normalized === 'tier-2') return 'tier2';
  return null;
}

function normalizeContentKind(value: string | null | undefined): ArtemisContentKind | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'article' || normalized === 'photo' || normalized === 'social' || normalized === 'data') return normalized;
  return null;
}

function normalizeMissionKey(value: string | null | undefined): ArtemisContentMissionKey | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'program' || normalized === 'artemis-program') return 'program';
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return null;
}

function normalizePlatform(value: string | null | undefined) {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'twitter') return 'x';
  return normalized;
}

function normalizeHandle(value: string | null | undefined) {
  const normalized = normalizeText(value)?.replace(/^@+/, '').toLowerCase();
  return normalized || null;
}

function extractHandleFromSocialUrl(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('x.com') && !host.endsWith('twitter.com')) return null;

    const segments = parsed.pathname
      .split('/')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!segments.length) return null;

    const handle = normalizeHandle(segments[0]);
    if (!handle || handle === 'i') return null;
    return handle;
  } catch {
    return null;
  }
}

function getHostname(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function decodeCursor(value: string | null) {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  const truncated = Math.trunc(value);
  return Math.max(min, Math.min(max, truncated));
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

const DEFAULT_ALLOWLIST: AllowlistedAccount[] = [
  { platform: 'x', handle: 'nasa', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasaadmin', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasaartemis', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasa_orion', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasa_sls', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasa_johnson', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'nasa_kennedy', missionScope: 'program', tier: 'tier1' },
  { platform: 'x', handle: 'esa', missionScope: 'artemis-ii', tier: 'tier2' },
  { platform: 'x', handle: 'csa_asc', missionScope: 'artemis-ii', tier: 'tier2' },
  { platform: 'x', handle: 'spacex', missionScope: 'program', tier: 'tier2' }
];
