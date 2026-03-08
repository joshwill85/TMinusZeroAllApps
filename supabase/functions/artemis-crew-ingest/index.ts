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

type NasaPersonPayload = {
  id?: number;
  link?: string;
  modified?: string;
  title?: WpRenderedText;
  excerpt?: WpRenderedText & { protected?: boolean };
  content?: WpRenderedText & { protected?: boolean };
};

type CrewRow = {
  mission_key: MissionKey;
  sort_order: number;
  name: string;
  agency: string;
  role: string | null;
  bio_url: string;
  portrait_url: string | null;
  summary: string | null;
  source_document_id: string | null;
  metadata: Record<string, unknown>;
  updated_at: string;
};

type IngestError = {
  step: string;
  error: string;
  context?: Record<string, unknown>;
};

const CHECKPOINT_KEY = 'artemis_people';
const RUN_NAME = 'artemis_crew_ingest';
const UPSERT_CHUNK = 200;

const CREW: Array<
  | {
      missionKey: MissionKey;
      sortOrder: number;
      name: string;
      agency: string;
      role: string;
      source: { kind: 'nasa_people'; id: number };
    }
  | {
      missionKey: MissionKey;
      sortOrder: number;
      name: string;
      agency: string;
      role: string;
      source: { kind: 'csa_html'; url: string };
    }
> = [
  {
    missionKey: 'artemis-ii',
    sortOrder: 1,
    name: 'Reid Wiseman',
    agency: 'NASA',
    role: 'Commander',
    source: { kind: 'nasa_people', id: 129827 }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 2,
    name: 'Victor J. Glover Jr.',
    agency: 'NASA',
    role: 'Pilot',
    source: { kind: 'nasa_people', id: 73745 }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 3,
    name: 'Christina Koch',
    agency: 'NASA',
    role: 'Mission Specialist',
    source: { kind: 'nasa_people', id: 129820 }
  },
  {
    missionKey: 'artemis-ii',
    sortOrder: 4,
    name: 'Jeremy R. Hansen',
    agency: 'Canadian Space Agency',
    role: 'Mission Specialist',
    source: { kind: 'csa_html', url: 'https://www.asc-csa.gc.ca/eng/astronauts/canadian/active/bio-jeremy-hansen.asp' }
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
    const enabled = await readBooleanSetting(supabase, 'artemis_crew_job_enabled', true);
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

    const rows: CrewRow[] = [];

    for (const entry of CREW) {
      if (entry.source.kind === 'nasa_people') {
        const payload = await fetchNasaPerson(entry.source.id, stats);
        if (!payload) continue;
        const title = normalizeText(stripHtml(payload.title?.rendered || '')) || entry.name;
        const summary = normalizeText(stripHtml(payload.excerpt?.rendered || ''));
        const portraitUrl = extractFirstImageUrl(payload.content?.rendered || '') || null;
        const bioUrl = normalizeUrl(payload.link) || null;
        if (!bioUrl) continue;

        rows.push({
          mission_key: entry.missionKey,
          sort_order: entry.sortOrder,
          name: title,
          agency: entry.agency,
          role: entry.role,
          bio_url: bioUrl,
          portrait_url: portraitUrl,
          summary,
          source_document_id: null,
          metadata: {
            sourceClass: 'nasa-people-wp-api',
            wpId: payload.id ?? entry.source.id,
            modifiedAt: toIsoOrNull(payload.modified) || null
          },
          updated_at: runStartedAtIso
        });
      } else {
        const extracted = await fetchCsaBio(entry.source.url, entry.name, stats);
        if (!extracted) continue;

        rows.push({
          mission_key: entry.missionKey,
          sort_order: entry.sortOrder,
          name: entry.name,
          agency: entry.agency,
          role: entry.role,
          bio_url: entry.source.url,
          portrait_url: extracted.portraitUrl,
          summary: extracted.summary,
          source_document_id: null,
          metadata: {
            sourceClass: 'csa-astronaut-bio',
            fetchedAt: extracted.fetchedAt
          },
          updated_at: runStartedAtIso
        });
      }
    }

    let upserted = 0;
    for (const chunk of chunkArray(rows, UPSERT_CHUNK)) {
      if (!chunk.length) continue;
      const { error } = await supabase.from('artemis_people').upsert(chunk, { onConflict: 'mission_key,name_normalized' });
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

async function fetchNasaPerson(id: number, stats: Record<string, unknown>) {
  const url = `https://www.nasa.gov/wp-json/wp/v2/people/${encodeURIComponent(String(id))}?_fields=id,link,modified,title,excerpt,content`;
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,*/*',
        'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)'
      }
    });
    if (!response.ok) {
      stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
      (stats.errors as IngestError[]).push({ step: 'nasa_people_fetch_non_200', error: `http_${response.status}`, context: { url } });
      return null;
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    stats.sourcesFetched = Number(stats.sourcesFetched || 0) + 1;
    return parseNasaPerson(json);
  } catch (error) {
    stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
    (stats.errors as IngestError[]).push({ step: 'nasa_people_fetch_exception', error: stringifyError(error), context: { id } });
    return null;
  }
}

function parseNasaPerson(value: unknown): NasaPersonPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as NasaPersonPayload;
}

async function fetchCsaBio(url: string, name: string, stats: Record<string, unknown>) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*',
        'user-agent': 'TMinusZero/0.1 (+https://tminusnow.app)'
      }
    });
    if (!response.ok) {
      stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
      (stats.errors as IngestError[]).push({ step: 'csa_bio_fetch_non_200', error: `http_${response.status}`, context: { url } });
      return null;
    }
    const html = await response.text();
    stats.sourcesFetched = Number(stats.sourcesFetched || 0) + 1;

    const summary =
      normalizeText(extractMetaContent(html, 'description')) ||
      normalizeText(extractFirstParagraph(html)) ||
      null;

    const ogImage = normalizeUrl(extractMetaProperty(html, 'og:image'));
    const portraitUrl = ogImage || normalizeUrl(extractImgAltSrc(html, name)) || normalizeUrl(extractFirstImgSrc(html)) || null;

    return { summary, portraitUrl, fetchedAt: new Date().toISOString() };
  } catch (error) {
    stats.sourcesFailed = Number(stats.sourcesFailed || 0) + 1;
    (stats.errors as IngestError[]).push({ step: 'csa_bio_fetch_exception', error: stringifyError(error), context: { url } });
    return null;
  }
}

function extractMetaContent(html: string, name: string) {
  const match = html.match(new RegExp(`<meta[^>]+name=[\"']${name}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`, 'i'));
  return match?.[1] || null;
}

function extractMetaProperty(html: string, property: string) {
  const match = html.match(new RegExp(`<meta[^>]+property=[\"']${property}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>`, 'i'));
  return match?.[1] || null;
}

function extractFirstParagraph(html: string) {
  const match = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  return match?.[1] ? stripHtml(match[1]) : null;
}

function extractImgAltSrc(html: string, altNeedle: string) {
  const escaped = altNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<img[^>]+alt=[\"'][^\"']*${escaped}[^\"']*[\"'][^>]+src=[\"']([^\"']+)[\"']`, 'i'));
  return match?.[1] || null;
}

function extractFirstImgSrc(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

function extractFirstImageUrl(html: string) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const src = match?.[1] || null;
  return normalizeUrl(src);
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

function chunkArray<T>(rows: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(rows.slice(index, index + size));
  }
  return out;
}

