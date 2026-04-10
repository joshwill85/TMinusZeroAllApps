import assert from 'node:assert/strict';
import { z } from 'zod';
import { extractRocketLabCandidateLinks, evaluateRocketLabPageSignals, readJsonFile } from './rocket-lab-source-audit-lib';

const fixtureSchema = z.object({
  seed: z.string(),
  notes: z.string(),
  indexCases: z
    .array(
      z.object({
        id: z.string(),
        sourceUrl: z.string(),
        html: z.string(),
        expected: z.object({
          pageUrls: z.array(z.string()).default([]),
          pdfUrls: z.array(z.string()).default([])
        })
      })
    )
    .min(1),
  pageCases: z
    .array(
      z.object({
        id: z.string(),
        url: z.string(),
        html: z.string(),
        expected: z.object({
          hasTrajectorySignals: z.boolean(),
          orbitSignalCount: z.number().int().nonnegative(),
          milestoneSignalCount: z.number().int().nonnegative(),
          recoverySignalCount: z.number().int().nonnegative(),
          numericOrbitSignalCount: z.number().int().nonnegative(),
          matchedKeywords: z.array(z.string()).default([])
        })
      })
    )
    .min(1)
});

async function main() {
  const fixture = fixtureSchema.parse(
    readJsonFile('scripts/fixtures/rocket-lab/rocket-lab-source-audit-sample.json')
  );

  for (const indexCase of fixture.indexCases) {
    const candidates = extractRocketLabCandidateLinks(indexCase.html, indexCase.sourceUrl);
    const pageUrls = candidates.filter((candidate) => candidate.kind === 'page').map((candidate) => candidate.url);
    const pdfUrls = candidates.filter((candidate) => candidate.kind === 'pdf').map((candidate) => candidate.url);
    assert.deepEqual(pageUrls, indexCase.expected.pageUrls, `${indexCase.id} page urls`);
    assert.deepEqual(pdfUrls, indexCase.expected.pdfUrls, `${indexCase.id} pdf urls`);
  }

  for (const pageCase of fixture.pageCases) {
    const signals = evaluateRocketLabPageSignals(pageCase.url, pageCase.html);
    assert.equal(signals.hasTrajectorySignals, pageCase.expected.hasTrajectorySignals, `${pageCase.id} has trajectory signals`);
    assert.equal(signals.orbitSignalCount, pageCase.expected.orbitSignalCount, `${pageCase.id} orbit signal count`);
    assert.equal(signals.milestoneSignalCount, pageCase.expected.milestoneSignalCount, `${pageCase.id} milestone signal count`);
    assert.equal(signals.recoverySignalCount, pageCase.expected.recoverySignalCount, `${pageCase.id} recovery signal count`);
    assert.equal(signals.numericOrbitSignalCount, pageCase.expected.numericOrbitSignalCount, `${pageCase.id} numeric orbit signal count`);
    assert.deepEqual(signals.matchedKeywords, pageCase.expected.matchedKeywords, `${pageCase.id} matched keywords`);
  }

  console.log(`rocket-lab-source-audit-smoke: ok (${fixture.indexCases.length} index cases, ${fixture.pageCases.length} page cases)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
