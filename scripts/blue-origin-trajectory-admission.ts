import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

type AdmissionSignal = 'yes' | 'partial' | 'no';
type AdmissionDecision = 'pass' | 'defer' | 'reject';

type CliArgs = {
  auditJsonPath: string;
  outputPath: string;
  markdownPath: string;
  quiet: boolean;
  json: boolean;
};

type AdmissionReport = {
  generatedAt: string;
  sourceAuditGeneratedAt: string | null;
  auditJsonPath: string;
  decision: AdmissionDecision;
  availability: AdmissionSignal;
  joinability: AdmissionSignal;
  usableCoverage: AdmissionSignal;
  summary: {
    launchesScanned: number;
    launchesWithOfficialSourcePages: number;
    launchesWithHealthyOfficialSources: number;
    launchesWithMissionSummary: number;
    launchesWithFailureReason: number;
    launchesWithBrokenOfficialSources: number;
    launchesWithOfficialSourceErrors: number;
    officialSourceCoverageRate: number | null;
    healthyOfficialSourceCoverageRate: number | null;
    missionSummaryCoverageRate: number | null;
    failureReasonCoverageRate: number | null;
  };
  reasons: string[];
  topAnomalies: Array<{ key: string; count: number }>;
};

const auditLaunchSchema = z.object({
  launchId: z.string(),
  enhancements: z.object({
    missionSummary: z.string().nullable(),
    failureReason: z.string().nullable(),
    officialSourcePages: z
      .array(
        z.object({
          canonicalUrl: z.string().nullable().optional(),
          url: z.string().nullable().optional(),
          provenance: z.string().nullable().optional(),
          archiveSnapshotUrl: z.string().nullable().optional(),
          title: z.string().nullable().optional(),
          fetchedAt: z.string().nullable().optional()
        })
      )
      .default([])
  }),
  officialSourceHealth: z.object({
    checked: z.number().int().nonnegative(),
    broken: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative()
  }),
  anomalies: z.array(z.string()).default([])
});

const auditSchema = z.object({
  generatedAt: z.string().nullable().optional(),
  launches: z.array(auditLaunchSchema).default([])
});

type BlueOriginAudit = z.infer<typeof auditSchema>;

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    auditJsonPath: value('--audit-json=') || 'tmp/blue-origin-audit.json',
    outputPath: value('--output=') || '.artifacts/blue-origin-trajectory-admission.json',
    markdownPath: value('--markdown=') || '.artifacts/blue-origin-trajectory-admission.md',
    quiet: args.includes('--quiet'),
    json: args.includes('--json')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function readAuditFile(pathArg: string): BlueOriginAudit {
  const full = resolvePath(pathArg);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  return auditSchema.parse(JSON.parse(fs.readFileSync(full, 'utf8')));
}

function writeJson(pathArg: string, value: unknown) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(pathArg: string, value: string) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value, 'utf8');
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function summarizeAnomalies(launches: BlueOriginAudit['launches']) {
  const counts = new Map<string, number>();
  for (const launch of launches) {
    for (const anomaly of launch.anomalies) {
      counts.set(anomaly, (counts.get(anomaly) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function buildMarkdown(report: AdmissionReport) {
  const lines: string[] = [];
  lines.push('# Blue Origin Trajectory Admission Report');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- sourceAuditGeneratedAt: ${report.sourceAuditGeneratedAt ?? '—'}`);
  lines.push(`- auditJsonPath: ${report.auditJsonPath}`);
  lines.push(`- decision: ${report.decision}`);
  lines.push(`- availability: ${report.availability}`);
  lines.push(`- joinability: ${report.joinability}`);
  lines.push(`- usableCoverage: ${report.usableCoverage}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- launchesScanned=${report.summary.launchesScanned}`);
  lines.push(
    `- officialSourceCoverage=${report.summary.launchesWithOfficialSourcePages}/${report.summary.launchesScanned} (${fmtPct(report.summary.officialSourceCoverageRate)})`
  );
  lines.push(
    `- healthyOfficialSourceCoverage=${report.summary.launchesWithHealthyOfficialSources}/${report.summary.launchesScanned} (${fmtPct(report.summary.healthyOfficialSourceCoverageRate)})`
  );
  lines.push(
    `- missionSummaryCoverage=${report.summary.launchesWithMissionSummary}/${report.summary.launchesScanned} (${fmtPct(report.summary.missionSummaryCoverageRate)})`
  );
  lines.push(
    `- failureReasonCoverage=${report.summary.launchesWithFailureReason}/${report.summary.launchesScanned} (${fmtPct(report.summary.failureReasonCoverageRate)})`
  );
  lines.push(
    `- brokenOfficialSources=${report.summary.launchesWithBrokenOfficialSources}/${report.summary.launchesScanned}`
  );
  lines.push(
    `- officialSourceErrors=${report.summary.launchesWithOfficialSourceErrors}/${report.summary.launchesScanned}`
  );
  lines.push('');
  lines.push('## Reasons');
  lines.push('');
  for (const reason of report.reasons) {
    lines.push(`- ${reason}`);
  }
  if (!report.reasons.length) {
    lines.push('- none');
  }
  lines.push('');
  lines.push('## Top Anomalies');
  lines.push('');
  lines.push('| Anomaly | Count |');
  lines.push('|---|---:|');
  if (!report.topAnomalies.length) {
    lines.push('| — | 0 |');
  } else {
    for (const row of report.topAnomalies) {
      lines.push(`| ${row.key} | ${row.count} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function evaluateAudit(audit: BlueOriginAudit, auditJsonPath: string): AdmissionReport {
  const launches = audit.launches;
  const launchesScanned = launches.length;
  const launchesWithOfficialSourcePages = launches.filter((launch) => launch.enhancements.officialSourcePages.length > 0).length;
  const launchesWithHealthyOfficialSources = launches.filter(
    (launch) => launch.enhancements.officialSourcePages.length > 0 && launch.officialSourceHealth.broken === 0 && launch.officialSourceHealth.errors === 0
  ).length;
  const launchesWithMissionSummary = launches.filter((launch) => Boolean(launch.enhancements.missionSummary?.trim())).length;
  const launchesWithFailureReason = launches.filter((launch) => Boolean(launch.enhancements.failureReason?.trim())).length;
  const launchesWithBrokenOfficialSources = launches.filter((launch) => launch.officialSourceHealth.broken > 0).length;
  const launchesWithOfficialSourceErrors = launches.filter((launch) => launch.officialSourceHealth.errors > 0).length;

  const officialSourceCoverageRate = safeRate(launchesWithOfficialSourcePages, launchesScanned);
  const healthyOfficialSourceCoverageRate = safeRate(launchesWithHealthyOfficialSources, launchesScanned);
  const missionSummaryCoverageRate = safeRate(launchesWithMissionSummary, launchesScanned);
  const failureReasonCoverageRate = safeRate(launchesWithFailureReason, launchesScanned);

  let availability: AdmissionSignal = 'no';
  if (launchesWithOfficialSourcePages > 0) availability = 'yes';

  let joinability: AdmissionSignal = 'no';
  if (launchesWithOfficialSourcePages > 0) {
    joinability = launchesWithOfficialSourcePages === launchesScanned && launchesWithBrokenOfficialSources === 0 ? 'yes' : 'partial';
  }

  const usableCoverage: AdmissionSignal = 'no';

  const reasons: string[] = [];
  if (availability === 'yes') {
    reasons.push(
      `Official source pages are present for ${launchesWithOfficialSourcePages}/${launchesScanned} audited launches (${fmtPct(officialSourceCoverageRate)}).`
    );
  } else {
    reasons.push('No official source pages were observed in the audit output.');
  }

  if (joinability === 'yes') {
    reasons.push('Every audited launch retained joinable official source pages without broken-link evidence.');
  } else if (joinability === 'partial') {
    reasons.push(
      `Joinability is only partial because official source pages are missing or unhealthy for part of the audited launch set (${launchesWithHealthyOfficialSources}/${launchesScanned} healthy launches).`
    );
  } else {
    reasons.push('Joinability is not demonstrated in the audit output.');
  }

  reasons.push(
    `Usable coverage stays "no" for trajectory-truth admission because the current audit only proves source-page and mission-summary presence; it does not prove direction, milestone, recovery, or visibility fields at useful coverage.`
  );

  if (launchesWithBrokenOfficialSources > 0 || launchesWithOfficialSourceErrors > 0) {
    reasons.push(
      `Official source health is not clean yet: ${launchesWithBrokenOfficialSources} launches show broken links and ${launchesWithOfficialSourceErrors} launches show fetch/check errors.`
    );
  }

  const decision: AdmissionDecision = availability === 'no' ? 'reject' : 'defer';

  return {
    generatedAt: new Date().toISOString(),
    sourceAuditGeneratedAt: audit.generatedAt ?? null,
    auditJsonPath,
    decision,
    availability,
    joinability,
    usableCoverage,
    summary: {
      launchesScanned,
      launchesWithOfficialSourcePages,
      launchesWithHealthyOfficialSources,
      launchesWithMissionSummary,
      launchesWithFailureReason,
      launchesWithBrokenOfficialSources,
      launchesWithOfficialSourceErrors,
      officialSourceCoverageRate,
      healthyOfficialSourceCoverageRate,
      missionSummaryCoverageRate,
      failureReasonCoverageRate
    },
    reasons,
    topAnomalies: summarizeAnomalies(launches)
  };
}

function main() {
  const args = parseArgs(process.argv);
  const audit = readAuditFile(args.auditJsonPath);
  const report = evaluateAudit(audit, args.auditJsonPath);
  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!args.quiet) {
    console.log('Blue Origin trajectory admission report');
    console.log(`Decision: ${report.decision}`);
    console.log(
      `Summary: launches=${report.summary.launchesScanned} officialSources=${fmtPct(report.summary.officialSourceCoverageRate)} healthySources=${fmtPct(report.summary.healthyOfficialSourceCoverageRate)} missionSummary=${fmtPct(report.summary.missionSummaryCoverageRate)}`
    );
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }
}

main();
