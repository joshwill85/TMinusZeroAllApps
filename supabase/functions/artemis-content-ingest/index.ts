import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyMission,
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  setSystemSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/artemisIngest.ts';
import { ARTEMIS_SOURCE_URLS, extractRssItems, fetchTextWithMeta, stripHtml } from '../_shared/artemisSources.ts';

type SourceType = 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';
type SourceClass = 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media' | 'll2-cache' | 'curated-fallback';
type SourceTier = 'tier1' | 'tier2';
type MissionKey = 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii' | 'artemis-iv' | 'artemis-v' | 'artemis-vi' | 'artemis-vii';
type ContentKind = 'article' | 'photo' | 'social' | 'data';

type RegistryRow = {
  source_key: string;
  source_type: string;
  source_tier: string;
  display_name: string;
  authority_score: number | null;
  active: boolean;
};

type RegistryEntry = {
  key: string;
  label: string;
  sourceType: SourceType;
  sourceClass: SourceClass;
  sourceTier: SourceTier;
  authority: number;
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

type NasaRssItem = {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  categories?: string[];
  imageUrl?: string | null;
};

type SourceDocumentRow = {
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

type LaunchSocialCandidateRow = {
  launch_id: string;
  platform: string | null;
  account_handle: string | null;
  external_post_id: string | null;
  post_url: string | null;
  post_text: string | null;
  posted_at: string | null;
  fetched_at: string | null;
  raw_payload: Record<string, unknown> | null;
};

type TimelineMediaRow = {
  mediaKey: string | null;
  type: string;
  normalizedUrl: string | null;
  width: number | null;
  height: number | null;
  altText: string | null;
};

type TimelineTweetRow = {
  id: string;
  url: string;
  text: string;
  createdAt: string | null;
  media: TimelineMediaRow[];
  handle: string;
};

type BudgetRow = {
  fiscal_year: number | null;
  agency: string | null;
  program: string | null;
  line_item: string | null;
  amount_requested: number | null;
  amount_enacted: number | null;
  announced_time: string | null;
  source_document_id: string | null;
};

type ProcurementRow = {
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown> | null;
};

type SourceDocLookupRow = {
  id: string;
  url: string;
  title: string | null;
};

type SocialAccountRow = {
  platform: string;
  handle: string;
  mission_scope: string;
  source_tier: string;
  active: boolean;
};

type AllowlistedAccount = {
  platform: string;
  handle: string;
  missionScope: MissionKey;
  sourceTier: SourceTier;
};

type ExistingContentRow = {
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
};

type ContentCandidate = {
  fingerprint: string;
  kind: ContentKind;
  mission_key: MissionKey;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  captured_at: string;
  source_key: string | null;
  source_type: SourceType;
  source_class: SourceClass;
  source_tier: SourceTier;
  authority_score: number;
  relevance_score: number;
  freshness_score: number;
  overall_score: number;
  image_url: string | null;
  external_id: string | null;
  platform: string | null;
  data_label: string | null;
  data_value: number | null;
  data_unit: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type IngestError = {
  step: string;
  error: string;
  context?: Record<string, unknown>;
};

const CHECKPOINT_KEY = 'artemis_content_hourly';
const RUN_NAME = 'artemis_content_ingest';
const BACKFILL_ONCE_KEY = 'artemis_content_backfill_once_enabled';
const BACKFILL_PHOTO_DAYS_KEY = 'artemis_content_backfill_photo_days';
const BACKFILL_SOCIAL_DAYS_KEY = 'artemis_content_backfill_social_days';
const DEFAULT_BACKFILL_PHOTO_DAYS = 90;
const DEFAULT_BACKFILL_SOCIAL_DAYS = 30;
const MAX_ARTICLE_ROWS = 96;
const MAX_NASA_RSS_ITEMS = 120;
const MAX_PHOTO_DOC_ROWS = 12;
const MAX_PHOTOS_PER_DOC = 12;
const MAX_NASA_API_PHOTOS = 36;
const MAX_SOCIAL_PHOTO_ROWS = 220;
const MAX_SOCIAL_PHOTOS_PER_POST = 4;
const MAX_X_HISTORY_ACCOUNTS = 5;
const MAX_X_HISTORY_TWEETS_PER_ACCOUNT = 60;
const MAX_X_SOCIAL_HISTORY_ACCOUNTS = 12;
const MAX_X_SOCIAL_HISTORY_TWEETS_PER_ACCOUNT = 40;
const X_TIMELINE_TIMEOUT_MS = 12000;
const MAX_SOCIAL_ROWS = 120;
const MAX_BUDGET_ROWS = 64;
const MAX_PROCUREMENT_ROWS = 64;
const UPSERT_CHUNK = 200;
const LOOKUP_CHUNK = 200;

const SCORE_WEIGHTS = {
  authority: 0.45,
  relevance: 0.25,
  freshness: 0.15,
  stability: 0.1,
  risk: 0.05
} as const;

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAtMs = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, RUN_NAME);

  const stats: Record<string, unknown> = {
    cursor: null as string | null,
    nextCursor: null as string | null,
    sourceSince: {
      articles: null as string | null,
      photos: null as string | null,
      social: null as string | null,
      data: null as string | null
    },
    backfill: {
      enabled: false,
      photoDays: DEFAULT_BACKFILL_PHOTO_DAYS,
      socialDays: DEFAULT_BACKFILL_SOCIAL_DAYS,
      consumed: false,
      autoDisabled: false
    },
    sourceRowsScanned: {
      articles: 0,
      photoDocs: 0,
      socialPhotoCandidates: 0,
      socialLaunches: 0,
      socialTimelineAccounts: 0,
      socialTimelineTweets: 0,
      nasaRssItems: 0,
      budgetLines: 0,
      procurementAwards: 0
    },
    candidateRejects: {
      photos: {
        missingPayload: 0,
        noMedia: 0,
        noImageUrl: 0,
        beforeWindow: 0,
        noHandle: 0,
        notAllowlisted: 0,
        notArtemis: 0,
        notPhotoType: 0
      },
      social: {
        noUrl: 0,
        beforeWindow: 0,
        noHandle: 0,
        notAllowlisted: 0,
        notArtemis: 0
      }
    },
    candidatesBuilt: 0,
    dedupedCandidates: 0,
    unchangedSkipped: 0,
    upserted: 0,
    sourceRegistryEntries: 0,
    allowlistedAccounts: 0,
    errors: [] as IngestError[]
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_content_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAtMs });
    }

    const checkpointRes = await supabase
      .from('artemis_ingest_checkpoints')
      .select('cursor')
      .eq('source_key', CHECKPOINT_KEY)
      .maybeSingle();

    const checkpointCursor = toIsoOrNull(asString(checkpointRes.data?.cursor));
    stats.cursor = checkpointCursor;

    const backfillEnabled = await readBooleanSetting(supabase, BACKFILL_ONCE_KEY, false);
    const photoBackfillDays = await readIntegerSetting(supabase, BACKFILL_PHOTO_DAYS_KEY, DEFAULT_BACKFILL_PHOTO_DAYS, 7, 3650);
    const socialBackfillDays = await readIntegerSetting(supabase, BACKFILL_SOCIAL_DAYS_KEY, DEFAULT_BACKFILL_SOCIAL_DAYS, 7, 1095);
    const photoSince = resolveSourceSince({
      cursor: checkpointCursor,
      runStartedAtIso,
      backfillEnabled,
      lookbackDays: photoBackfillDays
    });
    const socialSince = resolveSourceSince({
      cursor: checkpointCursor,
      runStartedAtIso,
      backfillEnabled,
      lookbackDays: socialBackfillDays
    });

    stats.sourceSince = {
      articles: checkpointCursor,
      photos: photoSince,
      social: socialSince,
      data: checkpointCursor
    };
    stats.backfill = {
      enabled: backfillEnabled,
      photoDays: photoBackfillDays,
      socialDays: socialBackfillDays,
      consumed: false,
      autoDisabled: false
    };

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'technical',
      status: 'running',
      startedAt: runStartedAtIso,
      cursor: checkpointCursor,
      lastError: null
    });

    const [registry, allowlistedAccounts] = await Promise.all([loadRegistry(supabase), loadAllowlistedAccounts(supabase)]);
    stats.sourceRegistryEntries = registry.size;
    stats.allowlistedAccounts = allowlistedAccounts.length;

    const [articles, photos, social, dataItems] = await Promise.all([
      fetchArticleCandidates({ supabase, cursor: checkpointCursor, registry, nowIso: runStartedAtIso, stats }),
      fetchPhotoCandidates({ supabase, since: photoSince, registry, allowlistedAccounts, nowIso: runStartedAtIso, stats }),
      fetchSocialCandidates({ supabase, since: socialSince, registry, allowlistedAccounts, nowIso: runStartedAtIso, stats }),
      fetchDataCandidates({ supabase, cursor: checkpointCursor, registry, nowIso: runStartedAtIso, stats })
    ]);

    const health = evaluateCandidateHealth(stats, { socialCandidates: social.length, allowlistedAccounts: allowlistedAccounts.length });
    stats.health = health;
    if (!health.ok) {
      for (const issue of health.issues) {
        (stats.errors as IngestError[]).push({ step: issue.step, error: issue.error, context: issue.context });
      }
    }

    const merged = dedupeCandidates([...articles, ...photos, ...social, ...dataItems]);
    stats.candidatesBuilt = articles.length + photos.length + social.length + dataItems.length;
    stats.dedupedCandidates = merged.length;

    if (!merged.length) {
      if (backfillEnabled) {
        const autoDisabled = await consumeBackfillOnce(supabase, stats);
        stats.backfill = {
          ...(asRecord(stats.backfill) || {}),
          consumed: true,
          autoDisabled
        };
      }

      stats.nextCursor = runStartedAtIso;
      await updateCheckpoint(supabase, CHECKPOINT_KEY, {
        sourceType: 'technical',
        status: 'complete',
        cursor: runStartedAtIso,
        recordsIngested: 0,
        endedAt: new Date().toISOString(),
        lastAnnouncedTime: runStartedAtIso,
        lastError: null,
        metadata: {
          sourceSince: stats.sourceSince,
          upserted: 0,
          unchangedSkipped: 0,
          candidatesBuilt: 0,
          dedupedCandidates: 0,
          candidateRejects: stats.candidateRejects,
          backfill: stats.backfill,
          health: stats.health || null
        }
      });

      await finishIngestionRun(supabase, runId, true, stats);
      return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAtMs, stats });
    }

    const fingerprints = merged.map((item) => item.fingerprint);
    const existingByFingerprint = await loadExistingByFingerprint(supabase, fingerprints);

    const toUpsert: ContentCandidate[] = [];
    let unchangedSkipped = 0;
    for (const candidate of merged) {
      const existing = existingByFingerprint.get(candidate.fingerprint);
      const mergedCandidate = mergeCandidateWithExisting(candidate, existing);
      if (existing && rowsEquivalent(existing, mergedCandidate)) {
        unchangedSkipped += 1;
        continue;
      }
      toUpsert.push(mergedCandidate);
    }

    stats.unchangedSkipped = unchangedSkipped;

    let upserted = 0;
    for (const chunk of chunkArray(toUpsert, UPSERT_CHUNK)) {
      if (!chunk.length) continue;
      const { error } = await supabase.from('artemis_content_items').upsert(chunk, { onConflict: 'fingerprint' });
      if (error) throw error;
      upserted += chunk.length;
    }

    stats.upserted = upserted;

    const nextCursor = resolveNextCursor(merged, runStartedAtIso);
    stats.nextCursor = nextCursor;

    if (backfillEnabled) {
      const autoDisabled = await consumeBackfillOnce(supabase, stats);
      stats.backfill = {
        ...(asRecord(stats.backfill) || {}),
        consumed: true,
        autoDisabled
      };
    }

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'technical',
      status: 'complete',
      cursor: nextCursor,
      recordsIngested: upserted,
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: nextCursor,
      lastError: null,
      metadata: {
        sourceRowsScanned: stats.sourceRowsScanned,
        candidatesBuilt: stats.candidatesBuilt,
        dedupedCandidates: stats.dedupedCandidates,
        unchangedSkipped,
        upserted,
        sourceSince: stats.sourceSince,
        candidateRejects: stats.candidateRejects,
        backfill: stats.backfill,
        health: stats.health || null
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAtMs, stats });
  } catch (error) {
    const message = stringifyError(error);
    (stats.errors as IngestError[]).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'technical',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAtMs, stats }, 500);
  }
});

async function fetchArticleCandidates({
  supabase,
  cursor,
  registry,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  cursor: string | null;
  registry: Map<string, RegistryEntry>;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  const [rssItems, snapiRows] = await Promise.all([
    fetchNasaRssArticleCandidates({ supabase, registry, nowIso, stats }),
    fetchSnapiArticleCandidates({ supabase, cursor, registry, nowIso, stats })
  ]);

  setScannedCount(stats, 'articles', rssItems.length + snapiRows.length);
  return [...rssItems, ...snapiRows];
}

async function fetchSnapiArticleCandidates({
  supabase,
  cursor,
  registry,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  cursor: string | null;
  registry: Map<string, RegistryEntry>;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  let query = supabase
    .from('snapi_items')
    .select('snapi_uid,item_type,title,url,news_site,summary,image_url,published_at')
    .or('title.ilike.%Artemis%,summary.ilike.%Artemis%')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ARTICLE_ROWS);

  if (cursor) query = query.gte('published_at', cursor);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as SnapiRow[];

  const source = registry.get('snapi_artemis') || defaultSource('snapi_artemis', 'SNAPI Artemis relevance', 'technical', 'technical', 'tier2', 0.62);
  const out: ContentCandidate[] = [];

  for (const row of rows) {
    if (!row.snapi_uid || !row.title || !row.url) continue;

    const text = `${row.title} ${row.summary || ''}`;
    const missionKey = normalizeMissionKey(classifyMission(text));
    const publishedAt = toIsoOrNull(row.published_at) || nowIso;

    const authority = source.authority;
    const relevance = relevanceScoreForMission(missionKey, text);
    const freshness = freshnessScoreForDate(publishedAt);
    const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(source.sourceTier), riskScore(source.sourceTier));

    out.push({
      fingerprint: `article:snapi:${row.snapi_uid}`,
      kind: 'article',
      mission_key: missionKey,
      title: row.title.trim(),
      summary: normalizeText(row.summary),
      url: row.url,
      published_at: publishedAt,
      captured_at: publishedAt,
      source_key: source.key,
      source_type: source.sourceType,
      source_class: source.sourceClass,
      source_tier: source.sourceTier,
      authority_score: authority,
      relevance_score: relevance,
      freshness_score: freshness,
      overall_score: overall,
      image_url: normalizeText(row.image_url),
      external_id: row.snapi_uid,
      platform: null,
      data_label: null,
      data_value: null,
      data_unit: null,
      metadata: {
        itemType: row.item_type,
        newsSite: row.news_site || null
      },
      updated_at: nowIso
    });
  }

  return out;
}

async function fetchNasaRssArticleCandidates({
  supabase,
  registry,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  registry: Map<string, RegistryEntry>;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  const out: ContentCandidate[] = [];

  const rssSource =
    registry.get('nasa_rss') || defaultSource('nasa_rss', 'NASA Artemis RSS', 'nasa_primary', 'nasa_primary', 'tier1', 0.97);
  const blogSource =
    registry.get('nasa_blog_posts') || defaultSource('nasa_blog_posts', 'NASA Artemis Blog', 'nasa_primary', 'nasa_primary', 'tier1', 0.96);

  let items: NasaRssItem[] = [];
  let docId: string | null = null;
  let docUrl: string | null = null;

  const { data: doc, error } = await supabase
    .from('artemis_source_documents')
    .select('id,url,fetched_at,raw')
    .eq('source_key', 'nasa_rss')
    .order('fetched_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    (stats.errors as IngestError[]).push({ step: 'nasa_rss_doc_query', error: error.message });
  } else if (doc) {
    docId = (doc as any).id || null;
    docUrl = (doc as any).url || null;
    const raw = asRecord((doc as any).raw);
    const rawItems = Array.isArray(raw?.items) ? (raw.items as unknown[]) : [];
    items = rawItems
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        title: String(entry.title || ''),
        link: String(entry.link || ''),
        pubDate: String(entry.pubDate || ''),
        description: String(entry.description || ''),
        categories: Array.isArray(entry.categories) ? entry.categories.map((value) => String(value)) : [],
        imageUrl: typeof entry.imageUrl === 'string' ? entry.imageUrl : null
      }));
  }

  if (!items.length) {
    const [missionsFeed, blogFeed] = await Promise.all([
      fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaMissionsFeed),
      fetchTextWithMeta(ARTEMIS_SOURCE_URLS.nasaBlogFeed)
    ]);
    items = [...(extractRssItems(missionsFeed.text) as unknown as NasaRssItem[]), ...(extractRssItems(blogFeed.text) as unknown as NasaRssItem[])];
  }

  setScannedCount(stats, 'nasaRssItems', items.length);

  for (const item of items.slice(0, MAX_NASA_RSS_ITEMS)) {
    const title = normalizeText(item.title);
    const link = normalizeText(item.link);
    if (!title || !link) continue;

    const description = normalizeText(item.description);
    const summary = description ? stripHtml(description) : null;
    const publishedAt = toIsoOrNull(item.pubDate) || nowIso;
    const missionKey = inferMissionFromText(`${title} ${summary || ''}`);

    const source = isNasaBlogLink(link) ? blogSource : rssSource;
    const authority = source.authority;
    const relevance = relevanceScoreForMission(missionKey, `${title} ${summary || ''}`);
    const freshness = freshnessScoreForDate(publishedAt);
    const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(source.sourceTier), riskScore(source.sourceTier));

    out.push({
      fingerprint: `article:nasa:${link}`,
      kind: 'article',
      mission_key: missionKey,
      title,
      summary,
      url: link,
      published_at: publishedAt,
      captured_at: publishedAt,
      source_key: source.key,
      source_type: source.sourceType,
      source_class: source.sourceClass,
      source_tier: source.sourceTier,
      authority_score: authority,
      relevance_score: relevance,
      freshness_score: freshness,
      overall_score: overall,
      image_url: normalizeText(item.imageUrl),
      external_id: null,
      platform: null,
      data_label: null,
      data_value: null,
      data_unit: null,
      metadata: {
        categories: item.categories || [],
        sourceDocumentId: docId,
        sourceDocumentUrl: docUrl,
        feedSourceKey: rssSource.key
      },
      updated_at: nowIso
    });
  }

  return out;
}

async function fetchPhotoCandidates({
  supabase,
  since,
  registry,
  allowlistedAccounts,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  since: string | null;
  registry: Map<string, RegistryEntry>;
  allowlistedAccounts: AllowlistedAccount[];
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  let query = supabase
    .from('artemis_source_documents')
    .select('id,source_key,source_type,url,title,published_at,fetched_at,raw')
    .eq('source_key', 'nasa_media_assets')
    .order('fetched_at', { ascending: false, nullsFirst: false })
    .limit(MAX_PHOTO_DOC_ROWS);

  if (since) query = query.gte('fetched_at', since);

  const { data, error } = await query;
  if (error) throw error;

  const docs = (data || []) as SourceDocumentRow[];
  setScannedCount(stats, 'photoDocs', docs.length);

  const source = registry.get('nasa_media_assets') || defaultSource('nasa_media_assets', 'NASA Images API', 'media', 'media', 'tier1', 0.95);
  const socialSource = registry.get('launch_social_links') || defaultSource('launch_social_links', 'Launch-linked social', 'media', 'media', 'tier1', 0.9);
  const out: ContentCandidate[] = [];
  const sinceMs = parseDateOrZero(since);

  for (const doc of docs) {
    const raw = asRecord(doc.raw);
    const collection = asRecord(raw?.collection);
    const items = Array.isArray(collection?.items) ? (collection.items as unknown[]) : [];
    if (!items.length) {
      incrementRejectCount(stats, ['photos', 'missingPayload']);
      continue;
    }

    for (const rawItem of items.slice(0, MAX_PHOTOS_PER_DOC)) {
      const item = asRecord(rawItem);
      if (!item) continue;

      const dataRows = Array.isArray(item.data) ? item.data : [];
      const dataRow = asRecord(dataRows[0]);
      const links = Array.isArray(item.links) ? item.links : [];
      const imageLink = links
        .map((entry) => asRecord(entry))
        .find((entry) => typeof entry?.href === 'string' && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(String(entry.href)));

      const title = normalizeText(dataRow?.title) || normalizeText(doc.title) || 'NASA Artemis image';
      const description = normalizeText(dataRow?.description);
      if (!containsArtemisKeyword(`${title} ${description || ''}`)) {
        incrementRejectCount(stats, ['photos', 'notArtemis']);
        continue;
      }
      const nasaId = normalizeText(dataRow?.nasa_id);
      const publishedAt =
        toIsoOrNull(normalizeText(dataRow?.date_created)) ||
        toIsoOrNull(doc.published_at) ||
        toIsoOrNull(doc.fetched_at) ||
        nowIso;
      const capturedAt = toIsoOrNull(doc.fetched_at) || publishedAt;
      const missionKey = inferMissionFromText(`${title} ${description || ''}`);
      const authority = source.authority;
      const relevance = relevanceScoreForMission(missionKey, `${title} ${description || ''}`);
      const freshness = freshnessScoreForDate(publishedAt);
      const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(source.sourceTier), riskScore(source.sourceTier));
      const detailUrl = nasaId ? `https://images.nasa.gov/details-${encodeURIComponent(nasaId)}` : doc.url;
      const imageUrl = normalizeText(imageLink?.href);

      if (!detailUrl) continue;
      if (!imageUrl) {
        incrementRejectCount(stats, ['photos', 'noImageUrl']);
        continue;
      }

      out.push({
        fingerprint: `photo:${nasaId || `${doc.id}:${title}`}`,
        kind: 'photo',
        mission_key: missionKey,
        title,
        summary: description,
        url: detailUrl,
        published_at: publishedAt,
        captured_at: capturedAt,
        source_key: source.key,
        source_type: source.sourceType,
        source_class: source.sourceClass,
        source_tier: source.sourceTier,
        authority_score: authority,
        relevance_score: relevance,
        freshness_score: freshness,
        overall_score: overall,
        image_url: imageUrl,
        external_id: nasaId,
        platform: null,
        data_label: null,
        data_value: null,
        data_unit: null,
        metadata: {
          sourceDocumentId: doc.id,
          sourceDocumentUrl: doc.url,
          nasaId
        },
        updated_at: nowIso
      });
    }
  }

  if (out.length < 8) {
    const liveItems = await fetchLiveNasaImageItems(stats);
    for (const rawItem of liveItems.slice(0, MAX_NASA_API_PHOTOS)) {
      const item = asRecord(rawItem);
      if (!item) continue;

      const dataRows = Array.isArray(item.data) ? item.data : [];
      const dataRow = asRecord(dataRows[0]);
      const links = Array.isArray(item.links) ? item.links : [];
      const imageLink = links
        .map((entry) => asRecord(entry))
        .find((entry) => typeof entry?.href === 'string' && /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(String(entry.href)));

      const title = normalizeText(dataRow?.title) || 'NASA Artemis image';
      const description = normalizeText(dataRow?.description);
      if (!containsArtemisKeyword(`${title} ${description || ''}`)) {
        incrementRejectCount(stats, ['photos', 'notArtemis']);
        continue;
      }

      const nasaId = normalizeText(dataRow?.nasa_id);
      const publishedAt = toIsoOrNull(normalizeText(dataRow?.date_created)) || nowIso;
      if (sinceMs && parseDateOrZero(publishedAt) < sinceMs) {
        incrementRejectCount(stats, ['photos', 'beforeWindow']);
        continue;
      }

      const imageUrl = normalizeText(imageLink?.href);
      if (!imageUrl) {
        incrementRejectCount(stats, ['photos', 'noImageUrl']);
        continue;
      }

      const missionKey = inferMissionFromText(`${title} ${description || ''}`);
      const authority = source.authority;
      const relevance = relevanceScoreForMission(missionKey, `${title} ${description || ''}`);
      const freshness = freshnessScoreForDate(publishedAt);
      const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(source.sourceTier), riskScore(source.sourceTier));

      out.push({
        fingerprint: `photo:live:${nasaId || imageUrl}`,
        kind: 'photo',
        mission_key: missionKey,
        title,
        summary: description,
        url: nasaId ? `https://images.nasa.gov/details-${encodeURIComponent(nasaId)}` : imageUrl,
        published_at: publishedAt,
        captured_at: nowIso,
        source_key: source.key,
        source_type: source.sourceType,
        source_class: source.sourceClass,
        source_tier: source.sourceTier,
        authority_score: authority,
        relevance_score: relevance,
        freshness_score: freshness,
        overall_score: overall,
        image_url: imageUrl,
        external_id: nasaId,
        platform: null,
        data_label: null,
        data_value: null,
        data_unit: null,
        metadata: {
          sourceDocumentId: null,
          sourceDocumentUrl: 'https://images-api.nasa.gov/search?q=Artemis&media_type=image&page=1',
          nasaId,
          liveFetch: true
        },
        updated_at: nowIso
      });
    }
  }

  let socialPhotoQuery = supabase
    .from('launch_social_candidates')
    .select('launch_id,platform,account_handle,external_post_id,post_url,post_text,posted_at,fetched_at,raw_payload')
    .eq('platform', 'x')
    .order('fetched_at', { ascending: false, nullsFirst: false })
    .limit(MAX_SOCIAL_PHOTO_ROWS);

  if (since) socialPhotoQuery = socialPhotoQuery.gte('fetched_at', since);

  const { data: socialPhotoRowsRaw, error: socialPhotoError } = await socialPhotoQuery;
  if (socialPhotoError) throw socialPhotoError;

  const socialPhotoRows = (socialPhotoRowsRaw || []) as LaunchSocialCandidateRow[];
  setScannedCount(stats, 'socialPhotoCandidates', socialPhotoRows.length);

  for (const row of socialPhotoRows) {
    const postText = normalizeText(row.post_text) || '';
    const missionKey = inferMissionFromText(postText);
    const handle = normalizeHandle(row.account_handle);
    if (!handle) {
      incrementRejectCount(stats, ['photos', 'noHandle']);
      continue;
    }

    const allowlisted = findAllowlistedAccount(allowlistedAccounts, row.platform || 'x', handle, missionKey);
    if (!allowlisted) {
      incrementRejectCount(stats, ['photos', 'notAllowlisted']);
      continue;
    }

    if (!containsArtemisKeyword(postText)) {
      incrementRejectCount(stats, ['photos', 'notArtemis']);
      continue;
    }

    const postedAt = toIsoOrNull(row.posted_at) || toIsoOrNull(row.fetched_at) || nowIso;
    if (sinceMs && parseDateOrZero(postedAt) < sinceMs) {
      incrementRejectCount(stats, ['photos', 'beforeWindow']);
      continue;
    }

    const payload = asRecord(row.raw_payload);
    const mediaRows = Array.isArray(payload?.media) ? payload.media : [];
    if (!mediaRows.length) {
      incrementRejectCount(stats, ['photos', 'noMedia']);
      continue;
    }

    for (const [index, rawMedia] of mediaRows.slice(0, MAX_SOCIAL_PHOTOS_PER_POST).entries()) {
      const media = asRecord(rawMedia);
      if (!media) continue;

      const mediaType = normalizeText(media.type)?.toLowerCase() || 'photo';
      if (mediaType !== 'photo') {
        incrementRejectCount(stats, ['photos', 'notPhotoType']);
        continue;
      }

      const imageUrl = normalizePhotoUrl(
        media.normalizedUrl,
        media.normalized_url,
        media.media_url_https,
        media.media_url,
        media.image_url,
        media.url
      );
      if (!imageUrl) {
        incrementRejectCount(stats, ['photos', 'noImageUrl']);
        continue;
      }

      const mediaKey = normalizeText(media.mediaKey) || normalizeText(media.media_key) || String(index + 1);
      const authority = socialSource.authority;
      const relevance = relevanceScoreForMission(missionKey, postText);
      const freshness = freshnessScoreForDate(postedAt);
      const overall = weightedOverallScore(
        authority,
        relevance,
        freshness,
        stabilityScore(allowlisted.sourceTier),
        riskScore(allowlisted.sourceTier)
      );
      const postUrl = normalizeText(row.post_url) || imageUrl;
      const handleLabel = `@${handle}`;

      out.push({
        fingerprint: `photo:social:${row.external_post_id || row.launch_id}:${mediaKey}:${imageUrl}`,
        kind: 'photo',
        mission_key: missionKey,
        title: `${handleLabel} Artemis photo`,
        summary: postText || null,
        url: postUrl,
        published_at: postedAt,
        captured_at: postedAt,
        source_key: socialSource.key,
        source_type: socialSource.sourceType,
        source_class: socialSource.sourceClass,
        source_tier: allowlisted.sourceTier,
        authority_score: authority,
        relevance_score: relevance,
        freshness_score: freshness,
        overall_score: overall,
        image_url: imageUrl,
        external_id: normalizeText(row.external_post_id) ? `${normalizeText(row.external_post_id)}:${mediaKey}` : mediaKey,
        platform: 'x',
        data_label: null,
        data_value: null,
        data_unit: null,
        metadata: {
          launchId: row.launch_id,
          postUrl: row.post_url,
          account: handle,
          mediaKey,
          mediaType
        },
        updated_at: nowIso
      });
    }
  }

  const timelinePhotos = await fetchTimelinePhotoCandidates({
    allowlistedAccounts,
    source: socialSource,
    sinceMs,
    nowIso,
    stats
  });
  out.push(...timelinePhotos);

  return out;
}

async function fetchLiveNasaImageItems(stats: Record<string, unknown>) {
  const url = 'https://images-api.nasa.gov/search?q=Artemis&media_type=image&page=1';
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'TMinusZero/0.1 (support@tminuszero.app)'
      }
    });
    if (!response.ok) return [] as unknown[];

    const body = await response.text();
    const parsed = body ? JSON.parse(body) : null;
    const collection = asRecord(asRecord(parsed)?.collection);
    const items = Array.isArray(collection?.items) ? (collection.items as unknown[]) : [];
    return items;
  } catch (error) {
    (stats.errors as IngestError[]).push({
      step: 'photos_live_nasa_fetch',
      error: stringifyError(error)
    });
    return [] as unknown[];
  }
}

async function fetchTimelinePhotoCandidates({
  allowlistedAccounts,
  source,
  sinceMs,
  nowIso,
  stats
}: {
  allowlistedAccounts: AllowlistedAccount[];
  source: RegistryEntry;
  sinceMs: number;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  const handles = [...new Set(allowlistedAccounts.filter((entry) => entry.platform === 'x' && entry.handle.startsWith('nasa')).map((entry) => entry.handle))].slice(
    0,
    MAX_X_HISTORY_ACCOUNTS
  );

  const out: ContentCandidate[] = [];
  for (const handle of handles) {
    const tweets = await fetchTimelineTweets(handle, stats);
    for (const tweet of tweets.slice(0, MAX_X_HISTORY_TWEETS_PER_ACCOUNT)) {
      const missionKey = inferMissionFromText(tweet.text);
      const allowlisted = findAllowlistedAccount(allowlistedAccounts, 'x', handle, missionKey);
      if (!allowlisted) {
        incrementRejectCount(stats, ['photos', 'notAllowlisted']);
        continue;
      }

      if (!containsArtemisKeyword(tweet.text)) {
        incrementRejectCount(stats, ['photos', 'notArtemis']);
        continue;
      }

      const postedAt = toIsoOrNull(tweet.createdAt) || nowIso;
      if (sinceMs && parseDateOrZero(postedAt) < sinceMs) {
        incrementRejectCount(stats, ['photos', 'beforeWindow']);
        continue;
      }

      if (!tweet.media.length) {
        incrementRejectCount(stats, ['photos', 'noMedia']);
        continue;
      }

      for (const [index, media] of tweet.media.slice(0, MAX_SOCIAL_PHOTOS_PER_POST).entries()) {
        if (media.type !== 'photo') {
          incrementRejectCount(stats, ['photos', 'notPhotoType']);
          continue;
        }

        const imageUrl = normalizePhotoUrl(media.normalizedUrl);
        if (!imageUrl) {
          incrementRejectCount(stats, ['photos', 'noImageUrl']);
          continue;
        }

        const mediaKey = media.mediaKey || String(index + 1);
        const authority = source.authority;
        const relevance = relevanceScoreForMission(missionKey, tweet.text);
        const freshness = freshnessScoreForDate(postedAt);
        const overall = weightedOverallScore(
          authority,
          relevance,
          freshness,
          stabilityScore(allowlisted.sourceTier),
          riskScore(allowlisted.sourceTier)
        );
        const handleLabel = `@${handle}`;

        out.push({
          fingerprint: `photo:timeline:${handle}:${tweet.id}:${mediaKey}`,
          kind: 'photo',
          mission_key: missionKey,
          title: `${handleLabel} Artemis photo`,
          summary: normalizeText(tweet.text),
          url: tweet.url,
          published_at: postedAt,
          captured_at: postedAt,
          source_key: source.key,
          source_type: source.sourceType,
          source_class: source.sourceClass,
          source_tier: allowlisted.sourceTier,
          authority_score: authority,
          relevance_score: relevance,
          freshness_score: freshness,
          overall_score: overall,
          image_url: imageUrl,
          external_id: `${tweet.id}:${mediaKey}`,
          platform: 'x',
          data_label: null,
          data_value: null,
          data_unit: null,
          metadata: {
            account: handle,
            mediaKey,
            mediaType: media.type,
            fromTimelineHistory: true
          },
          updated_at: nowIso
        });
      }
    }
  }

  return out;
}

async function fetchTimelineTweets(handle: string, stats: Record<string, unknown>) {
  const safeHandle = normalizeHandle(handle);
  if (!safeHandle) return [] as TimelineTweetRow[];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), X_TIMELINE_TIMEOUT_MS);

  try {
    const response = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(safeHandle)}`, {
      headers: {
        accept: 'text/html',
        'user-agent': 'TMinusZero/0.1 (support@tminuszero.app)'
      },
      signal: controller.signal
    });
    if (!response.ok) {
      (stats.errors as IngestError[]).push({
        step: `timeline_fetch_non_200:${safeHandle}`,
        error: `http_${response.status}`,
        context: { status: response.status }
      });
      return [] as TimelineTweetRow[];
    }

    const html = await response.text();
    const payload = extractNextDataPayload(html);
    if (!payload) {
      (stats.errors as IngestError[]).push({
        step: `timeline_fetch_missing_payload:${safeHandle}`,
        error: 'missing_next_data'
      });
      return [] as TimelineTweetRow[];
    }

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      (stats.errors as IngestError[]).push({
        step: `timeline_fetch_parse_error:${safeHandle}`,
        error: 'invalid_next_data_json'
      });
      return [] as TimelineTweetRow[];
    }

    const entries = asRecord(asRecord(asRecord(parsed)?.props)?.pageProps)?.timeline;
    const rows = Array.isArray(asRecord(entries)?.entries) ? (asRecord(entries)?.entries as unknown[]) : [];

    const out: TimelineTweetRow[] = [];
    const seen = new Set<string>();
    for (const entry of rows) {
      const tweet = asRecord(asRecord(entry)?.content)?.tweet;
      if (!tweet) continue;

      const id = normalizeText(tweet.id_str) || normalizeText(tweet.id);
      if (!id || seen.has(id)) continue;

      const text = normalizeText(tweet.full_text) || normalizeText(tweet.text);
      if (!text) continue;

      const permalink = normalizeText(tweet.permalink);
      const url = permalink
        ? `https://x.com${permalink.startsWith('/') ? permalink : `/${permalink}`}`
        : `https://x.com/${encodeURIComponent(safeHandle)}/status/${encodeURIComponent(id)}`;
      const media = extractTimelineMedia(tweet);

      seen.add(id);
      out.push({
        id,
        url,
        text,
        createdAt: normalizeText(tweet.created_at),
        media,
        handle: safeHandle
      });
    }

    out.sort((a, b) => parseDateOrZero(b.createdAt) - parseDateOrZero(a.createdAt));
    return out;
  } catch (error) {
    (stats.errors as IngestError[]).push({
      step: `timeline_fetch_exception:${safeHandle}`,
      error: stringifyError(error)
    });
    return [] as TimelineTweetRow[];
  } finally {
    clearTimeout(timeout);
  }
}

function extractTimelineMedia(tweet: Record<string, unknown>) {
  const candidates = [tweet, asRecord(tweet.retweeted_status), asRecord(tweet.quoted_status)].filter(
    (value): value is Record<string, unknown> => Boolean(value)
  );

  const out: TimelineMediaRow[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const mediaRows = [
      ...readTimelineMediaRows(candidate.extended_entities),
      ...readTimelineMediaRows(candidate.entities),
      ...readTimelineMediaRows(asRecord(candidate.retweeted_status)?.extended_entities),
      ...readTimelineMediaRows(asRecord(candidate.retweeted_status)?.entities),
      ...readTimelineMediaRows(asRecord(candidate.quoted_status)?.extended_entities),
      ...readTimelineMediaRows(asRecord(candidate.quoted_status)?.entities)
    ];

    for (const mediaRow of mediaRows) {
      const mediaKey = normalizeText(mediaRow.media_key) || normalizeText(mediaRow.id_str) || normalizeText(mediaRow.id);
      const normalizedUrl = normalizePhotoUrl(mediaRow.media_url_https, mediaRow.media_url);
      if (!normalizedUrl) continue;

      const dedupe = mediaKey ? `key:${mediaKey}` : `url:${normalizedUrl}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const largest = largestMediaSize(mediaRow);
      out.push({
        mediaKey,
        type: normalizeText(mediaRow.type)?.toLowerCase() || 'photo',
        normalizedUrl,
        width: largest.width,
        height: largest.height,
        altText: normalizeText(mediaRow.ext_alt_text) || normalizeText(mediaRow.alt_text)
      });
    }
  }

  return out.slice(0, 8);
}

function readTimelineMediaRows(value: unknown) {
  const record = asRecord(value);
  const rows = Array.isArray(record?.media) ? record.media : [];
  return rows
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function largestMediaSize(media: Record<string, unknown>) {
  const sizes = asRecord(media.sizes);
  if (!sizes) return { width: null as number | null, height: null as number | null };

  let width: number | null = null;
  let height: number | null = null;
  for (const value of Object.values(sizes)) {
    const row = asRecord(value);
    if (!row) continue;

    const rowWidth = finiteNumberOrNull(row.w);
    const rowHeight = finiteNumberOrNull(row.h);
    if (rowWidth == null || rowHeight == null) continue;

    const currentArea = width != null && height != null ? width * height : -1;
    const nextArea = rowWidth * rowHeight;
    if (nextArea >= currentArea) {
      width = rowWidth;
      height = rowHeight;
    }
  }
  return { width, height };
}

function extractNextDataPayload(html: string) {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const jsonStart = start + marker.length;
  const end = html.indexOf('</script>', jsonStart);
  if (end < 0) return null;
  return html.slice(jsonStart, end);
}

async function fetchSocialCandidates({
  supabase,
  since,
  registry,
  allowlistedAccounts,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  since: string | null;
  registry: Map<string, RegistryEntry>;
  allowlistedAccounts: AllowlistedAccount[];
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from('launches_public_cache')
    .select(
      'launch_id,name,mission_name,net,provider,social_primary_post_url,social_primary_post_platform,social_primary_post_handle,social_primary_post_id,social_primary_post_matched_at,spacex_x_post_url,spacex_x_post_id,spacex_x_post_captured_at'
    )
    .or('name.ilike.%Artemis%,mission_name.ilike.%Artemis%')
    .order('net', { ascending: false, nullsFirst: false })
    .limit(MAX_SOCIAL_ROWS);

  if (error) throw error;

  const rows = (data || []) as LaunchSocialRow[];
  setScannedCount(stats, 'socialLaunches', rows.length);

  const source = registry.get('launch_social_links') || defaultSource('launch_social_links', 'Launch-linked social', 'media', 'media', 'tier1', 0.9);
  const sinceMs = parseDateOrZero(since);
  const out: ContentCandidate[] = [];

  for (const row of rows) {
    const missionKey = normalizeMissionKey(classifyMission(`${row.name || ''} ${row.mission_name || ''}`));

    const candidates = [
      {
        url: normalizeText(row.social_primary_post_url),
        platform: normalizePlatform(row.social_primary_post_platform) || 'x',
        handle: normalizeHandle(row.social_primary_post_handle) || extractHandleFromUrl(row.social_primary_post_url),
        externalId: normalizeText(row.social_primary_post_id),
        at: toIsoOrNull(row.social_primary_post_matched_at) || toIsoOrNull(row.net) || nowIso
      },
      {
        url: normalizeText(row.spacex_x_post_url),
        platform: 'x',
        handle: extractHandleFromUrl(row.spacex_x_post_url),
        externalId: normalizeText(row.spacex_x_post_id),
        at: toIsoOrNull(row.spacex_x_post_captured_at) || toIsoOrNull(row.net) || nowIso
      }
    ];

    for (const candidate of candidates) {
      if (!candidate.url) {
        incrementRejectCount(stats, ['social', 'noUrl']);
        continue;
      }
      const atMs = parseDateOrZero(candidate.at);
      if (sinceMs && atMs && atMs < sinceMs) {
        incrementRejectCount(stats, ['social', 'beforeWindow']);
        continue;
      }
      if (!candidate.handle) {
        incrementRejectCount(stats, ['social', 'noHandle']);
        continue;
      }

      const allowlisted = findAllowlistedAccount(allowlistedAccounts, candidate.platform, candidate.handle, missionKey);
      if (!allowlisted) {
        incrementRejectCount(stats, ['social', 'notAllowlisted']);
        continue;
      }

      const authority = source.authority;
      const relevance = relevanceScoreForMission(missionKey, `${row.name || ''} ${row.mission_name || ''}`);
      const freshness = freshnessScoreForDate(candidate.at);
      const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(allowlisted.sourceTier), riskScore(allowlisted.sourceTier));
      const handleLabel = candidate.handle ? `@${candidate.handle}` : '@official';

      out.push({
        fingerprint: `social:${candidate.url}`,
        kind: 'social',
        mission_key: missionKey,
        title: `${handleLabel} update linked to ${row.name || 'Artemis mission'}`,
        summary: normalizeText(row.provider) ? `Provider: ${row.provider}` : null,
        url: candidate.url,
        published_at: candidate.at,
        captured_at: candidate.at,
        source_key: source.key,
        source_type: source.sourceType,
        source_class: source.sourceClass,
        source_tier: allowlisted.sourceTier,
        authority_score: authority,
        relevance_score: relevance,
        freshness_score: freshness,
        overall_score: overall,
        image_url: null,
        external_id: candidate.externalId,
        platform: candidate.platform,
        data_label: null,
        data_value: null,
        data_unit: null,
        metadata: {
          launchId: row.launch_id,
          launchName: row.name,
          provider: row.provider,
          account: candidate.handle,
          allowlistedMissionScope: allowlisted.missionScope
        },
        updated_at: nowIso
      });
    }
  }

  const timelineSocial = await fetchTimelineSocialCandidates({
    allowlistedAccounts,
    source,
    sinceMs,
    nowIso,
    stats
  });
  out.push(...timelineSocial);

  return out;
}

async function fetchTimelineSocialCandidates({
  allowlistedAccounts,
  source,
  sinceMs,
  nowIso,
  stats
}: {
  allowlistedAccounts: AllowlistedAccount[];
  source: RegistryEntry;
  sinceMs: number;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  const handles = [...new Set(allowlistedAccounts.filter((entry) => entry.platform === 'x').map((entry) => entry.handle))].slice(
    0,
    MAX_X_SOCIAL_HISTORY_ACCOUNTS
  );
  setScannedCount(stats, 'socialTimelineAccounts', handles.length);

  const out: ContentCandidate[] = [];
  let scannedTweets = 0;

  for (const handle of handles) {
    const tweets = await fetchTimelineTweets(handle, stats);
    const selectedTweets = tweets.slice(0, MAX_X_SOCIAL_HISTORY_TWEETS_PER_ACCOUNT);
    scannedTweets += selectedTweets.length;

    for (const tweet of selectedTweets) {
      const missionKey = inferMissionFromText(tweet.text);
      const allowlisted = findAllowlistedAccount(allowlistedAccounts, 'x', handle, missionKey);
      if (!allowlisted) {
        incrementRejectCount(stats, ['social', 'notAllowlisted']);
        continue;
      }

      if (!containsArtemisKeyword(tweet.text)) {
        incrementRejectCount(stats, ['social', 'notArtemis']);
        continue;
      }

      const postedAt = toIsoOrNull(tweet.createdAt) || nowIso;
      if (sinceMs && parseDateOrZero(postedAt) < sinceMs) {
        incrementRejectCount(stats, ['social', 'beforeWindow']);
        continue;
      }
      if (!tweet.url) {
        incrementRejectCount(stats, ['social', 'noUrl']);
        continue;
      }

      const authority = source.authority;
      const relevance = relevanceScoreForMission(missionKey, tweet.text);
      const freshness = freshnessScoreForDate(postedAt);
      const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(allowlisted.sourceTier), riskScore(allowlisted.sourceTier));
      const handleLabel = `@${handle}`;

      out.push({
        fingerprint: `social:${tweet.url}`,
        kind: 'social',
        mission_key: missionKey,
        title: `${handleLabel} Artemis update`,
        summary: normalizeText(tweet.text),
        url: tweet.url,
        published_at: postedAt,
        captured_at: postedAt,
        source_key: source.key,
        source_type: source.sourceType,
        source_class: source.sourceClass,
        source_tier: allowlisted.sourceTier,
        authority_score: authority,
        relevance_score: relevance,
        freshness_score: freshness,
        overall_score: overall,
        image_url: null,
        external_id: tweet.id,
        platform: 'x',
        data_label: null,
        data_value: null,
        data_unit: null,
        metadata: {
          account: handle,
          mediaCount: tweet.media.length,
          fromTimelineHistory: true,
          allowlistedMissionScope: allowlisted.missionScope
        },
        updated_at: nowIso
      });
    }
  }

  setScannedCount(stats, 'socialTimelineTweets', scannedTweets);
  if (handles.length > 0 && scannedTweets === 0) {
    (stats.errors as IngestError[]).push({
      step: 'social_timeline_empty',
      error: 'all_timeline_fetches_empty',
      context: { handles: handles.length }
    });
  }
  return out;
}

async function fetchDataCandidates({
  supabase,
  cursor,
  registry,
  nowIso,
  stats
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  cursor: string | null;
  registry: Map<string, RegistryEntry>;
  nowIso: string;
  stats: Record<string, unknown>;
}) {
  let budgetQuery = supabase
    .from('artemis_budget_lines')
    .select('fiscal_year,agency,program,line_item,amount_requested,amount_enacted,announced_time,source_document_id')
    .order('announced_time', { ascending: false, nullsFirst: false })
    .limit(MAX_BUDGET_ROWS);

  if (cursor) budgetQuery = budgetQuery.gte('announced_time', cursor);

  let procurementQuery = supabase
    .from('artemis_procurement_awards')
    .select('usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,metadata')
    .order('awarded_on', { ascending: false, nullsFirst: false })
    .limit(MAX_PROCUREMENT_ROWS);

  if (cursor) procurementQuery = procurementQuery.gte('awarded_on', cursor.slice(0, 10));

  const [{ data: budgetRowsRaw, error: budgetError }, { data: procurementRowsRaw, error: procurementError }] = await Promise.all([budgetQuery, procurementQuery]);
  if (budgetError) throw budgetError;
  if (procurementError) throw procurementError;

  const budgetRows = (budgetRowsRaw || []) as BudgetRow[];
  const procurementRowsAll = (procurementRowsRaw || []) as ProcurementRow[];
  const procurementRows = procurementRowsAll.filter((row) => isArtemisProcurementScope(row.metadata));
  setScannedCount(stats, 'budgetLines', budgetRows.length);
  setScannedCount(stats, 'procurementAwards', procurementRows.length);
  setScannedCount(stats, 'procurementAwardsFilteredOut', Math.max(0, procurementRowsAll.length - procurementRows.length));

  const sourceDocumentIds = [...new Set([...budgetRows, ...procurementRows].map((row) => row.source_document_id).filter(Boolean) as string[])];
  const docsById = await loadSourceDocLookup(supabase, sourceDocumentIds);

  const budgetSource = registry.get('nasa_budget_docs') || defaultSource('nasa_budget_docs', 'NASA budget documents', 'budget', 'budget', 'tier1', 0.94);
  const procurementSource = registry.get('usaspending_awards') || defaultSource('usaspending_awards', 'USASpending awards', 'procurement', 'procurement', 'tier1', 0.92);

  const out: ContentCandidate[] = [];

  for (const row of budgetRows) {
    const missionKey: MissionKey = 'program';
    const title = normalizeText(row.line_item) || 'Artemis budget line';
    const summary = normalizeText(row.program) ? `${row.program} budget context` : null;
    const publishedAt = toIsoOrNull(row.announced_time) || nowIso;
    const sourceDoc = row.source_document_id ? docsById.get(row.source_document_id) : null;
    const authority = budgetSource.authority;
    const relevance = relevanceScoreForMission(missionKey, `${title} ${summary || ''}`);
    const freshness = freshnessScoreForDate(publishedAt);
    const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(budgetSource.sourceTier), riskScore(budgetSource.sourceTier));

    out.push({
      fingerprint: `data:budget:${row.fiscal_year || 'na'}:${title}`,
      kind: 'data',
      mission_key: missionKey,
      title,
      summary,
      url: sourceDoc?.url || 'https://www.nasa.gov/budget/',
      published_at: publishedAt,
      captured_at: publishedAt,
      source_key: budgetSource.key,
      source_type: budgetSource.sourceType,
      source_class: budgetSource.sourceClass,
      source_tier: budgetSource.sourceTier,
      authority_score: authority,
      relevance_score: relevance,
      freshness_score: freshness,
      overall_score: overall,
      image_url: null,
      external_id: null,
      platform: null,
      data_label: `FY ${row.fiscal_year || 'n/a'} ${title}`,
      data_value: finiteNumberOrNull(row.amount_requested),
      data_unit: 'USD',
      metadata: {
        amountRequested: finiteNumberOrNull(row.amount_requested),
        amountEnacted: finiteNumberOrNull(row.amount_enacted),
        agency: row.agency || null,
        sourceDocumentId: row.source_document_id || null,
        sourceDocumentTitle: sourceDoc?.title || null
      },
      updated_at: nowIso
    });
  }

  for (const row of procurementRows) {
    const missionKey = normalizeMissionKey(row.mission_key);
    const title = normalizeText(row.award_title) || normalizeText(row.usaspending_award_id) || 'Artemis procurement award';
    const publishedAt = toIsoOrNull(row.awarded_on) || nowIso;
    const sourceDoc = row.source_document_id ? docsById.get(row.source_document_id) : null;
    const sourceUrl =
      normalizeUsaspendingPublicUrl(sourceDoc?.url || null, row.usaspending_award_id) ||
      'https://www.usaspending.gov/';
    const authority = procurementSource.authority;
    const relevance = relevanceScoreForMission(missionKey, `${title} ${row.recipient || ''}`);
    const freshness = freshnessScoreForDate(publishedAt);
    const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore(procurementSource.sourceTier), riskScore(procurementSource.sourceTier));

    out.push({
      fingerprint: `data:procurement:${row.usaspending_award_id || title}`,
      kind: 'data',
      mission_key: missionKey,
      title,
      summary: normalizeText(row.recipient),
      url: sourceUrl,
      published_at: publishedAt,
      captured_at: publishedAt,
      source_key: procurementSource.key,
      source_type: procurementSource.sourceType,
      source_class: procurementSource.sourceClass,
      source_tier: procurementSource.sourceTier,
      authority_score: authority,
      relevance_score: relevance,
      freshness_score: freshness,
      overall_score: overall,
      image_url: null,
      external_id: normalizeText(row.usaspending_award_id),
      platform: null,
      data_label: normalizeText(row.usaspending_award_id),
      data_value: finiteNumberOrNull(row.obligated_amount),
      data_unit: 'USD',
      metadata: {
        recipient: row.recipient || null,
        missionKey: row.mission_key || null,
        sourceDocumentId: row.source_document_id || null,
        sourceDocumentTitle: sourceDoc?.title || null
      },
      updated_at: nowIso
    });
  }

  return out;
}

async function loadRegistry(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('artemis_source_registry')
    .select('source_key,source_type,source_tier,display_name,authority_score,active')
    .eq('active', true)
    .limit(200);

  if (error) {
    console.warn('artemis content ingest registry query error', error.message);
    return new Map<string, RegistryEntry>();
  }

  const map = new Map<string, RegistryEntry>();
  for (const row of (data || []) as RegistryRow[]) {
    const sourceType = normalizeSourceType(row.source_type);
    const sourceClass = normalizeSourceClass(row.source_type);
    const sourceTier = normalizeSourceTier(row.source_tier);
    if (!sourceType || !sourceClass || !sourceTier) continue;

    map.set(row.source_key, {
      key: row.source_key,
      label: row.display_name,
      sourceType,
      sourceClass,
      sourceTier,
      authority: clampScore(Number(row.authority_score ?? authorityDefaultForType(sourceType)))
    });
  }

  return map;
}

async function loadAllowlistedAccounts(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('artemis_social_accounts')
    .select('platform,handle,mission_scope,source_tier,active')
    .eq('active', true)
    .limit(200);

  if (error) {
    console.warn('artemis content ingest allowlist query error', error.message);
    return DEFAULT_ALLOWLIST;
  }

  const rows = (data || []) as SocialAccountRow[];
  if (!rows.length) return DEFAULT_ALLOWLIST;

  const parsed = rows
    .map((row) => {
      const platform = normalizePlatform(row.platform);
      const handle = normalizeHandle(row.handle);
      const missionScope = normalizeMissionKey(row.mission_scope);
      const sourceTier = normalizeSourceTier(row.source_tier);
      if (!platform || !handle || !sourceTier) return null;
      return {
        platform,
        handle,
        missionScope,
        sourceTier
      } satisfies AllowlistedAccount;
    })
    .filter((row): row is AllowlistedAccount => Boolean(row));

  return parsed.length ? parsed : DEFAULT_ALLOWLIST;
}

async function loadSourceDocLookup(supabase: ReturnType<typeof createSupabaseAdminClient>, ids: string[]) {
  if (!ids.length) return new Map<string, SourceDocLookupRow>();

  const map = new Map<string, SourceDocLookupRow>();
  for (const chunk of chunkArray(ids, LOOKUP_CHUNK)) {
    const { data, error } = await supabase.from('artemis_source_documents').select('id,url,title').in('id', chunk);
    if (error) {
      console.warn('artemis content ingest source doc lookup error', error.message);
      continue;
    }

    for (const row of (data || []) as SourceDocLookupRow[]) {
      map.set(row.id, row);
    }
  }

  return map;
}

async function loadExistingByFingerprint(supabase: ReturnType<typeof createSupabaseAdminClient>, fingerprints: string[]) {
  const map = new Map<string, ExistingContentRow>();
  if (!fingerprints.length) return map;

  for (const chunk of chunkArray(fingerprints, LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('artemis_content_items')
      .select(
        'fingerprint,kind,mission_key,title,summary,url,published_at,captured_at,source_key,source_type,source_class,source_tier,authority_score,relevance_score,freshness_score,overall_score,image_url,external_id,platform,data_label,data_value,data_unit'
      )
      .in('fingerprint', chunk);

    if (error) throw error;
    for (const row of (data || []) as ExistingContentRow[]) {
      map.set(row.fingerprint, row);
    }
  }

  return map;
}

function rowsEquivalent(existing: ExistingContentRow, candidate: ContentCandidate) {
  return (
    existing.kind === candidate.kind &&
    existing.mission_key === candidate.mission_key &&
    existing.title === candidate.title &&
    normalizeText(existing.summary) === normalizeText(candidate.summary) &&
    existing.url === candidate.url &&
    toIsoOrNull(existing.published_at) === toIsoOrNull(candidate.published_at) &&
    toIsoOrNull(existing.captured_at) === toIsoOrNull(candidate.captured_at) &&
    normalizeText(existing.source_key) === normalizeText(candidate.source_key) &&
    existing.source_type === candidate.source_type &&
    existing.source_class === candidate.source_class &&
    existing.source_tier === candidate.source_tier &&
    nearlyEqual(existing.authority_score, candidate.authority_score) &&
    nearlyEqual(existing.relevance_score, candidate.relevance_score) &&
    nearlyEqual(existing.freshness_score, candidate.freshness_score) &&
    nearlyEqual(existing.overall_score, candidate.overall_score) &&
    normalizeText(existing.image_url) === normalizeText(candidate.image_url) &&
    normalizeText(existing.external_id) === normalizeText(candidate.external_id) &&
    normalizeText(existing.platform) === normalizeText(candidate.platform) &&
    normalizeText(existing.data_label) === normalizeText(candidate.data_label) &&
    nearlyEqual(existing.data_value, candidate.data_value) &&
    normalizeText(existing.data_unit) === normalizeText(candidate.data_unit)
  );
}

function mergeCandidateWithExisting(candidate: ContentCandidate, existing?: ExistingContentRow) {
  if (!existing) return candidate;

  const existingExternalId = normalizeText(existing.external_id);
  if (normalizeText(candidate.external_id) || !existingExternalId) return candidate;

  // Preserve enriched IDs (for example, WordPress blog post IDs from weekly backfill)
  // when incremental feeds do not provide an external identifier.
  return {
    ...candidate,
    external_id: existingExternalId
  };
}

function dedupeCandidates(candidates: ContentCandidate[]) {
  const byFingerprint = new Map<string, ContentCandidate>();

  for (const candidate of candidates) {
    const current = byFingerprint.get(candidate.fingerprint);
    if (!current) {
      byFingerprint.set(candidate.fingerprint, candidate);
      continue;
    }

    const currentScore = Number(current.overall_score || 0);
    const nextScore = Number(candidate.overall_score || 0);
    const currentTime = parseDateOrZero(current.published_at || current.captured_at);
    const nextTime = parseDateOrZero(candidate.published_at || candidate.captured_at);

    if (nextScore > currentScore || (nextScore === currentScore && nextTime > currentTime)) {
      byFingerprint.set(candidate.fingerprint, candidate);
    }
  }

  return [...byFingerprint.values()];
}

function resolveNextCursor(candidates: ContentCandidate[], fallback: string) {
  let maxMs = parseDateOrZero(fallback);
  for (const candidate of candidates) {
    const ms = parseDateOrZero(candidate.captured_at || candidate.published_at);
    if (ms > maxMs) maxMs = ms;
  }

  const date = new Date(maxMs);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString();
}

function weightedOverallScore(authority: number, relevance: number, freshness: number, stability: number, risk: number) {
  return clampScore(
    authority * SCORE_WEIGHTS.authority +
      relevance * SCORE_WEIGHTS.relevance +
      freshness * SCORE_WEIGHTS.freshness +
      stability * SCORE_WEIGHTS.stability +
      risk * SCORE_WEIGHTS.risk
  );
}

function relevanceScoreForMission(missionKey: MissionKey, text: string) {
  const normalized = text.toLowerCase();
  if (missionKey === 'program') return normalized.includes('artemis') ? 0.72 : 0.5;

  const missionLabel = missionKey.replace('-', ' ');
  if (normalized.includes(missionLabel)) return 0.96;
  if (/\bartemis\b/.test(normalized)) return 0.84;
  return 0.58;
}

function freshnessScoreForDate(value: string | null | undefined) {
  const ms = parseDateOrZero(value);
  if (!ms) return 0.35;
  const ageHours = Math.max(0, (Date.now() - ms) / 3_600_000);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.78;
  if (ageHours <= 168) return 0.64;
  if (ageHours <= 720) return 0.48;
  return 0.35;
}

function stabilityScore(tier: SourceTier) {
  return tier === 'tier1' ? 0.9 : 0.62;
}

function riskScore(tier: SourceTier) {
  return tier === 'tier1' ? 0.92 : 0.6;
}

function authorityDefaultForType(sourceType: SourceType) {
  if (sourceType === 'nasa_primary') return 0.97;
  if (sourceType === 'oversight') return 0.94;
  if (sourceType === 'budget') return 0.94;
  if (sourceType === 'procurement') return 0.92;
  if (sourceType === 'media') return 0.9;
  return 0.64;
}

function inferMissionFromText(text: string): MissionKey {
  const normalized = text.toLowerCase();
  if (/\bartemis\s*(vii|7)\b/.test(normalized)) return 'artemis-vii';
  if (/\bartemis\s*(vi|6)\b/.test(normalized)) return 'artemis-vi';
  if (/\bartemis\s*(v|5)\b/.test(normalized)) return 'artemis-v';
  if (/\bartemis\s*(iv|4)\b/.test(normalized)) return 'artemis-iv';
  if (/\bartemis\s*(iii|3)\b/.test(normalized)) return 'artemis-iii';
  if (/\bartemis\s*(ii|2)\b/.test(normalized)) return 'artemis-ii';
  if (/\bartemis\s*(i|1)\b/.test(normalized)) return 'artemis-i';
  return 'program';
}

function findAllowlistedAccount(allowlist: AllowlistedAccount[], platformRaw: string | null, handleRaw: string | null, missionKey: MissionKey) {
  const platform = normalizePlatform(platformRaw);
  const handle = normalizeHandle(handleRaw);
  if (!platform || !handle) return null;

  return (
    allowlist.find(
      (entry) =>
        entry.platform === platform &&
        entry.handle === handle &&
        (entry.missionScope === 'program' || entry.missionScope === missionKey)
    ) || null
  );
}

function normalizeSourceType(value: string | null | undefined): SourceType | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'nasa_primary' ||
    normalized === 'oversight' ||
    normalized === 'budget' ||
    normalized === 'procurement' ||
    normalized === 'technical' ||
    normalized === 'media'
  ) {
    return normalized;
  }
  return null;
}

function normalizeSourceClass(value: string | null | undefined): SourceClass | null {
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

function normalizeSourceTier(value: string | null | undefined): SourceTier | null {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'tier1' || normalized === 'tier-1') return 'tier1';
  if (normalized === 'tier2' || normalized === 'tier-2') return 'tier2';
  return null;
}

function normalizeMissionKey(value: string | null | undefined): MissionKey {
  const normalized = normalizeText(value)?.toLowerCase();
  if (!normalized) return 'program';
  if (normalized === 'program' || normalized === 'artemis-program') return 'program';
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return 'program';
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

function extractHandleFromUrl(value: string | null | undefined) {
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

function containsArtemisKeyword(value: string | null | undefined) {
  const normalized = String(value || '').toLowerCase();
  if (/\bartemis\b/.test(normalized) || /\bartemis[\s-]?(i|ii|iii|iv|v|vi|vii|[1-7])\b/.test(normalized)) return true;
  if (/\bmoon\s+to\s+mars\b/.test(normalized)) return true;
  if (/\bspace\s+launch\s+system\b/.test(normalized) || /\bsls\b/.test(normalized)) return true;
  if (/\borion\b/.test(normalized)) return true;
  if (/\bexploration\s+ground\s+systems\b/.test(normalized) || /\begs\b/.test(normalized)) return true;
  if (/\bhuman\s+landing\s+system\b/.test(normalized) || /\bhls\b/.test(normalized)) return true;
  if (/\blunar\s+gateway\b/.test(normalized) || (/\bgateway\b/.test(normalized) && /\blunar\b/.test(normalized))) return true;
  if (/\brs-?25\b/.test(normalized)) return true;
  if (/\bsolid\s+rocket\s+booster\b/.test(normalized) || /\bsrbs?\b/.test(normalized)) return true;
  if (/\binterim\s+cryogenic\s+propulsion\s+stage\b/.test(normalized) || /\bicps\b/.test(normalized)) return true;
  if (/\bmobile\s+launcher\b/.test(normalized)) return true;
  if (/\beuropean\s+service\s+module\b/.test(normalized) || (/\besm\b/.test(normalized) && /\bservice\s+module\b/.test(normalized))) return true;
  if (/\blaunch\s+abort\s+system\b/.test(normalized)) return true;
  return false;
}

function normalizePhotoUrl(...values: unknown[]) {
  for (const value of values) {
    const raw = normalizeText(value);
    if (!raw) continue;

    const normalized = raw.startsWith('//')
      ? `https:${raw}`
      : raw.startsWith('http://')
        ? `https://${raw.slice('http://'.length)}`
        : raw;

    try {
      const parsed = new URL(normalized);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue;

      const host = parsed.hostname.toLowerCase();
      const looksLikeImage = /\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(parsed.pathname);
      if (!looksLikeImage && !host.includes('twimg.com')) continue;
      return parsed.toString();
    } catch {
      continue;
    }
  }
  return null;
}

function setScannedCount(
  stats: Record<string, unknown>,
  key:
    | 'articles'
    | 'photoDocs'
    | 'socialPhotoCandidates'
    | 'socialLaunches'
    | 'socialTimelineAccounts'
    | 'socialTimelineTweets'
    | 'nasaRssItems'
    | 'budgetLines'
    | 'procurementAwards',
  value: number
) {
  const current = asRecord(stats.sourceRowsScanned) || {};
  current[key] = value;
  stats.sourceRowsScanned = current;
}

function evaluateCandidateHealth(
  stats: Record<string, unknown>,
  args: { socialCandidates: number; allowlistedAccounts: number }
): { ok: boolean; issues: Array<{ step: string; error: string; context?: Record<string, unknown> }> } {
  const scanned = asRecord(stats.sourceRowsScanned) || {};
  const rejects = asRecord(stats.candidateRejects) || {};
  const socialRejects = asRecord(rejects.social) || {};

  const socialAccounts = Number(scanned.socialTimelineAccounts || 0);
  const scannedTweets = Number(scanned.socialTimelineTweets || 0);
  const socialCandidates = Number(args.socialCandidates || 0);
  const allowlistedAccounts = Number(args.allowlistedAccounts || 0);

  const issues: Array<{ step: string; error: string; context?: Record<string, unknown> }> = [];

  if (allowlistedAccounts >= 6 && socialAccounts > 0 && scannedTweets === 0) {
    issues.push({
      step: 'health_social_timeline_empty',
      error: 'no_tweets_scanned',
      context: { allowlistedAccounts, socialAccounts }
    });
  }

  const rejectedNotArtemis = Number(socialRejects.notArtemis || 0);
  if (scannedTweets >= 50 && socialCandidates < 5 && rejectedNotArtemis >= 30) {
    issues.push({
      step: 'health_social_filtered_too_aggressively',
      error: 'too_many_rejected_not_relevant',
      context: { scannedTweets, socialCandidates, rejectedNotArtemis }
    });
  }

  return { ok: issues.length === 0, issues };
}

function incrementRejectCount(
  stats: Record<string, unknown>,
  path:
    | ['photos', 'missingPayload' | 'noMedia' | 'noImageUrl' | 'beforeWindow' | 'noHandle' | 'notAllowlisted' | 'notArtemis' | 'notPhotoType']
    | ['social', 'noUrl' | 'beforeWindow' | 'noHandle' | 'notAllowlisted' | 'notArtemis']
) {
  const root = asRecord(stats.candidateRejects) || {};
  const branch = asRecord(root[path[0]]) || {};
  const current = Number(branch[path[1]] || 0);
  branch[path[1]] = Number.isFinite(current) ? current + 1 : 1;
  root[path[0]] = branch;
  stats.candidateRejects = root;
}

async function consumeBackfillOnce(supabase: ReturnType<typeof createSupabaseAdminClient>, stats: Record<string, unknown>) {
  try {
    await setSystemSetting(supabase, BACKFILL_ONCE_KEY, false);
    return true;
  } catch (error) {
    (stats.errors as IngestError[]).push({
      step: 'backfill_disable',
      error: stringifyError(error)
    });
    return false;
  }
}

async function readIntegerSetting(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  key: string,
  fallback: number,
  min: number,
  max: number
) {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  const raw = data?.value;
  const parsed = Number(typeof raw === 'string' ? raw : raw ?? Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(Math.round(parsed), fallback, min, max);
}

function resolveSourceSince({
  cursor,
  runStartedAtIso,
  backfillEnabled,
  lookbackDays
}: {
  cursor: string | null;
  runStartedAtIso: string;
  backfillEnabled: boolean;
  lookbackDays: number;
}) {
  const runMs = parseDateOrZero(runStartedAtIso);
  if (!runMs) return cursor;
  const lookbackMs = Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000;
  const lookbackIso = new Date(runMs - lookbackMs).toISOString();

  if (backfillEnabled) return lookbackIso;

  // Default behavior: keep a rolling lookback window so the UI has enough items
  // even when sources publish infrequently or are rate-limited.
  if (!cursor) return lookbackIso;
  const cursorMs = parseDateOrZero(cursor);
  if (!cursorMs) return lookbackIso;
  return cursorMs < runMs - lookbackMs ? cursor : lookbackIso;
}

function defaultSource(
  key: string,
  label: string,
  sourceType: SourceType,
  sourceClass: SourceClass,
  sourceTier: SourceTier,
  authority: number
): RegistryEntry {
  return {
    key,
    label,
    sourceType,
    sourceClass,
    sourceTier,
    authority
  };
}

function chunkArray<T>(values: T[], size: number) {
  if (size <= 0) return [values];
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeUsaspendingPublicUrl(
  value: string | null | undefined,
  awardId: string | null | undefined
) {
  if (typeof value !== 'string') return buildUsaspendingSearchUrl(awardId);
  const normalized = value.trim();
  if (!normalized) return buildUsaspendingSearchUrl(awardId);

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'api.usaspending.gov') {
      return buildUsaspendingSearchUrl(awardId) || 'https://www.usaspending.gov/';
    }
    return normalized;
  } catch {
    return buildUsaspendingSearchUrl(awardId);
  }
}

function buildUsaspendingSearchUrl(awardId: string | null | undefined) {
  if (typeof awardId !== 'string') return null;
  const normalized = awardId.trim();
  if (!normalized) return null;
  return `https://www.usaspending.gov/search/?hash=${encodeURIComponent(normalized)}`;
}

type ProcurementProgramScope = 'artemis' | 'blue-origin' | 'spacex';

function normalizeProcurementProgramScope(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'artemis') return 'artemis' as ProcurementProgramScope;
  if (normalized === 'blue-origin' || normalized === 'blue_origin' || normalized === 'blueorigin' || normalized === 'blue') {
    return 'blue-origin' as ProcurementProgramScope;
  }
  if (normalized === 'spacex' || normalized === 'space-x' || normalized === 'space_x' || normalized === 'space x') {
    return 'spacex' as ProcurementProgramScope;
  }
  return null;
}

function isArtemisProcurementScope(metadata: Record<string, unknown> | null) {
  if (!metadata) return true;

  const direct = normalizeProcurementProgramScope(asString(metadata.programScope) || asString(metadata.program_scope));
  if (direct) return direct === 'artemis';

  const scopesRaw = metadata.programScopes || metadata.program_scopes;
  if (!Array.isArray(scopesRaw)) return true;

  const scopes = scopesRaw
    .map((entry) => normalizeProcurementProgramScope(asString(entry)))
    .filter((entry): entry is ProcurementProgramScope => Boolean(entry));

  if (scopes.length === 0) return true;
  return scopes.includes('artemis');
}

function isNasaBlogLink(url: string) {
  const normalized = url.trim().toLowerCase();
  if (!normalized.startsWith('https://www.nasa.gov/')) return false;
  return normalized.includes('/blogs/');
}

function parseDateOrZero(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function nearlyEqual(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return true;
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) && !Number.isFinite(right)) return true;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.0001;
}

function finiteNumberOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function clampInt(value: number, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

const DEFAULT_ALLOWLIST: AllowlistedAccount[] = [
  { platform: 'x', handle: 'nasa', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasaadmin', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasaartemis', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasagroundsys', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasa_orion', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasa_sls', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasa_johnson', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'nasa_kennedy', missionScope: 'program', sourceTier: 'tier1' },
  { platform: 'x', handle: 'spacex', missionScope: 'program', sourceTier: 'tier2' },
  { platform: 'x', handle: 'esa', missionScope: 'artemis-ii', sourceTier: 'tier2' },
  { platform: 'x', handle: 'csa_asc', missionScope: 'artemis-ii', sourceTier: 'tier2' }
];
