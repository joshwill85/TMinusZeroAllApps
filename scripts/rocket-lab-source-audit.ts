import { z } from 'zod';
import {
  ROCKET_LAB_SOURCE_URLS,
  evaluateRocketLabPageSignals,
  extractRocketLabCandidateLinks,
  fetchTextWithMeta,
  readJsonFile,
  writeJson,
  writeText,
  type CandidateLink,
  type FetchTextResult
} from './rocket-lab-source-audit-lib';

type AdmissionSignal = 'yes' | 'partial' | 'no';
type AdmissionDecision = 'pass' | 'defer' | 'reject';

type CliArgs = {
  fixtureJsonPath: string | null;
  outputPath: string;
  markdownPath: string;
  sampleLimit: number;
  retries: number;
  backoffMs: number;
  timeoutMs: number;
  quiet: boolean;
  json: boolean;
};

type SeedPageReport = {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  finalUrl: string | null;
  challenge: boolean;
  error: string | null;
  pageCandidates: number;
  pdfCandidates: number;
};

type SampledPageReport = {
  url: string;
  ok: boolean;
  status: number;
  contentType: string | null;
  finalUrl: string | null;
  challenge: boolean;
  error: string | null;
  slug: string | null;
  hasTrajectorySignals: boolean;
  orbitSignalCount: number;
  milestoneSignalCount: number;
  recoverySignalCount: number;
  numericOrbitSignalCount: number;
  matchedKeywords: string[];
};

type AdmissionReport = {
  generatedAt: string;
  mode: 'live' | 'fixture';
  fixtureJsonPath: string | null;
  decision: AdmissionDecision;
  availability: AdmissionSignal;
  joinability: AdmissionSignal;
  usableCoverage: AdmissionSignal;
  summary: {
    seedPagesChecked: number;
    seedPagesAvailable: number;
    candidatePageCount: number;
    candidatePdfCount: number;
    sampledPagesChecked: number;
    sampledPagesAvailable: number;
    launchSpecificSlugCount: number;
    pagesWithTrajectorySignals: number;
    pagesWithOrbitSignals: number;
    pagesWithMilestoneSignals: number;
    pagesWithRecoverySignals: number;
    pagesWithNumericOrbitSignals: number;
  };
  reasons: string[];
  seedPages: SeedPageReport[];
  candidatePages: string[];
  candidatePdfs: string[];
  sampledPages: SampledPageReport[];
};

const fixtureIndexCaseSchema = z.object({
  sourceUrl: z.string(),
  html: z.string()
});

const fixturePageCaseSchema = z.object({
  url: z.string(),
  html: z.string()
});

const fixtureSchema = z.object({
  indexCases: z.array(fixtureIndexCaseSchema).default([]),
  pageCases: z.array(fixturePageCaseSchema).default([])
});

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    fixtureJsonPath: value('--fixture-json=') || null,
    outputPath: value('--output=') || '.artifacts/rocket-lab-source-audit.json',
    markdownPath: value('--markdown=') || '.artifacts/rocket-lab-source-audit.md',
    sampleLimit: clampInt(Number(value('--sample-limit=') || 8), 1, 20),
    retries: clampInt(Number(value('--retries=') || 2), 1, 6),
    backoffMs: clampInt(Number(value('--backoff-ms=') || 900), 200, 20_000),
    timeoutMs: clampInt(Number(value('--timeout-ms=') || 20_000), 1_000, 60_000),
    quiet: args.includes('--quiet'),
    json: args.includes('--json')
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.fixtureJsonPath ? 'fixture' : 'live';
  const fixture = args.fixtureJsonPath ? fixtureSchema.parse(readJsonFile(args.fixtureJsonPath)) : null;

  const seedFetches = fixture
    ? fixture.indexCases.map((page) => buildFixtureFetch(page.sourceUrl, page.html))
    : await Promise.all(
        Object.values(ROCKET_LAB_SOURCE_URLS).map((url) =>
          fetchTextWithMeta(url, {
            retries: args.retries,
            backoffMs: args.backoffMs,
            timeoutMs: args.timeoutMs
          })
        )
      );

  const candidates = collectCandidates(seedFetches);
  const candidatePages = candidates.filter((candidate) => candidate.kind === 'page');
  const candidatePdfs = candidates.filter((candidate) => candidate.kind === 'pdf');

  const sampledFetches = fixture
    ? fixture.pageCases.slice(0, args.sampleLimit).map((page) => buildFixtureFetch(page.url, page.html))
    : await Promise.all(
        candidatePages
          .slice(0, args.sampleLimit)
          .map((candidate) =>
            fetchTextWithMeta(candidate.url, {
              retries: args.retries,
              backoffMs: args.backoffMs,
              timeoutMs: args.timeoutMs
            })
          )
      );

  const report = buildReport({
    mode,
    fixtureJsonPath: args.fixtureJsonPath,
    seedFetches,
    candidates,
    sampledFetches
  });

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('Rocket Lab source audit');
    console.log(`Decision: ${report.decision}`);
    console.log(
      `Summary: seedPages=${report.summary.seedPagesAvailable}/${report.summary.seedPagesChecked} candidatePages=${report.summary.candidatePageCount} candidatePdfs=${report.summary.candidatePdfCount} sampledPages=${report.summary.sampledPagesAvailable}/${report.summary.sampledPagesChecked}`
    );
    console.log(`Wrote report: ${args.outputPath}`);
    console.log(`Wrote markdown: ${args.markdownPath}`);
  }
}

function buildReport(input: {
  mode: 'live' | 'fixture';
  fixtureJsonPath: string | null;
  seedFetches: FetchTextResult[];
  candidates: CandidateLink[];
  sampledFetches: FetchTextResult[];
}): AdmissionReport {
  const seedPageReports = input.seedFetches.map((fetch) => {
    const extracted = fetch.ok ? extractRocketLabCandidateLinks(fetch.text, fetch.finalUrl || fetch.url) : [];
    return {
      url: fetch.url,
      ok: fetch.ok,
      status: fetch.status,
      contentType: fetch.contentType,
      finalUrl: fetch.finalUrl,
      challenge: fetch.challenge,
      error: fetch.error,
      pageCandidates: extracted.filter((candidate) => candidate.kind === 'page').length,
      pdfCandidates: extracted.filter((candidate) => candidate.kind === 'pdf').length
    };
  });

  const sampledPageReports = input.sampledFetches.map((fetch) => {
    const signals = fetch.ok ? evaluateRocketLabPageSignals(fetch.finalUrl || fetch.url, fetch.text) : emptySignals(fetch.finalUrl || fetch.url);
    return {
      url: fetch.url,
      ok: fetch.ok,
      status: fetch.status,
      contentType: fetch.contentType,
      finalUrl: fetch.finalUrl,
      challenge: fetch.challenge,
      error: fetch.error,
      ...signals
    };
  });

  const seedPagesChecked = seedPageReports.length;
  const seedPagesAvailable = seedPageReports.filter((page) => page.ok).length;
  const sampledPagesChecked = sampledPageReports.length;
  const sampledPagesAvailable = sampledPageReports.filter((page) => page.ok).length;
  const launchSpecificSlugCount = sampledPageReports.filter((page) => page.ok && page.slug).length;
  const pagesWithTrajectorySignals = sampledPageReports.filter((page) => page.ok && page.hasTrajectorySignals).length;
  const pagesWithOrbitSignals = sampledPageReports.filter((page) => page.ok && page.orbitSignalCount > 0).length;
  const pagesWithMilestoneSignals = sampledPageReports.filter((page) => page.ok && page.milestoneSignalCount > 0).length;
  const pagesWithRecoverySignals = sampledPageReports.filter((page) => page.ok && page.recoverySignalCount > 0).length;
  const pagesWithNumericOrbitSignals = sampledPageReports.filter((page) => page.ok && page.numericOrbitSignalCount > 0).length;

  const candidatePages = input.candidates.filter((candidate) => candidate.kind === 'page');
  const candidatePdfs = input.candidates.filter((candidate) => candidate.kind === 'pdf');
  const candidatePageCount = candidatePages.length;
  const candidatePdfCount = candidatePdfs.length;

  let availability: AdmissionSignal = 'no';
  if (seedPagesAvailable > 0) {
    availability =
      seedPagesAvailable === seedPagesChecked && candidatePageCount + candidatePdfCount > 0
        ? 'yes'
        : 'partial';
  }

  const joinability: AdmissionSignal = candidatePageCount + candidatePdfCount > 0 && launchSpecificSlugCount > 0 ? 'partial' : 'no';
  const usableCoverage: AdmissionSignal = 'no';

  const reasons: string[] = [];
  reasons.push(
    `Availability is ${availability}: ${seedPagesAvailable}/${seedPagesChecked} seed pages loaded and exposed ${candidatePageCount} same-host page candidates plus ${candidatePdfCount} same-host PDF candidates.`
  );
  reasons.push(
    joinability === 'partial'
      ? `Joinability is partial because the sampled docs expose stable first-party slugs, but there is still no deterministic proof that those docs map cleanly onto T-Minus Zero launch identity for the current launch inventory.`
      : `Joinability is not proven because the sample did not produce enough stable launch-specific docs to test against launch identity.`
  );
  reasons.push(
    `Usable coverage stays "no" because this source-sample audit does not yet prove direction, milestone, recovery, or visibility values across real T-Minus Zero launches.`
  );
  if (sampledPagesAvailable > 0) {
    reasons.push(
      `Trajectory-related language appeared on ${pagesWithTrajectorySignals}/${sampledPagesAvailable} sampled pages, with orbit signals on ${pagesWithOrbitSignals}, milestone signals on ${pagesWithMilestoneSignals}, recovery signals on ${pagesWithRecoverySignals}, and numeric orbit-like language on ${pagesWithNumericOrbitSignals}.`
    );
  }
  const blockedSeedPages = seedPageReports.filter((page) => page.challenge || page.status === 403 || page.status === 429).length;
  if (blockedSeedPages > 0) {
    reasons.push(`Source health is not clean: ${blockedSeedPages} seed pages returned challenge-like or throttled responses.`);
  }

  const decision: AdmissionDecision = availability === 'no' ? 'reject' : 'defer';

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    fixtureJsonPath: input.fixtureJsonPath,
    decision,
    availability,
    joinability,
    usableCoverage,
    summary: {
      seedPagesChecked,
      seedPagesAvailable,
      candidatePageCount,
      candidatePdfCount,
      sampledPagesChecked,
      sampledPagesAvailable,
      launchSpecificSlugCount,
      pagesWithTrajectorySignals,
      pagesWithOrbitSignals,
      pagesWithMilestoneSignals,
      pagesWithRecoverySignals,
      pagesWithNumericOrbitSignals
    },
    reasons,
    seedPages: seedPageReports,
    candidatePages: candidatePages.map((candidate) => candidate.url),
    candidatePdfs: candidatePdfs.map((candidate) => candidate.url),
    sampledPages: sampledPageReports
  };
}

function collectCandidates(seedFetches: FetchTextResult[]) {
  const deduped = new Map<string, CandidateLink>();
  for (const fetch of seedFetches) {
    if (!fetch.ok) continue;
    for (const candidate of extractRocketLabCandidateLinks(fetch.text, fetch.finalUrl || fetch.url)) {
      if (!deduped.has(candidate.url)) deduped.set(candidate.url, candidate);
    }
  }
  return [...deduped.values()].sort((a, b) => {
    const rankDiff = candidateRank(a) - candidateRank(b);
    if (rankDiff !== 0) return rankDiff;
    return a.url.localeCompare(b.url);
  });
}

function buildFixtureFetch(url: string, text: string): FetchTextResult {
  return {
    url,
    ok: true,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    finalUrl: url,
    attemptCount: 1,
    challenge: false,
    error: null,
    text
  };
}

function candidateRank(candidate: CandidateLink) {
  if (candidate.kind === 'pdf') return 100;
  try {
    const pathname = new URL(candidate.url).pathname.toLowerCase();
    if (pathname.startsWith('/missions/launches/')) return 0;
    if (pathname.startsWith('/updates/mission-success')) return 1;
    if (pathname.startsWith('/updates/') && pathname.includes('launch')) return 2;
    if (pathname.startsWith('/updates/')) return 3;
    if (pathname.startsWith('/missions/')) return 4;
    return 5;
  } catch {
    return 6;
  }
}

function emptySignals(url: string) {
  return {
    ...evaluateRocketLabPageSignals(url, ''),
    hasTrajectorySignals: false,
    orbitSignalCount: 0,
    milestoneSignalCount: 0,
    recoverySignalCount: 0,
    numericOrbitSignalCount: 0,
    matchedKeywords: []
  };
}

function buildMarkdown(report: AdmissionReport) {
  const lines: string[] = [];
  lines.push('# Rocket Lab Source Audit');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- fixtureJsonPath: ${report.fixtureJsonPath ?? '—'}`);
  lines.push(`- decision: ${report.decision}`);
  lines.push(`- availability: ${report.availability}`);
  lines.push(`- joinability: ${report.joinability}`);
  lines.push(`- usableCoverage: ${report.usableCoverage}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- seedPagesAvailable=${report.summary.seedPagesAvailable}/${report.summary.seedPagesChecked}`);
  lines.push(`- candidatePages=${report.summary.candidatePageCount}`);
  lines.push(`- candidatePdfs=${report.summary.candidatePdfCount}`);
  lines.push(`- sampledPagesAvailable=${report.summary.sampledPagesAvailable}/${report.summary.sampledPagesChecked}`);
  lines.push(`- launchSpecificSlugs=${report.summary.launchSpecificSlugCount}`);
  lines.push(`- pagesWithTrajectorySignals=${report.summary.pagesWithTrajectorySignals}`);
  lines.push(`- pagesWithOrbitSignals=${report.summary.pagesWithOrbitSignals}`);
  lines.push(`- pagesWithMilestoneSignals=${report.summary.pagesWithMilestoneSignals}`);
  lines.push(`- pagesWithRecoverySignals=${report.summary.pagesWithRecoverySignals}`);
  lines.push(`- pagesWithNumericOrbitSignals=${report.summary.pagesWithNumericOrbitSignals}`);
  lines.push('');
  lines.push('## Reasons');
  lines.push('');
  for (const reason of report.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Seed Pages');
  lines.push('');
  lines.push('| URL | Status | Page candidates | PDF candidates | Error |');
  lines.push('|---|---:|---:|---:|---|');
  for (const page of report.seedPages) {
    lines.push(`| ${page.url} | ${page.status} | ${page.pageCandidates} | ${page.pdfCandidates} | ${page.error ?? '—'} |`);
  }
  lines.push('');
  lines.push('## Sampled Pages');
  lines.push('');
  lines.push('| URL | Status | Slug | Orbit | Milestone | Recovery | Numeric orbit | Keywords |');
  lines.push('|---|---:|---|---:|---:|---:|---:|---|');
  if (!report.sampledPages.length) {
    lines.push('| — | 0 | — | 0 | 0 | 0 | 0 | — |');
  } else {
    for (const page of report.sampledPages) {
      lines.push(
        `| ${page.url} | ${page.status} | ${page.slug ?? '—'} | ${page.orbitSignalCount} | ${page.milestoneSignalCount} | ${page.recoverySignalCount} | ${page.numericOrbitSignalCount} | ${page.matchedKeywords.join(', ') || '—'} |`
      );
    }
  }
  lines.push('');
  lines.push('## Candidate Pages');
  lines.push('');
  if (!report.candidatePages.length) {
    lines.push('- none');
  } else {
    for (const url of report.candidatePages) {
      lines.push(`- ${url}`);
    }
  }
  lines.push('');
  lines.push('## Candidate PDFs');
  lines.push('');
  if (!report.candidatePdfs.length) {
    lines.push('- none');
  } else {
    for (const url of report.candidatePdfs) {
      lines.push(`- ${url}`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
