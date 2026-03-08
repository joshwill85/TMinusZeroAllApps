import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import * as pdfjsStatic from 'npm:pdfjs-dist@4.0.379/build/pdf.mjs';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';

type PdfJsModule = {
  getDocument?: (args: Record<string, unknown>) => { promise: Promise<any> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

let pdfJsModulePromise: Promise<PdfJsModule | null> | null = null;

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
const WS45_PARSE_VERSION = 'v12';

const USER_AGENT =
  Deno.env.get('WS45_USER_AGENT') ||
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

type ForecastPageItem = {
  label: string;
  src: string;
  pdfUrl: string;
};

type ParsedScenario = {
  label?: string;
  povPercent?: number;
  primaryConcerns?: string[];
  weatherVisibility?: string;
  tempF?: number;
  humidityPercent?: number;
  liftoffWinds?: { directionDeg?: number; speedMphMin?: number; speedMphMax?: number; raw?: string };
  additionalRiskCriteria?: {
    upperLevelWindShear?: string;
    boosterRecoveryWeather?: string;
    solarActivity?: string;
  };
  clouds?: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }>;
  rawSection?: string;
};

type ParsedForecast = {
  productName?: string;
  missionName?: string;
  missionNameNormalized?: string;
  missionTokens?: string[];
  issuedAtUtc?: string;
  validStartUtc?: string;
  validEndUtc?: string;
  forecastDiscussion?: string;
  launchDay?: ParsedScenario;
  delay24h?: ParsedScenario;
  launchDayPovPercent?: number;
  launchDayPrimaryConcerns?: string[];
  delay24hPovPercent?: number;
  delay24hPrimaryConcerns?: string[];
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

serve(async (req) => {
  const startedAt = Date.now();
  let supabase: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let runId: number | null = null;

  const stats: Record<string, unknown> = {
    pageUrl: WS45_PAGE_URL,
    pdfsFound: 0,
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
    stats.pdfsFound = items.length;
    if (!items.length) throw new Error('ws45_no_pdfs_found');

    for (const item of items) {
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
        const parsed = parseWs45ForecastText(text);
        if (deriveForecastKind(item.label, pdfUrl) === 'faq') continue;

        stats.forecastsParsed = (stats.forecastsParsed as number) + 1;

        const match = await matchForecastToLaunch(supabase, parsed);

        if (!existing) {
          const insertPayload = buildInsertPayload({
            item,
            pdfUrl,
            pdfSha256,
            pdfRes,
            metadata,
            text,
            parsed,
            match
          });
          const { error: insertError } = await supabase.from('ws45_launch_forecasts').insert(insertPayload);
          if (insertError) throw insertError;
          stats.rowsInserted = (stats.rowsInserted as number) + 1;
        } else {
          const updatePayload = buildUpdatePayload({
            item,
            pdfRes,
            metadata,
            text,
            parsed,
            match,
            existing
          });
          if (Object.keys(updatePayload).length) {
            const { error: updateError } = await supabase.from('ws45_launch_forecasts').update(updatePayload).eq('id', existing.id);
            if (updateError) throw updateError;
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
  const digest = await crypto.subtle.digest('SHA-256', bytes);
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

function parseWs45ForecastText(text: string): ParsedForecast {
  const compact = normalizeText(text);

  const productName = compact.includes('Launch Mission Execution Forecast') ? 'Launch Mission Execution Forecast' : undefined;

  const missionName =
    matchGroup(compact, /Mission\s*:\s*(.+?)\s+Issued\s*:/i) ?? matchGroup(compact, /Mission\s*:\s*(.+?)\s+Valid\s*:/i);
  const missionNameNormalized = missionName ? normalizeMissionName(missionName) : undefined;
  const missionTokens = missionName ? tokenizeMissionName(missionName) : undefined;

  const issued = parseIssuedUtc(compact);
  const valid = parseValidUtc(compact);

  const forecastDiscussion = matchGroup(compact, /Forecast Discussion\s*:\s*(.+?)\s+Launch\s+Day\b/i);

  const delay24Header = /\b24\s*(?:-\s*)?Hour\s+Delay\b/i;
  const delay48Header = /\b48\s*(?:-\s*)?Hour\s+Delay\b/i;
  const delay72Header = /\b72\s*(?:-\s*)?Hour\s+Delay\b/i;
  const sectionTailHeaders = [/\bNotes\b/i, /\bNext Forecast\b/i];

  const launchDaySection = sliceBetweenAny(compact, /\bLaunch Day\b/i, [
    delay24Header,
    delay48Header,
    delay72Header,
    ...sectionTailHeaders
  ]);
  const delay24Section = sliceBetweenAny(compact, delay24Header, [delay48Header, delay72Header, ...sectionTailHeaders]);
  const delay48Section = sliceBetweenAny(compact, delay48Header, [delay72Header, ...sectionTailHeaders]);
  const delay72Section = sliceBetweenAny(compact, delay72Header, sectionTailHeaders);
  const delaySelection = delay24Section
    ? { section: delay24Section, label: '24-Hour Delay' }
    : delay48Section
      ? { section: delay48Section, label: '48-Hour Delay' }
      : delay72Section
        ? { section: delay72Section, label: '72-Hour Delay' }
        : null;

  const launchDay = launchDaySection ? parseScenario(launchDaySection) : undefined;
  const delay24h = delaySelection ? parseScenario(delaySelection.section) : undefined;
  if (delay24h && delaySelection) delay24h.label = delaySelection.label;

  return {
    productName,
    missionName: missionName || undefined,
    missionNameNormalized,
    missionTokens,
    issuedAtUtc: issued ?? undefined,
    validStartUtc: valid?.start ?? undefined,
    validEndUtc: valid?.end ?? undefined,
    forecastDiscussion: forecastDiscussion || undefined,
    launchDay,
    delay24h,
    launchDayPovPercent: launchDay?.povPercent,
    launchDayPrimaryConcerns: launchDay?.primaryConcerns,
    delay24hPovPercent: delay24h?.povPercent,
    delay24hPrimaryConcerns: delay24h?.primaryConcerns
  };
}

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function matchGroup(text: string, re: RegExp) {
  const match = text.match(re);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function sliceBetween(text: string, start: RegExp, end: RegExp) {
  const startMatch = text.match(start);
  if (startMatch?.index == null) return null;
  const startIndex = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIndex);
  const endMatch = rest.match(end);
  const endIndex = endMatch?.index ?? rest.length;
  const sliced = rest.slice(0, endIndex).trim();
  return sliced || null;
}

function sliceBetweenAny(text: string, start: RegExp, endPatterns: RegExp[]) {
  const startMatch = text.match(start);
  if (startMatch?.index == null) return null;
  const startIndex = startMatch.index + startMatch[0].length;
  const rest = text.slice(startIndex);
  let endIndex = rest.length;

  for (const pattern of endPatterns) {
    const match = rest.match(pattern);
    if (match?.index == null) continue;
    if (match.index < endIndex) endIndex = match.index;
  }

  const sliced = rest.slice(0, endIndex).trim();
  return sliced || null;
}

function parseIssuedUtc(compact: string) {
  const match = compact.match(
    /Issued\s*:\s*([0-9](?:\s*[0-9])?\s+[A-Za-z]+\.?\s+[0-9](?:\s*[0-9]){3})\s*\/\s*([0-9](?:\s*[0-9]){2,3})\s*L\s*\(\s*([0-9](?:\s*[0-9]){2,3})\s*Z\s*\)/i
  );
  if (!match) return null;
  const date = parseDayMonthYear(match[1]);
  if (!date) return null;
  const localMinutes = parseTimeMinutes(match[2]);
  const utcMinutes = parseTimeMinutes(match[3]);
  if (localMinutes == null || utcMinutes == null) return null;
  const offsetMinutes = inferOffsetMinutes(localMinutes, utcMinutes);
  const utc = buildUtcTimestamp(date, localMinutes, offsetMinutes);
  return utc.toISOString();
}

function parseValidUtc(compact: string) {
  const match = compact.match(
    /Valid\s*:\s*([0-9](?:\s*[0-9])?\s+[A-Za-z]+\.?\s+[0-9](?:\s*[0-9]){3})\s*\/\s*([^()]+?)\s*\(\s*([^)]+?)\s*\)/i
  );
  if (!match) return null;

  const date = parseDayMonthYear(match[1]);
  if (!date) return null;

  const localRange = parseWs45TimeRange(match[2], 'L');
  const utcRange = parseWs45TimeRange(match[3], 'Z');
  if (!localRange || !utcRange) return null;

  const localStartMinutes = localRange.start.minutes;
  const localEndMinutes = localRange.end.minutes;
  const utcStartMinutes = utcRange.start.minutes;
  if (localStartMinutes == null || localEndMinutes == null || utcStartMinutes == null) return null;

  const offsetMinutes = inferOffsetMinutes(localStartMinutes, utcStartMinutes);

  const startBase = localRange.start.day != null ? resolveWs45Day(date, localRange.start.day) : date;
  const start = buildUtcTimestamp(startBase, localStartMinutes, offsetMinutes);

  let endBase: { y: number; m: number; d: number };
  if (localRange.end.day != null) {
    endBase = resolveWs45Day(startBase, localRange.end.day);
  } else {
    endBase = localEndMinutes < localStartMinutes ? addDaysUtc(startBase, 1) : startBase;
  }
  const end = buildUtcTimestamp(endBase, localEndMinutes, offsetMinutes);

  // Extra guard for malformed end times.
  if (end.getTime() <= start.getTime()) {
    return { start: start.toISOString(), end: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function parseWs45TimeRange(raw: string, zone: 'L' | 'Z') {
  let cleaned = raw.trim().replace(/\s+/g, ' ');
  cleaned = cleaned.replace(new RegExp(`\\s*${zone}\\s*$`, 'i'), '').trim();
  cleaned = cleaned.replace(/\bUTC\b\s*$/i, '').trim();

  const parts = cleaned.split(/\s*-\s*/);
  if (parts.length < 2) return null;
  const startRaw = parts[0]?.trim() ?? '';
  const endRaw = parts.slice(1).join('-').trim();

  const start = parseWs45DayTimeToken(startRaw);
  const end = parseWs45DayTimeToken(endRaw);
  return { start, end };
}

function parseWs45DayTimeToken(raw: string): { raw: string; day: number | null; minutes: number | null } {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return { raw: raw, day: null, minutes: null };

  const slashIndex = cleaned.indexOf('/');
  if (slashIndex >= 0) {
    const left = cleaned.slice(0, slashIndex);
    const right = cleaned.slice(slashIndex + 1);
    const parsedDay = parseSpacedInt(left);
    const day = parsedDay != null && parsedDay >= 1 && parsedDay <= 31 ? parsedDay : null;
    return { raw: cleaned, day, minutes: parseTimeMinutes(right) };
  }

  const digits = cleaned.replace(/[^0-9]/g, '');
  if (digits.length > 4 && digits.length <= 6) {
    const dayDigits = digits.slice(0, digits.length - 4);
    const timeDigits = digits.slice(-4);
    const dayCandidate = Number(dayDigits);
    const day = Number.isFinite(dayCandidate) && dayCandidate >= 1 && dayCandidate <= 31 ? dayCandidate : null;
    const minutes = parseTimeMinutes(timeDigits);
    if (day != null && minutes != null) return { raw: cleaned, day, minutes };
  }

  return { raw: cleaned, day: null, minutes: parseTimeMinutes(cleaned) };
}

function resolveWs45Day(base: { y: number; m: number; d: number }, targetDay: number, maxLookaheadDays = 2) {
  if (!Number.isFinite(targetDay) || targetDay < 1 || targetDay > 31) return base;
  const day = Math.trunc(targetDay);
  for (let offset = 0; offset <= maxLookaheadDays; offset += 1) {
    const candidate = addDaysUtc(base, offset);
    if (candidate.d === day) return candidate;
  }
  return base;
}

function parseScenario(section: string): ParsedScenario {
  const scenario: ParsedScenario = { rawSection: section };

  const pov = parsePovPercent(section);
  if (pov != null) scenario.povPercent = pov;

  const concerns = matchGroup(
    section,
    /Primary Concerns\s*:\s*(.+?)(?:Weather Conditions|Weather\/Visibility\s*:|Weather\s*:|Temp\/Humidity\s*:)/i
  );
  if (concerns) {
    const parts = concerns
      .split(/[;,]/g)
      .map((p) => p.trim())
      .filter(Boolean);
    scenario.primaryConcerns = parts.length ? parts : [concerns.trim()];
  }

  const wxVisLegacy = matchGroup(
    section,
    /Weather\/Visibility\s*:\s*(.+?)(?:Clouds|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  const weather = matchGroup(
    section,
    /Weather\s*:\s*(.+?)(?:Visibility\s*:|Clouds(?:\s+Type)?|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  const visibility = matchGroup(
    section,
    /Visibility\s*:\s*(.+?)(?:Clouds(?:\s+Type)?|(?:Towering\s+)?Cumulus|Cirrus|Cirrostratus|Cirrocumulus|Stratus|Altocumulus|Altostratus|Cumulonimbus|Anvil|Temp\/Humidity\s*:|Liftoff Winds|Pad Escape Winds|Ascent Corridor Weather)/i
  );
  if (wxVisLegacy) {
    scenario.weatherVisibility = wxVisLegacy.trim();
  } else {
    const wxParts = [weather?.trim(), visibility?.trim()].filter(Boolean) as string[];
    if (wxParts.length) scenario.weatherVisibility = wxParts.join(' • ');
  }

  const tempHumidity = section.match(/Temp\/Humidity\s*:\s*([0-9]{1,3})\s*°?\s*F\s*\/\s*([0-9]{1,3})\s*%/i);
  if (tempHumidity) {
    scenario.tempF = clampInt(Number(tempHumidity[1]), -80, 160);
    scenario.humidityPercent = clampInt(Number(tempHumidity[2]), 0, 100);
  }

  const winds = parseLiftoffWinds(section);
  if (winds) scenario.liftoffWinds = winds;

  const upperShear = matchGroup(section, /Upper-Level Wind Shear\s*:\s*([A-Za-z]+)/i);
  const booster = matchGroup(section, /Booster Recovery Weather\s*:\s*([A-Za-z]+)/i);
  const solar = matchGroup(section, /Solar Activity\s*:\s*([A-Za-z]+)/i);
  if (upperShear || booster || solar) {
    scenario.additionalRiskCriteria = {
      upperLevelWindShear: upperShear || undefined,
      boosterRecoveryWeather: booster || undefined,
      solarActivity: solar || undefined
    };
  }

  const clouds = parseCloudLayers(section);
  if (clouds.length) scenario.clouds = clouds;

  return scenario;
}

function parseLiftoffWinds(section: string): ParsedScenario['liftoffWinds'] | null {
  const cleaned = section.replace(/[’′]/g, "'");
  const match = cleaned.match(
    /Liftoff Winds\s*\\(200'\\)\s*:\s*([0-9](?:\s*[0-9]){0,2})\s*°?\s*([0-9](?:\s*[0-9])?)\s*-\s*([0-9](?:\s*[0-9])?)\s*mph/i
  );
  if (match?.[1] && match?.[2] && match?.[3]) {
    const direction = Number(match[1].replace(/[^0-9]/g, ''));
    const min = Number(match[2].replace(/[^0-9]/g, ''));
    const max = Number(match[3].replace(/[^0-9]/g, ''));
    return {
      directionDeg: Number.isFinite(direction) ? clampInt(direction, 0, 360) : undefined,
      speedMphMin: Number.isFinite(min) ? clampInt(min, 0, 200) : undefined,
      speedMphMax: Number.isFinite(max) ? clampInt(max, 0, 200) : undefined,
      raw: match[0]
    };
  }

  const singleMatch = cleaned.match(
    /Liftoff Winds\s*\\(200'\\)\s*:\s*([0-9](?:\s*[0-9]){0,2})\s*°?\s*([0-9](?:\s*[0-9])?)\s*mph/i
  );
  if (!singleMatch?.[1] || !singleMatch?.[2]) return null;
  const direction = Number(singleMatch[1].replace(/[^0-9]/g, ''));
  const speed = Number(singleMatch[2].replace(/[^0-9]/g, ''));
  return {
    directionDeg: Number.isFinite(direction) ? clampInt(direction, 0, 360) : undefined,
    speedMphMin: Number.isFinite(speed) ? clampInt(speed, 0, 200) : undefined,
    speedMphMax: Number.isFinite(speed) ? clampInt(speed, 0, 200) : undefined,
    raw: singleMatch[0]
  };
}

function parseCloudLayers(section: string) {
  const layers: Array<{ type: string; coverage?: string; baseFt?: number; topsFt?: number; raw?: string }> = [];
  const re =
    /((?:Towering\s+)?Cumulus|Cirrus|Cirrostratus|Cirrocumulus|Stratus|Altocumulus|Altostratus|Cumulonimbus|Anvil)\s+(Few|Scattered|Broken|Overcast|FEW|SCT|BKN|OVC|Br|BR)\s*([0-9]{1,3}(?:\s*,\s*[0-9]{3})?)\s+([0-9]{1,3}(?:\s*,\s*[0-9]{3})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(section))) {
    layers.push({
      type: match[1],
      coverage: normalizeCloudCoverage(match[2]),
      baseFt: parseCommaNumber(match[3]),
      topsFt: parseCommaNumber(match[4]),
      raw: match[0]
    });
  }
  return layers;
}

function normalizeCloudCoverage(value: string) {
  const raw = value.trim().toUpperCase();
  if (raw === 'FEW') return 'Few';
  if (raw === 'SCATTERED' || raw === 'SCT') return 'Scattered';
  if (raw === 'BROKEN' || raw === 'BKN' || raw === 'BR') return 'Broken';
  if (raw === 'OVERCAST' || raw === 'OVC') return 'Overcast';
  return value.trim();
}

function parseCommaNumber(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeMissionName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeMissionName(name: string) {
  const base = normalizeMissionName(name);
  const tokens = base.split(' ').filter(Boolean);
  const expanded = new Set<string>();
  for (const token of tokens) {
    expanded.add(token);
    if (token.includes('-')) token.split('-').filter(Boolean).forEach((t) => expanded.add(t));
  }
  return Array.from(expanded);
}

function inferOffsetMinutes(localMinutes: number, utcMinutes: number) {
  const delta = utcMinutes - localMinutes;
  return ((delta % 1440) + 1440) % 1440;
}

function parseTimeMinutes(raw: string) {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const normalized = digits.length > 4 ? digits.slice(-4) : digits;
  const padded = normalized.padStart(4, '0');
  const hours = Number(padded.slice(0, 2));
  const minutes = Number(padded.slice(2, 4));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function buildUtcTimestamp(date: { y: number; m: number; d: number }, localMinutes: number, offsetMinutes: number) {
  const total = localMinutes + offsetMinutes;
  const dayShift = Math.floor(total / 1440);
  const mins = ((total % 1440) + 1440) % 1440;
  const shifted = addDaysUtc(date, dayShift);
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return new Date(Date.UTC(shifted.y, shifted.m, shifted.d, hours, minutes));
}

function addDaysUtc(date: { y: number; m: number; d: number }, days: number) {
  const base = Date.UTC(date.y, date.m, date.d);
  const shifted = new Date(base + days * 24 * 60 * 60 * 1000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

function parseDayMonthYear(value: string): { y: number; m: number; d: number } | null {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  const match = cleaned.match(/^([0-9](?:\s*[0-9])?)\s+([A-Za-z]+)\.?\s+([0-9](?:\s*[0-9]){3})$/);
  if (!match) return null;
  const d = parseSpacedInt(match[1]);
  const y = parseSpacedInt(match[3]);
  const monthName = match[2].toLowerCase();
  const m = monthIndex(monthName);
  if (m == null) return null;
  if (d == null || y == null) return null;
  return { y, m, d };
}

function parseSpacedInt(value: string) {
  const digits = value.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function monthIndex(month: string) {
  const m = month.toLowerCase();
  const map: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11
  };
  return map[m] ?? null;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parsePovPercent(section: string): number | null {
  const leadingPercent = section.match(/^\s*([0-9](?:\s*[0-9]){0,2})\s*%\s*Primary Concerns/i);
  if (leadingPercent?.[1]) {
    const value = parseSpacedInt(leadingPercent[1]);
    if (value != null) return clampInt(value, 0, 100);
  }

  const snippet =
    sliceBetweenAny(section, /Probability of Violating Weather Constraints/i, [
      /Primary Concerns/i,
      /Weather Conditions/i,
      /Weather\/Visibility/i,
      /Weather\s*:/i,
      /Temp\/Humidity/i,
      /Liftoff Winds/i,
      /Pad Escape Winds/i,
      /Ascent Corridor Weather/i
    ]) ?? null;
  if (!snippet) return null;

  const arrow = snippet.match(/→|->/);
  if (!arrow) {
    const value = parsePercentValueFromSnippet(snippet);
    if (value == null) return null;
    return clampInt(value, 0, 100);
  }

  const [before, after = ''] = snippet.split(/→|->/);
  const candidates: number[] = [];

  for (const m of before.matchAll(/[0-9]{1,3}/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) candidates.push(n);
  }

  for (const m of before.matchAll(/([0-9])\s+([0-9])/g)) {
    const n = Number(`${m[1]}${m[2]}`);
    if (Number.isFinite(n)) candidates.push(n);
  }

  const startVal = candidates.length ? Math.max(...candidates) : null;
  const endVal = parsePercentValueFromSnippet(after);
  const values = [startVal, endVal].filter((v): v is number => v != null && v >= 0 && v <= 100);
  if (!values.length) return null;
  return clampInt(Math.max(...values), 0, 100);
}

function parsePercentValueFromSnippet(snippet: string): number | null {
  const percentIndex = snippet.indexOf('%');
  if (percentIndex < 0) return null;
  const prefix = snippet.slice(0, percentIndex).trim();
  if (!prefix) return null;

  const spacedThree = prefix.match(/([0-9])\s+([0-9])\s+([0-9])\s*$/);
  if (spacedThree) {
    const value = parseSpacedInt(`${spacedThree[1]}${spacedThree[2]}${spacedThree[3]}`);
    if (value != null) return value;
  }

  const spacedTwo = prefix.match(/([0-9])\s+([0-9])\s*$/);
  if (spacedTwo) {
    const value = parseSpacedInt(`${spacedTwo[1]}${spacedTwo[2]}`);
    if (value != null) return value;
  }

  const contiguous = prefix.match(/([0-9]{1,3})\s*$/);
  if (contiguous?.[1]) {
    const value = parseSpacedInt(contiguous[1]);
    if (value != null) return value;
  }

  return null;
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
  match: { status: 'matched' | 'ambiguous' | 'unmatched'; launchId?: string; confidence?: number; strategy?: string; meta?: Record<string, unknown> };
}) {
  return {
    source: '45ws',
    source_range: 'eastern_range',
    source_page_url: WS45_PAGE_URL,
    source_label: args.item.label || null,
    forecast_kind: deriveForecastKind(args.item.label, args.pdfUrl),
    pdf_url: args.pdfUrl,
    pdf_etag: args.pdfRes.etag,
    pdf_last_modified: args.pdfRes.lastModified,
    pdf_sha256: args.pdfSha256,
    pdf_bytes: args.pdfRes.bytes.length,
    pdf_metadata: args.metadata ?? null,
    fetched_at: new Date().toISOString(),
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
    raw: { item: args.item, parsed: args.parsed },
    parse_version: WS45_PARSE_VERSION,
    match_status: args.match.status,
    matched_launch_id: args.match.status === 'matched' ? args.match.launchId ?? null : null,
    match_confidence: args.match.confidence ?? null,
    match_strategy: args.match.strategy ?? null,
    match_meta: args.match.meta ?? null,
    matched_at: args.match.status === 'matched' ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function buildUpdatePayload(args: {
  item: ForecastPageItem;
  pdfRes: FetchedPdf;
  metadata: unknown;
  text: string;
  parsed: ParsedForecast;
  match: { status: 'matched' | 'ambiguous' | 'unmatched'; launchId?: string; confidence?: number; strategy?: string; meta?: Record<string, unknown> };
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
    forecast_kind: deriveForecastKind(args.item.label, args.item.pdfUrl),
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
    raw: { item: args.item, parsed: args.parsed },
    parse_version: WS45_PARSE_VERSION,
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
  const payload = buildReparsePayload({
    parsed,
    match,
    existing: { matchStatus: latest.matchStatus }
  });

  if (!Object.keys(payload).length) return { didUpdate: false, matchStatus: match.status };
  const { error } = await supabase.from('ws45_launch_forecasts').update(payload).eq('id', latest.id);
  if (error) throw error;
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
    .select('id,parse_version,raw_text,match_status,matched_launch_id,valid_start,valid_end,mission_name,mission_tokens')
    .eq('pdf_url', pdfUrl)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: (data as any).id as string,
    parseVersion: ((data as any).parse_version as string | null) ?? null,
    rawText: ((data as any).raw_text as string | null) ?? null,
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
  match: { status: 'matched' | 'ambiguous' | 'unmatched'; launchId?: string; confidence?: number; strategy?: string; meta?: Record<string, unknown> };
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
  match: { status: 'matched' | 'ambiguous' | 'unmatched'; launchId?: string; confidence?: number; strategy?: string; meta?: Record<string, unknown> };
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
