import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import * as pdfjsStatic from 'npm:pdfjs-dist@4.0.379/build/pdf.mjs';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { getSettings, readBooleanSetting } from '../_shared/settings.ts';
import { parseWs45PlanningForecast, type Ws45PlanningProductKind } from '../../../shared/ws45PlanningParser.ts';

type PdfJsModule = {
  getDocument?: (args: Record<string, unknown>) => { promise: Promise<any> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

type PlanningPageItem = {
  productKind: Ws45PlanningProductKind;
  label: string;
  src: string;
  pdfUrl: string;
};

type FetchedPdf = {
  notModified: boolean;
  bytes: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
};

const PLANNING_PAGE_URL = 'https://45thweathersquadron.nebula.spaceforce.mil/pages/planningAndAviationForecastProducts.html';
const WS45_BASE_URL = 'https://45thweathersquadron.nebula.spaceforce.mil';
const PARSE_VERSION = 'v1';
const USER_AGENT =
  Deno.env.get('WS45_USER_AGENT') ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

let pdfJsModulePromise: Promise<PdfJsModule | null> | null = null;

serve(async (req) => {
  const startedAt = Date.now();
  const supabase = createSupabaseAdminClient();

  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const stats: Record<string, unknown> = {
    pageUrl: PLANNING_PAGE_URL,
    pageFetched: false,
    itemsFound: 0,
    pdfsFetched: 0,
    pdfsNotModified: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    skipped: false,
    reason: null,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  const { runId } = await startIngestionRun(supabase, 'ws45_planning_forecast_ingest');

  try {
    const settings = await getSettings(supabase, ['ws45_planning_forecast_job_enabled']);
    if (!readBooleanSetting(settings.ws45_planning_forecast_job_enabled, true)) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt, stats });
    }

    const latestRows = await loadLatestByProductKind(supabase);
    const dueState = computeDueState(latestRows);
    stats.due24h = dueState.planning24hDue;
    stats.dueWeekly = dueState.weeklyDue;
    stats.dueReason24h = dueState.planning24hReason;
    stats.dueReasonWeekly = dueState.weeklyReason;

    if (!dueState.planning24hDue && !dueState.weeklyDue) {
      await finishIngestionRun(supabase, runId, true, { ...stats, skipped: true, reason: 'not_due' });
      return jsonResponse({ ok: true, skipped: true, reason: 'not_due', elapsedMs: Date.now() - startedAt, stats });
    }

    const html = await fetchText(PLANNING_PAGE_URL);
    stats.pageFetched = true;
    const items = parsePlanningPage(html);
    stats.itemsFound = items.length;
    if (!items.length) throw new Error('ws45_planning_no_pdfs_found');

    for (const item of items) {
      try {
        const latest = await loadLatestByUrl(supabase, item.productKind, item.pdfUrl);
        const pdfRes = await fetchPdf(item.pdfUrl, latest);
        if (pdfRes.notModified) {
          stats.pdfsNotModified = Number(stats.pdfsNotModified || 0) + 1;
          if (latest?.id && latest.sourceLabel !== item.label) {
            const { error: updateError } = await supabase
              .from('ws45_planning_forecasts')
              .update({
                source_label: item.label,
                updated_at: new Date().toISOString()
              })
              .eq('id', latest.id);
            if (updateError) throw updateError;
            stats.rowsUpdated = Number(stats.rowsUpdated || 0) + 1;
          }
          continue;
        }

        stats.pdfsFetched = Number(stats.pdfsFetched || 0) + 1;

        const pdfSha256 = await sha256Hex(pdfRes.bytes);
        const existing = await loadByUrlAndHash(supabase, item.productKind, item.pdfUrl, pdfSha256);
        const { text, metadata } = await extractPdfText(pdfRes.bytes);
        const parsed = parseWs45PlanningForecast({
          text,
          productKind: item.productKind,
          sourceLabel: item.label,
          fetchedAt: new Date().toISOString()
        });

        const payload = {
          product_kind: item.productKind,
          source_page_url: PLANNING_PAGE_URL,
          source_label: item.label,
          pdf_url: item.pdfUrl,
          pdf_etag: pdfRes.etag,
          pdf_last_modified: pdfRes.lastModified,
          pdf_sha256: pdfSha256,
          pdf_bytes: pdfRes.contentLength,
          pdf_metadata: metadata,
          fetched_at: new Date().toISOString(),
          issued_at: parsed.issuedAtUtc,
          valid_start: parsed.validStartUtc,
          valid_end: parsed.validEndUtc,
          headline: parsed.headline || item.label,
          summary: parsed.summary,
          highlights: parsed.highlights,
          raw_text: text,
          raw: {
            pageLabel: item.label,
            pageSrc: item.src
          },
          parse_version: PARSE_VERSION,
          document_family: parsed.documentFamily,
          parse_status: parsed.parseStatus,
          parse_confidence: parsed.parseConfidence,
          publish_eligible: parsed.publishEligible,
          quarantine_reasons: parsed.quarantineReasons,
          updated_at: new Date().toISOString()
        };

        if (existing?.id) {
          const { error: updateError } = await supabase.from('ws45_planning_forecasts').update(payload).eq('id', existing.id);
          if (updateError) throw updateError;
          stats.rowsUpdated = Number(stats.rowsUpdated || 0) + 1;
        } else {
          const { error: insertError } = await supabase.from('ws45_planning_forecasts').insert(payload);
          if (insertError) throw insertError;
          stats.rowsInserted = Number(stats.rowsInserted || 0) + 1;
        }
      } catch (err) {
        (stats.errors as Array<Record<string, unknown>>).push({
          step: 'planning_pdf_ingest',
          error: stringifyError(err),
          context: { productKind: item.productKind, pdfUrl: item.pdfUrl, label: item.label }
        });
      }
    }

    const ok = (stats.errors as Array<Record<string, unknown>>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats }, ok ? 200 : 207);
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<Record<string, unknown>>).push({ step: 'planning_ingest', error: message });
    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, stats, error: message }, 500);
  }
});

function computeDueState(latestRows: Record<Ws45PlanningProductKind, Record<string, unknown> | null>) {
  const nowMs = Date.now();
  const latest24hAt = normalizeLatestAt(latestRows.planning_24h);
  const latestWeeklyAt = normalizeLatestAt(latestRows.weekly_planning);
  const latestSlotMs = latest24hPlanningSlotMs(nowMs);

  const planning24hDue =
    !latest24hAt ||
    nowMs - latest24hAt >= 4 * 60 * 60 * 1000 ||
    (Number.isFinite(latestSlotMs) && nowMs >= latestSlotMs && nowMs - latestSlotMs <= 2 * 60 * 60 * 1000 && latest24hAt < latestSlotMs);

  const weeklyDue = !latestWeeklyAt || nowMs - latestWeeklyAt >= 24 * 60 * 60 * 1000;

  return {
    planning24hDue,
    planning24hReason: !latest24hAt
      ? 'missing_latest'
      : nowMs - latest24hAt >= 4 * 60 * 60 * 1000
        ? 'base_cadence'
        : Number.isFinite(latestSlotMs) && latest24hAt < latestSlotMs
          ? 'post_slot_retry'
          : null,
    weeklyDue,
    weeklyReason: !latestWeeklyAt ? 'missing_latest' : nowMs - latestWeeklyAt >= 24 * 60 * 60 * 1000 ? 'daily_refresh' : null
  };
}

function latest24hPlanningSlotMs(nowMs: number) {
  const now = new Date(nowMs);
  const parts = getEasternDateParts(now);
  if (!parts) return NaN;
  const slotHour = Math.floor(parts.hour / 4) * 4;
  const slotIso = buildEasternIso(parts.year, parts.month, parts.day, slotHour, 0);
  return slotIso ? Date.parse(slotIso) : NaN;
}

function getEasternDateParts(date: Date) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const lookup = (type: string) => Number(parts.find((entry) => entry.type === type)?.value || '0');
    return {
      year: lookup('year'),
      month: lookup('month'),
      day: lookup('day'),
      hour: lookup('hour'),
      minute: lookup('minute')
    };
  } catch {
    return null;
  }
}

function buildEasternIso(year: number, month: number, day: number, hour: number, minute: number) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, 'America/New_York');
  if (offsetMinutes == null) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000).toISOString();
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'shortOffset',
      year: 'numeric'
    });
    const part = formatter.formatToParts(date).find((entry) => entry.type === 'timeZoneName')?.value || '';
    const match = part.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2] || '0');
    const sign = hours < 0 ? -1 : 1;
    return hours * 60 + sign * minutes;
  } catch {
    return null;
  }
}

function normalizeLatestAt(row: Record<string, unknown> | null) {
  const iso =
    (typeof row?.issued_at === 'string' ? row.issued_at : null) ||
    (typeof row?.fetched_at === 'string' ? row.fetched_at : null) ||
    null;
  const ms = Date.parse(String(iso || ''));
  return Number.isFinite(ms) ? ms : null;
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  const wafAction = res.headers.get('x-amzn-waf-action');
  if (wafAction) throw new Error(`ws45_waf_${wafAction}_${res.status}`);
  if (!res.ok) throw new Error(`ws45_planning_html_${res.status}`);
  const html = await res.text();
  if (!html.trim()) {
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`ws45_planning_html_empty_${res.status}_${contentType.split(';')[0] || 'unknown'}`);
  }
  return html;
}

function parsePlanningPage(html: string) {
  const items: PlanningPageItem[] = [];
  const structuredRegex = /<li>\s*<h3>([^<]+)<\/h3>[\s\S]{0,2500}?(?:<embed|<iframe|<a)\b[^>]*(?:src|href)\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = structuredRegex.exec(html))) {
    const label = decodeHtml(match[1] || '').trim();
    const src = (match[2] || '').trim();
    const productKind = classifyPlanningProductKind(label);
    if (!src || !productKind) continue;
    items.push({
      productKind,
      label,
      src,
      pdfUrl: new URL(src, WS45_BASE_URL).toString()
    });
  }

  if (!items.length) {
    const fallbackLabels: Array<{ productKind: Ws45PlanningProductKind; pattern: RegExp }> = [
      { productKind: 'planning_24h', pattern: /24\s*Hour\s*Planning\s*Forecast/i },
      { productKind: 'weekly_planning', pattern: /Weekly\s*Planning\s*Forecast/i }
    ];

    for (const fallback of fallbackLabels) {
      const indexMatch = html.match(fallback.pattern);
      if (!indexMatch?.index && indexMatch?.index !== 0) continue;
      const segment = html.slice(indexMatch.index, indexMatch.index + 3000);
      const pdfMatch = segment.match(/(?:src|href)\s*=\s*["']([^"']+\.pdf[^"']*)["']/i);
      if (!pdfMatch?.[1]) continue;
      items.push({
        productKind: fallback.productKind,
        label: fallback.productKind === 'planning_24h' ? '45 WS 24 Hour Planning Forecast' : '45 WS Weekly Planning Forecast',
        src: pdfMatch[1],
        pdfUrl: new URL(pdfMatch[1], WS45_BASE_URL).toString()
      });
    }
  }

  const deduped = new Map<Ws45PlanningProductKind, PlanningPageItem>();
  for (const item of items) {
    if (!deduped.has(item.productKind)) deduped.set(item.productKind, item);
  }
  return [...deduped.values()];
}

function classifyPlanningProductKind(label: string): Ws45PlanningProductKind | null {
  const normalized = label.toLowerCase();
  if (normalized.includes('24') && normalized.includes('planning')) return 'planning_24h';
  if (normalized.includes('weekly') && normalized.includes('planning')) return 'weekly_planning';
  return null;
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function loadLatestByProductKind(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from('ws45_planning_forecasts')
    .select('product_kind, issued_at, fetched_at')
    .in('product_kind', ['planning_24h', 'weekly_planning'])
    .order('issued_at', { ascending: false })
    .order('fetched_at', { ascending: false })
    .limit(8);
  if (error) throw error;

  const rows = (data || []) as Array<Record<string, unknown>>;
  return {
    planning_24h: rows.find((row) => row.product_kind === 'planning_24h') ?? null,
    weekly_planning: rows.find((row) => row.product_kind === 'weekly_planning') ?? null
  } as Record<Ws45PlanningProductKind, Record<string, unknown> | null>;
}

async function loadLatestByUrl(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  productKind: Ws45PlanningProductKind,
  pdfUrl: string
) {
  const { data, error } = await supabase
    .from('ws45_planning_forecasts')
    .select('id, source_label, pdf_etag, pdf_last_modified')
    .eq('product_kind', productKind)
    .eq('pdf_url', pdfUrl)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    id: String(data.id || ''),
    sourceLabel: typeof data.source_label === 'string' ? data.source_label : null,
    etag: typeof data.pdf_etag === 'string' ? data.pdf_etag : null,
    lastModified: typeof data.pdf_last_modified === 'string' ? data.pdf_last_modified : null
  };
}

async function loadByUrlAndHash(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  productKind: Ws45PlanningProductKind,
  pdfUrl: string,
  pdfSha256: string
) {
  const { data, error } = await supabase
    .from('ws45_planning_forecasts')
    .select('id')
    .eq('product_kind', productKind)
    .eq('pdf_url', pdfUrl)
    .eq('pdf_sha256', pdfSha256)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ? { id: String(data.id) } : null;
}

async function fetchPdf(pdfUrl: string, latest: { etag: string | null; lastModified: string | null } | null): Promise<FetchedPdf> {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    accept: 'application/pdf',
    'accept-language': 'en-US,en;q=0.9'
  };
  if (latest?.etag) headers['If-None-Match'] = latest.etag;
  if (latest?.lastModified) headers['If-Modified-Since'] = new Date(latest.lastModified).toUTCString();

  const res = await fetch(pdfUrl, { headers });
  if (res.status === 304) {
    return {
      notModified: true,
      bytes: new Uint8Array(),
      etag: latest?.etag ?? null,
      lastModified: latest?.lastModified ?? null,
      contentLength: null
    };
  }
  const wafAction = res.headers.get('x-amzn-waf-action');
  if (wafAction) throw new Error(`ws45_waf_${wafAction}_${res.status}`);
  if (!res.ok) throw new Error(`ws45_planning_pdf_${res.status}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  if (!isPdfBytes(buf)) {
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`ws45_planning_pdf_invalid_header_${contentType.split(';')[0] || 'unknown'}`);
  }
  const etag = res.headers.get('etag');
  const lmHeader = res.headers.get('last-modified');
  const lastModified = lmHeader ? new Date(lmHeader).toISOString() : null;
  const contentLength = res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null;

  return { notModified: false, bytes: buf, etag, lastModified, contentLength: Number.isFinite(contentLength) ? contentLength : null };
}

function isPdfBytes(bytes: Uint8Array) {
  if (bytes.length < 4) return false;
  const maxIndex = Math.min(bytes.length - 4, 1024);
  for (let index = 0; index <= maxIndex; index += 1) {
    if (bytes[index] !== 0x25) continue;
    if (bytes[index + 1] !== 0x50) continue;
    if (bytes[index + 2] !== 0x44) continue;
    if (bytes[index + 3] !== 0x46) continue;
    return true;
  }
  return false;
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; metadata: unknown }> {
  const pdfjs = await loadPdfJsModule();
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('ws45_planning_pdfjs_module_unavailable');
  }
  ensurePdfWorkerSrc(pdfjs);
  const task = pdfjs.getDocument({ data: bytes, disableWorker: true });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const chunks = (textContent.items as any[])
      .map((item) => (item && typeof item.str === 'string' ? item.str : ''))
      .filter(Boolean);
    pages.push(chunks.join(' '));
  }

  const text = pages.join('\n').trim();
  const metadata = meta ? { info: (meta as any).info ?? null, meta: (meta as any).metadata ?? null, pages: doc.numPages } : { pages: doc.numPages };
  return { text, metadata };
}

async function loadPdfJsModule(): Promise<PdfJsModule | null> {
  if (pdfJsModulePromise) return pdfJsModulePromise;

  pdfJsModulePromise = (async () => {
    const staticCandidate = pdfjsStatic as unknown as PdfJsModule;
    if (staticCandidate && typeof staticCandidate.getDocument === 'function') {
      return staticCandidate;
    }

    const candidates = [
      'npm:pdfjs-dist@4.0.379/legacy/build/pdf.mjs',
      'npm:pdfjs-dist@4.0.379/build/pdf.mjs',
      'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs',
      'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs'
    ];

    for (const specifier of candidates) {
      try {
        const mod = (await import(specifier)) as unknown as PdfJsModule;
        if (mod && typeof mod.getDocument === 'function') return mod;
      } catch {
        // Try next candidate.
      }
    }

    return null;
  })();

  return pdfJsModulePromise;
}

function ensurePdfWorkerSrc(pdfjs: PdfJsModule) {
  const workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs';
  const opts = (pdfjs as any)?.GlobalWorkerOptions;
  if (!opts || typeof opts !== 'object') return;
  if (!opts.workerSrc) opts.workerSrc = workerSrc;
}

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error.message });
    return { runId: null as number | null };
  }
  return { runId: Number((data as { id?: number } | null)?.id ?? 0) || null };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  errorMessage?: string
) {
  if (!runId) return;
  const update = {
    success,
    ended_at: new Date().toISOString(),
    stats: stats ?? {},
    error: errorMessage ?? null
  };
  const { error } = await supabase.from('ingestion_runs').update(update).eq('id', runId);
  if (error) {
    console.warn('Failed to update ingestion_runs record', { runId, error: error.message });
  }
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
