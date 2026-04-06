import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseWs45ForecastText } from '@/lib/server/ws45ForecastIngest';

const repoRoot = process.cwd();
const corpusPath = path.join(repoRoot, 'scripts/fixtures/ws45/ws45-corpus-v1.json');

const expectedSchema = z.object({
  missionName: z.string().nullable(),
  issuedAtUtc: z.string().nullable(),
  validStartUtc: z.string().nullable(),
  validEndUtc: z.string().nullable(),
  launchDayPovPercent: z.number().int().nullable(),
  delay24hPovPercent: z.number().int().nullable(),
  launchDayPrimaryConcerns: z.array(z.string()).optional(),
  delay24hPrimaryConcerns: z.array(z.string()).optional(),
  delayLabel: z.string().optional(),
  forecastDiscussionIncludes: z.string().optional(),
  missionTokensContain: z.array(z.string()).optional()
});

const corpusSchema = z.object({
  seed: z.string(),
  notes: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        family: z.string(),
        sourceLabel: z.string(),
        rawTextPath: z.string(),
        regression: z.object({
          observedParserVersion: z.string(),
          notes: z.string(),
          observedStoredFields: z
            .object({
              issuedAt: z.string().nullable().optional(),
              validStart: z.string().nullable().optional(),
              validEnd: z.string().nullable().optional(),
              matchStatus: z.string().nullable().optional()
            })
            .optional()
        }),
        expected: expectedSchema
      })
    )
    .min(1)
});

type Ws45Corpus = z.infer<typeof corpusSchema>;

function readCorpus(): Ws45Corpus {
  const raw = fs.readFileSync(corpusPath, 'utf8');
  return corpusSchema.parse(JSON.parse(raw));
}

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function main() {
  const corpus = readCorpus();
  let recoveredDriftCases = 0;

  for (const fixture of corpus.cases) {
    const rawText = readRepoFile(fixture.rawTextPath);
    assert(rawText.trim().length > 0, `${fixture.id} raw text fixture must not be empty`);

    const parsed = parseWs45ForecastText(rawText);
    const expected = fixture.expected;

    assert.equal(parsed.missionName ?? null, expected.missionName, `${fixture.id} mission name`);
    assert.equal(parsed.issuedAtUtc ?? null, expected.issuedAtUtc, `${fixture.id} issued_at`);
    assert.equal(parsed.validStartUtc ?? null, expected.validStartUtc, `${fixture.id} valid_start`);
    assert.equal(parsed.validEndUtc ?? null, expected.validEndUtc, `${fixture.id} valid_end`);
    assert.equal(parsed.launchDayPovPercent ?? null, expected.launchDayPovPercent, `${fixture.id} launch day POV`);
    assert.equal(parsed.delay24hPovPercent ?? null, expected.delay24hPovPercent, `${fixture.id} delay POV`);

    if (expected.launchDayPrimaryConcerns) {
      assert.deepEqual(parsed.launchDayPrimaryConcerns ?? [], expected.launchDayPrimaryConcerns, `${fixture.id} launch day concerns`);
    }
    if (expected.delay24hPrimaryConcerns) {
      assert.deepEqual(parsed.delay24hPrimaryConcerns ?? [], expected.delay24hPrimaryConcerns, `${fixture.id} delay concerns`);
    }
    if (expected.delayLabel) {
      assert.equal(parsed.delay24h?.label ?? null, expected.delayLabel, `${fixture.id} delay label`);
    }
    if (expected.forecastDiscussionIncludes) {
      assert(
        (parsed.forecastDiscussion ?? '').includes(expected.forecastDiscussionIncludes),
        `${fixture.id} forecast discussion should include "${expected.forecastDiscussionIncludes}"`
      );
    }
    if (expected.missionTokensContain?.length) {
      const actualTokens = new Set(parsed.missionTokens ?? []);
      for (const token of expected.missionTokensContain) {
        assert(actualTokens.has(token), `${fixture.id} mission tokens should contain "${token}"`);
      }
    }

    if (
      fixture.regression.observedStoredFields &&
      fixture.regression.observedStoredFields.issuedAt == null &&
      expected.issuedAtUtc != null
    ) {
      recoveredDriftCases += 1;
    }
  }

  console.log(`ws45-corpus-smoke: ok (${corpus.cases.length} cases, ${recoveredDriftCases} recovered drift cases)`);
}

main();
