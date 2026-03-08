import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  classifyMission,
  finishIngestionRun,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint
} from '../_shared/artemisIngest.ts';
import { stripHtml } from '../_shared/artemisSources.ts';

type MissionKey = 'program' | 'artemis-i' | 'artemis-ii' | 'artemis-iii' | 'artemis-iv' | 'artemis-v' | 'artemis-vi' | 'artemis-vii';

type WpRenderedText = { rendered?: string };

type NasaBlogPost = {
  id?: number;
  date?: string;
  modified?: string;
  link?: string;
  title?: WpRenderedText;
  excerpt?: WpRenderedText & { protected?: boolean };
};

type ContentRow = {
  fingerprint: string;
  kind: 'article';
  mission_key: MissionKey;
  title: string;
  summary: string | null;
  url: string;
  published_at: string | null;
  captured_at: string;
  source_key: string | null;
  source_type: 'nasa_primary';
  source_class: 'nasa_primary';
  source_tier: 'tier1';
  authority_score: number;
  relevance_score: number;
  freshness_score: number;
  overall_score: number;
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

const CHECKPOINT_KEY = 'nasa_blog_posts_backfill';
const RUN_NAME = 'artemis_nasa_blog_backfill';

// NASA WordPress taxonomy term id for the Artemis blog name.
const NASA_BLOG_NAME_ARTEMIS_ID = 16106;
const PER_PAGE = 100;
const MAX_PAGES = 20;
const CURSOR_LOOKBACK_DAYS = 14;
const UPSERT_CHUNK = 200;

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
    pagesFetched: 0,
    postsScanned: 0,
    postsConsidered: 0,
    postsUpserted: 0,
    stoppedEarly: false,
    errors: [] as IngestError[]
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_nasa_blog_backfill_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAtMs });
    }

    const checkpointRes = await supabase
      .from('artemis_ingest_checkpoints')
      .select('cursor')
      .eq('source_key', CHECKPOINT_KEY)
      .maybeSingle();
    const cursorIso = toIsoOrNull(asString((checkpointRes.data as any)?.cursor));
    stats.cursor = cursorIso;

    const cursorMs = cursorIso ? Date.parse(cursorIso) : 0;
    const sinceMs = cursorMs ? cursorMs - CURSOR_LOOKBACK_DAYS * 86_400_000 : 0;

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'nasa_primary',
      status: 'running',
      startedAt: runStartedAtIso,
      cursor: cursorIso,
      lastError: null
    });

    const candidates: ContentRow[] = [];
    let maxModifiedMs = cursorMs;
    let stopAll = false;
    let totalPages = 0;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      if (stopAll) break;

      const url = buildWpUrl(page);
      const response = await fetchWpPage(url);
      if (!response.ok) {
        (stats.errors as IngestError[]).push({
          step: 'wp_fetch',
          error: `http_${response.status}`,
          context: { page, url }
        });
        throw new Error(`wp_fetch_failed:${response.status}`);
      }

      totalPages = Math.max(totalPages, response.totalPages || 0);
      stats.pagesFetched = Number(stats.pagesFetched || 0) + 1;

      const rows = Array.isArray(response.json) ? (response.json as unknown[]) : [];
      if (!rows.length) break;

      stats.postsScanned = Number(stats.postsScanned || 0) + rows.length;

      for (const raw of rows) {
        if (stopAll) break;
        const post = parseBlogPost(raw);
        if (!post) continue;

        const link = normalizeText(post.link);
        const title = normalizeText(stripHtml(post.title?.rendered || ''));
        if (!link || !title) continue;

        const summary = normalizeText(stripHtml(post.excerpt?.rendered || ''));
        const publishedAt = toIsoOrNull(post.date) || runStartedAtIso;
        const modifiedAt = toIsoOrNull(post.modified) || publishedAt;
        const modifiedMs = parseDateOrZero(modifiedAt);
        if (modifiedMs > maxModifiedMs) maxModifiedMs = modifiedMs;

        if (sinceMs && modifiedMs && modifiedMs < sinceMs) {
          stopAll = true;
          stats.stoppedEarly = true;
          break;
        }

        stats.postsConsidered = Number(stats.postsConsidered || 0) + 1;

        const missionKey = normalizeMissionKey(classifyMission(`${title} ${summary || ''} ${link}`));
        const authority = 0.97;
        const relevance = relevanceScoreForMission(missionKey, `${title} ${summary || ''}`);
        const freshness = freshnessScoreForDate(publishedAt);
        const overall = weightedOverallScore(authority, relevance, freshness, stabilityScore('tier1'), riskScore('tier1'));

        candidates.push({
          fingerprint: `article:nasa:${link}`,
          kind: 'article',
          mission_key: missionKey,
          title,
          summary,
          url: link,
          published_at: publishedAt,
          captured_at: publishedAt,
          source_key: 'nasa_blog_posts',
          source_type: 'nasa_primary',
          source_class: 'nasa_primary',
          source_tier: 'tier1',
          authority_score: authority,
          relevance_score: relevance,
          freshness_score: freshness,
          overall_score: overall,
          external_id: post.id != null ? String(post.id) : null,
          platform: null,
          data_label: null,
          data_value: null,
          data_unit: null,
          metadata: {
            wpId: post.id ?? null,
            modifiedAt,
            blogNameId: NASA_BLOG_NAME_ARTEMIS_ID,
            sourceClass: 'nasa-blog-wp-api'
          },
          updated_at: runStartedAtIso
        });
      }

      if (totalPages > 0 && page >= totalPages) break;
    }

    const dedupedCandidates = dedupeByFingerprint(candidates);
    (stats as any).postsDeduped = dedupedCandidates.length;

    let upserted = 0;
    for (const chunk of chunkArray(dedupedCandidates, UPSERT_CHUNK)) {
      if (!chunk.length) continue;
      const { error } = await supabase.from('artemis_content_items').upsert(chunk, { onConflict: 'fingerprint' });
      if (error) {
        (stats.errors as IngestError[]).push({
          step: 'content_upsert',
          error: stringifyError(error),
          context: {
            ...serializeError(error),
            rows: chunk.length,
            sampleFingerprint: chunk[0]?.fingerprint || null
          }
        });
        throw error;
      }
      upserted += chunk.length;
    }

    stats.postsUpserted = upserted;

    const nextCursor = maxModifiedMs ? new Date(maxModifiedMs).toISOString() : runStartedAtIso;
    stats.nextCursor = nextCursor;

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'nasa_primary',
      status: 'complete',
      cursor: nextCursor,
      recordsIngested: upserted,
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: nextCursor,
      lastError: null,
      metadata: {
        pagesFetched: stats.pagesFetched,
        totalPages,
        postsScanned: stats.postsScanned,
        postsConsidered: stats.postsConsidered,
        postsUpserted: upserted,
        stoppedEarly: stats.stoppedEarly
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAtMs, stats });
  } catch (error) {
    const message = stringifyError(error);
    (stats.errors as IngestError[]).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'nasa_primary',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAtMs, stats }, 500);
  }
});

function buildWpUrl(page: number) {
  const params = new URLSearchParams();
  params.set('blog-name', String(NASA_BLOG_NAME_ARTEMIS_ID));
  params.set('per_page', String(PER_PAGE));
  params.set('page', String(page));
  params.set('orderby', 'modified');
  params.set('order', 'desc');
  params.set('_fields', 'id,date,modified,link,title,excerpt');
  return `https://www.nasa.gov/wp-json/wp/v2/nasa-blog?${params.toString()}`;
}

async function fetchWpPage(url: string): Promise<{ ok: boolean; status: number; json: unknown; totalPages: number | null }> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json,*/*',
      'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)'
    }
  });

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  const totalPages = Number(response.headers.get('x-wp-totalpages') || '');
  return {
    ok: response.ok,
    status: response.status,
    json,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null
  };
}

function parseBlogPost(value: unknown): NasaBlogPost | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as NasaBlogPost;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null;
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

function chunkArray<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

function dedupeByFingerprint(rows: ContentRow[]) {
  const map = new Map<string, ContentRow>();
  for (const row of rows) {
    const existing = map.get(row.fingerprint);
    if (!existing) {
      map.set(row.fingerprint, row);
      continue;
    }

    map.set(row.fingerprint, preferCandidate(existing, row));
  }
  return [...map.values()];
}

function preferCandidate(a: ContentRow, b: ContentRow) {
  const aScore = candidateCompletenessScore(a);
  const bScore = candidateCompletenessScore(b);
  if (bScore > aScore) return b;
  return a;
}

function candidateCompletenessScore(row: ContentRow) {
  let score = 0;
  if (row.summary) score += 1;
  if (row.external_id) score += 1;
  return score;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== 'object') return {};
  const value = err as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['message', 'details', 'hint', 'code', 'status', 'statusText']) {
    if (key in value) out[key] = value[key];
  }
  return out;
}

function normalizeMissionKey(value: string): MissionKey {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === 'artemis-i') return 'artemis-i';
  if (normalized === 'artemis-ii') return 'artemis-ii';
  if (normalized === 'artemis-iii') return 'artemis-iii';
  if (normalized === 'artemis-iv') return 'artemis-iv';
  if (normalized === 'artemis-v') return 'artemis-v';
  if (normalized === 'artemis-vi') return 'artemis-vi';
  if (normalized === 'artemis-vii') return 'artemis-vii';
  return 'program';
}

function relevanceScoreForMission(missionKey: MissionKey, text: string) {
  const normalized = text.toLowerCase();
  if (missionKey === 'program') return normalized.includes('artemis') ? 0.72 : 0.56;

  const missionLabel = missionKey.replace('-', ' ');
  if (normalized.includes(missionLabel)) return 0.96;
  if (/\bartemis\b/.test(normalized)) return 0.84;
  return 0.62;
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

function stabilityScore(tier: 'tier1' | 'tier2') {
  return tier === 'tier1' ? 0.9 : 0.62;
}

function riskScore(tier: 'tier1' | 'tier2') {
  return tier === 'tier1' ? 0.92 : 0.6;
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
