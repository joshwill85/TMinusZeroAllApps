import { z } from 'zod';
import { buildBlueOriginFieldAuditReport } from './blue-origin-field-audit-lib';
import { readJsonFile } from './rocket-lab-source-audit-lib';

const fixtureSchema = z.object({
  launches: z.array(
    z.object({
      launchId: z.string(),
      ll2LaunchUuid: z.string().nullable(),
      flightCode: z.string().nullable(),
      name: z.string().nullable(),
      missionName: z.string().nullable(),
      net: z.string().nullable(),
      enhancements: z.object({
        missionSummary: z.string().nullable(),
        officialSourcePages: z.array(
          z.object({
            canonicalUrl: z.string().nullable().optional(),
            url: z.string().nullable().optional(),
            provenance: z.string().nullable().optional(),
            archiveSnapshotUrl: z.string().nullable().optional(),
            title: z.string().nullable().optional(),
            fetchedAt: z.string().nullable().optional()
          })
        )
      }),
      officialSourceHealth: z.object({
        checked: z.number().int().nonnegative(),
        broken: z.number().int().nonnegative(),
        errors: z.number().int().nonnegative()
      }),
      anomalies: z.array(z.string()).default([])
    })
  ),
  pages: z.array(
    z.object({
      url: z.string(),
      html: z.string()
    })
  )
});

const fixture = fixtureSchema.parse(readJsonFile('scripts/fixtures/blue-origin/blue-origin-field-audit-sample.json'));
const fetchedPages = new Map(
  fixture.pages.map((page) => [
    page.url,
    {
      url: page.url,
      ok: true,
      status: 200,
      contentType: 'text/html; charset=utf-8',
      finalUrl: page.url,
      attemptCount: 1,
      challenge: false,
      error: null,
      text: page.html
    }
  ])
);

const report = buildBlueOriginFieldAuditReport({
  mode: 'fixture',
  fixtureJsonPath: 'scripts/fixtures/blue-origin/blue-origin-field-audit-sample.json',
  auditJsonPath: 'tmp/blue-origin-audit.json',
  launches: fixture.launches.map((launch) => ({
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
  })),
  fetchedPages
});

if (report.decision !== 'defer') throw new Error(`Expected defer decision, received ${report.decision}`);
if (report.availability !== 'yes') throw new Error(`Expected availability=yes, received ${report.availability}`);
if (report.joinability !== 'partial') throw new Error(`Expected joinability=partial, received ${report.joinability}`);
if (report.usableCoverage !== 'no') throw new Error(`Expected usableCoverage=no, received ${report.usableCoverage}`);
if (report.summary.launchesAudited !== 2) throw new Error(`Expected 2 launches audited, received ${report.summary.launchesAudited}`);
if (report.summary.launchesWithProfileSignals !== 1) {
  throw new Error(`Expected 1 launch with profile signals, received ${report.summary.launchesWithProfileSignals}`);
}
if (report.summary.launchesWithTimelineSignals !== 1) {
  throw new Error(`Expected 1 launch with timeline signals, received ${report.summary.launchesWithTimelineSignals}`);
}
if (report.summary.launchesWithRecoverySignals !== 1) {
  throw new Error(`Expected 1 launch with recovery signals, received ${report.summary.launchesWithRecoverySignals}`);
}
if (report.summary.launchesWithNumericMissionFacts !== 1) {
  throw new Error(`Expected 1 launch with numeric mission facts, received ${report.summary.launchesWithNumericMissionFacts}`);
}
if (report.summary.launchesWithAuthorityFieldBundle !== 1) {
  throw new Error(`Expected 1 launch with authority bundle, received ${report.summary.launchesWithAuthorityFieldBundle}`);
}

console.log('blue-origin-field-audit-smoke: ok');
