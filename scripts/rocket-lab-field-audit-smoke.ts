import assert from 'node:assert/strict';
import { z } from 'zod';
import { buildRocketLabFieldAuditReport } from './rocket-lab-field-audit-lib';
import { readJsonFile } from './rocket-lab-source-audit-lib';

const fixtureSchema = z.object({
  launches: z.array(
    z.object({
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
    })
  ),
  pages: z.array(z.object({ url: z.string(), html: z.string() }))
});

async function main() {
  const fixture = fixtureSchema.parse(readJsonFile('scripts/fixtures/rocket-lab/rocket-lab-field-audit-sample.json'));
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

  const report = buildRocketLabFieldAuditReport({
    mode: 'fixture',
    fixtureJsonPath: 'scripts/fixtures/rocket-lab/rocket-lab-field-audit-sample.json',
    joinAuditJsonPath: null,
    launches: fixture.launches,
    fetchedPages
  });

  assert.equal(report.summary.launchesAudited, 2, 'fixture should audit deterministic and probable launches only');
  assert.equal(report.summary.launchesWithAnyNumericOrbitField, 1, 'fixture should detect one numeric orbit-bearing launch');
  assert.equal(report.summary.launchesWithMilestoneSignals, 2, 'fixture should detect both fixture launches carrying milestone signals');
  assert.equal(report.summary.launchesWithAuthorityFieldBundle, 1, 'fixture should detect one launch with both numeric orbit and milestones');
  assert.equal(report.usableCoverage, 'no', 'fixture should remain below rollout-grade usable coverage');

  console.log('rocket-lab-field-audit-smoke: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
