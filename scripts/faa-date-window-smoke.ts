import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { inferDateWindowPrecision, parseFaaNotamDetailWindow } from '../supabase/functions/_shared/faa';

const repoRoot = process.cwd();
const corpusPath = path.join(repoRoot, 'scripts/fixtures/faa/faa-date-window-corpus-v1.json');

const corpusSchema = z.object({
  seed: z.string(),
  notes: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        webTextPath: z.string().optional(),
        notamTextPath: z.string().optional(),
        expected: z.object({
          validStart: z.string().nullable(),
          validEnd: z.string().nullable(),
          precision: z.enum(['none', 'date', 'datetime'])
        })
      })
    )
    .min(1)
});

function readCorpus() {
  return corpusSchema.parse(JSON.parse(fs.readFileSync(corpusPath, 'utf8')));
}

function readFixture(relativePath: string | undefined) {
  if (!relativePath) return null;
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function main() {
  const corpus = readCorpus();

  for (const fixture of corpus.cases) {
    const parsed = parseFaaNotamDetailWindow({
      webText: readFixture(fixture.webTextPath),
      notamText: readFixture(fixture.notamTextPath)
    });

    assert.equal(parsed.validStart ?? null, fixture.expected.validStart, `${fixture.id} validStart`);
    assert.equal(parsed.validEnd ?? null, fixture.expected.validEnd, `${fixture.id} validEnd`);
    assert.equal(
      inferDateWindowPrecision(parsed.validStart, parsed.validEnd),
      fixture.expected.precision,
      `${fixture.id} precision`
    );
  }

  console.log(`faa-date-window-smoke: ok (${corpus.cases.length} cases)`);
}

main();
