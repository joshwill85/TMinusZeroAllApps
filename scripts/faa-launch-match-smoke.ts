import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { computeLaunchWindow, decideLaunchMatch, scoreLaunchCandidate } from '../supabase/functions/_shared/faaLaunchMatch';
import { buildDirectionalPriorsByLaunch } from '../supabase/functions/_shared/trajectoryDirection';

const repoRoot = process.cwd();
const corpusPath = path.join(repoRoot, 'scripts/fixtures/faa/faa-launch-match-corpus-v1.json');

const corpusSchema = z.object({
  seed: z.string(),
  notes: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        launch: z.object({
          id: z.string(),
          name: z.string().nullable(),
          mission_name: z.string().nullable(),
          mission_orbit: z.string().nullable(),
          provider: z.string().nullable(),
          vehicle: z.string().nullable(),
          net: z.string().nullable(),
          window_start: z.string().nullable(),
          window_end: z.string().nullable(),
          pad_name: z.string().nullable(),
          pad_short_code: z.string().nullable(),
          pad_state: z.string().nullable(),
          pad_country_code: z.string().nullable(),
          pad_latitude: z.number().nullable(),
          pad_longitude: z.number().nullable(),
          location_name: z.string().nullable()
        }),
        record: z.object({
          id: z.string(),
          source_key: z.string(),
          notam_id: z.string().nullable(),
          facility: z.string().nullable(),
          state: z.string().nullable(),
          type: z.string().nullable(),
          legal: z.string().nullable(),
          title: z.string().nullable(),
          description: z.string().nullable(),
          valid_start: z.string().nullable(),
          valid_end: z.string().nullable(),
          mod_at: z.string().nullable(),
          status: z.enum(['active', 'expired', 'manual']),
          has_shape: z.boolean()
        }),
        shapes: z.array(
          z.object({
            id: z.string(),
            faa_tfr_record_id: z.string(),
            bbox_min_lat: z.number().nullable(),
            bbox_min_lon: z.number().nullable(),
            bbox_max_lat: z.number().nullable(),
            bbox_max_lon: z.number().nullable(),
            geometry: z.record(z.string(), z.any()).nullable()
          })
        ),
        constraints: z.array(
          z.object({
            launch_id: z.string(),
            source: z.string().nullable(),
            source_id: z.string().nullable(),
            constraint_type: z.string(),
            data: z.record(z.string(), z.any()),
            confidence: z.number().nullable(),
            fetched_at: z.string().nullable()
          })
        ),
        expected: z.object({
          status: z.enum(['matched', 'ambiguous', 'unmatched']),
          reasonsContain: z.array(z.string()).default([])
        })
      })
    )
    .min(1)
});

function main() {
  const corpus = corpusSchema.parse(JSON.parse(fs.readFileSync(corpusPath, 'utf8')));

  for (const fixture of corpus.cases) {
    const directionalPrior = buildDirectionalPriorsByLaunch([fixture.launch], fixture.constraints).get(fixture.launch.id) || null;
    const ranked = [
      scoreLaunchCandidate({
        launch: fixture.launch,
        launchWindow: computeLaunchWindow(fixture.launch),
        record: fixture.record,
        shapes: fixture.shapes,
        nowMs: Date.parse(fixture.launch.net || '2026-04-10T00:00:00.000Z'),
        directionalPrior
      })
    ];
    const decision = decideLaunchMatch(ranked);

    assert.equal(decision.matchStatus, fixture.expected.status, `${fixture.id} status`);

    const bestReasons = decision.best?.reasons || [];
    for (const reason of fixture.expected.reasonsContain) {
      assert(bestReasons.includes(reason), `${fixture.id} should include reason "${reason}"`);
    }
  }

  console.log(`faa-launch-match-smoke: ok (${corpus.cases.length} cases)`);
}

main();
