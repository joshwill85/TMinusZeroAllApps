import { z } from 'zod';
import { buildBlueOriginFieldAuditReport } from './blue-origin-field-audit-lib';
import { fetchTextWithMeta, readJsonFile, writeJson, writeText } from './rocket-lab-source-audit-lib';

type CliArgs = {
  fixtureJsonPath: string | null;
  auditJsonPath: string;
  outputPath: string;
  markdownPath: string;
  retries: number;
  backoffMs: number;
  timeoutMs: number;
  quiet: boolean;
  json: boolean;
};

const officialSourcePageSchema = z.object({
  canonicalUrl: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  provenance: z.string().nullable().optional(),
  archiveSnapshotUrl: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  fetchedAt: z.string().nullable().optional()
});

const auditLaunchSchema = z.object({
  launchId: z.string(),
  ll2LaunchUuid: z.string().nullable(),
  flightCode: z.string().nullable(),
  name: z.string().nullable(),
  missionName: z.string().nullable(),
  net: z.string().nullable(),
  enhancements: z.object({
    missionSummary: z.string().nullable(),
    officialSourcePages: z.array(officialSourcePageSchema).default([])
  }),
  officialSourceHealth: z.object({
    checked: z.number().int().nonnegative(),
    broken: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative()
  }),
  anomalies: z.array(z.string()).default([])
});

const auditSchema = z.object({
  launches: z.array(auditLaunchSchema).default([])
});

const fixtureSchema = z.object({
  launches: z.array(auditLaunchSchema).default([]),
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
    auditJsonPath: value('--audit-json=') || 'tmp/blue-origin-audit.json',
    outputPath: value('--output=') || '.artifacts/blue-origin-field-audit.json',
    markdownPath: value('--markdown=') || '.artifacts/blue-origin-field-audit.md',
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
  const audit = fixture ? { launches: fixture.launches } : auditSchema.parse(readJsonFile(args.auditJsonPath));
  const launches = audit.launches.map((launch) => ({
    launchId: launch.launchId,
    ll2LaunchUuid: launch.ll2LaunchUuid,
    flightCode: launch.flightCode,
    name: launch.name,
    missionName: launch.missionName,
    net: launch.net,
    missionSummary: launch.enhancements.missionSummary,
    officialSourcePages: launch.enhancements.officialSourcePages,
    officialSourceHealth: launch.officialSourceHealth,
    anomalies: launch.anomalies
  }));

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
    const urls = new Set<string>();
    for (const launch of launches) {
      for (const page of launch.officialSourcePages) {
        const url = (page.archiveSnapshotUrl || page.canonicalUrl || page.url || '').replace(
          /^http:\/\/web\.archive\.org\//i,
          'https://web.archive.org/'
        );
        if (url) {
          urls.add(url);
          break;
        }
      }
    }

    const fetches = await Promise.all(
      [...urls].map((url) =>
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

  const report = buildBlueOriginFieldAuditReport({
    mode: fixture ? 'fixture' : 'live',
    fixtureJsonPath: args.fixtureJsonPath,
    auditJsonPath: args.auditJsonPath,
    launches,
    fetchedPages
  });

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('Blue Origin field audit');
    console.log(`Decision: ${report.decision}`);
    console.log(
      `Summary: launches=${report.summary.launchesAudited} profile=${report.summary.launchesWithProfileSignals}/${report.summary.launchesAudited} numericFacts=${report.summary.launchesWithNumericMissionFacts}/${report.summary.launchesAudited} authorityBundle=${report.summary.launchesWithAuthorityFieldBundle}/${report.summary.launchesAudited}`
    );
    console.log(`Wrote report: ${args.outputPath}`);
    console.log(`Wrote markdown: ${args.markdownPath}`);
  }
}

function buildMarkdown(report: ReturnType<typeof buildBlueOriginFieldAuditReport>) {
  const lines: string[] = [];
  lines.push('# Blue Origin Field Audit');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- fixtureJsonPath: ${report.fixtureJsonPath ?? '—'}`);
  lines.push(`- auditJsonPath: ${report.auditJsonPath}`);
  lines.push(`- decision: ${report.decision}`);
  lines.push(`- availability: ${report.availability}`);
  lines.push(`- joinability: ${report.joinability}`);
  lines.push(`- usableCoverage: ${report.usableCoverage}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- launchesScanned=${report.summary.launchesScanned}`);
  lines.push(`- launchesWithOfficialSourcePages=${report.summary.launchesWithOfficialSourcePages}`);
  lines.push(`- launchesWithHealthyOfficialSources=${report.summary.launchesWithHealthyOfficialSources}`);
  lines.push(`- launchesAudited=${report.summary.launchesAudited}`);
  lines.push(`- launchesFetchedSuccessfully=${report.summary.launchesFetchedSuccessfully}`);
  lines.push(`- launchesWithProfileSignals=${report.summary.launchesWithProfileSignals}`);
  lines.push(`- launchesWithTimelineSignals=${report.summary.launchesWithTimelineSignals}`);
  lines.push(`- launchesWithRecoverySignals=${report.summary.launchesWithRecoverySignals}`);
  lines.push(`- launchesWithVisibilitySignals=${report.summary.launchesWithVisibilitySignals}`);
  lines.push(`- launchesWithNumericMissionFacts=${report.summary.launchesWithNumericMissionFacts}`);
  lines.push(`- launchesWithAnyNumericOrbitField=${report.summary.launchesWithAnyNumericOrbitField}`);
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
  lines.push('| Launch | Source | Profile | Timeline | Recovery | Numeric facts | Orbit class | Authority bundle |');
  lines.push('|---|---|---:|---:|---:|---:|---|---|');
  if (!report.launches.length) {
    lines.push('| — | — | 0 | 0 | 0 | 0 | — | no |');
  } else {
    for (const launch of report.launches) {
      lines.push(
        `| ${escapeMarkdownCell(launch.missionName || launch.name || launch.launchId)} | ${escapeMarkdownCell(launch.selectedSourceTitle || launch.selectedSourceUrl || '—')} | ${launch.signals.profileSignalCount} | ${launch.signals.timelineSignalCount} | ${launch.signals.recoverySignalCount} | ${launch.signals.numericMissionFactCount} | ${escapeMarkdownCell(launch.orbit.orbitClass || '—')} | ${launch.hasAuthorityFieldBundle ? 'yes' : 'no'} |`
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
