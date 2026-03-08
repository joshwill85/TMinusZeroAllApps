import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { dedupeBudgetLinesForDisplay, dedupeProcurementAwardsForDisplay } from '@/components/artemis/dashboard/budgetLineUtils';
import {
  buildArtemisBudgetIdentityKey,
  buildArtemisContentIdentityKey,
  buildArtemisTimelineIdentityKey,
  buildArtemisUrlComparisonKey,
  canonicalizeArtemisUrl,
  normalizeArtemisDateBucket,
  normalizeArtemisNumber,
  normalizeArtemisText
} from '@/lib/utils/artemisDedupe';

type QaEnvTarget = 'prod-readonly' | 'staging' | 'local';
type QaOutputFormat = 'json' | 'md';
type Severity = 'p0' | 'p1' | 'p2';
type FindingCategory = 'exact_key_duplicate' | 'semantic_content_duplicate' | 'cross_source_duplicate' | 'ui_projection_duplicate';

type QaOptions = {
  envTarget: QaEnvTarget;
  format: QaOutputFormat;
  windowDays: number;
  pageSize: number;
  hardCap: number;
};

type Finding = {
  id: string;
  severity: Severity;
  category: FindingCategory;
  layer: 'db' | 'server' | 'ui';
  surface: string;
  summary: string;
  recommendation: string;
  evidence: Record<string, unknown>;
  owner: 'data-engineering' | 'backend' | 'frontend';
};

type QaReport = {
  generatedAt: string;
  envTarget: QaEnvTarget;
  windowDays: number;
  status: 'pass' | 'fail' | 'skipped';
  findings: Finding[];
  summary: {
    totalFindings: number;
    p0: number;
    p1: number;
    p2: number;
    exactKeyDuplicates: number;
    semanticDuplicates: number;
    uiProjectionDuplicates: number;
    scannedRowsBySurface: Record<string, number>;
  };
  notes: string[];
};

type ContentRow = {
  id: string;
  fingerprint: string | null;
  kind: string;
  mission_key: string;
  url: string;
  title: string;
  source_key: string | null;
  external_id: string | null;
  platform: string | null;
  image_url: string | null;
  data_label: string | null;
  data_value: number | null;
  data_unit: string | null;
  published_at: string | null;
  captured_at: string | null;
  updated_at: string | null;
};

type BudgetRow = {
  id: string;
  fiscal_year: number | null;
  agency: string | null;
  program: string | null;
  line_item: string | null;
  amount_requested: number | null;
  amount_enacted: number | null;
  source_document_id: string | null;
  announced_time: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type ProcurementRow = {
  id: string;
  usaspending_award_id: string | null;
  award_title: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
  source_document_id: string | null;
  updated_at: string | null;
};

type TimelineRow = {
  id: string;
  fingerprint: string | null;
  summary: string | null;
  source_type: string | null;
  source_url: string | null;
  title: string;
  mission_key: string;
  event_time: string | null;
  announced_time: string;
  is_superseded: boolean;
  updated_at: string | null;
};

type SourceDocumentRow = {
  id: string;
  url: string;
  sha256: string | null;
  source_key: string;
  fetched_at: string | null;
};

type UiIntelRow = {
  id: string;
  kind: string;
  mission_key: string;
  title: string;
  url: string;
  source_key: string | null;
  external_id: string | null;
  platform: string | null;
  image_url: string | null;
  data_label: string | null;
  data_value: number | null;
  data_unit: string | null;
  source_tier: string;
  published_at: string | null;
  captured_at: string | null;
  overall_score: number | null;
};

type UiBudgetRow = {
  fiscal_year: number | null;
  agency: string | null;
  program: string | null;
  line_item: string | null;
  amount_requested: number | null;
  amount_enacted: number | null;
  announced_time: string | null;
  metadata: Record<string, unknown> | null;
  source_document_id: string | null;
};

type UiProcurementRow = {
  award_title: string | null;
  usaspending_award_id: string | null;
  recipient: string | null;
  obligated_amount: number | null;
  awarded_on: string | null;
  mission_key: string | null;
};

type UiTimelineRow = {
  id: string;
  summary: string | null;
  confidence: string | null;
  source_type: string | null;
  source_url: string | null;
  title: string;
  mission_key: string;
  event_time: string | null;
  announced_time: string;
  is_superseded: boolean;
};

const DEFAULT_OPTIONS: QaOptions = {
  envTarget: 'prod-readonly',
  format: 'md',
  windowDays: 30,
  pageSize: 1000,
  hardCap: 25000
};

async function main() {
  const generatedAt = new Date().toISOString();
  const options = parseCliOptions(process.argv.slice(2));
  const artifactsDir = path.resolve(process.cwd(), '.artifacts', 'artemis-qa');
  mkdirSync(artifactsDir, { recursive: true });

  const reportPathJson = path.join(artifactsDir, 'artemis-qa-report.json');
  const reportPathMd = path.join(artifactsDir, 'artemis-qa-report.md');

  const env = resolveSupabaseEnv();
  if (!env.url || !env.key) {
    const skipped = buildSkippedReport(generatedAt, options, [
      'Supabase environment variables are missing. Expected NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    ]);
    writeFileSync(reportPathJson, `${JSON.stringify(skipped, null, 2)}\n`, 'utf8');
    writeFileSync(reportPathMd, renderMarkdown(skipped), 'utf8');
    logReportPaths(skipped.status, reportPathJson, reportPathMd);
    return;
  }

  const supabase = createClient(env.url, env.key, { auth: { persistSession: false } });
  const sinceIso = new Date(Date.now() - options.windowDays * 24 * 60 * 60 * 1000).toISOString();

  const notes: string[] = [];
  const findings: Finding[] = [];
  const scannedRowsBySurface: Record<string, number> = {};

  const contentRows = await scanTable<ContentRow>({
    supabase,
    table: 'artemis_content_items',
    select:
      'id,fingerprint,kind,mission_key,title,url,source_key,external_id,platform,image_url,data_label,data_value,data_unit,published_at,captured_at,updated_at',
    orderBy: 'id',
    sinceField: 'captured_at',
    sinceIso,
    options
  });
  scannedRowsBySurface.artemis_content_items = contentRows.rows.length;
  notes.push(...contentRows.notes);
  findings.push(...checkContentTableDuplicates(contentRows.rows));

  const budgetRows = await scanTable<BudgetRow>({
    supabase,
    table: 'artemis_budget_lines',
    select:
      'id,fiscal_year,agency,program,line_item,amount_requested,amount_enacted,source_document_id,announced_time,metadata,updated_at',
    orderBy: 'id',
    sinceField: 'updated_at',
    sinceIso,
    options
  });
  scannedRowsBySurface.artemis_budget_lines = budgetRows.rows.length;
  notes.push(...budgetRows.notes);
  findings.push(...checkBudgetTableDuplicates(budgetRows.rows));

  const procurementRows = await scanTable<ProcurementRow>({
    supabase,
    table: 'artemis_procurement_awards',
    select:
      'id,usaspending_award_id,award_title,recipient,obligated_amount,awarded_on,mission_key,source_document_id,updated_at',
    orderBy: 'id',
    sinceField: 'updated_at',
    sinceIso,
    options
  });
  scannedRowsBySurface.artemis_procurement_awards = procurementRows.rows.length;
  notes.push(...procurementRows.notes);
  findings.push(...checkProcurementTableDuplicates(procurementRows.rows));

  const timelineRows = await scanTable<TimelineRow>({
    supabase,
    table: 'artemis_timeline_events',
    select: 'id,fingerprint,title,summary,mission_key,event_time,announced_time,source_type,source_url,is_superseded,updated_at',
    orderBy: 'id',
    sinceField: 'announced_time',
    sinceIso,
    options
  });
  scannedRowsBySurface.artemis_timeline_events = timelineRows.rows.length;
  notes.push(...timelineRows.notes);
  findings.push(...checkTimelineTableDuplicates(timelineRows.rows));

  const sourceDocumentRows = await scanTable<SourceDocumentRow>({
    supabase,
    table: 'artemis_source_documents',
    select: 'id,url,sha256,source_key,fetched_at',
    orderBy: 'id',
    sinceField: 'fetched_at',
    sinceIso,
    options
  });
  scannedRowsBySurface.artemis_source_documents = sourceDocumentRows.rows.length;
  notes.push(...sourceDocumentRows.notes);
  findings.push(...checkSourceDocumentDuplicates(sourceDocumentRows.rows));

  const uiChecks = await runUiProjectionChecks({
    supabase,
    sinceIso,
    options
  });
  scannedRowsBySurface.ui_intel_items = uiChecks.intelRowsScanned;
  scannedRowsBySurface.ui_budget_rows = uiChecks.budgetRowsScanned;
  scannedRowsBySurface.ui_procurement_rows = uiChecks.procurementRowsScanned;
  scannedRowsBySurface.ui_timeline_rows = uiChecks.timelineRowsScanned;
  findings.push(...uiChecks.findings);
  notes.push(...uiChecks.notes);

  const rankedFindings = [...findings].sort(compareFindings);
  const summary = summarize(rankedFindings, scannedRowsBySurface);
  const status: QaReport['status'] = summary.p0 > 0 || summary.p1 > 0 ? 'fail' : 'pass';
  const report: QaReport = {
    generatedAt,
    envTarget: options.envTarget,
    windowDays: options.windowDays,
    status,
    findings: rankedFindings,
    summary,
    notes
  };

  writeFileSync(reportPathJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(reportPathMd, renderMarkdown(report), 'utf8');
  logReportPaths(status, reportPathJson, reportPathMd);

  if (status === 'fail') process.exitCode = 1;
}

function resolveSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  return { url, key };
}

function buildSkippedReport(generatedAt: string, options: QaOptions, notes: string[]): QaReport {
  return {
    generatedAt,
    envTarget: options.envTarget,
    windowDays: options.windowDays,
    status: 'skipped',
    findings: [],
    summary: {
      totalFindings: 0,
      p0: 0,
      p1: 0,
      p2: 0,
      exactKeyDuplicates: 0,
      semanticDuplicates: 0,
      uiProjectionDuplicates: 0,
      scannedRowsBySurface: {}
    },
    notes
  };
}

async function scanTable<TRow>({
  supabase,
  table,
  select,
  orderBy,
  sinceField,
  sinceIso,
  options
}: {
  supabase: ReturnType<typeof createClient>;
  table: string;
  select: string;
  orderBy: string;
  sinceField?: string;
  sinceIso: string;
  options: QaOptions;
}): Promise<{ rows: TRow[]; notes: string[] }> {
  const notes: string[] = [];
  const rows: TRow[] = [];
  let offset = 0;

  while (offset < options.hardCap) {
    let query = supabase.from(table).select(select).order(orderBy, { ascending: true }).range(offset, offset + options.pageSize - 1);
    if (sinceField) {
      query = query.gte(sinceField, sinceIso);
    }

    const { data, error } = await query;
    if (error) {
      notes.push(`Query failure for ${table}: ${error.message}`);
      break;
    }

    const chunk = (data || []) as TRow[];
    rows.push(...chunk);
    if (chunk.length < options.pageSize) break;
    offset += options.pageSize;
  }

  if (rows.length >= options.hardCap) {
    notes.push(`Hard cap reached for ${table}; scan may be partial (${options.hardCap} rows).`);
  }

  return { rows, notes };
}

function checkContentTableDuplicates(rows: ContentRow[]): Finding[] {
  const findings: Finding[] = [];

  const exact = findDuplicateGroups(rows, (row) => normalizeArtemisText(row.fingerprint));
  if (exact.length) {
    findings.push(
      buildFinding({
        id: 'db-content-fingerprint-duplicate',
        severity: 'p1',
        category: 'exact_key_duplicate',
        layer: 'db',
        surface: 'artemis_content_items',
        summary: `Found ${exact.length} duplicate fingerprint group(s) in artemis_content_items.`,
        recommendation: 'Enforce ingest fingerprint determinism and verify conflict handling in content upsert pipeline.',
        owner: 'data-engineering',
        evidence: {
          duplicateGroups: exact.slice(0, 20)
        }
      })
    );
  }

  const semanticStrict = findDuplicateGroups(rows, (row) =>
    buildArtemisContentIdentityKey({
      kind: row.kind,
      missionKey: row.mission_key,
      title: row.title,
      url: row.url,
      sourceKey: row.source_key,
      externalId: row.external_id,
      platform: row.platform,
      imageUrl: row.image_url,
      dataLabel: row.data_label,
      dataValue: row.data_value,
      dataUnit: row.data_unit
    })
  );
  if (semanticStrict.length) {
    findings.push(
      buildFinding({
        id: 'db-content-semantic-identity-duplicate',
        severity: 'p1',
        category: 'semantic_content_duplicate',
        layer: 'db',
        surface: 'artemis_content_items',
        summary: `Found ${semanticStrict.length} strict semantic duplicate content group(s) in artemis_content_items.`,
        recommendation: 'Reconcile ingest identity keys and enforce idempotent upserts for duplicated content records.',
        owner: 'backend',
        evidence: {
          duplicateGroups: semanticStrict.slice(0, 20)
        }
      })
    );
  }

  return findings;
}

function checkBudgetTableDuplicates(rows: BudgetRow[]): Finding[] {
  const findings: Finding[] = [];
  const naturalKeyGroups = findDuplicateGroups(rows, (row) =>
    buildArtemisBudgetIdentityKey({
      fiscalYear: row.fiscal_year,
      agency: row.agency,
      program: row.program,
      lineItem: row.line_item,
      amountRequested: row.amount_requested,
      amountEnacted: row.amount_enacted,
      announcedTime: row.announced_time,
      sourceDocumentId: row.source_document_id,
      sourceClass: metadataString(row.metadata, 'sourceClass'),
      amountType: metadataString(row.metadata, 'amountType'),
      sourceUrl: metadataString(row.metadata, 'sourceUrl'),
      sourceTitle: metadataString(row.metadata, 'sourceTitle'),
      detail: metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'snippet')
    })
  );

  if (naturalKeyGroups.length) {
    findings.push(
      buildFinding({
        id: 'db-budget-natural-key-duplicate',
        severity: 'p1',
        category: 'semantic_content_duplicate',
        layer: 'db',
        surface: 'artemis_budget_lines',
        summary: `Found ${naturalKeyGroups.length} duplicate budget natural-key group(s).`,
        recommendation: 'Backfill cleanup and add stronger natural-key dedupe in ingest transforms for budget lines.',
        owner: 'data-engineering',
        evidence: {
          duplicateGroups: naturalKeyGroups.slice(0, 20)
        }
      })
    );
  }

  return findings;
}

function checkProcurementTableDuplicates(rows: ProcurementRow[]): Finding[] {
  const findings: Finding[] = [];

  const exact = findDuplicateGroups(rows, (row) => {
    return [
      normalizeArtemisText(row.usaspending_award_id),
      normalizeArtemisText(row.award_title),
      normalizeArtemisText(row.recipient),
      normalizeArtemisNumber(row.obligated_amount),
      normalizeArtemisDateBucket(row.awarded_on),
      normalizeArtemisText(row.mission_key),
      normalizeArtemisText(row.source_document_id)
    ].join('|');
  }).filter((group) => group.key.replace(/\|/g, '').length > 0 && !group.key.startsWith('||||||'));

  if (exact.length) {
    findings.push(
      buildFinding({
        id: 'db-procurement-exact-key-duplicate',
        severity: 'p1',
        category: 'exact_key_duplicate',
        layer: 'db',
        surface: 'artemis_procurement_awards',
        summary: `Found ${exact.length} duplicate procurement award key group(s).`,
        recommendation: 'Reconcile award identity generation and validate unique key coverage during ingestion.',
        owner: 'data-engineering',
        evidence: {
          duplicateGroups: exact.slice(0, 20)
        }
      })
    );
  }

  return findings;
}

function checkTimelineTableDuplicates(rows: TimelineRow[]): Finding[] {
  const findings: Finding[] = [];

  const exact = findDuplicateGroups(rows, (row) => normalizeArtemisText(row.fingerprint));
  if (exact.length) {
    findings.push(
      buildFinding({
        id: 'db-timeline-fingerprint-duplicate',
        severity: 'p1',
        category: 'exact_key_duplicate',
        layer: 'db',
        surface: 'artemis_timeline_events',
        summary: `Found ${exact.length} duplicate timeline fingerprint group(s).`,
        recommendation: 'Investigate timeline fingerprint generation and supersession merge behavior.',
        owner: 'data-engineering',
        evidence: {
          duplicateGroups: exact.slice(0, 20)
        }
      })
    );
  }

  const semantic = findDuplicateGroups(
    rows.filter((row) => !row.is_superseded),
    (row) => buildTimelineSemanticCollapseKey(row)
  );

  if (semantic.length) {
    findings.push(
      buildFinding({
        id: 'db-timeline-semantic-duplicate',
        severity: 'p2',
        category: 'semantic_content_duplicate',
        layer: 'db',
        surface: 'artemis_timeline_events',
        summary: `Found ${semantic.length} semantic duplicate timeline event group(s) among non-superseded rows.`,
        recommendation: 'Ensure timeline supersession links are applied before publishing event feed rows.',
        owner: 'backend',
        evidence: {
          duplicateGroups: semantic.slice(0, 20)
        }
      })
    );
  }

  return findings;
}

function checkSourceDocumentDuplicates(rows: SourceDocumentRow[]): Finding[] {
  const rowsWithSha = rows.filter((row) => normalizeArtemisText(row.sha256).length > 0);
  const exact = findDuplicateGroups(rowsWithSha, (row) => `${canonicalizeArtemisUrl(row.url)}|${normalizeArtemisText(row.sha256)}`).filter(
    (group) => normalizeArtemisText(group.key).length > 1
  );
  if (!exact.length) return [];

  return [
    buildFinding({
      id: 'db-source-doc-url-sha-duplicate',
      severity: 'p1',
      category: 'exact_key_duplicate',
      layer: 'db',
      surface: 'artemis_source_documents',
      summary: `Found ${exact.length} duplicate source-document URL+sha256 group(s).`,
      recommendation: 'Verify source-document ingest idempotency and historical reingest conflict behavior.',
      owner: 'data-engineering',
      evidence: {
        duplicateGroups: exact.slice(0, 20)
      }
    })
  ];
}

async function runUiProjectionChecks({
  supabase,
  sinceIso,
  options
}: {
  supabase: ReturnType<typeof createClient>;
  sinceIso: string;
  options: QaOptions;
}): Promise<{
  findings: Finding[];
  notes: string[];
  intelRowsScanned: number;
  budgetRowsScanned: number;
  procurementRowsScanned: number;
  timelineRowsScanned: number;
}> {
  const findings: Finding[] = [];
  const notes: string[] = [];
  const { data: intelData, error: intelError } = await supabase
    .from('artemis_content_items')
    .select('id,kind,mission_key,title,url,source_key,external_id,platform,image_url,data_label,data_value,data_unit,source_tier,published_at,captured_at,overall_score')
    .gte('captured_at', sinceIso)
    .order('overall_score', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('captured_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(options.hardCap, 240));

  if (intelError) {
    notes.push(`UI Intel projection check skipped: ${intelError.message}`);
  }

  const intelItems = ((intelData || []) as UiIntelRow[]).filter((row) => Boolean(row.id && row.url && row.title && row.kind));
  const intelIdGroups = findDuplicateGroups(intelItems, (item) => normalizeArtemisText(item.id));
  if (intelIdGroups.length) {
    findings.push(
      buildFinding({
        id: 'ui-intel-id-duplicate',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'ui',
        surface: '/artemis?view=intel',
        summary: `Found ${intelIdGroups.length} duplicate rendered card id group(s) in Intelligence view projection.`,
        recommendation: 'De-duplicate merged Intel view list before render and stabilize content item identity keys.',
        owner: 'frontend',
        evidence: {
          duplicateGroups: intelIdGroups.slice(0, 20)
        }
      })
    );
  }

  const strictIntelGroups = findDuplicateGroups(intelItems, (item) =>
    buildArtemisContentIdentityKey({
      kind: item.kind,
      missionKey: item.mission_key,
      title: item.title,
      url: item.url,
      sourceKey: item.source_key,
      externalId: item.external_id,
      platform: item.platform,
      imageUrl: item.image_url,
      dataLabel: item.data_label,
      dataValue: item.data_value,
      dataUnit: item.data_unit
    })
  );
  if (strictIntelGroups.length) {
    findings.push(
      buildFinding({
        id: 'ui-intel-semantic-duplicate',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'ui',
        surface: '/artemis?view=intel',
        summary: `Found ${strictIntelGroups.length} strict duplicate card group(s) in Intelligence view input rows.`,
        recommendation: 'Apply strict identity dedupe before rendering merged intelligence cards.',
        owner: 'frontend',
        evidence: {
          duplicateGroups: strictIntelGroups.slice(0, 20)
        }
      })
    );
  }

  const { data: budgetData, error: budgetError } = await supabase
    .from('artemis_budget_lines')
    .select('fiscal_year,agency,program,line_item,amount_requested,amount_enacted,announced_time,metadata,source_document_id')
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(options.hardCap, 5000));
  if (budgetError) {
    notes.push(`UI Budget projection check skipped: ${budgetError.message}`);
  }

  const mappedBudgetLines = ((budgetData || []) as UiBudgetRow[]).map((row) => ({
    fiscalYear: row.fiscal_year ?? null,
    agency: row.agency ?? null,
    program: row.program ?? null,
    lineItem: row.line_item ?? null,
    amountRequested: coerceFiniteNumber(row.amount_requested),
    amountEnacted: coerceFiniteNumber(row.amount_enacted),
    announcedTime: row.announced_time ?? null,
    detail: metadataString(row.metadata, 'detail') || metadataString(row.metadata, 'snippet'),
    sourceClass: metadataString(row.metadata, 'sourceClass'),
    amountType: metadataString(row.metadata, 'amountType'),
    sourceUrl: metadataString(row.metadata, 'sourceUrl'),
    sourceTitle: metadataString(row.metadata, 'sourceTitle')
  }));
  const budgetRowsScanned = mappedBudgetLines.length;

  const displayBudgetInput = mappedBudgetLines.filter((line) => {
    if (line.sourceClass === 'usaspending-budgetary-resources') return false;
    return line.amountRequested != null || line.amountEnacted != null;
  });
  const displayBudget = dedupeBudgetLinesForDisplay(displayBudgetInput);
  if (displayBudget.length < displayBudgetInput.length) {
    findings.push(
      buildFinding({
        id: 'ui-budget-collapsed-duplicates',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'server',
        surface: '/artemis?view=budget',
        summary: `Budget view collapsed ${displayBudgetInput.length - displayBudget.length} duplicate source row(s) before rendering.`,
        recommendation: 'Treat collapsed duplicates as data-quality defects and remove at ingest/table level.',
        owner: 'backend',
        evidence: {
          inputRows: displayBudgetInput.length,
          renderedRows: displayBudget.length
        }
      })
    );
  }

  const { data: procurementData, error: procurementError } = await supabase
    .from('artemis_procurement_awards')
    .select('award_title,usaspending_award_id,recipient,obligated_amount,awarded_on,mission_key')
    .gte('updated_at', sinceIso)
    .order('updated_at', { ascending: false, nullsFirst: false })
    .limit(Math.min(options.hardCap, 5000));
  if (procurementError) {
    notes.push(`UI Procurement projection check skipped: ${procurementError.message}`);
  }

  const mappedProcurement = ((procurementData || []) as UiProcurementRow[]).map((row) => ({
    title: row.award_title,
    awardId: row.usaspending_award_id,
    recipient: row.recipient,
    obligatedAmount: coerceFiniteNumber(row.obligated_amount),
    awardedOn: row.awarded_on,
    missionKey: row.mission_key,
    detail: null,
    sourceUrl: null,
    sourceTitle: null
  }));
  const procurementRowsScanned = mappedProcurement.length;
  const dedupedProcurement = dedupeProcurementAwardsForDisplay(mappedProcurement);

  const procurementDisplayDuplicates = findDuplicateGroups(dedupedProcurement, (row) => {
    return [
      normalizeArtemisText(row.title || row.awardId),
      normalizeArtemisText(row.recipient),
      normalizeArtemisNumber(row.obligatedAmount),
      normalizeArtemisDateBucket(row.awardedOn),
      normalizeArtemisText(row.missionKey)
    ].join('|');
  }).filter((group) => group.key.replace(/\|/g, '').length > 0 && !group.key.startsWith('||||'));

  if (dedupedProcurement.length < mappedProcurement.length) {
    findings.push(
      buildFinding({
        id: 'ui-procurement-collapsed-duplicates',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'server',
        surface: '/artemis?view=budget',
        summary: `Budget procurement view collapsed ${mappedProcurement.length - dedupedProcurement.length} strict duplicate row(s) before render.`,
        recommendation: 'Resolve duplicate procurement records at ingest while keeping UI strict-id dedupe as a guardrail.',
        owner: 'backend',
        evidence: {
          inputRows: mappedProcurement.length,
          renderedRows: dedupedProcurement.length
        }
      })
    );
  }

  if (procurementDisplayDuplicates.length) {
    findings.push(
      buildFinding({
        id: 'ui-procurement-visible-duplicates',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'ui',
        surface: '/artemis?view=budget',
        summary: `Found ${procurementDisplayDuplicates.length} procurement duplicate group(s) likely visible in awards table.`,
        recommendation: 'Add pre-render dedupe for procurement awards and normalize award identity keys upstream.',
        owner: 'frontend',
        evidence: {
          duplicateGroups: procurementDisplayDuplicates.slice(0, 20)
        }
      })
    );
  }

  const { data: timelineData, error: timelineError } = await supabase
    .from('artemis_timeline_events')
    .select('id,title,summary,confidence,mission_key,event_time,announced_time,source_type,source_url,is_superseded')
    .eq('is_superseded', false)
    .gte('announced_time', sinceIso)
    .order('announced_time', { ascending: false, nullsFirst: false })
    .limit(250);
  if (timelineError) {
    notes.push(`UI Timeline projection check skipped: ${timelineError.message}`);
  }

  const timelineRows = ((timelineData || []) as UiTimelineRow[]).filter((row) => !row.is_superseded);
  const projectedTimelineRows = dedupeUiTimelineRows(timelineRows);
  const visibleTimelineDuplicates = findDuplicateGroups(projectedTimelineRows, (event) => buildTimelineSemanticCollapseKey(event));

  if (projectedTimelineRows.length < timelineRows.length) {
    findings.push(
      buildFinding({
        id: 'ui-timeline-collapsed-duplicates',
        severity: 'p2',
        category: 'ui_projection_duplicate',
        layer: 'server',
        surface: '/artemis?view=timeline',
        summary: `Timeline projection collapsed ${timelineRows.length - projectedTimelineRows.length} duplicate row(s) before render.`,
        recommendation: 'Keep projection dedupe and address repeated timeline refresh records in upstream event ingestion.',
        owner: 'backend',
        evidence: {
          inputRows: timelineRows.length,
          renderedRows: projectedTimelineRows.length
        }
      })
    );
  }

  if (visibleTimelineDuplicates.length) {
    findings.push(
      buildFinding({
        id: 'ui-timeline-visible-duplicates',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'ui',
        surface: '/artemis?view=timeline',
        summary: `Found ${visibleTimelineDuplicates.length} duplicate timeline event group(s) in non-superseded view.`,
        recommendation: 'Ensure timeline projection resolves semantic duplicates before rendering event list.',
        owner: 'frontend',
        evidence: {
          duplicateGroups: visibleTimelineDuplicates.slice(0, 20)
        }
      })
    );
  }

  const quickPulse = resolveOverviewQuickPulse(projectedTimelineRows);
  const quickPulseUrlKeys = new Set(
    quickPulse
      .map((row) => buildArtemisUrlComparisonKey(row.source_url))
      .filter((key) => key.length > 0)
  );
  const intelHighlights = resolveOverviewIntelHighlights(intelItems, quickPulseUrlKeys);
  const overlap = intelHighlights
    .map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      key: buildArtemisUrlComparisonKey(row.url)
    }))
    .filter((row) => row.key.length > 0 && quickPulseUrlKeys.has(row.key));

  if (overlap.length) {
    findings.push(
      buildFinding({
        id: 'ui-overview-quick-pulse-intel-overlap',
        severity: 'p1',
        category: 'ui_projection_duplicate',
        layer: 'ui',
        surface: '/artemis?view=overview',
        summary: `Found ${overlap.length} overlapping story URL(s) between Overview Quick Pulse and Intel Highlights.`,
        recommendation: 'Preserve URL-key exclusion from Quick Pulse before selecting Overview Intel Highlights.',
        owner: 'frontend',
        evidence: {
          overlap: overlap.slice(0, 20),
          quickPulse: quickPulse.map((row) => ({
            id: row.id,
            title: row.title,
            sourceUrl: row.source_url
          })),
          intelHighlights: intelHighlights.map((row) => ({
            id: row.id,
            title: row.title,
            url: row.url
          }))
        }
      })
    );
  }

  notes.push(
    'UI checks use strict identity keys that mirror dashboard projection dedupe behavior, including a Quick Pulse vs Intel Highlights overlap guard; pair with manual screenshot review for visual validation.'
  );

  return {
    findings,
    notes,
    intelRowsScanned: intelItems.length,
    budgetRowsScanned,
    procurementRowsScanned,
    timelineRowsScanned: projectedTimelineRows.length
  };
}

function findDuplicateGroups<TRow>(
  rows: TRow[],
  keyFn: (row: TRow) => string
): Array<{ key: string; count: number; sampleIds: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const list = grouped.get(key) || [];
    const sampleId = resolveSampleId(row);
    if (sampleId) list.push(sampleId);
    grouped.set(key, list);
  }

  return [...grouped.entries()]
    .map(([key, ids]) => ({ key, count: ids.length, sampleIds: ids.slice(0, 8) }))
    .filter((entry) => entry.count > 1)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function buildTimelineSemanticCollapseKey(row: {
  mission_key: string;
  title: string;
  summary?: string | null;
  event_time?: string | null;
  announced_time: string | null;
  source_type?: string | null;
  source_url?: string | null;
}) {
  return `strict:${buildArtemisTimelineIdentityKey({
    missionKey: row.mission_key,
    title: row.title,
    summary: row.summary || null,
    sourceType: row.source_type || null,
    sourceUrl: row.source_url || null,
    eventTime: row.event_time || null,
    announcedTime: row.announced_time || null
  })}`;
}

function dedupeUiTimelineRows(rows: UiTimelineRow[]) {
  const grouped = new Map<string, UiTimelineRow[]>();
  for (const row of rows) {
    const key = buildTimelineSemanticCollapseKey(row);
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }

  const deduped: UiTimelineRow[] = [];
  for (const group of grouped.values()) {
    deduped.push(group.slice().sort(compareTimelineRowsByPriority)[0] || group[0]);
  }

  return deduped;
}

function resolveOverviewQuickPulse(rows: UiTimelineRow[]) {
  return [...rows]
    .filter((row) => isOverviewHighConfidence(row.confidence))
    .sort((a, b) => parseDateMs(b.event_time || b.announced_time) - parseDateMs(a.event_time || a.announced_time))
    .slice(0, 3);
}

function resolveOverviewIntelHighlights(items: UiIntelRow[], excludeUrlComparisonKeys: Set<string>) {
  const deduped = dedupeUiIntelItems(items).filter((item) => {
    const comparisonKey = buildArtemisUrlComparisonKey(item.url);
    if (!comparisonKey.length) return true;
    return !excludeUrlComparisonKeys.has(comparisonKey);
  });

  const tierOne = deduped.filter((item) => normalizeArtemisText(item.source_tier) === 'tier1');
  if (tierOne.length >= 2) return tierOne.slice(0, 2);
  return (tierOne.length ? tierOne : deduped).slice(0, 2);
}

function dedupeUiIntelItems(items: UiIntelRow[]) {
  const deduped = new Map<string, UiIntelRow>();
  for (const item of items) {
    const key = buildArtemisContentIdentityKey({
      kind: item.kind,
      missionKey: item.mission_key,
      title: item.title,
      url: item.url,
      sourceKey: item.source_key,
      externalId: item.external_id,
      platform: item.platform,
      imageUrl: item.image_url,
      dataLabel: item.data_label,
      dataValue: item.data_value,
      dataUnit: item.data_unit
    });
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }
  return [...deduped.values()];
}

function isOverviewHighConfidence(value: string | null | undefined) {
  const normalized = normalizeArtemisText(value);
  return normalized === 'high' || normalized === 'primary';
}

function compareTimelineRowsByPriority(a: UiTimelineRow, b: UiTimelineRow) {
  const announcedDiff = parseDateMs(b.announced_time) - parseDateMs(a.announced_time);
  if (announcedDiff !== 0) return announcedDiff;

  const eventDiff = parseDateMs(b.event_time) - parseDateMs(a.event_time);
  if (eventDiff !== 0) return eventDiff;

  const sourceDiff = scoreTimelineSourceUrl(b.source_url) - scoreTimelineSourceUrl(a.source_url);
  if (sourceDiff !== 0) return sourceDiff;

  const summaryDiff = normalizeArtemisText(b.summary).length - normalizeArtemisText(a.summary).length;
  if (summaryDiff !== 0) return summaryDiff;

  return b.id.localeCompare(a.id);
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scoreTimelineSourceUrl(value: string | null | undefined) {
  const canonical = canonicalizeArtemisUrl(value);
  if (!canonical) return 0;
  if (canonical.includes('nasa.gov')) return 3;
  if (canonical.includes('usaspending.gov')) return 2;
  return 1;
}

function resolveSampleId(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.id === 'string') return record.id;
  if (typeof record.fingerprint === 'string') return record.fingerprint;
  if (typeof record.url === 'string') return record.url;
  return JSON.stringify(record).slice(0, 120);
}

function metadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  if (!metadata) return null;
  const value = metadata[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function buildFinding(finding: Omit<Finding, 'evidence'> & { evidence: Record<string, unknown> }): Finding {
  return finding;
}

function compareFindings(a: Finding, b: Finding) {
  const severity = severityRank(a.severity) - severityRank(b.severity);
  if (severity !== 0) return severity;
  return a.id.localeCompare(b.id);
}

function severityRank(value: Severity) {
  if (value === 'p0') return 0;
  if (value === 'p1') return 1;
  return 2;
}

function summarize(findings: Finding[], scannedRowsBySurface: Record<string, number>) {
  const p0 = findings.filter((finding) => finding.severity === 'p0').length;
  const p1 = findings.filter((finding) => finding.severity === 'p1').length;
  const p2 = findings.filter((finding) => finding.severity === 'p2').length;

  return {
    totalFindings: findings.length,
    p0,
    p1,
    p2,
    exactKeyDuplicates: findings.filter((finding) => finding.category === 'exact_key_duplicate').length,
    semanticDuplicates: findings.filter((finding) => finding.category === 'semantic_content_duplicate').length,
    uiProjectionDuplicates: findings.filter((finding) => finding.category === 'ui_projection_duplicate').length,
    scannedRowsBySurface
  };
}

function parseCliOptions(args: string[]): QaOptions {
  const options: QaOptions = { ...DEFAULT_OPTIONS };

  for (const arg of args) {
    if (arg.startsWith('--env=')) {
      const value = arg.slice('--env='.length).trim().toLowerCase();
      if (value === 'prod-readonly' || value === 'staging' || value === 'local') {
        options.envTarget = value;
      }
      continue;
    }

    if (arg.startsWith('--format=')) {
      const value = arg.slice('--format='.length).trim().toLowerCase();
      if (value === 'json' || value === 'md') options.format = value;
      continue;
    }

    if (arg.startsWith('--window=')) {
      const value = arg.slice('--window='.length).trim().toLowerCase();
      options.windowDays = parseWindowDays(value) ?? options.windowDays;
      continue;
    }

    if (arg.startsWith('--page-size=')) {
      const value = Number(arg.slice('--page-size='.length));
      if (Number.isFinite(value) && value > 0) options.pageSize = Math.floor(value);
      continue;
    }

    if (arg.startsWith('--hard-cap=')) {
      const value = Number(arg.slice('--hard-cap='.length));
      if (Number.isFinite(value) && value > 0) options.hardCap = Math.floor(value);
    }
  }

  return options;
}

function parseWindowDays(value: string) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.max(1, Number(value));
  const match = value.match(/^(\d+)\s*d$/);
  if (match?.[1]) return Math.max(1, Number(match[1]));
  return null;
}

function renderMarkdown(report: QaReport) {
  const findings = report.findings
    .map(
      (finding) =>
        `| ${finding.severity.toUpperCase()} | ${finding.layer} | ${finding.surface} | ${finding.category} | ${finding.summary} | ${finding.recommendation} |`
    )
    .join('\n');

  const notes = report.notes.length ? report.notes.map((note) => `- ${note}`).join('\n') : '- none';

  return `# Artemis QA Scan Report

Generated at: ${report.generatedAt}  
Environment target: ${report.envTarget}  
Window: last ${report.windowDays} day(s)  
Status: **${report.status.toUpperCase()}**

## Summary
- Total findings: **${report.summary.totalFindings}**
- P0: **${report.summary.p0}**
- P1: **${report.summary.p1}**
- P2: **${report.summary.p2}**
- Exact-key duplicate findings: **${report.summary.exactKeyDuplicates}**
- Semantic duplicate findings: **${report.summary.semanticDuplicates}**
- UI projection duplicate findings: **${report.summary.uiProjectionDuplicates}**

## Scanned Row Counts
\`\`\`json
${JSON.stringify(report.summary.scannedRowsBySurface, null, 2)}
\`\`\`

## Ranked Findings
| Severity | Layer | Surface | Category | Summary | Recommendation |
|---|---|---|---|---|---|
${findings || '| n/a | n/a | n/a | n/a | No duplicate findings detected. | n/a |'}

## Notes
${notes}
`;
}

function logReportPaths(status: QaReport['status'], jsonPath: string, mdPath: string) {
  console.log(`artemis-qa-scan: ${status.toUpperCase()}`);
  console.log(`- JSON: ${jsonPath}`);
  console.log(`- Markdown: ${mdPath}`);
}

void main();
