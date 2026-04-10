import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  ROCKET_LAB_SOURCE_URLS,
  classifyRocketLabCandidateMatches,
  evaluateRocketLabPageSignals,
  extractRocketLabCandidateLinks,
  fetchTextWithMeta,
  readJsonFile,
  sortRocketLabCandidates,
  writeJson,
  writeText,
  type FetchTextResult,
  type RocketLabJoinStatus,
  type RocketLabLaunchLike
} from './rocket-lab-source-audit-lib';

config({ path: '.env.local' });
config();

type AdmissionSignal = 'yes' | 'partial' | 'no';
type AdmissionDecision = 'pass' | 'defer' | 'reject';

type CliArgs = {
  fixtureJsonPath: string | null;
  sourceAuditJsonPath: string | null;
  outputPath: string;
  markdownPath: string;
  lookbackDays: number;
  lookaheadDays: number;
  launchLimit: number;
  matchedFetchLimit: number;
  retries: number;
  backoffMs: number;
  timeoutMs: number;
  quiet: boolean;
  json: boolean;
};

type RocketLabLaunchRow = RocketLabLaunchLike;

type CandidatePageFixture = {
  url: string;
  html: string | null;
};

type JoinReportLaunch = {
  launchId: string;
  name: string | null;
  missionName: string | null;
  net: string | null;
  vehicle: string | null;
  statusName: string | null;
  matchStatus: RocketLabJoinStatus;
  bestMatchUrl: string | null;
  bestMatchScore: number | null;
  matchedAlias: string | null;
  aliases: string[];
  reasons: string[];
  candidateUrls: string[];
  matchedPageSignals: {
    hasTrajectorySignals: boolean;
    orbitSignalCount: number;
    milestoneSignalCount: number;
    recoverySignalCount: number;
    numericOrbitSignalCount: number;
    matchedKeywords: string[];
  } | null;
};

type JoinAuditReport = {
  generatedAt: string;
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  sourceAuditJsonPath: string | null;
  decision: AdmissionDecision;
  availability: AdmissionSignal;
  joinability: AdmissionSignal;
  usableCoverage: AdmissionSignal;
  summary: {
    launchesScanned: number;
    candidatePagesScanned: number;
    launchesWithDeterministicMatch: number;
    launchesWithProbableMatch: number;
    launchesWithAmbiguousMatch: number;
    launchesWithoutMatch: number;
    launchesWithMatchedTrajectorySignals: number;
    launchesWithMatchedOrbitSignals: number;
    launchesWithMatchedMilestoneSignals: number;
    launchesWithMatchedRecoverySignals: number;
    launchesWithMatchedNumericOrbitSignals: number;
  };
  reasons: string[];
  launches: JoinReportLaunch[];
};

const launchRowSchema = z.object({
  launchId: z.string(),
  name: z.string().nullable(),
  missionName: z.string().nullable(),
  net: z.string().nullable(),
  provider: z.string().nullable(),
  vehicle: z.string().nullable(),
  statusName: z.string().nullable()
});

const fixtureSchema = z.object({
  launches: z.array(launchRowSchema).default([]),
  candidatePages: z.array(z.object({ url: z.string(), html: z.string().nullable().optional() })).default([])
});

const sourceAuditSchema = z.object({
  candidatePages: z.array(z.string()).default([])
});

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    fixtureJsonPath: value('--fixture-json=') || null,
    sourceAuditJsonPath: value('--source-audit-json=') || null,
    outputPath: value('--output=') || '.artifacts/rocket-lab-join-audit.json',
    markdownPath: value('--markdown=') || '.artifacts/rocket-lab-join-audit.md',
    lookbackDays: clampInt(Number(value('--lookback-days=') || 30), 0, 365),
    lookaheadDays: clampInt(Number(value('--lookahead-days=') || 365), 1, 730),
    launchLimit: clampInt(Number(value('--launch-limit=') || 40), 1, 200),
    matchedFetchLimit: clampInt(Number(value('--matched-fetch-limit=') || 20), 1, 100),
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
  const launches = fixture ? fixture.launches : await loadRocketLabLaunches(args);
  const candidatePages = fixture ? fixture.candidatePages : await loadRocketLabCandidatePages(args);

  const candidateUrls = candidatePages.map((page) => page.url);
  const seededPageHtml = new Map(
    candidatePages.filter((page) => typeof page.html === 'string' && page.html.trim().length > 0).map((page) => [page.url, page.html || ''])
  );

  const preliminary = launches.map((launch) => {
    const join = classifyRocketLabCandidateMatches(launch, candidateUrls);
    return {
      launch,
      join
    };
  });

  const urlsToFetch = [...new Set(
    preliminary
      .filter((item) => item.join.status === 'deterministic' || item.join.status === 'probable')
      .map((item) => item.join.bestMatchUrl)
      .filter((value): value is string => Boolean(value))
      .slice(0, args.matchedFetchLimit)
  )];

  const fetchedHtmlByUrl = new Map<string, string>();
  for (const [url, html] of seededPageHtml.entries()) {
    fetchedHtmlByUrl.set(url, html);
  }

  if (!fixture) {
    const liveFetches = await Promise.all(
      urlsToFetch
        .filter((url) => !fetchedHtmlByUrl.has(url))
        .map((url) =>
          fetchTextWithMeta(url, {
            retries: args.retries,
            backoffMs: args.backoffMs,
            timeoutMs: args.timeoutMs
          })
        )
    );

    for (const fetch of liveFetches) {
      if (fetch.ok) fetchedHtmlByUrl.set(fetch.url, fetch.text);
    }
  }

  const launchesReport: JoinReportLaunch[] = preliminary.map(({ launch, join }) => {
    const matchedHtml = join.bestMatchUrl ? fetchedHtmlByUrl.get(join.bestMatchUrl) || null : null;
    const signals = matchedHtml && join.bestMatchUrl ? evaluateRocketLabPageSignals(join.bestMatchUrl, matchedHtml) : null;
    return {
      launchId: launch.launchId,
      name: launch.name,
      missionName: launch.missionName,
      net: launch.net,
      vehicle: launch.vehicle,
      statusName: launch.statusName,
      matchStatus: join.status,
      bestMatchUrl: join.bestMatchUrl,
      bestMatchScore: join.bestMatchScore,
      matchedAlias: join.matchedAlias,
      aliases: join.aliases,
      reasons: join.reasons,
      candidateUrls: join.candidates.map((candidate) => candidate.url),
      matchedPageSignals: signals
        ? {
            hasTrajectorySignals: signals.hasTrajectorySignals,
            orbitSignalCount: signals.orbitSignalCount,
            milestoneSignalCount: signals.milestoneSignalCount,
            recoverySignalCount: signals.recoverySignalCount,
            numericOrbitSignalCount: signals.numericOrbitSignalCount,
            matchedKeywords: signals.matchedKeywords
          }
        : null
    };
  });

  const report = buildReport({
    mode,
    fixtureJsonPath: args.fixtureJsonPath,
    sourceAuditJsonPath: args.sourceAuditJsonPath,
    candidatePageCount: candidateUrls.length,
    launches: launchesReport
  });

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('Rocket Lab join audit');
    console.log(`Decision: ${report.decision}`);
    console.log(
      `Summary: launches=${report.summary.launchesScanned} deterministic=${report.summary.launchesWithDeterministicMatch} probable=${report.summary.launchesWithProbableMatch} ambiguous=${report.summary.launchesWithAmbiguousMatch} none=${report.summary.launchesWithoutMatch}`
    );
    console.log(`Wrote report: ${args.outputPath}`);
    console.log(`Wrote markdown: ${args.markdownPath}`);
  }
}

async function loadRocketLabLaunches(args: CliArgs): Promise<RocketLabLaunchRow[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase env (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const fromIso = new Date(Date.now() - args.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(Date.now() + args.lookaheadDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('launches_public_cache')
    .select('launch_id,name,mission_name,net,provider,vehicle,status_name')
    .ilike('provider', '%Rocket Lab%')
    .gte('net', fromIso)
    .lte('net', toIso)
    .order('net', { ascending: true })
    .limit(args.launchLimit);

  if (error) throw error;

  return ((data || []) as Array<Record<string, unknown>>)
    .map((row) => ({
      launchId: asString(row.launch_id) || '',
      name: asNullableString(row.name),
      missionName: asNullableString(row.mission_name),
      net: asNullableString(row.net),
      provider: asNullableString(row.provider),
      vehicle: asNullableString(row.vehicle),
      statusName: asNullableString(row.status_name)
    }))
    .filter((row) => row.launchId);
}

async function loadRocketLabCandidatePages(args: CliArgs): Promise<CandidatePageFixture[]> {
  if (args.sourceAuditJsonPath) {
    const audit = sourceAuditSchema.parse(readJsonFile(args.sourceAuditJsonPath));
    return audit.candidatePages.map((url) => ({ url, html: null }));
  }

  const seedFetches = await Promise.all(
    Object.values(ROCKET_LAB_SOURCE_URLS).map((url) =>
      fetchTextWithMeta(url, {
        retries: args.retries,
        backoffMs: args.backoffMs,
        timeoutMs: args.timeoutMs
      })
    )
  );

  const deduped = new Map<string, { url: string; html: string | null }>();
  for (const fetch of seedFetches) {
    if (!fetch.ok) continue;
    const candidates = sortRocketLabCandidates(extractRocketLabCandidateLinks(fetch.text, fetch.finalUrl || fetch.url));
    for (const candidate of candidates) {
      if (candidate.kind !== 'page') continue;
      if (!deduped.has(candidate.url)) {
        deduped.set(candidate.url, { url: candidate.url, html: null });
      }
    }
  }

  return [...deduped.values()];
}

function buildReport(input: {
  mode: 'fixture' | 'live';
  fixtureJsonPath: string | null;
  sourceAuditJsonPath: string | null;
  candidatePageCount: number;
  launches: JoinReportLaunch[];
}): JoinAuditReport {
  const launchesWithDeterministicMatch = input.launches.filter((launch) => launch.matchStatus === 'deterministic').length;
  const launchesWithProbableMatch = input.launches.filter((launch) => launch.matchStatus === 'probable').length;
  const launchesWithAmbiguousMatch = input.launches.filter((launch) => launch.matchStatus === 'ambiguous').length;
  const launchesWithoutMatch = input.launches.filter((launch) => launch.matchStatus === 'none').length;
  const launchesWithMatchedTrajectorySignals = input.launches.filter((launch) => launch.matchedPageSignals?.hasTrajectorySignals).length;
  const launchesWithMatchedOrbitSignals = input.launches.filter((launch) => (launch.matchedPageSignals?.orbitSignalCount || 0) > 0).length;
  const launchesWithMatchedMilestoneSignals = input.launches.filter((launch) => (launch.matchedPageSignals?.milestoneSignalCount || 0) > 0).length;
  const launchesWithMatchedRecoverySignals = input.launches.filter((launch) => (launch.matchedPageSignals?.recoverySignalCount || 0) > 0).length;
  const launchesWithMatchedNumericOrbitSignals = input.launches.filter(
    (launch) => (launch.matchedPageSignals?.numericOrbitSignalCount || 0) > 0
  ).length;

  const launchesScanned = input.launches.length;
  const deterministicCoverage = safeRate(launchesWithDeterministicMatch, launchesScanned);
  const joinableCoverage = safeRate(launchesWithDeterministicMatch + launchesWithProbableMatch, launchesScanned);
  const ambiguousRate = safeRate(launchesWithAmbiguousMatch, launchesScanned);

  const availability: AdmissionSignal = input.candidatePageCount > 0 ? 'yes' : 'no';
  let joinability: AdmissionSignal = 'no';
  if (typeof deterministicCoverage === 'number' && typeof ambiguousRate === 'number') {
    if (deterministicCoverage >= 0.75 && ambiguousRate <= 0.1) joinability = 'yes';
    else if ((joinableCoverage ?? 0) > 0 || launchesWithAmbiguousMatch > 0) joinability = 'partial';
  }
  const usableCoverage: AdmissionSignal = 'no';
  const decision: AdmissionDecision = availability === 'no' ? 'reject' : 'defer';

  const reasons: string[] = [];
  reasons.push(
    `Candidate availability is ${availability}: ${input.candidatePageCount} Rocket Lab mission/update pages were available for join scoring against ${launchesScanned} bounded inventory launches.`
  );
  reasons.push(
    `Joinability is ${joinability}: ${launchesWithDeterministicMatch}/${launchesScanned} launches matched deterministically, ${launchesWithProbableMatch}/${launchesScanned} matched probably, ${launchesWithAmbiguousMatch}/${launchesScanned} remained ambiguous, and ${launchesWithoutMatch}/${launchesScanned} had no qualifying match.`
  );
  reasons.push(
    `Usable coverage stays "no" because this audit only proves candidate-page joins; it does not prove that enough matched launches expose direction, milestone, recovery, or visibility values at rollout-grade coverage.`
  );
  if (launchesWithMatchedTrajectorySignals > 0) {
    reasons.push(
      `Among launches with fetched matched pages, ${launchesWithMatchedTrajectorySignals} showed trajectory-like language, ${launchesWithMatchedOrbitSignals} showed orbit signals, ${launchesWithMatchedMilestoneSignals} showed milestone signals, ${launchesWithMatchedRecoverySignals} showed recovery signals, and ${launchesWithMatchedNumericOrbitSignals} showed numeric orbit-like language.`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    fixtureJsonPath: input.fixtureJsonPath,
    sourceAuditJsonPath: input.sourceAuditJsonPath,
    decision,
    availability,
    joinability,
    usableCoverage,
    summary: {
      launchesScanned,
      candidatePagesScanned: input.candidatePageCount,
      launchesWithDeterministicMatch,
      launchesWithProbableMatch,
      launchesWithAmbiguousMatch,
      launchesWithoutMatch,
      launchesWithMatchedTrajectorySignals,
      launchesWithMatchedOrbitSignals,
      launchesWithMatchedMilestoneSignals,
      launchesWithMatchedRecoverySignals,
      launchesWithMatchedNumericOrbitSignals
    },
    reasons,
    launches: input.launches
  };
}

function buildMarkdown(report: JoinAuditReport) {
  const lines: string[] = [];
  lines.push('# Rocket Lab Join Audit');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- fixtureJsonPath: ${report.fixtureJsonPath ?? '—'}`);
  lines.push(`- sourceAuditJsonPath: ${report.sourceAuditJsonPath ?? '—'}`);
  lines.push(`- decision: ${report.decision}`);
  lines.push(`- availability: ${report.availability}`);
  lines.push(`- joinability: ${report.joinability}`);
  lines.push(`- usableCoverage: ${report.usableCoverage}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- launchesScanned=${report.summary.launchesScanned}`);
  lines.push(`- candidatePagesScanned=${report.summary.candidatePagesScanned}`);
  lines.push(`- launchesWithDeterministicMatch=${report.summary.launchesWithDeterministicMatch}`);
  lines.push(`- launchesWithProbableMatch=${report.summary.launchesWithProbableMatch}`);
  lines.push(`- launchesWithAmbiguousMatch=${report.summary.launchesWithAmbiguousMatch}`);
  lines.push(`- launchesWithoutMatch=${report.summary.launchesWithoutMatch}`);
  lines.push(`- launchesWithMatchedTrajectorySignals=${report.summary.launchesWithMatchedTrajectorySignals}`);
  lines.push(`- launchesWithMatchedOrbitSignals=${report.summary.launchesWithMatchedOrbitSignals}`);
  lines.push(`- launchesWithMatchedMilestoneSignals=${report.summary.launchesWithMatchedMilestoneSignals}`);
  lines.push(`- launchesWithMatchedRecoverySignals=${report.summary.launchesWithMatchedRecoverySignals}`);
  lines.push(`- launchesWithMatchedNumericOrbitSignals=${report.summary.launchesWithMatchedNumericOrbitSignals}`);
  lines.push('');
  lines.push('## Reasons');
  lines.push('');
  for (const reason of report.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Launch Matches');
  lines.push('');
  lines.push('| Launch | Match status | Score | Match URL | Alias | Signals |');
  lines.push('|---|---|---:|---|---|---|');
  if (!report.launches.length) {
    lines.push('| — | none | 0 | — | — | — |');
  } else {
    for (const launch of report.launches) {
      const signals = launch.matchedPageSignals
        ? `orbit=${launch.matchedPageSignals.orbitSignalCount}, milestone=${launch.matchedPageSignals.milestoneSignalCount}, recovery=${launch.matchedPageSignals.recoverySignalCount}, numeric=${launch.matchedPageSignals.numericOrbitSignalCount}`
        : '—';
      lines.push(
        `| ${escapeMarkdownCell(launch.missionName || launch.name || launch.launchId)} | ${escapeMarkdownCell(launch.matchStatus)} | ${launch.bestMatchScore ?? 0} | ${escapeMarkdownCell(launch.bestMatchUrl ?? '—')} | ${escapeMarkdownCell(launch.matchedAlias ?? '—')} | ${escapeMarkdownCell(signals)} |`
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullableString(value: unknown) {
  const normalized = asString(value);
  return normalized || null;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, '\\|');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
