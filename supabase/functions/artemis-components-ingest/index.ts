import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
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

type WpEntry = {
  id?: number;
  link?: string;
  modified?: string;
  title?: WpRenderedText;
  excerpt?: WpRenderedText & { protected?: boolean };
  content?: WpRenderedText & { protected?: boolean };
};

type ComponentRow = {
  mission_key: MissionKey;
  sort_order: number;
  component: string;
  description: string;
  official_urls: string[];
  image_url: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type IngestError = {
  step: string;
  error: string;
  context?: Record<string, unknown>;
};

const CHECKPOINT_KEY = 'artemis_mission_components';
const RUN_NAME = 'artemis_components_ingest';
const UPSERT_CHUNK = 200;

const COMPONENT_SPECS: Array<{
  missionKey: MissionKey;
  sortOrder: number;
  component: string;
  source: { kind: 'reference' | 'topic'; slug: string };
  additionalUrls?: string[];
}> = [
  { missionKey: 'artemis-ii', sortOrder: 1, component: 'Orion Spacecraft', source: { kind: 'reference', slug: 'orion-spacecraft' } },
  { missionKey: 'artemis-ii', sortOrder: 2, component: 'Space Launch System (SLS)', source: { kind: 'reference', slug: 'space-launch-system' } },
  {
    missionKey: 'artemis-ii',
    sortOrder: 3,
    component: 'Interim Cryogenic Propulsion Stage (ICPS)',
    source: { kind: 'reference', slug: 'icps' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 4,
    component: 'RS-25 Engines',
    source: { kind: 'reference', slug: 'space-launch-system-rs-25-core-stage-engine' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 5,
    component: 'Solid Rocket Boosters',
    source: { kind: 'reference', slug: 'sls-space-launch-system-solid-rocket-booster' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 6,
    component: 'Exploration Ground Systems',
    source: { kind: 'topic', slug: 'exploration-ground-systems' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 7,
    component: 'Mobile Launcher 1',
    source: { kind: 'topic', slug: 'mobile-launcher' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 8,
    component: 'Launch Complex 39B',
    source: { kind: 'reference', slug: 'launch-complex-39b' }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 9,
    component: 'European Service Module',
    source: { kind: 'topic', slug: 'european-service-module' }
  }
];

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAtMs = Date.now();
  const runStartedAtIso = new Date().toISOString();
  const { runId } = await startIngestionRun(supabase, RUN_NAME);

  const stats: Record<string, unknown> = {
    rowsUpserted: 0,
    sourcesFetched: 0,
    sourcesFailed: 0,
    errors: [] as IngestError[]
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_components_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAtMs });
    }

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'nasa_primary',
      status: 'running',
      startedAt: runStartedAtIso,
      cursor: null,
      lastError: null
    });

    const rows: ComponentRow[] = [];

    for (const spec of COMPONENT_SPECS) {
      const entry = await fetchWpEntry(spec.source.kind, spec.source.slug, stats);
      if (!entry) continue;

      const officialUrl = normalizeUrl(entry.link) || null;
      const urlSet = new Set<string>();
      if (officialUrl) urlSet.add(officialUrl);
      for (const url of spec.additionalUrls || []) {
        const normalized = normalizeUrl(url);
        if (normalized) urlSet.add(normalized);
      }

      const excerptText = normalizeText(stripHtml(entry.excerpt?.rendered || ''));
      const contentHtml = entry.content?.rendered || '';
      const contentText = normalizeText(extractFirstMeaningfulParagraph(contentHtml));
      const description = excerptText || contentText || spec.component;

      const imageUrl = extractFirstImageUrl(contentHtml);

      rows.push({
        mission_key: spec.missionKey,
        sort_order: spec.sortOrder,
        component: spec.component,
        description,
        official_urls: [...urlSet.values()],
        image_url: imageUrl,
        source_document_id: null,
        metadata: {
          sourceClass: `nasa-wp-${spec.source.kind}`,
          wpId: entry.id ?? null,
          slug: spec.source.slug,
          modifiedAt: toIsoOrNull(entry.modified) || null
        },
        updated_at: runStartedAtIso
      });
    }

    let upserted = 0;
    for (const chunk of chunkArray(rows, UPSERT_CHUNK)) {
      if (!chunk.length) continue;
      const { error } = await supabase.from('artemis_mission_components').upsert(chunk, { onConflict: 'mission_key,component_normalized' });
      if (error) throw error;
      upserted += chunk.length;
    }

    stats.rowsUpserted = upserted;

    await updateCheckpoint(supabase, CHECKPOINT_KEY, {
      sourceType: 'nasa_primary',
      status: 'complete',
      cursor: null,
      recordsIngested: upserted,
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: runStartedAtIso,
      lastError: null,
      metadata: {
        sourcesFetched: stats.sourcesFetched,
        sourcesFailed: stats.sourcesFailed
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

async function fetchWpEntry(kind: 'reference' | 'topic', slug: string, stats: Record<string, unknown>) {
  const params = new URLSearchParams();
  params.set('slug', slug);
  params.set('per_page', '1');
  params.set('_fields', 'id,link,modified,title,excerpt,content');
  const url = `https://www.nasa.gov/wp-json/wp/v2/${encodeURIComponent(kind)}?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)'
      }
    });
    if (!response.ok) {
      stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
      (stats.errors as IngestError[]).push({ step: 'nasa_wp_fetch_non_200', error: `http_${response.status}`, context: { url } });
      return null;
    }

    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    stats.sourcesFetched = Number(stats.sourcesFetched || 0) + 1;

    const rows = Array.isArray(json) ? (json as unknown[]) : [];
    const entry = rows.length ? parseWpEntry(rows[0]) : null;
    if (!entry) {
      (stats.errors as IngestError[]).push({ step: 'nasa_wp_missing_entry', error: 'empty_response', context: { kind, slug } });
      return null;
    }

    return entry;
  } catch (error) {
    stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
    (stats.errors as IngestError[]).push({ step: 'nasa_wp_fetch_exception', error: stringifyError(error), context: { kind, slug } });
    return null;
  }
}

function parseWpEntry(value: unknown): WpEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as WpEntry;
}

function normalizeUrl(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const resolved = normalized.startsWith('//') ? `https:${normalized}` : normalized;
  try {
    const parsed = new URL(resolved);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function extractFirstImageUrl(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const src = match?.[1] || null;
  return normalizeUrl(src);
}

function extractFirstMeaningfulParagraph(html: string) {
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripHtml(match[1] || '')).map((value) => value.trim());
  for (const paragraph of paragraphs) {
    if (paragraph.length < 80) continue;
    if (paragraph.toLowerCase().includes('skip to main content')) continue;
    return paragraph;
  }
  return paragraphs.find((value) => value.length > 0) || null;
}

function chunkArray<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

