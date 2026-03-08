import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { FAQ_AUDIT_DATE, FAQ_REGISTRY, FAQ_SURFACE_REQUIREMENTS, FAQ_SURFACES } from '@/lib/content/faq/registry';
import { getFaqEntriesForSurface } from '@/lib/content/faq/resolvers';
import type { FaqSurfaceId } from '@/lib/content/faq/types';

type CoverageFinding = {
  surface: FaqSurfaceId;
  missingTopics: string[];
};

type AuditSummary = {
  totalEntries: number;
  byClaimClass: Record<string, number>;
  byStatus: Record<string, number>;
  byRisk: Record<string, number>;
  duplicateIds: string[];
  entriesMissingEvidence: string[];
  coverageFindings: CoverageFinding[];
  highRiskFailures: string[];
  staleTimeSensitive: Array<{ id: string; lastVerifiedAt: string; ageDays: number }>;
};

const MAX_TIME_SENSITIVE_AGE_DAYS = 45;

async function main() {
  const generatedAt = new Date().toISOString();
  const runDate = generatedAt.slice(0, 10);

  const artifactsDir = path.resolve(process.cwd(), '.artifacts', 'faq');
  const docsDir = path.resolve(process.cwd(), 'docs');
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  const summary = buildSummary(generatedAt);

  const registryJsonPath = path.join(artifactsDir, 'faq-registry.json');
  const matrixCsvPath = path.join(artifactsDir, 'faq-matrix.csv');
  const auditDocPath = path.join(docsDir, `faq-truth-audit-${runDate}.md`);

  writeFileSync(
    registryJsonPath,
    `${JSON.stringify(
      {
        generatedAt,
        auditDateBaseline: FAQ_AUDIT_DATE,
        summary,
        entries: FAQ_REGISTRY
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  writeFileSync(matrixCsvPath, renderCsv(), 'utf8');
  writeFileSync(auditDocPath, renderMarkdown(generatedAt, summary), 'utf8');

  console.log(`FAQ audit complete (${runDate})`);
  console.log(`- ${registryJsonPath}`);
  console.log(`- ${matrixCsvPath}`);
  console.log(`- ${auditDocPath}`);

  const hasBlockingFindings =
    summary.duplicateIds.length > 0 ||
    summary.highRiskFailures.length > 0 ||
    summary.coverageFindings.length > 0;

  if (hasBlockingFindings) {
    console.error('FAQ audit failed due to blocking findings. Review the generated markdown report for details.');
    process.exitCode = 1;
  }
}

function buildSummary(generatedAt: string): AuditSummary {
  const byClaimClass: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byRisk: Record<string, number> = {};

  for (const entry of FAQ_REGISTRY) {
    byClaimClass[entry.claimClass] = (byClaimClass[entry.claimClass] || 0) + 1;
    byStatus[entry.verificationStatus] = (byStatus[entry.verificationStatus] || 0) + 1;
    byRisk[entry.risk] = (byRisk[entry.risk] || 0) + 1;
  }

  const idCounts = new Map<string, number>();
  for (const entry of FAQ_REGISTRY) {
    idCounts.set(entry.id, (idCounts.get(entry.id) || 0) + 1);
  }

  const duplicateIds = [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();

  const entriesMissingEvidence = FAQ_REGISTRY.filter((entry) => entry.verificationSources.length === 0)
    .map((entry) => entry.id)
    .sort();

  const highRiskFailures = FAQ_REGISTRY.filter(
    (entry) => entry.risk === 'high' && (entry.verificationStatus === 'unverified' || entry.verificationStatus === 'contradicted')
  )
    .map((entry) => entry.id)
    .sort();

  const coverageFindings: CoverageFinding[] = [];
  for (const surface of FAQ_SURFACES) {
    const requiredTopics = FAQ_SURFACE_REQUIREMENTS[surface] || [];
    const topicSet = new Set(FAQ_REGISTRY.filter((entry) => entry.surfaces.includes(surface)).map((entry) => entry.topic));
    const missingTopics = requiredTopics.filter((topic) => !topicSet.has(topic));
    if (missingTopics.length > 0) {
      coverageFindings.push({ surface, missingTopics });
    }

    const renderedCount = getFaqEntriesForSurface(surface, { flightNumber: 9 }).length;
    if (renderedCount === 0) {
      coverageFindings.push({
        surface,
        missingTopics: ['surface_has_no_rendered_entries']
      });
    }
  }

  const staleTimeSensitive = FAQ_REGISTRY.filter((entry) => entry.claimClass === 'time_sensitive')
    .map((entry) => ({
      id: entry.id,
      lastVerifiedAt: entry.lastVerifiedAt,
      ageDays: calculateAgeDays(entry.lastVerifiedAt, generatedAt)
    }))
    .filter((entry) => entry.ageDays > MAX_TIME_SENSITIVE_AGE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);

  return {
    totalEntries: FAQ_REGISTRY.length,
    byClaimClass,
    byStatus,
    byRisk,
    duplicateIds,
    entriesMissingEvidence,
    coverageFindings,
    highRiskFailures,
    staleTimeSensitive
  };
}

function renderCsv() {
  const header = [
    'id',
    'question',
    'topic',
    'claim_class',
    'verification_status',
    'risk',
    'surfaces',
    'owner',
    'last_verified_at',
    'evidence_count'
  ];

  const rows = FAQ_REGISTRY.map((entry) => [
    entry.id,
    entry.question,
    entry.topic,
    entry.claimClass,
    entry.verificationStatus,
    entry.risk,
    entry.surfaces.join(' | '),
    entry.owner,
    entry.lastVerifiedAt,
    String(entry.verificationSources.length)
  ]);

  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderMarkdown(generatedAt: string, summary: AuditSummary) {
  const statusRows = objectRows(summary.byStatus);
  const classRows = objectRows(summary.byClaimClass);
  const riskRows = objectRows(summary.byRisk);

  const coverageTableRows = FAQ_SURFACES.map((surface) => {
    const entries = FAQ_REGISTRY.filter((entry) => entry.surfaces.includes(surface));
    const requiredTopics = FAQ_SURFACE_REQUIREMENTS[surface] || [];
    const topicSet = new Set(entries.map((entry) => entry.topic));
    const missing = requiredTopics.filter((topic) => !topicSet.has(topic));
    return `| ${surface} | ${entries.length} | ${requiredTopics.length} | ${missing.length ? missing.join(', ') : 'none'} |`;
  }).join('\n');

  const highRiskLines =
    summary.highRiskFailures.length > 0
      ? summary.highRiskFailures.map((id) => `- ${id}`).join('\n')
      : '- none';

  const duplicateLines = summary.duplicateIds.length > 0 ? summary.duplicateIds.map((id) => `- ${id}`).join('\n') : '- none';
  const evidenceLines =
    summary.entriesMissingEvidence.length > 0
      ? summary.entriesMissingEvidence.map((id) => `- ${id}`).join('\n')
      : '- none';
  const staleLines =
    summary.staleTimeSensitive.length > 0
      ? summary.staleTimeSensitive.map((entry) => `- ${entry.id}: ${entry.ageDays} days old`).join('\n')
      : '- none';

  const coverageFindingsLines =
    summary.coverageFindings.length > 0
      ? summary.coverageFindings
          .map((finding) => `- ${finding.surface}: missing ${finding.missingTopics.join(', ')}`)
          .join('\n')
      : '- none';

  return `# FAQ Truth Audit (${generatedAt.slice(0, 10)})

Generated at: ${generatedAt}
Baseline verification date in registry: ${FAQ_AUDIT_DATE}

## Scope
- Canonical FAQ registry truth metadata.
- Surface coverage checks against required topics.
- Blocking checks for high-risk unverified/contradicted claims.

## Summary
- Total entries: **${summary.totalEntries}**

### Verification Status
${statusRows}

### Claim Classes
${classRows}

### Risk Distribution
${riskRows}

## Coverage Matrix
| Surface | Entries | Required topics | Missing topics |
|---|---:|---:|---|
${coverageTableRows}

## Findings
### Blocking: High-risk unverified/contradicted
${highRiskLines}

### Blocking: Surface coverage gaps
${coverageFindingsLines}

### Integrity: Duplicate IDs
${duplicateLines}

### Integrity: Missing evidence references
${evidenceLines}

### Freshness: Stale time-sensitive entries (>${MAX_TIME_SENSITIVE_AGE_DAYS} days)
${staleLines}

## Enforcement Policy
- Block when any high-risk claim is marked unverified or contradicted.
- Block when required coverage topics are missing for a declared surface.
- Warn on stale time-sensitive entries and missing evidence references.

## Assumptions
- FAQ answers avoid hard launch-date promises and defer to live mission pages for changing timelines.
- Industry-standard FAQ quality is treated as a combination of factual traceability, surface coverage, and structured-data readiness.
`;
}

function calculateAgeDays(isoDate: string, generatedAt: string) {
  const from = Date.parse(isoDate);
  const to = Date.parse(generatedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function objectRows(record: Record<string, number>) {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '- none';
  return entries.map(([key, value]) => `- ${key}: **${value}**`).join('\n');
}

function csvCell(value: string) {
  const safe = String(value ?? '');
  if (!safe.includes(',') && !safe.includes('"') && !safe.includes('\n')) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error('FAQ audit failed', error);
  process.exitCode = 1;
});
