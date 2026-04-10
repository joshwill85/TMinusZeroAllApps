import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import * as pdfjsStatic from 'npm:pdfjs-dist@4.0.379/build/pdf.mjs';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import { parseWs45ForecastText, tokenizeMissionName, type ParsedForecast } from '../../../shared/ws45Parser.ts';

type PdfJsModule = {
  getDocument?: (args: Record<string, unknown>) => { promise: Promise<any> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

let pdfJsModulePromise: Promise<PdfJsModule | null> | null = null;

async function loadPdfJsModule(): Promise<PdfJsModule | null> {
  if (pdfJsModulePromise) return pdfJsModulePromise;

  pdfJsModulePromise = (async () => {
    const staticCandidate = pdfjsStatic as unknown as PdfJsModule;
    if (staticCandidate && typeof staticCandidate === 'object' && typeof staticCandidate.getDocument === 'function') {
      return staticCandidate;
    }

    const candidates = [
      'npm:pdfjs-dist@4.0.379/legacy/build/pdf.mjs',
      'npm:pdfjs-dist@4.0.379/build/pdf.mjs',
      'https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs',
      'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.mjs',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/legacy/build/pdf.mjs',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs'
    ];

    for (const specifier of candidates) {
      try {
        const mod = (await import(specifier)) as unknown as PdfJsModule;
        if (mod && typeof mod === 'object') return mod;
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

const WS45_PAGE_URL = 'https://45thweathersquadron.nebula.spaceforce.mil/pages/launchForecastSupport.html';
const WS45_BASE_URL = 'https://45thweathersquadron.nebula.spaceforce.mil';
const WS45_PARSE_VERSION = 'v13';

const USER_AGENT =
  Deno.env.get('WS45_USER_AGENT') ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

type ForecastPageItem = {
  label: string;
  src: string;
  pdfUrl: string;
};

type LaunchCandidate = {
  id: string;
  name: string | null;
  net: string | null;
  window_start: string | null;
  window_end: string | null;
  pad_state: string | null;
  pad_name: string | null;
  pad_short_code: string | null;
};

type FetchedPdf = {
  notModified: boolean;
  bytes: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
};

type Ws45MatchResult = {
  status: 'matched' | 'ambiguous' | 'unmatched';
  launchId?: string;
  confidence?: number;
  strategy?: string;
  meta?: Record<string, unknown>;
};

type Ws45QualitySummary = {
  documentMode: 'digital' | 'scanned' | 'unknown';
  documentFamily: string | null;
  classificationConfidence: number | null;
  parseStatus: 'parsed' | 'partial' | 'failed';
  parseConfidence: number | null;
  publishEligible: boolean;
  quarantineReasons: string[];
  requiredFieldsMissing: string[];
  normalizationFlags: string[];
  validationFailures: string[];
  fieldConfidence: Record<string, number>;
};

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;

  const stats: Record<string, unknown> = {
    pageUrl: WS45_PAGE_URL,
    pdfsFound: 0,
    forecastPdfsFound: 0,
    faqPdfsFound: 0,
    pdfsFetched: 0,
    pdfsNotModified: 0,
    forecastsParsed: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsMatched: 0,
    rowsAmbiguous: 0,
    rowsUnmatched: 0,
    errors: [] as Array<{ step: string; error: string; context?: Record<string, unknown> }>
  };

  try {
    supabase = createSupabaseAdminClient();
    const authorized = await requireJobAuth(req, supabase);
    if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

    runId = (await startIngestionRun(supabase, 'ws45_forecasts_ingest')).runId;

    const html = await fetchText(WS45_PAGE_URL);
    const items = parseForecastPage(html);
    const forecastItems = items.filter((item) => deriveForecastKind(item.label, item.pdfUrl) !== 'faq');
    stats.pdfsFound = items.length;
    stats.forecastPdfsFound = forecastItems.length;
    stats.faqPdfsFound = items.length - forecastItems.length;
    if (!items.length) throw new Error('ws45_no_pdfs_found');

    for (const item of forecastItems) {
      const pdfUrl = item.pdfUrl;
      try {
        const latest = await loadLatestByUrl(supabase, pdfUrl);
        const pdfRes = await fetchPdf(pdfUrl, latest);
        if (pdfRes.notModified) {
          stats.pdfsNotModified = (stats.pdfsNotModified as number) + 1;
          const reparsed = await maybeReparseLatest({ supabase, pdfUrl });
          if (reparsed?.didUpdate) {
            stats.forecastsParsed = (stats.forecastsParsed as number) + 1;
            stats.rowsUpdated = (stats.rowsUpdated as number) + 1;
            if (reparsed.matchStatus === 'matched') stats.rowsMatched = (stats.rowsMatched as number) + 1;
            else if (reparsed.matchStatus === 'ambiguous') stats.rowsAmbiguous = (stats.rowsAmbiguous as number) + 1;
            else stats.rowsUnmatched = (stats.rowsUnmatched as number) + 1;
          } else {
            const rematched = await maybeRematchLatest({ supabase, pdfUrl });
            if (rematched?.didUpdate) {
              stats.rowsUpdated = (stats.rowsUpdated as number) + 1;
              if (rematched.matchStatus === 'matched') stats.rowsMatched = (stats.rowsMatched as number) + 1;
              else if (rematched.matchStatus === 'ambiguous') stats.rowsAmbiguous = (stats.rowsAmbiguous as number) + 1;
              else stats.rowsUnmatched = (stats.rowsUnmatched as number) + 1;
            }
          }
          continue;
        }

        stats.pdfsFetched = (stats.pdfsFetched as number) + 1;

        const pdfSha256 = await sha256Hex(pdfRes.bytes);
        const existing = await loadByUrlAndHash(supabase, pdfUrl, pdfSha256);

        const { text, metadata } = await extractPdfText(pdfRes.bytes);
        const forecastKind = deriveForecastKind(item.label, pdfUrl);
        const parsed = parseWs45ForecastText(text);

        stats.forecastsParsed = (stats.forecastsParsed as number) + 1;

        const match = await matchForecastToLaunch(supabase, parsed);
        const quality = summarizeWs45Quality({ text, parsed, forecastKind, match });

        if (!existing) {
          const insertPayload = buildInsertPayload({
            item,
            pdfUrl,
            pdfSha256,
            pdfRes,
            metadata,
            text,
            parsed,
            forecastKind,
            quality,
            match
          });
          const { data: inserted, error: insertError } = await supabase
            .from('ws45_launch_forecasts')
            .insert(insertPayload)
            .select('id')
            .single();
          if (insertError) throw insertError;
          await safeRecordWs45ParseRun({
            supabase,
            forecastId: String((inserted as any)?.id || ''),
            runtime: 'edge',
            attemptReason: 'ingest',
            item,
            pdfUrl,
            forecastKind,
            parsed,
            quality,
            match
          });
          stats.rowsInserted = (stats.rowsInserted as number) + 1;
        } else {
          const updatePayload = buildUpdatePayload({
            item,
            pdfRes,
            metadata,
            text,
            parsed,
            forecastKind,
            quality,
            match,
            existing
          });
          if (Object.keys(updatePayload).length) {
            const { error: updateError } = await supabase.from('ws45_launch_forecasts').update(updatePayload).eq('id', existing.id);
            if (updateError) throw updateError;
            await safeRecordWs45ParseRun({
              supabase,
              forecastId: existing.id,
              runtime: 'edge',
              attemptReason: 'ingest',
              item,
              pdfUrl,
              forecastKind,
              parsed,
              quality,
              match
            });
            stats.rowsUpdated = (stats.rowsUpdated as number) + 1;
          }
        }

        if (match.status === 'matched') stats.rowsMatched = (stats.rowsMatched as number) + 1;
        else if (match.status === 'ambiguous') stats.rowsAmbiguous = (stats.rowsAmbiguous as number) + 1;
        else stats.rowsUnmatched = (stats.rowsUnmatched as number) + 1;
      } catch (err) {
        (stats.errors as Array<any>).push({
          step: 'pdf_ingest',
          error: stringifyError(err),
          context: { pdfUrl: item.pdfUrl, label: item.label }
        });
      }
    }

    const ok = (stats.errors as Array<any>).length === 0;
    await finishIngestionRun(supabase, runId, ok, stats, ok ? undefined : 'partial_failure');
    return jsonResponse({ ok, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });
    if (supabase) await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, elapsedMs: Date.now() - startedAt, error: message, stats }, 500);
  }
});

async function startIngestionRun(supabase: ReturnType<typeof createSupabaseAdminClient>, jobName: string) {
  const { data, error } = await supabase.from('ingestion_runs').insert({ job_name: jobName }).select('id').single();
  if (error || !data) {
    console.warn('Failed to start ingestion_runs record', { jobName, error: error?.message });
    return { runId: null as number | null };
  }
  return { runId: data.id as number };
}

async function finishIngestionRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  runId: number | null,
  success: boolean,
  stats?: Record<string, unknown>,
  error?: string
) {
  if (runId == null) return;
  const { error: updateError } = await supabase
    .from('ingestion_runs')
    .update({
      ended_at: new Date().toISOString(),
      success,
      stats: stats ?? null,
      error: error ?? null
    })
    .eq('id', runId);
  if (updateError) {
    console.warn('Failed to update ingestion_runs record', { runId, updateError: updateError.message });
  }
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
  if (!res.ok) throw new Error(`ws45_html_${res.status}`);
  const html = await res.text();
  if (!html.trim()) {
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`ws45_html_empty_${res.status}_${contentType.split(';')[0] || 'unknown'}`);
  }
  return html;
}

function parseForecastPage(html: string): ForecastPageItem[] {
  const items: ForecastPageItem[] = [];
  const re = /<li>\s*<h3>([^<]+)<\/h3>[\s\S]*?<embed\b[^>]*\bsrc\s*=\s*["']([^"']+\.pdf[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const label = decodeHtml(match[1] || '').trim();
    const src = (match[2] || '').trim();
    if (!src) continue;
    const pdfUrl = new URL(src, WS45_BASE_URL).toString();
    items.push({ label, src, pdfUrl });
  }
  return items;
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

async function loadLatestByUrl(supabase: ReturnType<typeof createSupabaseAdminClient>, pdfUrl: string) {
  const { data, error } = await supabase
    .from('ws45_launch_forecasts')
    .select('pdf_etag,pdf_last_modified')
    .eq('pdf_url', pdfUrl)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return {
    etag: data.pdf_etag as string | null,
    lastModified: (data.pdf_last_modified as string | null) ?? null
  };
}

async function loadByUrlAndHash(supabase: ReturnType<typeof createSupabaseAdminClient>, pdfUrl: string, pdfSha256: string) {
  const { data, error } = await supabase
    .from('ws45_launch_forecasts')
    .select('id,match_status')
    .eq('pdf_url', pdfUrl)
    .eq('pdf_sha256', pdfSha256)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id as string, matchStatus: (data.match_status as string | null) ?? null };
}

async function fetchPdf(
  pdfUrl: string,
  latest: { etag: string | null; lastModified: string | null } | null
): Promise<FetchedPdf> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, accept: 'application/pdf', 'accept-language': 'en-US,en;q=0.9' };
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
  if (!res.ok) throw new Error(`ws45_pdf_${res.status}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  if (!isPdfBytes(buf)) {
    const contentType = res.headers.get('content-type') || 'unknown';
    throw new Error(`ws45_pdf_invalid_header_${contentType.split(';')[0] || 'unknown'}`);
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
  for (let i = 0; i <= maxIndex; i += 1) {
    if (bytes[i] !== 0x25) continue;
    if (bytes[i + 1] !== 0x50) continue;
    if (bytes[i + 2] !== 0x44) continue;
    if (bytes[i + 3] !== 0x46) continue;
    return true;
  }
  return false;
}

async function sha256Hex(bytes: Uint8Array) {
  const digestInput = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; metadata: unknown }> {
  const pdfjs = await loadPdfJsModule();
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('ws45_pdfjs_module_unavailable');
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

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

async function matchForecastToLaunch(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  parsed: ParsedForecast
): Promise<{ status: 'matched' | 'ambiguous' | 'unmatched'; launchId?: string; confidence?: number; strategy?: string; meta?: Record<string, unknown> }> {
  if (!parsed.validStartUtc || !parsed.validEndUtc) {
    return {
      status: 'unmatched',
      strategy: 'missing_valid_window',
      meta: { hasValidStart: Boolean(parsed.validStartUtc), hasValidEnd: Boolean(parsed.validEndUtc) }
    };
  }
  const startMs = Date.parse(parsed.validStartUtc);
  const endMs = Date.parse(parsed.validEndUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return {
      status: 'unmatched',
      strategy: 'invalid_valid_window',
      meta: { validStartUtc: parsed.validStartUtc, validEndUtc: parsed.validEndUtc }
    };
  }

  const horizonStart = new Date(startMs - 48 * 60 * 60 * 1000).toISOString();
  const horizonEnd = new Date(endMs + 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('launches')
    .select('id,name,net,window_start,window_end,pad_state,pad_name,pad_short_code')
    .eq('pad_state', 'FL')
    .eq('hidden', false)
    .gte('net', horizonStart)
    .lte('net', horizonEnd)
    .limit(50);
  if (error) {
    console.warn('ws45 match query error', error.message);
    return { status: 'unmatched', strategy: 'launch_query_error', meta: { message: error.message } };
  }

  const candidates: LaunchCandidate[] = (data as any) || [];
  if (!candidates.length) return { status: 'unmatched', strategy: 'no_candidates', meta: { horizonStart, horizonEnd } };

  const forecastTokens = new Set(parsed.missionTokens ?? []);
  const scored = candidates
    .map((c) => ({ candidate: c, score: scoreCandidate(c, { startMs, endMs, forecastTokens }) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { status: 'unmatched', strategy: 'no_scored_candidates', meta: { candidateCount: candidates.length } };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  const confidence = clampInt(top.score, 0, 100);

  if (runnerUp && Math.abs(top.score - runnerUp.score) < 10) {
    return {
      status: 'ambiguous',
      confidence,
      strategy: 'time_window_plus_mission_tokens',
      meta: { top: { id: top.candidate.id, score: top.score }, runnerUp: { id: runnerUp.candidate.id, score: runnerUp.score } }
    };
  }

  if (top.score < 60) return { status: 'unmatched', confidence, strategy: 'time_window_plus_mission_tokens', meta: { topScore: top.score } };

  return {
    status: 'matched',
    launchId: top.candidate.id,
    confidence,
    strategy: 'time_window_plus_mission_tokens',
    meta: { score: top.score, matchedBy: ['time', 'tokens'] }
  };
}

function scoreCandidate(
  candidate: LaunchCandidate,
  ctx: { startMs: number; endMs: number; forecastTokens: Set<string> }
) {
  const start = Date.parse(candidate.window_start || candidate.net || '');
  const end = Date.parse(candidate.window_end || candidate.net || '');
  const net = Date.parse(candidate.net || '');

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const launchStart = start;
  const launchEnd = end >= start ? end : start;

  const overlap = Math.max(0, Math.min(ctx.endMs, launchEnd) - Math.max(ctx.startMs, launchStart));
  const netInside = Number.isFinite(net) ? net >= ctx.startMs && net <= ctx.endMs : false;

  const candidateTokens = new Set(tokenizeMissionName(candidate.name || ''));
  let tokenHits = 0;
  ctx.forecastTokens.forEach((t) => {
    if (candidateTokens.has(t)) tokenHits += 1;
  });
  const tokenScore = Math.min(25, tokenHits * 5);
  const timeScore = netInside ? 75 : overlap > 0 ? 60 : 0;
  const score = timeScore + tokenScore;

  return clampInt(score, 0, 100);
}

function buildInsertPayload(args: {
  item: ForecastPageItem;
  pdfUrl: string;
  pdfSha256: string;
  pdfRes: FetchedPdf;
  metadata: unknown;
  text: string;
  parsed: ParsedForecast;
  forecastKind: string | null;
  quality: Ws45QualitySummary;
  match: Ws45MatchResult;
}) {
  const now = new Date().toISOString();
  return {
    source: '45ws',
    source_range: 'eastern_range',
    source_page_url: WS45_PAGE_URL,
    source_label: args.item.label || null,
    forecast_kind: args.forecastKind,
    pdf_url: args.pdfUrl,
    pdf_etag: args.pdfRes.etag,
    pdf_last_modified: args.pdfRes.lastModified,
    pdf_sha256: args.pdfSha256,
    pdf_bytes: args.pdfRes.bytes.length,
    pdf_metadata: args.metadata ?? null,
    fetched_at: now,
    product_name: args.parsed.productName ?? null,
    mission_name: args.parsed.missionName ?? null,
    mission_name_normalized: args.parsed.missionNameNormalized ?? null,
    mission_tokens: args.parsed.missionTokens ?? null,
    issued_at: args.parsed.issuedAtUtc ?? null,
    valid_start: args.parsed.validStartUtc ?? null,
    valid_end: args.parsed.validEndUtc ?? null,
    local_timezone: 'America/New_York',
    forecast_discussion: args.parsed.forecastDiscussion ?? null,
    launch_day_pov_percent: args.parsed.launchDayPovPercent ?? null,
    launch_day_primary_concerns: args.parsed.launchDayPrimaryConcerns ?? null,
    launch_day: args.parsed.launchDay ?? null,
    delay_24h_pov_percent: args.parsed.delay24hPovPercent ?? null,
    delay_24h_primary_concerns: args.parsed.delay24hPrimaryConcerns ?? null,
    delay_24h: args.parsed.delay24h ?? null,
    raw_text: args.text,
    raw: { item: args.item, parsed: args.parsed, quality: serializeQuality(args.quality) },
    parse_version: WS45_PARSE_VERSION,
    document_mode: args.quality.documentMode,
    document_family: args.quality.documentFamily,
    classification_confidence: args.quality.classificationConfidence,
    parse_status: args.quality.parseStatus,
    parse_confidence: args.quality.parseConfidence,
    publish_eligible: args.quality.publishEligible,
    quarantine_reasons: args.quality.quarantineReasons,
    required_fields_missing: args.quality.requiredFieldsMissing,
    normalization_flags: args.quality.normalizationFlags,
    match_status: args.match.status,
    matched_launch_id: args.match.status === 'matched' ? args.match.launchId ?? null : null,
    match_confidence: args.match.confidence ?? null,
    match_strategy: args.match.strategy ?? null,
    match_meta: args.match.meta ?? null,
    matched_at: args.match.status === 'matched' ? now : null,
    created_at: now,
    updated_at: now
  };
}

function buildUpdatePayload(args: {
  item: ForecastPageItem;
  pdfRes: FetchedPdf;
  metadata: unknown;
  text: string;
  parsed: ParsedForecast;
  forecastKind: string | null;
  quality: Ws45QualitySummary;
  match: Ws45MatchResult;
  existing: { id: string; matchStatus: string | null };
}) {
  const now = new Date().toISOString();
  const canUpdateMatch = args.existing.matchStatus !== 'manual';
  return {
    pdf_etag: args.pdfRes.etag,
    pdf_last_modified: args.pdfRes.lastModified,
    pdf_bytes: args.pdfRes.bytes.length,
    pdf_metadata: args.metadata ?? null,
    fetched_at: now,
    source_label: args.item.label || null,
    forecast_kind: args.forecastKind,
    product_name: args.parsed.productName ?? null,
    mission_name: args.parsed.missionName ?? null,
    mission_name_normalized: args.parsed.missionNameNormalized ?? null,
    mission_tokens: args.parsed.missionTokens ?? null,
    issued_at: args.parsed.issuedAtUtc ?? null,
    valid_start: args.parsed.validStartUtc ?? null,
    valid_end: args.parsed.validEndUtc ?? null,
    forecast_discussion: args.parsed.forecastDiscussion ?? null,
    launch_day_pov_percent: args.parsed.launchDayPovPercent ?? null,
    launch_day_primary_concerns: args.parsed.launchDayPrimaryConcerns ?? null,
    launch_day: args.parsed.launchDay ?? null,
    delay_24h_pov_percent: args.parsed.delay24hPovPercent ?? null,
    delay_24h_primary_concerns: args.parsed.delay24hPrimaryConcerns ?? null,
    delay_24h: args.parsed.delay24h ?? null,
    raw_text: args.text,
    raw: { item: args.item, parsed: args.parsed, quality: serializeQuality(args.quality) },
    parse_version: WS45_PARSE_VERSION,
    document_mode: args.quality.documentMode,
    document_family: args.quality.documentFamily,
    classification_confidence: args.quality.classificationConfidence,
    parse_status: args.quality.parseStatus,
    parse_confidence: args.quality.parseConfidence,
    publish_eligible: args.quality.publishEligible,
    quarantine_reasons: args.quality.quarantineReasons,
    required_fields_missing: args.quality.requiredFieldsMissing,
    normalization_flags: args.quality.normalizationFlags,
    match_status: canUpdateMatch ? args.match.status : undefined,
    matched_launch_id: canUpdateMatch ? (args.match.status === 'matched' ? args.match.launchId ?? null : null) : undefined,
    match_confidence: canUpdateMatch ? args.match.confidence ?? null : undefined,
    match_strategy: canUpdateMatch ? args.match.strategy ?? null : undefined,
    match_meta: canUpdateMatch ? args.match.meta ?? null : undefined,
    matched_at: canUpdateMatch ? (args.match.status === 'matched' ? now : null) : undefined,
    updated_at: now
  };
}

async function maybeReparseLatest({
  supabase,
  pdfUrl
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  pdfUrl: string;
}): Promise<{ didUpdate: boolean; matchStatus: 'matched' | 'ambiguous' | 'unmatched' } | null> {
  const latest = await loadLatestForReparse(supabase, pdfUrl);
  if (!latest?.id || !latest.rawText) return null;
  if (latest.parseVersion === WS45_PARSE_VERSION) return null;

  const parsed = parseWs45ForecastText(latest.rawText);
  if (!parsed.productName && !parsed.missionName && !parsed.validStartUtc) return null;

  const match = await matchForecastToLaunch(supabase, parsed);
  const forecastKind = deriveForecastKind(latest.sourceLabel || '', pdfUrl);
  const quality = summarizeWs45Quality({ text: latest.rawText, parsed, forecastKind, match });
  const payload = buildReparsePayload({
    parsed,
    quality,
    match,
    existing: { matchStatus: latest.matchStatus }
  });

  if (!Object.keys(payload).length) return { didUpdate: false, matchStatus: match.status };
  const { error } = await supabase.from('ws45_launch_forecasts').update(payload).eq('id', latest.id);
  if (error) throw error;
  await safeRecordWs45ParseRun({
    supabase,
    forecastId: latest.id,
    runtime: 'edge',
    attemptReason: 'reparse',
    item: { label: latest.sourceLabel || '', src: '', pdfUrl },
    pdfUrl,
    forecastKind,
    parsed,
    quality,
    match
  });
  return { didUpdate: true, matchStatus: match.status };
}

async function maybeRematchLatest({
  supabase,
  pdfUrl
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  pdfUrl: string;
}): Promise<{ didUpdate: boolean; matchStatus: 'matched' | 'ambiguous' | 'unmatched' } | null> {
  const latest = await loadLatestForReparse(supabase, pdfUrl);
  if (!latest?.id || latest.matchStatus === 'manual') return null;
  if (!latest.validStart || !latest.validEnd) return null;

  const parsed: ParsedForecast = {
    validStartUtc: latest.validStart ?? undefined,
    validEndUtc: latest.validEnd ?? undefined,
    missionTokens: latest.missionTokens ?? (latest.missionName ? tokenizeMissionName(latest.missionName) : undefined)
  };

  const match = await matchForecastToLaunch(supabase, parsed);
  const nextMatchedId = match.status === 'matched' ? match.launchId ?? null : null;
  const shouldUpdate = match.status !== latest.matchStatus || nextMatchedId !== (latest.matchedLaunchId ?? null);
  if (!shouldUpdate) return { didUpdate: false, matchStatus: match.status };

  const payload = buildRematchPayload({
    match,
    existing: { matchStatus: latest.matchStatus }
  });

  if (!Object.keys(payload).length) return { didUpdate: false, matchStatus: match.status };
  const { error } = await supabase.from('ws45_launch_forecasts').update(payload).eq('id', latest.id);
  if (error) throw error;
  return { didUpdate: true, matchStatus: match.status };
}

async function loadLatestForReparse(supabase: ReturnType<typeof createSupabaseAdminClient>, pdfUrl: string) {
  const { data, error } = await supabase
    .from('ws45_launch_forecasts')
    .select('id,parse_version,raw_text,source_label,match_status,matched_launch_id,valid_start,valid_end,mission_name,mission_tokens')
    .eq('pdf_url', pdfUrl)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: (data as any).id as string,
    parseVersion: ((data as any).parse_version as string | null) ?? null,
    rawText: ((data as any).raw_text as string | null) ?? null,
    sourceLabel: ((data as any).source_label as string | null) ?? null,
    matchStatus: ((data as any).match_status as string | null) ?? null,
    matchedLaunchId: ((data as any).matched_launch_id as string | null) ?? null,
    validStart: ((data as any).valid_start as string | null) ?? null,
    validEnd: ((data as any).valid_end as string | null) ?? null,
    missionName: ((data as any).mission_name as string | null) ?? null,
    missionTokens: ((data as any).mission_tokens as string[] | null) ?? null
  };
}

function buildReparsePayload(args: {
  parsed: ParsedForecast;
  quality: Ws45QualitySummary;
  match: Ws45MatchResult;
  existing: { matchStatus: string | null };
}) {
  const now = new Date().toISOString();
  const canUpdateMatch = args.existing.matchStatus !== 'manual';

  return {
    product_name: args.parsed.productName ?? null,
    mission_name: args.parsed.missionName ?? null,
    mission_name_normalized: args.parsed.missionNameNormalized ?? null,
    mission_tokens: args.parsed.missionTokens ?? null,
    issued_at: args.parsed.issuedAtUtc ?? null,
    valid_start: args.parsed.validStartUtc ?? null,
    valid_end: args.parsed.validEndUtc ?? null,
    forecast_discussion: args.parsed.forecastDiscussion ?? null,
    launch_day_pov_percent: args.parsed.launchDayPovPercent ?? null,
    launch_day_primary_concerns: args.parsed.launchDayPrimaryConcerns ?? null,
    launch_day: args.parsed.launchDay ?? null,
    delay_24h_pov_percent: args.parsed.delay24hPovPercent ?? null,
    delay_24h_primary_concerns: args.parsed.delay24hPrimaryConcerns ?? null,
    delay_24h: args.parsed.delay24h ?? null,
    parse_version: WS45_PARSE_VERSION,
    document_mode: args.quality.documentMode,
    document_family: args.quality.documentFamily,
    classification_confidence: args.quality.classificationConfidence,
    parse_status: args.quality.parseStatus,
    parse_confidence: args.quality.parseConfidence,
    publish_eligible: args.quality.publishEligible,
    quarantine_reasons: args.quality.quarantineReasons,
    required_fields_missing: args.quality.requiredFieldsMissing,
    normalization_flags: args.quality.normalizationFlags,
    match_status: canUpdateMatch ? args.match.status : undefined,
    matched_launch_id: canUpdateMatch ? (args.match.status === 'matched' ? args.match.launchId ?? null : null) : undefined,
    match_confidence: canUpdateMatch ? args.match.confidence ?? null : undefined,
    match_strategy: canUpdateMatch ? args.match.strategy ?? null : undefined,
    match_meta: canUpdateMatch ? args.match.meta ?? null : undefined,
    matched_at: canUpdateMatch ? (args.match.status === 'matched' ? now : null) : undefined,
    updated_at: now
  };
}

function buildRematchPayload(args: {
  match: Ws45MatchResult;
  existing: { matchStatus: string | null };
}) {
  const now = new Date().toISOString();
  const canUpdateMatch = args.existing.matchStatus !== 'manual';
  if (!canUpdateMatch) return {};

  return {
    match_status: args.match.status,
    matched_launch_id: args.match.status === 'matched' ? args.match.launchId ?? null : null,
    match_confidence: args.match.confidence ?? null,
    match_strategy: args.match.strategy ?? null,
    match_meta: args.match.meta ?? null,
    matched_at: args.match.status === 'matched' ? now : null,
    updated_at: now
  };
}

function summarizeWs45Quality({
  text,
  parsed,
  forecastKind,
  match
}: {
  text: string;
  parsed: ParsedForecast;
  forecastKind: string | null;
  match: Ws45MatchResult;
}): Ws45QualitySummary {
  const normalizationFlags: string[] = [];
  if (/Forecast\s+Discussio\s+n/i.test(text)) normalizationFlags.push('split_forecast_discussion_heading');
  if (/\b\d{1,2}\s*-\s*[A-Za-z]{3}\s*-\s*\d{2}\b/i.test(text)) normalizationFlags.push('hyphenated_date_tokens');

  const documentMode = inferWs45DocumentMode(text);
  const documentFamily = inferWs45DocumentFamily(text);
  const classificationConfidence = documentFamily === 'unknown_family' ? 40 : 90;

  const requiredFieldsMissing =
    forecastKind === 'faq'
      ? []
      : [
          parsed.productName ? null : 'product_name',
          parsed.missionName ? null : 'mission_name',
          parsed.issuedAtUtc ? null : 'issued_at',
          parsed.validStartUtc ? null : 'valid_start',
          parsed.validEndUtc ? null : 'valid_end'
        ].filter((value): value is string => Boolean(value));

  const validationFailures: string[] = [];
  const validStartMs = parsed.validStartUtc ? Date.parse(parsed.validStartUtc) : NaN;
  const validEndMs = parsed.validEndUtc ? Date.parse(parsed.validEndUtc) : NaN;
  if (Number.isFinite(validStartMs) && Number.isFinite(validEndMs) && validEndMs <= validStartMs) {
    validationFailures.push('invalid_valid_window_order');
  }

  const hasMeaningfulContent = Boolean(
    parsed.productName ||
      parsed.missionName ||
      parsed.issuedAtUtc ||
      parsed.validStartUtc ||
      parsed.validEndUtc ||
      parsed.forecastDiscussion ||
      parsed.launchDay ||
      parsed.delay24h
  );

  let parseStatus: Ws45QualitySummary['parseStatus'] = 'parsed';
  if (!hasMeaningfulContent) parseStatus = 'failed';
  else if (requiredFieldsMissing.length || validationFailures.length) parseStatus = 'partial';

  const quarantineReasons = [
    ...requiredFieldsMissing.map((field) => `missing_${field}`),
    ...validationFailures,
    ...(match.status === 'matched' ? [] : [match.status === 'ambiguous' ? 'ambiguous_launch' : 'unmatched_launch'])
  ];

  const fieldConfidence = {
    product_name: parsed.productName ? 100 : 0,
    mission_name: parsed.missionName ? 100 : 0,
    issued_at: parsed.issuedAtUtc ? 100 : 0,
    valid_start: parsed.validStartUtc ? 100 : 0,
    valid_end: parsed.validEndUtc ? 100 : 0,
    forecast_discussion: parsed.forecastDiscussion ? 85 : 0,
    launch_day: parsed.launchDay ? 90 : 0,
    delay_24h: parsed.delay24h ? 90 : 0
  };
  const fieldScores = Object.values(fieldConfidence);
  const parseConfidence = fieldScores.length ? clampInt(Math.round(fieldScores.reduce((sum, value) => sum + value, 0) / fieldScores.length), 0, 100) : null;
  const publishEligible = forecastKind !== 'faq' && parseStatus === 'parsed' && match.status === 'matched';

  return {
    documentMode,
    documentFamily,
    classificationConfidence,
    parseStatus,
    parseConfidence,
    publishEligible,
    quarantineReasons,
    requiredFieldsMissing,
    normalizationFlags,
    validationFailures,
    fieldConfidence
  };
}

function inferWs45DocumentMode(text: string): Ws45QualitySummary['documentMode'] {
  const trimmed = text.trim();
  if (!trimmed) return 'scanned';
  return trimmed.length >= 80 ? 'digital' : 'unknown';
}

function inferWs45DocumentFamily(text: string) {
  if (/Forecast\s+Discussio\s+n/i.test(text)) return 'split_heading_variant';
  if (/\b\d{1,2}\s*-\s*[A-Za-z]{3}\s*-\s*\d{2}\b/i.test(text)) return 'hyphenated_abbrev_month_2digit_year';
  if (/\b\d{1,2}\s+[A-Za-z]+\.?\s+\d{4}\b/i.test(text)) return 'legacy_spaced_full_month_year';
  return 'unknown_family';
}

function serializeQuality(quality: Ws45QualitySummary) {
  return {
    documentMode: quality.documentMode,
    documentFamily: quality.documentFamily,
    classificationConfidence: quality.classificationConfidence,
    parseStatus: quality.parseStatus,
    parseConfidence: quality.parseConfidence,
    publishEligible: quality.publishEligible,
    quarantineReasons: quality.quarantineReasons,
    requiredFieldsMissing: quality.requiredFieldsMissing,
    normalizationFlags: quality.normalizationFlags,
    validationFailures: quality.validationFailures,
    fieldConfidence: quality.fieldConfidence
  };
}

async function safeRecordWs45ParseRun({
  supabase,
  forecastId,
  runtime,
  attemptReason,
  item,
  pdfUrl,
  forecastKind,
  parsed,
  quality,
  match
}: {
  supabase: ReturnType<typeof createSupabaseAdminClient>;
  forecastId: string;
  runtime: 'edge' | 'node' | 'script';
  attemptReason: 'ingest' | 'reparse' | 'admin_replay' | 'backfill';
  item: ForecastPageItem;
  pdfUrl: string;
  forecastKind: string | null;
  parsed: ParsedForecast;
  quality: Ws45QualitySummary;
  match: Ws45MatchResult;
}) {
  if (!forecastId) return;
  try {
    const { data, error } = await supabase
      .from('ws45_forecast_parse_runs')
      .insert({
        forecast_id: forecastId,
        parser_version: WS45_PARSE_VERSION,
        runtime,
        attempt_reason: attemptReason,
        document_mode: quality.documentMode,
        document_family: quality.documentFamily,
        parse_status: quality.parseStatus,
        parse_confidence: quality.parseConfidence,
        publish_eligible: quality.publishEligible,
        missing_required_fields: quality.requiredFieldsMissing,
        validation_failures: quality.validationFailures,
        normalization_flags: quality.normalizationFlags,
        field_confidence: quality.fieldConfidence,
        field_evidence: {
          source_label: item.label || null,
          pdf_url: pdfUrl,
          forecast_kind: forecastKind,
          product_name: parsed.productName ?? null,
          mission_name: parsed.missionName ?? null,
          issued_at: parsed.issuedAtUtc ?? null,
          valid_start: parsed.validStartUtc ?? null,
          valid_end: parsed.validEndUtc ?? null
        },
        strategy_trace: {
          document_family: quality.documentFamily,
          normalization_flags: quality.normalizationFlags,
          match_strategy: match.strategy ?? null
        },
        stats: {
          match_status: match.status,
          match_confidence: match.confidence ?? null,
          match_strategy: match.strategy ?? null,
          match_meta: match.meta ?? null
        }
      })
      .select('id')
      .single();
    if (error) {
      console.warn('ws45 parse run insert error', error.message);
      return;
    }
    const parseRunId = typeof (data as any)?.id === 'string' ? ((data as any).id as string) : null;
    if (!parseRunId) return;
    const { error: updateError } = await supabase
      .from('ws45_launch_forecasts')
      .update({ latest_parse_run_id: parseRunId, updated_at: new Date().toISOString() })
      .eq('id', forecastId);
    if (updateError) console.warn('ws45 latest_parse_run_id update error', updateError.message);
  } catch (err) {
    console.warn('ws45 parse run logging failed', stringifyError(err));
  }
}

function deriveForecastKind(label: string, pdfUrl: string) {
  const lower = label.toLowerCase();
  if (lower.includes('faq')) return 'faq';
  const kindMatch = lower.match(/\bl[+-]?[0-9]+\b/);
  if (kindMatch) return kindMatch[0].toUpperCase();
  if (pdfUrl.toLowerCase().includes('forecast')) return 'forecast';
  return null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function stringifyError(err: unknown) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}
