import { z } from 'zod';
import { buildRocketLabFieldAuditReport } from './rocket-lab-field-audit-lib';
import { fetchTextWithMeta, readJsonFile, writeJson, writeText } from './rocket-lab-source-audit-lib';

type CliArgs = {
  fixtureJsonPath: string | null;
  joinAuditJsonPath: string;
  outputPath: string;
  markdownPath: string;
  retries: number;
  backoffMs: number;
  timeoutMs: number;
  quiet: boolean;
  json: boolean;
};

const joinAuditLaunchSchema = z.object({
  launchId: z.string(),
  name: z.string().nullable(),
  missionName: z.string().nullable(),
  net: z.string().nullable(),
  vehicle: z.string().nullable(),
  statusName: z.string().nullable(),
  matchStatus: z.enum(['deterministic', 'probable', 'ambiguous', 'none']),
  bestMatchUrl: z.string().nullable(),
  bestMatchScore: z.number().nullable(),
  matchedAlias: z.string().nullable()
});

const joinAuditSchema = z.object({
  launches: z.array(joinAuditLaunchSchema).default([])
});

const fixtureSchema = z.object({
  launches: z.array(joinAuditLaunchSchema).default([]),
  pages: z
    .array(
      z.object({
        url: z.string(),
        html: z.string()
      })
    )
    .default([])
});

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    fixtureJsonPath: value('--fixture-json=') || null,
    joinAuditJsonPath: value('--join-audit-json=') || '.artifacts/rocket-lab-join-audit-live.json',
    outputPath: value('--output=') || '.artifacts/rocket-lab-field-audit.json',
    markdownPath: value('--markdown=') || '.artifacts/rocket-lab-field-audit.md',
    retries: clampInt(Number(value('--retries=') || 2), 1, 6),
    backoffMs: clampInt(Number(value('--backoff-ms=') || 900), 200, 20_000),
    timeoutMs: clampInt(Number(value('--timeout-ms=') || 20_000), 1_000, 60_000),
    quiet: args.includes('--quiet'),
    json: args.includes('--json')
  };
}

async function main() {
  const args = parseArgs(process.argv);

  const fixture = args.fixtureJsonPath ? fixtureSchema.parse(readJsonFile(args.fixtureJsonPath)) : null;
  const launches = fixture ? fixture.launches : joinAuditSchema.parse(readJsonFile(args.joinAuditJsonPath)).launches;
  const fetchedPages = new Map<string, Awaited<ReturnType<typeof fetchTextWithMeta>>>();

  if (fixture) {
    for (const page of fixture.pages) {
      fetchedPages.set(page.url, {
        url: page.url,
        ok: true,
        status: 200,
        contentType: 'text/html; charset=utf-8',
        finalUrl: page.url,
        attemptCount: 1,
        challenge: false,
        error: null,
        text: page.html
      });
    }
  } else {
    const urls = [...new Set(
      launches
        .filter((launch) => (launch.matchStatus === 'deterministic' || launch.matchStatus === 'probable') && launch.bestMatchUrl)
        .map((launch) => launch.bestMatchUrl)
        .filter((value): value is string => Boolean(value))
    )];

    const fetches = await Promise.all(
      urls.map((url) =>
        fetchTextWithMeta(url, {
          retries: args.retries,
          backoffMs: args.backoffMs,
          timeoutMs: args.timeoutMs
        })
      )
    );
    for (const fetch of fetches) {
      fetchedPages.set(fetch.url, fetch);
    }
  }

  const report = buildRocketLabFieldAuditReport({
    mode: fixture ? 'fixture' : 'live',
    fixtureJsonPath: args.fixtureJsonPath,
    joinAuditJsonPath: fixture ? null : args.joinAuditJsonPath,
    launches,
    fetchedPages
  });

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('Rocket Lab field audit');
    console.log(`Decision: ${report.decision}`);
    console.log(
      `Summary: launches=${report.summary.launchesAudited} numericOrbit=${report.summary.launchesWithAnyNumericOrbitField}/${report.summary.launchesAudited} milestones=${report.summary.launchesWithMilestoneSignals}/${report.summary.launchesAudited} authorityBundle=${report.summary.launchesWithAuthorityFieldBundle}/${report.summary.launchesAudited}`
    );
    console.log(`Wrote report: ${args.outputPath}`);
    console.log(`Wrote markdown: ${args.markdownPath}`);
  }
}

function buildMarkdown(report: ReturnType<typeof buildRocketLabFieldAuditReport>) {
  const lines: string[] = [];
  lines.push('# Rocket Lab Field Audit');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- fixtureJsonPath: ${report.fixtureJsonPath ?? '—'}`);
  lines.push(`- joinAuditJsonPath: ${report.joinAuditJsonPath ?? '—'}`);
  lines.push(`- decision: ${report.decision}`);
  lines.push(`- availability: ${report.availability}`);
  lines.push(`- joinability: ${report.joinability}`);
  lines.push(`- usableCoverage: ${report.usableCoverage}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- launchesEligibleFromJoinAudit=${report.summary.launchesEligibleFromJoinAudit}`);
  lines.push(`- launchesAudited=${report.summary.launchesAudited}`);
  lines.push(`- launchesFetchedSuccessfully=${report.summary.launchesFetchedSuccessfully}`);
  lines.push(`- launchesWithInclination=${report.summary.launchesWithInclination}`);
  lines.push(`- launchesWithFlightAzimuth=${report.summary.launchesWithFlightAzimuth}`);
  lines.push(`- launchesWithAltitude=${report.summary.launchesWithAltitude}`);
  lines.push(`- launchesWithApogee=${report.summary.launchesWithApogee}`);
  lines.push(`- launchesWithPerigee=${report.summary.launchesWithPerigee}`);
  lines.push(`- launchesWithOrbitClass=${report.summary.launchesWithOrbitClass}`);
  lines.push(`- launchesWithAnyNumericOrbitField=${report.summary.launchesWithAnyNumericOrbitField}`);
  lines.push(`- launchesWithMilestoneSignals=${report.summary.launchesWithMilestoneSignals}`);
  lines.push(`- launchesWithRecoverySignals=${report.summary.launchesWithRecoverySignals}`);
  lines.push(`- launchesWithNumericOrbitSignals=${report.summary.launchesWithNumericOrbitSignals}`);
  lines.push(`- launchesWithAuthorityFieldBundle=${report.summary.launchesWithAuthorityFieldBundle}`);
  lines.push('');
  lines.push('## Reasons');
  lines.push('');
  for (const reason of report.reasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Launches');
  lines.push('');
  lines.push('| Launch | Match | Inclination | Azimuth | Orbit class | Milestones | Recovery | Authority bundle |');
  lines.push('|---|---|---:|---:|---|---:|---:|---|');
  if (!report.launches.length) {
    lines.push('| — | — | 0 | 0 | — | 0 | 0 | no |');
  } else {
    for (const launch of report.launches) {
      lines.push(
        `| ${escapeMarkdownCell(launch.missionName || launch.name || launch.launchId)} | ${launch.matchStatus} | ${launch.orbit.inclinationDeg ?? '—'} | ${launch.orbit.flightAzimuthDeg ?? '—'} | ${escapeMarkdownCell(launch.orbit.orbitClass ?? '—')} | ${launch.signals.milestoneSignalCount} | ${launch.signals.recoverySignalCount} | ${launch.hasAuthorityFieldBundle ? 'yes' : 'no'} |`
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, '\\|');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
