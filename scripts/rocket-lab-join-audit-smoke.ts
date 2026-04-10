import assert from 'node:assert/strict';
import { z } from 'zod';
import { classifyRocketLabCandidateMatches, evaluateRocketLabPageSignals, readJsonFile } from './rocket-lab-source-audit-lib';

const fixtureSchema = z.object({
  launches: z
    .array(
      z.object({
        launchId: z.string(),
        name: z.string().nullable(),
        missionName: z.string().nullable(),
        net: z.string().nullable(),
        provider: z.string().nullable(),
        vehicle: z.string().nullable(),
        statusName: z.string().nullable(),
        expected: z.object({
          status: z.enum(['deterministic', 'probable', 'ambiguous', 'none']),
          bestMatchUrl: z.string().nullable(),
          matchedAlias: z.string().nullable()
        })
      })
    )
    .min(1),
  candidatePages: z
    .array(
      z.object({
        url: z.string(),
        html: z.string().nullable().optional()
      })
    )
    .min(1)
});

async function main() {
  const fixture = fixtureSchema.parse(readJsonFile('scripts/fixtures/rocket-lab/rocket-lab-join-audit-sample.json'));
  const candidateUrls = fixture.candidatePages.map((page) => page.url);

  for (const launch of fixture.launches) {
    const join = classifyRocketLabCandidateMatches(launch, candidateUrls);
    assert.equal(join.status, launch.expected.status, `${launch.launchId} status`);
    assert.equal(join.bestMatchUrl, launch.expected.bestMatchUrl, `${launch.launchId} bestMatchUrl`);
    assert.equal(join.matchedAlias, launch.expected.matchedAlias, `${launch.launchId} matchedAlias`);
  }

  const matchedHtml = fixture.candidatePages.find((page) => page.url.includes('a-sky-full-of-sars'))?.html;
  assert.ok(matchedHtml, 'fixture should include a-sky-full-of-sars page html');
  const signals = evaluateRocketLabPageSignals('https://rocketlabcorp.com/missions/launches/a-sky-full-of-sars', matchedHtml || '');
  assert.equal(signals.orbitSignalCount > 0, true, 'matched Rocket Lab mission page should expose orbit signals');

  console.log(`rocket-lab-join-audit-smoke: ok (${fixture.launches.length} launches, ${fixture.candidatePages.length} candidates)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
