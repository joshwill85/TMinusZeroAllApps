import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as pdfjsStatic from 'npm:pdfjs-dist@4.0.379/build/pdf.mjs';
import { createSupabaseAdminClient } from '../_shared/supabase.ts';
import { requireJobAuth } from '../_shared/jobAuth.ts';
import {
  finishIngestionRun,
  insertSourceDocument,
  jsonResponse,
  readBooleanSetting,
  startIngestionRun,
  stringifyError,
  toIsoOrNull,
  updateCheckpoint,
  upsertTimelineEvent
} from '../_shared/artemisIngest.ts';
import { ARTEMIS_SOURCE_URLS, fetchJsonWithMeta, stripHtml } from '../_shared/artemisSources.ts';

type NasaContentPayload = {
  id?: number;
  link?: string;
  date?: string;
  modified?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
};

type NasaTopicSpec = {
  fiscalYear: number;
  pageUrl: string;
  apiUrl: string;
  title: string;
};

type PressReleaseSpec = {
  fiscalYear: number;
  pageUrl: string;
  apiUrl: string;
  title: string;
};

type NasaBudgetDocument = {
  title: string;
  dateLabel: string | null;
  fileType: string | null;
  url: string;
};

type ParsedBudgetLine = {
  fiscalYear: number;
  program: string;
  lineItem: string;
  amountRequested: number | null;
  amountEnacted: number | null;
  announcedTime: string;
  sourceDocumentId: string;
  metadata: Record<string, unknown>;
};

type UsaSpendingBudgetaryYear = {
  fiscal_year?: number;
  agency_budgetary_resources?: number;
  agency_total_obligated?: number;
  agency_total_outlayed?: number;
};

type UsaSpendingBudgetaryResourcesPayload = {
  toptier_code?: string;
  agency_data_by_year?: UsaSpendingBudgetaryYear[];
};

type PdfJsModule = {
  getDocument?: (args: Record<string, unknown>) => { promise: Promise<any> };
  GlobalWorkerOptions?: { workerSrc?: string };
};

type BudgetNumberToken = {
  raw: string;
  value: number;
  unit: 'billion' | 'million' | 'thousand' | null;
  index: number;
  hasDecimal: boolean;
  hasThousandsSeparator: boolean;
};

type PdfFetchResult = {
  notModified: boolean;
  bytes: Uint8Array;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  httpStatus: number;
};

type PdfLineExtraction = {
  lineItem: string;
  amountRequested: number;
  amountMillions: number;
  pageNumber: number;
  selector: string;
  detail: string;
  confidence: number;
};

type PdfDocumentExtractionResult = {
  lines: ParsedBudgetLine[];
  sourceDocumentId: string | null;
  fetched: boolean;
  notModified: boolean;
  sourceInserted: boolean;
  parseStatus: 'ok' | 'cached' | 'error' | 'skipped';
  error: string | null;
  pagesScanned: number;
  totalPages: number;
};

const NASA_TOPIC_SPECS: NasaTopicSpec[] = [
  {
    fiscalYear: 2017,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy17,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy17,
    title: 'NASA FY 2017 Budget Request'
  },
  {
    fiscalYear: 2018,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy18,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy18,
    title: 'NASA FY 2018 Budget Request'
  },
  {
    fiscalYear: 2019,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy19,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy19,
    title: 'NASA FY 2019 Budget Request'
  },
  {
    fiscalYear: 2020,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy20,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy20,
    title: 'NASA FY 2020 Budget Request'
  },
  {
    fiscalYear: 2021,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy21,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy21,
    title: 'NASA FY 2021 Budget Request'
  },
  {
    fiscalYear: 2022,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy22,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy22,
    title: 'NASA FY 2022 Budget Request'
  },
  {
    fiscalYear: 2023,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy23,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy23,
    title: 'NASA FY 2023 Budget Request'
  },
  {
    fiscalYear: 2024,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy24,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy24,
    title: 'NASA FY 2024 Budget Request'
  },
  {
    fiscalYear: 2025,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy25,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy25,
    title: 'NASA FY 2025 Budget Request'
  },
  {
    fiscalYear: 2026,
    pageUrl: ARTEMIS_SOURCE_URLS.nasaBudgetRequestFy26,
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetTopicApiFy26,
    title: 'NASA FY 2026 Budget Request'
  }
];

const PRESS_RELEASE_SPECS: PressReleaseSpec[] = [
  {
    fiscalYear: 2025,
    pageUrl: 'https://www.nasa.gov/news-release/statement-from-nasas-janet-petro-on-fiscal-year-2025-budget-request/',
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetPressReleaseApiFy25,
    title: 'NASA FY 2025 Budget Request Statement'
  },
  {
    fiscalYear: 2026,
    pageUrl: 'https://www.nasa.gov/news-release/president-trumps-fy26-budget-revitalizes-human-space-exploration/',
    apiUrl: ARTEMIS_SOURCE_URLS.nasaBudgetPressReleaseApiFy26,
    title: 'NASA FY 2026 Budget Request Statement'
  }
];

const MIN_BUDGET_DOCUMENT_ROWS = 4;
const MIN_BUDGET_LINES = 8;
const MIN_PDF_LINES_PER_REQUIRED_FY26_DOC = 3;
const PDF_PARSE_VERSION = 'v4';
const PDF_FETCH_TIMEOUT_MS = 35_000;
const PDF_FETCH_MAX_BYTES = 25_000_000;
const PDF_FETCH_RETRIES = 2;
const PDF_PRIMARY_PAGE_LIMIT = 12;
const PDF_FALLBACK_PAGE_LIMIT = 60;
const PDF_TEXT_LIMIT = 500;
const PDF_MIN_EXTRACTION_FISCAL_YEAR = 2017;

const BUDGET_PDF_DOC_TYPE_PATTERNS = [
  /budget technical supplement/i,
  /mission (?:directorate )?fact sheets?/i,
  /agency fact sheet/i,
  /nasa .* fact sheet/i
];

const ARTEMIS_BUDGET_LINE_SPECS: Array<{ lineItem: string; pattern: RegExp }> = [
  {
    lineItem: 'Moon to Mars Transportation System',
    pattern: /\bmoon\s+to\s+mars\s+transportation\s+system\b/i
  },
  {
    lineItem: 'Moon To Mars Lunar Systems Development',
    pattern: /moon\s*to\s*mars.*(?:lunar\s+)?systems?\s+development/i
  },
  { lineItem: 'Artemis Campaign Development', pattern: /\bartemis\s+campaign\s+development\b/i },

  { lineItem: 'Orion Program', pattern: /\borion(?:\s+program)?\b/i },
  { lineItem: 'Crew Vehicle Development', pattern: /\bcrew\s+vehicle\s+development\b/i },

  { lineItem: 'SLS Operations', pattern: /\bsls\s+operations\b/i },
  { lineItem: 'Block 1B Capability Upgrade', pattern: /\bblock\s+1b\s+capability\s+upgrade\b/i },
  { lineItem: 'SLS Program Integration and Support', pattern: /\bsls\s+program\s+integration\b/i },
  { lineItem: 'Space Launch System', pattern: /\bspace\s+launch\s+system\b|\bsls\b/i },

  { lineItem: 'Exploration Ground Systems', pattern: /\bexploration\s+ground\s+systems?\b|\begs\b/i },

  { lineItem: 'Gateway Initial Capability', pattern: /\bgateway\s+initial\s+capability\b/i },
  { lineItem: 'Gateway', pattern: /\bgateway\b/i },

  { lineItem: 'HLS Initial Capability', pattern: /\bhls\s+initial\s+capability\b/i },
  { lineItem: 'Human Landing System', pattern: /\bhuman\s+landing\s+system\b|\bhls\b/i },

  { lineItem: 'xEVA and Surface Mobility Program', pattern: /\bx[\-\s]?eva\b|surface mobility/i },
  { lineItem: 'Lunar Discovery and Exploration', pattern: /\blunar\s+discovery\s+and\s+exploration\b/i },
  {
    lineItem: 'Commercial Lunar Payload Services',
    pattern: /\bcommercial\s+lunar\s+payload\s+services\b|\bclps\b/i
  },
  { lineItem: 'Moon to Mars Program Office', pattern: /\bmoon\s+to\s+mars\s+program\s+office\b/i }
];

type RequiredFy26DocKey = 'technicalSupplement' | 'missionFactSheets';

serve(async (req) => {
  const supabase = createSupabaseAdminClient();
  const authorized = await requireJobAuth(req, supabase);
  if (!authorized) return jsonResponse({ error: 'unauthorized' }, 401);

  const startedAt = Date.now();
  const { runId } = await startIngestionRun(supabase, 'artemis_budget_ingest');

  const stats: Record<string, unknown> = {
    sourceDocumentsInserted: 0,
    budgetLinesUpserted: 0,
    timelineEventsUpserted: 0,
    topicPagesHealthy: 0,
    officialDocumentsDiscovered: 0,
    monetaryLinesExtracted: 0,
    pdfDocumentsConsidered: 0,
    pdfDocumentsFetched: 0,
    pdfDocumentsNotModified: 0,
    pdfDocumentsParsed: 0,
    pdfBudgetLinesExtracted: 0,
    pdfDocumentsErrored: 0,
    errors: [] as Array<{ step: string; error: string }>
  };

  try {
    const enabled = await readBooleanSetting(supabase, 'artemis_budget_job_enabled', true);
    if (!enabled) {
      await finishIngestionRun(supabase, runId, true, { skipped: true, reason: 'disabled' });
      return jsonResponse({ ok: true, skipped: true, reason: 'disabled', elapsedMs: Date.now() - startedAt });
    }

    await updateCheckpoint(supabase, 'nasa_budget_docs', {
      sourceType: 'budget',
      status: 'running',
      startedAt: new Date().toISOString(),
      lastError: null
    });

    const [topicResponses, pressResponses, usaspendingBudgetResponse] = await Promise.all([
      Promise.all(NASA_TOPIC_SPECS.map((spec) => safeFetchJsonWithMeta(spec.apiUrl))),
      Promise.all(PRESS_RELEASE_SPECS.map((spec) => safeFetchJsonWithMeta(spec.apiUrl))),
      safeFetchJsonWithMeta(ARTEMIS_SOURCE_URLS.usaspendingNasaBudgetaryResources)
    ]);

    const extractedLines: ParsedBudgetLine[] = [];
    const topicStatuses: Array<Record<string, unknown>> = [];
    const pressStatuses: Array<Record<string, unknown>> = [];
    const pdfStatuses: Array<Record<string, unknown>> = [];
    const fy26RequiredCoverage: Record<RequiredFy26DocKey, { discovered: boolean; extractedLines: number }> = {
      technicalSupplement: { discovered: false, extractedLines: 0 },
      missionFactSheets: { discovered: false, extractedLines: 0 }
    };

    for (let index = 0; index < NASA_TOPIC_SPECS.length; index += 1) {
      const spec = NASA_TOPIC_SPECS[index];
      const response = topicResponses[index];
      const payload = parseNasaContentPayload(response.json);
      const topicHtml = payload?.content?.rendered || '';
      const topicText = stripHtml(topicHtml);
      const announcedTime =
        toIsoOrNull(payload?.modified) ||
        toIsoOrNull(payload?.date) ||
        toIsoOrNull(response.lastModified) ||
        new Date().toISOString();

      const documents = topicHtml ? parseBudgetDocumentsFromTopicHtml(topicHtml) : [];
      stats.officialDocumentsDiscovered = Number(stats.officialDocumentsDiscovered || 0) + documents.length;
      if (response.ok && payload) {
        stats.topicPagesHealthy = Number(stats.topicPagesHealthy || 0) + 1;
      }

      const sourceDocumentId = await insertSourceDocument(supabase, {
        sourceKey: 'nasa_budget_docs',
        sourceType: 'budget',
        url: payload?.link || spec.pageUrl,
        title: payload?.title?.rendered || spec.title,
        summary: topicText.slice(0, 2400),
        announcedTime,
        httpStatus: response.status,
        contentType: response.contentType,
        raw: {
          apiUrl: spec.apiUrl,
          topicId: payload?.id || null,
          documentsDiscovered: documents.length,
          etag: response.etag,
          lastModified: response.lastModified
        },
        error: response.ok ? null : `http_${response.status}`
      });

      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;

      topicStatuses.push({
        fiscalYear: spec.fiscalYear,
        status: response.status,
        ok: response.ok,
        documentsDiscovered: documents.length
      });

      for (const document of documents) {
        const documentAnnouncedTime = parseLooseDate(document.dateLabel) || announcedTime;
        const requiredFy26DocKey = spec.fiscalYear === 2026 ? classifyRequiredFy26Document(document.title) : null;
        if (requiredFy26DocKey) {
          fy26RequiredCoverage[requiredFy26DocKey].discovered = true;
        }

        extractedLines.push({
          fiscalYear: spec.fiscalYear,
          program: 'Artemis',
          lineItem: document.title,
          amountRequested: null,
          amountEnacted: null,
          announcedTime: documentAnnouncedTime,
          sourceDocumentId,
          metadata: {
            sourceClass: 'nasa-budget-document',
            sourceTitle: document.title,
            sourceUrl: document.url,
            detail: [document.title, document.dateLabel, document.fileType].filter(Boolean).join(' • '),
            dateLabel: document.dateLabel,
            fileType: document.fileType,
            topicPageUrl: spec.pageUrl,
            topicApiUrl: spec.apiUrl,
            snippet: topicText.slice(0, 380)
          }
        });

        if (!shouldExtractBudgetPdfDocument(document.title, document.url)) continue;
        if (
          !shouldAttemptBudgetPdfExtraction({
            fiscalYear: spec.fiscalYear,
            title: document.title,
            requiredFy26DocKey
          })
        ) {
          continue;
        }

        stats.pdfDocumentsConsidered = Number(stats.pdfDocumentsConsidered || 0) + 1;

        const extraction = await extractBudgetLinesFromPdfDocument({
          supabase,
          document,
          fiscalYear: spec.fiscalYear,
          announcedTime: documentAnnouncedTime,
          topicPageUrl: spec.pageUrl,
          topicApiUrl: spec.apiUrl,
          requiredForHealthGuard: Boolean(requiredFy26DocKey)
        }).catch((err) => ({
          lines: [] as ParsedBudgetLine[],
          sourceDocumentId: null,
          fetched: false,
          notModified: false,
          sourceInserted: false,
          parseStatus: 'error' as const,
          error: stringifyError(err),
          pagesScanned: 0,
          totalPages: 0
        }));

        if (extraction.sourceInserted) {
          stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;
        }
        if (extraction.fetched) {
          stats.pdfDocumentsFetched = Number(stats.pdfDocumentsFetched || 0) + 1;
        }
        if (extraction.notModified) {
          stats.pdfDocumentsNotModified = Number(stats.pdfDocumentsNotModified || 0) + 1;
        }
        if (extraction.parseStatus === 'ok' || extraction.parseStatus === 'cached') {
          stats.pdfDocumentsParsed = Number(stats.pdfDocumentsParsed || 0) + 1;
        }
        if (extraction.parseStatus === 'error') {
          stats.pdfDocumentsErrored = Number(stats.pdfDocumentsErrored || 0) + 1;
          if (extraction.error) {
            (stats.errors as Array<any>).push({
              step: 'pdf_extract',
              error: extraction.error,
              context: { fiscalYear: spec.fiscalYear, title: document.title, url: document.url }
            });
          }
        }

        if (extraction.lines.length > 0) {
          extractedLines.push(...extraction.lines);
          stats.pdfBudgetLinesExtracted = Number(stats.pdfBudgetLinesExtracted || 0) + extraction.lines.length;
          stats.monetaryLinesExtracted = Number(stats.monetaryLinesExtracted || 0) + extraction.lines.length;
          if (requiredFy26DocKey) {
            fy26RequiredCoverage[requiredFy26DocKey].extractedLines += extraction.lines.length;
          }
        }

        pdfStatuses.push({
          fiscalYear: spec.fiscalYear,
          title: document.title,
          url: document.url,
          parseStatus: extraction.parseStatus,
          fetched: extraction.fetched,
          notModified: extraction.notModified,
          sourceDocumentId: extraction.sourceDocumentId,
          pagesScanned: extraction.pagesScanned,
          totalPages: extraction.totalPages,
          extractedLines: extraction.lines.length,
          error: extraction.error
        });
      }
    }

    for (let index = 0; index < PRESS_RELEASE_SPECS.length; index += 1) {
      const spec = PRESS_RELEASE_SPECS[index];
      const response = pressResponses[index];
      const payload = parseNasaContentPayload(response.json);
      const text = stripHtml(payload?.content?.rendered || '');
      const announcedTime =
        toIsoOrNull(payload?.modified) ||
        toIsoOrNull(payload?.date) ||
        toIsoOrNull(response.lastModified) ||
        new Date().toISOString();

      const sourceDocumentId = await insertSourceDocument(supabase, {
        sourceKey: 'nasa_budget_docs',
        sourceType: 'budget',
        url: payload?.link || spec.pageUrl,
        title: payload?.title?.rendered || spec.title,
        summary: text.slice(0, 2400),
        announcedTime,
        httpStatus: response.status,
        contentType: response.contentType,
        raw: {
          apiUrl: spec.apiUrl,
          topicId: payload?.id || null,
          etag: response.etag,
          lastModified: response.lastModified
        },
        error: response.ok ? null : `http_${response.status}`
      });

      stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;

      const extractedFromPressRelease = response.ok
        ? extractPressReleaseBudgetLines({
            text,
            fiscalYear: spec.fiscalYear,
            announcedTime,
            sourceDocumentId,
            sourceUrl: payload?.link || spec.pageUrl,
            sourceTitle: payload?.title?.rendered || spec.title
          })
        : [];

      stats.monetaryLinesExtracted = Number(stats.monetaryLinesExtracted || 0) + extractedFromPressRelease.length;
      extractedLines.push(...extractedFromPressRelease);

      pressStatuses.push({
        fiscalYear: spec.fiscalYear,
        status: response.status,
        ok: response.ok,
        monetaryLines: extractedFromPressRelease.length
      });
    }

    const usaspendingPayload = parseUsaSpendingBudgetaryResourcesPayload(usaspendingBudgetResponse.json);
    const usaspendingAnnouncedTime = toIsoOrNull(usaspendingBudgetResponse.lastModified) || new Date().toISOString();
    const usaspendingBudgetLines = usaspendingBudgetResponse.ok
      ? extractUsaSpendingBudgetLines({
          payload: usaspendingPayload,
          years: NASA_TOPIC_SPECS.map((entry) => entry.fiscalYear),
          announcedTime: usaspendingAnnouncedTime
        })
      : [];

    const usaspendingSourceDocumentId = await insertSourceDocument(supabase, {
      sourceKey: 'nasa_budget_docs',
      sourceType: 'budget',
      url: ARTEMIS_SOURCE_URLS.usaspendingNasaBudgetaryResources,
      title: 'USASpending NASA Budgetary Resources',
      summary: usaspendingBudgetResponse.ok
        ? `USASpending yearly NASA budgetary resources snapshot (${usaspendingBudgetLines.length} line candidates).`
        : `USASpending budget endpoint returned HTTP ${usaspendingBudgetResponse.status}.`,
      announcedTime: usaspendingAnnouncedTime,
      httpStatus: usaspendingBudgetResponse.status,
      contentType: usaspendingBudgetResponse.contentType,
      raw: {
        etag: usaspendingBudgetResponse.etag,
        lastModified: usaspendingBudgetResponse.lastModified,
        yearsReturned: Array.isArray(usaspendingPayload?.agency_data_by_year) ? usaspendingPayload?.agency_data_by_year.length : 0,
        selectedYears: NASA_TOPIC_SPECS.map((entry) => entry.fiscalYear)
      },
      error: usaspendingBudgetResponse.ok ? null : `http_${usaspendingBudgetResponse.status}`
    });

    stats.sourceDocumentsInserted = Number(stats.sourceDocumentsInserted || 0) + 1;

    for (const line of usaspendingBudgetLines) {
      extractedLines.push({
        ...line,
        sourceDocumentId: usaspendingSourceDocumentId,
        metadata: {
          ...line.metadata,
          sourceClass: 'usaspending-budgetary-resources',
          sourceTitle: 'USASpending NASA Budgetary Resources',
          sourceUrl: ARTEMIS_SOURCE_URLS.usaspendingNasaBudgetaryResources,
          detail: typeof line.metadata?.detail === 'string' ? line.metadata.detail : 'USASpending budgetary resources snapshot.'
        }
      });
    }

    stats.monetaryLinesExtracted = Number(stats.monetaryLinesExtracted || 0) + usaspendingBudgetLines.length;

    const dedupedLines = dedupeBudgetLines(extractedLines);
    if (Number(stats.topicPagesHealthy || 0) === 0) {
      throw new Error('nasa_budget_topics_unavailable');
    }
    if (Number(stats.officialDocumentsDiscovered || 0) < MIN_BUDGET_DOCUMENT_ROWS) {
      throw new Error(`nasa_budget_document_rows_below_threshold:${String(stats.officialDocumentsDiscovered || 0)}`);
    }
    if (!fy26RequiredCoverage.technicalSupplement.discovered) {
      throw new Error('fy2026_technical_supplement_not_discovered');
    }
    if (!fy26RequiredCoverage.missionFactSheets.discovered) {
      throw new Error('fy2026_mission_fact_sheets_not_discovered');
    }
    if (fy26RequiredCoverage.technicalSupplement.extractedLines < MIN_PDF_LINES_PER_REQUIRED_FY26_DOC) {
      throw new Error(
        `fy2026_technical_supplement_lines_below_threshold:${fy26RequiredCoverage.technicalSupplement.extractedLines}`
      );
    }
    if (fy26RequiredCoverage.missionFactSheets.extractedLines < MIN_PDF_LINES_PER_REQUIRED_FY26_DOC) {
      throw new Error(`fy2026_mission_fact_sheets_lines_below_threshold:${fy26RequiredCoverage.missionFactSheets.extractedLines}`);
    }
    if (dedupedLines.length < MIN_BUDGET_LINES) {
      throw new Error(`nasa_budget_lines_below_threshold:${dedupedLines.length}`);
    }
    if (Number(stats.monetaryLinesExtracted || 0) <= 0) {
      throw new Error('nasa_budget_no_monetary_lines_extracted');
    }

    const rows = await Promise.all(
      dedupedLines.map(async (line) => {
        const sourceUrl = metadataString(line.metadata, 'sourceUrl') || '';
        const sourceClass = metadataString(line.metadata, 'sourceClass') || '';
        const stableKey = [
          'artemis-budget',
          String(line.fiscalYear),
          normalizeLineItemKey(line.lineItem),
          sourceClass,
          sourceUrl
        ].join('|');

        return {
          id: await stableUuidFromText(stableKey),
          fiscal_year: line.fiscalYear,
          agency: 'NASA',
          program: line.program,
          line_item: line.lineItem,
          amount_requested: line.amountRequested,
          amount_enacted: line.amountEnacted,
          announced_time: line.announcedTime,
          source_document_id: line.sourceDocumentId,
          metadata: line.metadata,
          updated_at: new Date().toISOString()
        };
      })
    );

    const { error: upsertError } = await supabase.from('artemis_budget_lines').upsert(rows, { onConflict: 'id' });
    if (upsertError) throw upsertError;
    stats.budgetLinesUpserted = rows.length;

    await upsertTimelineEvent(supabase, {
      fingerprint: ['budget-refresh', new Date().toISOString().slice(0, 10)].join('|'),
      missionKey: 'program',
      title: 'Artemis budget context refreshed',
      summary: 'NASA budget request documents and USASpending budgetary resources were refreshed for Artemis program context.',
      eventTime: null,
      eventTimePrecision: 'unknown',
      announcedTime: new Date().toISOString(),
      sourceType: 'budget',
      confidence: 'secondary',
      sourceDocumentId: usaspendingSourceDocumentId,
      sourceUrl: ARTEMIS_SOURCE_URLS.nasaBudgetHub,
      tags: ['budget']
    });
    stats.timelineEventsUpserted = 1;

    await updateCheckpoint(supabase, 'nasa_budget_docs', {
      sourceType: 'budget',
      status: 'complete',
      recordsIngested: Number(stats.budgetLinesUpserted || 0),
      endedAt: new Date().toISOString(),
      lastAnnouncedTime: new Date().toISOString(),
      lastError: null,
      metadata: {
        topicStatuses,
        pressStatuses,
        pdfStatuses,
        fy26RequiredCoverage,
        usaspending: {
          status: usaspendingBudgetResponse.status,
          ok: usaspendingBudgetResponse.ok,
          linesExtracted: usaspendingBudgetLines.length
        }
      }
    });

    await finishIngestionRun(supabase, runId, true, stats);
    return jsonResponse({ ok: true, elapsedMs: Date.now() - startedAt, stats });
  } catch (err) {
    const message = stringifyError(err);
    (stats.errors as Array<any>).push({ step: 'fatal', error: message });

    await updateCheckpoint(supabase, 'nasa_budget_docs', {
      sourceType: 'budget',
      status: 'error',
      endedAt: new Date().toISOString(),
      lastError: message
    }).catch(() => undefined);

    await finishIngestionRun(supabase, runId, false, stats, message);
    return jsonResponse({ ok: false, error: message, elapsedMs: Date.now() - startedAt, stats }, 500);
  }
});

async function loadPdfJsModule(): Promise<PdfJsModule | null> {
  const moduleCandidate = pdfjsStatic as unknown as PdfJsModule;
  if (!moduleCandidate || typeof moduleCandidate.getDocument !== 'function') return null;
  return moduleCandidate;
}

async function safeFetchJsonWithMeta(url: string) {
  try {
    return await fetchJsonWithMeta(url);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: null,
      etag: null,
      lastModified: null,
      json: null,
      text: stringifyError(err)
    };
  }
}

function ensurePdfWorkerSrc(pdfjs: PdfJsModule) {
  const workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs';
  const opts = (pdfjs as any)?.GlobalWorkerOptions;
  if (!opts || typeof opts !== 'object') return;
  if (!opts.workerSrc) opts.workerSrc = workerSrc;
}

function shouldExtractBudgetPdfDocument(title: string, url: string) {
  if (!/\.pdf(\?|$)/i.test(url)) return false;
  return BUDGET_PDF_DOC_TYPE_PATTERNS.some((pattern) => pattern.test(title));
}

function classifyRequiredFy26Document(title: string): RequiredFy26DocKey | null {
  if (/technical supplement/i.test(title)) return 'technicalSupplement';
  if (/mission (?:directorate )?fact sheets?/i.test(title)) return 'missionFactSheets';
  return null;
}

function shouldAttemptBudgetPdfExtraction({
  fiscalYear,
  title,
  requiredFy26DocKey
}: {
  fiscalYear: number;
  title: string;
  requiredFy26DocKey: RequiredFy26DocKey | null;
}) {
  if (requiredFy26DocKey) return true;
  if (fiscalYear < PDF_MIN_EXTRACTION_FISCAL_YEAR) return false;
  if (/mission (?:directorate )?fact sheets?/i.test(title)) return true;
  if (/technical supplement/i.test(title)) return true;
  return false;
}

async function extractBudgetLinesFromPdfDocument({
  supabase,
  document,
  fiscalYear,
  announcedTime,
  topicPageUrl,
  topicApiUrl,
  requiredForHealthGuard
}: {
  supabase: SupabaseClient;
  document: NasaBudgetDocument;
  fiscalYear: number;
  announcedTime: string;
  topicPageUrl: string;
  topicApiUrl: string;
  requiredForHealthGuard: boolean;
}): Promise<PdfDocumentExtractionResult> {
  const latest = await loadLatestBudgetPdfDocumentMeta(supabase, document.url);

  let fetched = await fetchBudgetPdfDocument(document.url, latest);
  const cachedCandidates = parseCachedPdfLineExtractions(latest?.raw);
  const hasUsableCache = fetched.notModified && cachedCandidates.length > 0 && latest?.id && latest.parseVersion === PDF_PARSE_VERSION;
  if (hasUsableCache) {
    return {
      lines: toParsedBudgetLinesFromPdfCandidates({
        candidates: cachedCandidates,
        fiscalYear,
        announcedTime,
        sourceDocumentId: latest.id,
        sourceTitle: document.title,
        sourceUrl: document.url,
        topicPageUrl,
        topicApiUrl,
        parseStatus: 'cached'
      }),
      sourceDocumentId: latest.id,
      fetched: false,
      notModified: true,
      sourceInserted: false,
      parseStatus: 'cached',
      error: null,
      pagesScanned: numberOrZero(latest?.raw?.pagesScanned),
      totalPages: numberOrZero(latest?.raw?.totalPages)
    };
  }

  // If the upstream returned 304 but we do not have cached extracted rows,
  // force one full fetch to avoid losing coverage.
  if (fetched.notModified) {
    fetched = await fetchBudgetPdfDocument(document.url, null);
  }

  const extracted = await extractArtemisBudgetLineCandidatesFromPdfBytes({
    bytes: fetched.bytes,
    sourceTitle: document.title,
    allowFallback: requiredForHealthGuard,
    fiscalYear
  });

  const sourceDocumentInsert = await upsertBudgetPdfSourceDocument(supabase, {
    url: document.url,
    title: document.title,
    announcedTime,
    fetched,
    extracted,
    fiscalYear,
    topicPageUrl,
    topicApiUrl
  });

  return {
    lines: toParsedBudgetLinesFromPdfCandidates({
      candidates: extracted.candidates,
      fiscalYear,
      announcedTime,
      sourceDocumentId: sourceDocumentInsert.id,
      sourceTitle: document.title,
      sourceUrl: document.url,
      topicPageUrl,
      topicApiUrl,
      parseStatus: 'ok'
    }),
    sourceDocumentId: sourceDocumentInsert.id,
    fetched: true,
    notModified: false,
    sourceInserted: sourceDocumentInsert.inserted,
    parseStatus: 'ok',
    error: null,
    pagesScanned: extracted.pagesScanned,
    totalPages: extracted.totalPages
  };
}

async function loadLatestBudgetPdfDocumentMeta(supabase: SupabaseClient, url: string) {
  const { data, error } = await supabase
    .from('artemis_source_documents')
    .select('id,etag,last_modified,parse_version,raw')
    .eq('source_key', 'nasa_budget_docs')
    .eq('url', url)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: String((data as any).id),
    etag: typeof (data as any).etag === 'string' ? (data as any).etag : null,
    lastModified:
      typeof (data as any).last_modified === 'string'
        ? (data as any).last_modified
        : toIsoOrNull((data as any).last_modified) || null,
    parseVersion: typeof (data as any).parse_version === 'string' ? (data as any).parse_version : null,
    raw: objectFromUnknown((data as any).raw)
  };
}

async function fetchBudgetPdfDocument(
  url: string,
  latest: { etag: string | null; lastModified: string | null } | null
): Promise<PdfFetchResult> {
  const headers: Record<string, string> = {
    'User-Agent': 'TMinusZero/0.1 (+https://tminusnow.app)',
    accept: 'application/pdf,*/*'
  };

  if (latest?.etag) headers['If-None-Match'] = latest.etag;
  if (latest?.lastModified) {
    const parsed = new Date(latest.lastModified);
    if (!Number.isNaN(parsed.getTime())) headers['If-Modified-Since'] = parsed.toUTCString();
  }

  let lastError = 'pdf_fetch_failed';
  for (let attempt = 0; attempt < PDF_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), PDF_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      if (response.status === 304) {
        return {
          notModified: true,
          bytes: new Uint8Array(),
          etag: latest?.etag || null,
          lastModified: latest?.lastModified || null,
          contentType: null,
          httpStatus: 304
        };
      }

      if (!response.ok) {
        throw new Error(`pdf_fetch_http_${response.status}`);
      }

      const contentLength = Number(response.headers.get('content-length') || NaN);
      if (Number.isFinite(contentLength) && contentLength > PDF_FETCH_MAX_BYTES) {
        throw new Error('pdf_fetch_too_large');
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > PDF_FETCH_MAX_BYTES) throw new Error('pdf_fetch_too_large');

      const parsedLastModified = response.headers.get('last-modified');
      const lastModifiedDate = parsedLastModified ? new Date(parsedLastModified) : null;
      const lastModified =
        lastModifiedDate && !Number.isNaN(lastModifiedDate.getTime()) ? lastModifiedDate.toISOString() : null;

      return {
        notModified: false,
        bytes,
        etag: response.headers.get('etag'),
        lastModified,
        contentType: response.headers.get('content-type'),
        httpStatus: response.status
      };
    } catch (err) {
      const message = stringifyError(err);
      const timeoutAbort = message.toLowerCase().includes('abort') || message.toLowerCase().includes('timeout');
      lastError = timeoutAbort ? 'pdf_fetch_timeout' : message;
      if (attempt + 1 < PDF_FETCH_RETRIES) {
        await sleep(200 * Math.pow(2, attempt));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(lastError);
}

async function extractArtemisBudgetLineCandidatesFromPdfBytes({
  bytes,
  sourceTitle,
  allowFallback,
  fiscalYear
}: {
  bytes: Uint8Array;
  sourceTitle: string;
  allowFallback: boolean;
  fiscalYear: number;
}) {
  const pdfjs = await loadPdfJsModule();
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
    throw new Error('pdfjs_unavailable');
  }

  ensurePdfWorkerSrc(pdfjs);
  const task = pdfjs.getDocument({ data: bytes, disableWorker: true });
  const pdf = await task.promise;
  const totalPages = Number(pdf?.numPages || 0);
  if (!Number.isFinite(totalPages) || totalPages <= 0) {
    throw new Error('pdf_no_pages');
  }

  const primaryLines = await extractPdfLines(pdf, Math.min(totalPages, PDF_PRIMARY_PAGE_LIMIT));
  let candidates = extractArtemisBudgetLineCandidatesFromLines({
    lines: primaryLines,
    sourceTitle,
    fiscalYear
  });

  let pagesScanned = Math.min(totalPages, PDF_PRIMARY_PAGE_LIMIT);
  const shouldFallback =
    totalPages > pagesScanned &&
    ((allowFallback && candidates.length < MIN_PDF_LINES_PER_REQUIRED_FY26_DOC) || candidates.length === 0);
  if (shouldFallback) {
    const fallbackLines = await extractPdfLines(pdf, Math.min(totalPages, PDF_FALLBACK_PAGE_LIMIT));
    candidates = extractArtemisBudgetLineCandidatesFromLines({
      lines: fallbackLines,
      sourceTitle,
      fiscalYear
    });
    pagesScanned = Math.min(totalPages, PDF_FALLBACK_PAGE_LIMIT);
  }

  return { candidates, pagesScanned, totalPages };
}

async function extractPdfLines(pdf: any, maxPages: number): Promise<Array<{ pageNumber: number; text: string }>> {
  const lines: Array<{ pageNumber: number; text: string }> = [];
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const grouped = groupPdfTextItemsIntoLines(Array.isArray(textContent?.items) ? textContent.items : []);
    for (const line of grouped) {
      if (!line) continue;
      lines.push({ pageNumber, text: line });
    }
  }
  return lines;
}

function groupPdfTextItemsIntoLines(items: any[]): string[] {
  const rows = new Map<number, Array<{ x: number; text: string }>>();

  for (const item of items) {
    const text = compactWhitespace(typeof item?.str === 'string' ? item.str : '');
    if (!text) continue;

    const transform = Array.isArray(item?.transform) ? item.transform : [];
    const x = Number(transform?.[4]);
    const y = Number(transform?.[5]);
    const rowKey = Number.isFinite(y) ? Math.round(y * 2) / 2 : Number.NaN;

    if (!Number.isFinite(rowKey)) {
      const fallbackKey = -1 * (rows.size + 1);
      rows.set(fallbackKey, [...(rows.get(fallbackKey) || []), { x: Number.isFinite(x) ? x : 0, text }]);
      continue;
    }

    const current = rows.get(rowKey) || [];
    current.push({ x: Number.isFinite(x) ? x : 0, text });
    rows.set(rowKey, current);
  }

  const sortedKeys = [...rows.keys()].sort((a, b) => b - a);
  return sortedKeys
    .flatMap((key) => {
      const chunk = rows.get(key) || [];
      chunk.sort((a, b) => a.x - b.x);
      const joined = compactWhitespace(chunk.map((entry) => entry.text).join(' '));
      return joined ? [joined] : [];
    })
    .filter(Boolean);
}

function extractArtemisBudgetLineCandidatesFromLines({
  lines,
  sourceTitle,
  fiscalYear
}: {
  lines: Array<{ pageNumber: number; text: string }>;
  sourceTitle: string;
  fiscalYear: number;
}): PdfLineExtraction[] {
  const bestByLineItem = new Map<string, PdfLineExtraction>();

  for (const row of lines) {
    const text = compactWhitespace(row.text);
    if (!text || text.length < 6) continue;
    if (text.length > 320) continue;
    if (/\.{4,}/.test(text)) continue;
    if (/\b(?:exp|ps|som)-\d+\b/i.test(text)) continue;

    const matchedSpec = ARTEMIS_BUDGET_LINE_SPECS.find((spec) => spec.pattern.test(text));
    if (!matchedSpec) continue;

    const selected = selectBudgetAmountFromLine({ line: text, fiscalYear, sourceTitle });
    if (!selected) continue;
    if (!selected.token.hasDecimal && !selected.token.hasThousandsSeparator && !selected.token.unit && selected.token.value < 10) {
      continue;
    }

    const normalizedUnit = normalizeBudgetUnit(selected.token.unit, text, sourceTitle);
    const amountRequested = normalizeToDollars(selected.token.value, normalizedUnit);
    if (!Number.isFinite(amountRequested) || amountRequested <= 0) continue;

    const amountMillions = amountRequested / 1_000_000;
    if (amountMillions < 10) continue;
    const detail = compactWhitespace(text).slice(0, PDF_TEXT_LIMIT);
    const confidence =
      selected.selector === 'after-dash'
        ? 0.96
        : selected.selector.startsWith('fy') && selected.selector.endsWith('_column')
          ? 0.95
        : selected.selector === 'single-token'
          ? 0.92
          : selected.selector === 'dollar-sign'
            ? 0.9
            : 0.78;

    const candidate: PdfLineExtraction = {
      lineItem: matchedSpec.lineItem,
      amountRequested,
      amountMillions,
      pageNumber: row.pageNumber,
      selector: selected.selector,
      detail,
      confidence
    };

    const existing = bestByLineItem.get(candidate.lineItem);
    if (!existing || candidate.confidence > existing.confidence) {
      bestByLineItem.set(candidate.lineItem, candidate);
      continue;
    }
    if (candidate.confidence === existing.confidence && candidate.pageNumber < existing.pageNumber) {
      bestByLineItem.set(candidate.lineItem, candidate);
    }
  }

  return [...bestByLineItem.values()];
}

function extractBudgetNumberTokens(line: string): BudgetNumberToken[] {
  const tokens: BudgetNumberToken[] = [];
  const pattern =
    /(?<![A-Za-z0-9])\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)(?:\s*(billion|million|thousand))?(?![A-Za-z0-9])/gi;

  for (const match of line.matchAll(pattern)) {
    const raw = match[0] || '';
    const numberPart = match[1] || '';
    const parsed = Number(numberPart.replace(/,/g, ''));
    if (!Number.isFinite(parsed)) continue;

    const unitRaw = (match[2] || '').toLowerCase();
    let unit: BudgetNumberToken['unit'] = null;
    if (unitRaw === 'billion') unit = 'billion';
    if (unitRaw === 'million') unit = 'million';
    if (unitRaw === 'thousand') unit = 'thousand';

    tokens.push({
      raw,
      value: parsed,
      unit,
      index: match.index || 0,
      hasDecimal: numberPart.includes('.'),
      hasThousandsSeparator: numberPart.includes(',')
    });
  }

  return tokens;
}

function selectBudgetAmountFromLine({
  line,
  fiscalYear,
  sourceTitle
}: {
  line: string;
  fiscalYear: number;
  sourceTitle: string;
}): { token: BudgetNumberToken; selector: string } | null {
  const tokens = extractBudgetNumberTokens(line).filter((token) => !isLikelyYearToken(token));
  if (!tokens.length) return null;

  const isFactSheet = /mission (?:directorate )?fact sheets?|agency fact sheet|budget request/i.test(sourceTitle);
  const isLikelyMultiYearTableRow = isFactSheet && tokens.length >= 5 && !line.includes('--');
  if (isLikelyMultiYearTableRow && tokens[2]) {
    return { token: tokens[2], selector: `fy${fiscalYear}_column` };
  }

  const dashIndex = line.indexOf('--');
  if (dashIndex >= 0) {
    const afterDash = tokens.find((token) => token.index > dashIndex);
    if (afterDash) return { token: afterDash, selector: 'after-dash' };
  }

  const dollarToken = tokens.find((token) => token.raw.includes('$'));
  if (dollarToken) return { token: dollarToken, selector: 'dollar-sign' };

  if (tokens.length === 1) return { token: tokens[0], selector: 'single-token' };

  const decimalToken = tokens.find((token) => token.hasDecimal || token.hasThousandsSeparator);
  if (decimalToken) return { token: decimalToken, selector: 'first-decimal' };

  return { token: tokens[0], selector: 'first-token' };
}

function isLikelyYearToken(token: BudgetNumberToken) {
  if (token.unit) return false;
  if (token.hasDecimal || token.hasThousandsSeparator) return false;
  return token.value >= 1900 && token.value <= 2100;
}

function normalizeBudgetUnit(tokenUnit: BudgetNumberToken['unit'], line: string, sourceTitle: string) {
  if (tokenUnit) return tokenUnit;
  if (/\bbillion\b|\bmillion\b|\bthousand\b/i.test(line)) {
    if (/\bbillion\b/i.test(line)) return 'billion' as const;
    if (/\bmillion\b/i.test(line)) return 'million' as const;
    if (/\bthousand\b/i.test(line)) return 'thousand' as const;
  }

  if (/fact sheet|technical supplement/i.test(sourceTitle)) return 'million' as const;
  return 'million' as const;
}

function normalizeToDollars(value: number, unit: 'billion' | 'million' | 'thousand') {
  if (unit === 'billion') return value * 1_000_000_000;
  if (unit === 'million') return value * 1_000_000;
  return value * 1_000;
}

function toParsedBudgetLinesFromPdfCandidates({
  candidates,
  fiscalYear,
  announcedTime,
  sourceDocumentId,
  sourceTitle,
  sourceUrl,
  topicPageUrl,
  topicApiUrl,
  parseStatus
}: {
  candidates: PdfLineExtraction[];
  fiscalYear: number;
  announcedTime: string;
  sourceDocumentId: string;
  sourceTitle: string;
  sourceUrl: string;
  topicPageUrl: string;
  topicApiUrl: string;
  parseStatus: 'ok' | 'cached';
}): ParsedBudgetLine[] {
  return candidates.map((candidate) => ({
    fiscalYear,
    program: 'Artemis',
    lineItem: candidate.lineItem,
    amountRequested: candidate.amountRequested,
    amountEnacted: null,
    announcedTime,
    sourceDocumentId,
    metadata: {
      sourceClass: 'nasa-budget-pdf-line',
      sourceTitle,
      sourceUrl,
      detail: candidate.detail,
      snippet: candidate.detail,
      pageNumber: candidate.pageNumber,
      amountMillions: Number(candidate.amountMillions.toFixed(3)),
      selector: candidate.selector,
      extractionConfidence: candidate.confidence,
      extractionStatus: parseStatus,
      topicPageUrl,
      topicApiUrl
    }
  }));
}

async function upsertBudgetPdfSourceDocument(
  supabase: SupabaseClient,
  args: {
    url: string;
    title: string;
    announcedTime: string;
    fetched: PdfFetchResult;
    extracted: { candidates: PdfLineExtraction[]; pagesScanned: number; totalPages: number };
    fiscalYear: number;
    topicPageUrl: string;
    topicApiUrl: string;
  }
) {
  const sha256 = await sha256Hex(args.fetched.bytes);
  const existingId = await loadSourceDocumentIdByUrlAndSha(supabase, args.url, sha256);
  const summary =
    args.extracted.candidates.length > 0
      ? `Extracted ${args.extracted.candidates.length} Artemis budget lines from ${args.title}.`
      : `No Artemis budget line candidates extracted from ${args.title}.`;

  const row = {
    source_key: 'nasa_budget_docs',
    source_type: 'budget',
    url: args.url,
    title: args.title,
    summary,
    announced_time: args.announcedTime,
    fetched_at: new Date().toISOString(),
    http_status: args.fetched.httpStatus,
    etag: args.fetched.etag,
    last_modified: args.fetched.lastModified,
    sha256,
    bytes: args.fetched.bytes.length,
    content_type: args.fetched.contentType,
    parse_version: PDF_PARSE_VERSION,
    raw: {
      sourceClass: 'nasa-budget-pdf',
      fiscalYear: args.fiscalYear,
      topicPageUrl: args.topicPageUrl,
      topicApiUrl: args.topicApiUrl,
      pagesScanned: args.extracted.pagesScanned,
      totalPages: args.extracted.totalPages,
      extractedBudgetLines: args.extracted.candidates.map((candidate) => ({
        lineItem: candidate.lineItem,
        amountRequested: candidate.amountRequested,
        amountMillions: candidate.amountMillions,
        pageNumber: candidate.pageNumber,
        selector: candidate.selector,
        detail: candidate.detail,
        confidence: candidate.confidence
      }))
    },
    error: null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('artemis_source_documents')
    .upsert(row, { onConflict: 'url,sha256' })
    .select('id')
    .single();
  if (error || !data?.id) {
    const fallbackId = await loadSourceDocumentIdByUrlAndSha(supabase, args.url, sha256);
    if (!fallbackId) {
      throw error || new Error('failed_to_upsert_budget_pdf_source_document');
    }
    return { id: fallbackId, inserted: existingId == null };
  }

  return { id: String(data.id), inserted: existingId == null };
}

async function loadSourceDocumentIdByUrlAndSha(supabase: SupabaseClient, url: string, sha256: string) {
  const { data, error } = await supabase
    .from('artemis_source_documents')
    .select('id')
    .eq('url', url)
    .eq('sha256', sha256)
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return null;
  return String((data as any).id);
}

function parseCachedPdfLineExtractions(raw: Record<string, unknown> | null): PdfLineExtraction[] {
  if (!raw) return [];
  const values = Array.isArray(raw.extractedBudgetLines) ? raw.extractedBudgetLines : [];
  const candidates: PdfLineExtraction[] = [];

  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const lineItem = typeof (value as any).lineItem === 'string' ? compactWhitespace((value as any).lineItem) : '';
    const amountRequested = finiteNumberOrNull((value as any).amountRequested);
    const amountMillions = finiteNumberOrNull((value as any).amountMillions);
    const pageNumber = Math.max(1, Math.round(finiteNumberOrNull((value as any).pageNumber) || 1));
    const selector = typeof (value as any).selector === 'string' ? compactWhitespace((value as any).selector) : 'cached';
    const detail = typeof (value as any).detail === 'string' ? compactWhitespace((value as any).detail).slice(0, PDF_TEXT_LIMIT) : lineItem;
    const confidence = finiteNumberOrNull((value as any).confidence) || 0.75;

    if (!lineItem || amountRequested == null || !Number.isFinite(amountRequested) || amountRequested <= 0) continue;
    const normalizedMillions =
      amountMillions != null && Number.isFinite(amountMillions) ? amountMillions : amountRequested / 1_000_000;
    if (normalizedMillions < 10) continue;

    candidates.push({
      lineItem,
      amountRequested,
      amountMillions: normalizedMillions,
      pageNumber,
      selector: selector || 'cached',
      detail: detail || lineItem,
      confidence
    });
  }

  return candidates;
}

function objectFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sha256Hex(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNasaContentPayload(value: unknown): NasaContentPayload | null {
  if (!value || typeof value !== 'object') return null;
  return value as NasaContentPayload;
}

function parseBudgetDocumentsFromTopicHtml(html: string): NasaBudgetDocument[] {
  const rows = html.split(/<div class="hds-list-row hds-file-list-row">/i).slice(1);
  const documents: NasaBudgetDocument[] = [];

  for (const row of rows) {
    const title = compactWhitespace(stripHtml(extractMatch(row, /<h2[^>]*>([\s\S]*?)<\/h2>/i) || ''));
    const href = extractMatch(row, /<a[^>]*href="([^"]+)"[^>]*download/i) || extractMatch(row, /<a[^>]*href="([^"]+)"/i);
    if (!title || !href || !/\.pdf(\?|$)/i.test(href)) continue;

    const dateAndType = [...row.matchAll(/<p class="p-sm">([\s\S]*?)<\/p>/gi)]
      .map((match) => compactWhitespace(stripHtml(match[1] || '')))
      .filter((value) => value.length > 0);

    documents.push({
      title,
      dateLabel: dateAndType[0] || null,
      fileType: dateAndType[1] || null,
      url: sanitizeUrl(href)
    });
  }

  return dedupeBudgetDocuments(documents);
}

function dedupeBudgetDocuments(documents: NasaBudgetDocument[]) {
  const seen = new Set<string>();
  const deduped: NasaBudgetDocument[] = [];

  for (const document of documents) {
    const key = `${normalizeLineItemKey(document.title)}|${document.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(document);
  }

  return deduped;
}

function extractPressReleaseBudgetLines({
  text,
  fiscalYear,
  announcedTime,
  sourceDocumentId,
  sourceUrl,
  sourceTitle
}: {
  text: string;
  fiscalYear: number;
  announcedTime: string;
  sourceDocumentId: string;
  sourceUrl: string;
  sourceTitle: string;
}): ParsedBudgetLine[] {
  const terms = [
    { lineItem: 'Lunar exploration investment', pattern: /lunar exploration/i },
    { lineItem: 'Mars-focused programs investment', pattern: /mars[-\s]*focused programs?/i },
    { lineItem: 'Human space exploration investment', pattern: /human space exploration/i },
    { lineItem: 'Science and technology research investment', pattern: /science and technology research/i }
  ];

  const lines: ParsedBudgetLine[] = [];

  for (const term of terms) {
    const snippet = findSnippetAround(text, term.pattern);
    if (!snippet) continue;

    const amount = extractMoneyFromText(snippet);
    if (amount == null) continue;

    lines.push({
      fiscalYear,
      program: 'Artemis',
      lineItem: `${term.lineItem} (press statement)`,
      amountRequested: amount,
      amountEnacted: null,
      announcedTime,
      sourceDocumentId,
      metadata: {
        sourceClass: 'nasa-budget-press-release',
        sourceTitle,
        sourceUrl,
        detail: snippet,
        snippet
      }
    });
  }

  return dedupeBudgetLines(lines);
}

function parseUsaSpendingBudgetaryResourcesPayload(value: unknown): UsaSpendingBudgetaryResourcesPayload | null {
  if (!value || typeof value !== 'object') return null;
  return value as UsaSpendingBudgetaryResourcesPayload;
}

function extractUsaSpendingBudgetLines({
  payload,
  years,
  announcedTime
}: {
  payload: UsaSpendingBudgetaryResourcesPayload | null;
  years: number[];
  announcedTime: string;
}): ParsedBudgetLine[] {
  const targetYears = new Set<number>(years);
  const rows = Array.isArray(payload?.agency_data_by_year) ? payload?.agency_data_by_year : [];
  const extracted: ParsedBudgetLine[] = [];

  for (const row of rows) {
    const fiscalYear = finiteNumberOrNull(row?.fiscal_year);
    if (fiscalYear == null || !targetYears.has(Math.round(fiscalYear))) continue;

    const year = Math.round(fiscalYear);
    const budgetaryResources = finiteNumberOrNull(row?.agency_budgetary_resources);
    const totalObligated = finiteNumberOrNull(row?.agency_total_obligated);
    const totalOutlayed = finiteNumberOrNull(row?.agency_total_outlayed);

    if (budgetaryResources != null) {
      extracted.push({
        fiscalYear: year,
        program: 'Artemis',
        lineItem: 'NASA agency budgetary resources (USASpending)',
        amountRequested: budgetaryResources,
        amountEnacted: totalObligated,
        announcedTime,
        sourceDocumentId: '',
        metadata: {
          detail: 'USASpending NASA budgetary resources line.',
          amountType: 'agency_budgetary_resources'
        }
      });
    }

    if (totalObligated != null) {
      extracted.push({
        fiscalYear: year,
        program: 'Artemis',
        lineItem: 'NASA agency total obligated (USASpending)',
        amountRequested: totalObligated,
        amountEnacted: totalOutlayed,
        announcedTime,
        sourceDocumentId: '',
        metadata: {
          detail: 'USASpending NASA total obligated line.',
          amountType: 'agency_total_obligated'
        }
      });
    }

    if (totalOutlayed != null) {
      extracted.push({
        fiscalYear: year,
        program: 'Artemis',
        lineItem: 'NASA agency total outlayed (USASpending)',
        amountRequested: totalOutlayed,
        amountEnacted: null,
        announcedTime,
        sourceDocumentId: '',
        metadata: {
          detail: 'USASpending NASA total outlayed line.',
          amountType: 'agency_total_outlayed'
        }
      });
    }
  }

  return dedupeBudgetLines(extracted);
}

function dedupeBudgetLines(lines: ParsedBudgetLine[]) {
  const deduped = new Map<string, ParsedBudgetLine>();

  for (const line of lines) {
    const key = [
      String(line.fiscalYear),
      normalizeLineItemKey(line.lineItem),
      metadataString(line.metadata, 'sourceClass') || '',
      metadataString(line.metadata, 'sourceUrl') || ''
    ].join('|');

    if (!deduped.has(key)) {
      deduped.set(key, line);
    }
  }

  return [...deduped.values()];
}

function extractMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return match[1] || null;
}

function sanitizeUrl(value: string) {
  const normalized = value.replace(/&amp;/g, '&').trim();
  try {
    const parsed = new URL(normalized);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return normalized.split('?')[0] || normalized;
  }
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function parseLooseDate(value: string | null) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function findSnippetAround(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match || match.index == null) return null;
  const start = Math.max(0, match.index - 200);
  const end = Math.min(text.length, match.index + 260);
  return compactWhitespace(text.slice(start, end));
}

function extractMoneyFromText(text: string) {
  const match = text.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(billion|million|thousand)?/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const unit = (match[2] || '').toLowerCase();
  if (unit === 'billion') return value * 1_000_000_000;
  if (unit === 'million') return value * 1_000_000;
  if (unit === 'thousand') return value * 1_000;
  return value;
}

function finiteNumberOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeLineItemKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function stableUuidFromText(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest).slice(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
