import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type SourceClass = 'nasa_primary' | 'oversight' | 'budget' | 'procurement' | 'technical' | 'media';
type SourceTier = 'tier1' | 'tier2';

type SourceCandidate = {
  key: string;
  label: string;
  url: string;
  sourceClass: SourceClass;
  tier: SourceTier;
  parserComplexity: 'low' | 'medium' | 'high';
  missionCoverage: number;
};

type SourceAuditResult = {
  key: string;
  label: string;
  url: string;
  sourceClass: SourceClass;
  tier: SourceTier;
  httpStatus: number;
  ok: boolean;
  latencyMs: number;
  lastModified: string | null;
  authorityScore: number;
  relevanceScore: number;
  freshnessScore: number;
  stabilityScore: number;
  riskScore: number;
  overallScore: number;
  accepted: boolean;
  notes: string;
};

const WEIGHTS = {
  authority: 0.45,
  relevance: 0.25,
  freshness: 0.15,
  stability: 0.1,
  risk: 0.05
} as const;

const AUTHORITY_ACCEPT_THRESHOLD = 0.8;
const OVERALL_ACCEPT_THRESHOLD = 0.76;

const CANDIDATES: SourceCandidate[] = [
  {
    key: 'nasa_rss',
    label: 'NASA Artemis RSS',
    url: 'https://www.nasa.gov/missions/artemis/feed/',
    sourceClass: 'nasa_primary',
    tier: 'tier1',
    parserComplexity: 'low',
    missionCoverage: 0.92
  },
  {
    key: 'nasa_campaign_pages',
    label: 'NASA Artemis campaign page',
    url: 'https://www.nasa.gov/artemis',
    sourceClass: 'nasa_primary',
    tier: 'tier1',
    parserComplexity: 'medium',
    missionCoverage: 0.94
  },
  {
    key: 'nasa_media_assets',
    label: 'NASA Images API',
    url: 'https://images-api.nasa.gov/search?q=Artemis&media_type=image&page=1',
    sourceClass: 'media',
    tier: 'tier1',
    parserComplexity: 'medium',
    missionCoverage: 0.88
  },
  {
    key: 'oig_reports',
    label: 'NASA OIG audits',
    url: 'https://oig.nasa.gov/audits/',
    sourceClass: 'oversight',
    tier: 'tier1',
    parserComplexity: 'medium',
    missionCoverage: 0.82
  },
  {
    key: 'gao_reports',
    label: 'GAO search',
    url: 'https://www.gao.gov/search?search_api_fulltext=artemis',
    sourceClass: 'oversight',
    tier: 'tier2',
    parserComplexity: 'high',
    missionCoverage: 0.76
  },
  {
    key: 'usaspending_awards',
    label: 'USASpending API',
    url: 'https://api.usaspending.gov/docs/',
    sourceClass: 'procurement',
    tier: 'tier1',
    parserComplexity: 'medium',
    missionCoverage: 0.79
  }
];

async function main() {
  const startedAt = new Date().toISOString();
  const results = await Promise.all(CANDIDATES.map((candidate) => auditCandidate(candidate)));
  const accepted = results.filter((entry) => entry.accepted);

  const output = {
    generatedAt: startedAt,
    weights: WEIGHTS,
    thresholds: {
      authority: AUTHORITY_ACCEPT_THRESHOLD,
      overall: OVERALL_ACCEPT_THRESHOLD
    },
    summary: {
      total: results.length,
      accepted: accepted.length,
      rejected: results.length - accepted.length
    },
    results
  };

  const artifactsDir = path.resolve(process.cwd(), '.artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const jsonPath = path.join(artifactsDir, 'artemis-source-option-audit.json');
  const markdownPath = path.join(artifactsDir, 'artemis-source-option-audit.md');

  writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderMarkdown(output), 'utf8');

  console.log(`Artemis source audit complete: ${accepted.length}/${results.length} accepted`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);
}

async function auditCandidate(candidate: SourceCandidate): Promise<SourceAuditResult> {
  const started = Date.now();

  try {
    const response = await fetch(candidate.url, {
      headers: {
        'User-Agent': 'TMinusZero/0.1 (+https://tminusnow.app)',
        Accept: 'text/html,application/xhtml+xml,application/xml,application/json,*/*'
      }
    });

    const latencyMs = Date.now() - started;
    const authorityScore = authorityScoreFor(candidate);
    const relevanceScore = clamp(candidate.missionCoverage);
    const freshnessScore = freshnessScoreFromLastModified(response.headers.get('last-modified'));
    const stabilityScore = stabilityScoreFromResponse(response.ok, response.status, latencyMs);
    const riskScore = riskScoreForComplexity(candidate.parserComplexity);
    const overallScore = overallScoreFrom({ authorityScore, relevanceScore, freshnessScore, stabilityScore, riskScore });
    const accepted = authorityScore >= AUTHORITY_ACCEPT_THRESHOLD && overallScore >= OVERALL_ACCEPT_THRESHOLD;

    return {
      key: candidate.key,
      label: candidate.label,
      url: candidate.url,
      sourceClass: candidate.sourceClass,
      tier: candidate.tier,
      httpStatus: response.status,
      ok: response.ok,
      latencyMs,
      lastModified: response.headers.get('last-modified'),
      authorityScore,
      relevanceScore,
      freshnessScore,
      stabilityScore,
      riskScore,
      overallScore,
      accepted,
      notes: accepted ? 'Meets authority + overall thresholds.' : 'Fails authority and/or weighted overall threshold.'
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const authorityScore = authorityScoreFor(candidate);
    const relevanceScore = clamp(candidate.missionCoverage);
    const freshnessScore = 0.25;
    const stabilityScore = 0.1;
    const riskScore = riskScoreForComplexity(candidate.parserComplexity);
    const overallScore = overallScoreFrom({ authorityScore, relevanceScore, freshnessScore, stabilityScore, riskScore });

    return {
      key: candidate.key,
      label: candidate.label,
      url: candidate.url,
      sourceClass: candidate.sourceClass,
      tier: candidate.tier,
      httpStatus: 0,
      ok: false,
      latencyMs,
      lastModified: null,
      authorityScore,
      relevanceScore,
      freshnessScore,
      stabilityScore,
      riskScore,
      overallScore,
      accepted: false,
      notes: `Fetch failed: ${(error as Error).message}`
    };
  }
}

function authorityScoreFor(candidate: SourceCandidate) {
  if (candidate.sourceClass === 'nasa_primary') return 0.98;
  if (candidate.sourceClass === 'oversight') return candidate.tier === 'tier1' ? 0.95 : 0.88;
  if (candidate.sourceClass === 'budget') return 0.94;
  if (candidate.sourceClass === 'procurement') return 0.92;
  if (candidate.sourceClass === 'media') return 0.9;
  return candidate.tier === 'tier1' ? 0.86 : 0.62;
}

function freshnessScoreFromLastModified(value: string | null) {
  if (!value) return 0.5;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return 0.5;

  const ageHours = Math.max(0, (Date.now() - parsed) / 3_600_000);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.78;
  if (ageHours <= 168) return 0.64;
  if (ageHours <= 720) return 0.48;
  return 0.34;
}

function stabilityScoreFromResponse(ok: boolean, status: number, latencyMs: number) {
  if (!ok) {
    if (status >= 500) return 0.2;
    if (status === 429) return 0.3;
    return 0.35;
  }

  if (latencyMs <= 800) return 0.95;
  if (latencyMs <= 1800) return 0.86;
  if (latencyMs <= 3500) return 0.75;
  return 0.6;
}

function riskScoreForComplexity(level: SourceCandidate['parserComplexity']) {
  if (level === 'low') return 0.95;
  if (level === 'medium') return 0.78;
  return 0.58;
}

function overallScoreFrom({
  authorityScore,
  relevanceScore,
  freshnessScore,
  stabilityScore,
  riskScore
}: {
  authorityScore: number;
  relevanceScore: number;
  freshnessScore: number;
  stabilityScore: number;
  riskScore: number;
}) {
  return clamp(
    authorityScore * WEIGHTS.authority +
      relevanceScore * WEIGHTS.relevance +
      freshnessScore * WEIGHTS.freshness +
      stabilityScore * WEIGHTS.stability +
      riskScore * WEIGHTS.risk
  );
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function renderMarkdown(output: {
  generatedAt: string;
  weights: typeof WEIGHTS;
  thresholds: { authority: number; overall: number };
  summary: { total: number; accepted: number; rejected: number };
  results: SourceAuditResult[];
}) {
  const lines: string[] = [];
  lines.push('# Artemis Source Option Audit');
  lines.push('');
  lines.push(`Generated at: ${output.generatedAt}`);
  lines.push('');
  lines.push('## Thresholds');
  lines.push('');
  lines.push(`- Authority minimum: ${Math.round(output.thresholds.authority * 100)}%`);
  lines.push(`- Overall minimum: ${Math.round(output.thresholds.overall * 100)}%`);
  lines.push('');
  lines.push('## Weights');
  lines.push('');
  lines.push(`- Authority: ${Math.round(output.weights.authority * 100)}%`);
  lines.push(`- Relevance: ${Math.round(output.weights.relevance * 100)}%`);
  lines.push(`- Freshness: ${Math.round(output.weights.freshness * 100)}%`);
  lines.push(`- Stability: ${Math.round(output.weights.stability * 100)}%`);
  lines.push(`- Risk: ${Math.round(output.weights.risk * 100)}%`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total options: ${output.summary.total}`);
  lines.push(`- Accepted: ${output.summary.accepted}`);
  lines.push(`- Rejected: ${output.summary.rejected}`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Key | Class | Tier | HTTP | Overall | Accepted | Notes |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  for (const result of output.results) {
    lines.push(
      `| ${result.key} | ${result.sourceClass} | ${result.tier} | ${result.httpStatus || 'ERR'} | ${Math.round(result.overallScore * 100)}% | ${result.accepted ? 'yes' : 'no'} | ${result.notes} |`
    );
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

void main().catch((error) => {
  console.error('Artemis source option audit failed', error);
  process.exit(1);
});
