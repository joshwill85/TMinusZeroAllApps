import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  buildLandingHintConstraintRow,
  buildMissionInfographicConstraintRow,
  buildSpaceXLaunchPageUrl,
  normalizeCmsAsset
} from '../supabase/functions/_shared/spacexInfographicConstraints';

const repoRoot = process.cwd();
const corpusPath = path.join(repoRoot, 'scripts/fixtures/spacex/spacex-infographics-corpus-v1.json');

const assetSchema = z
  .object({
    url: z.string().optional(),
    previewUrl: z.string().optional(),
    mime: z.string().optional(),
    width: z.union([z.number(), z.string()]).optional(),
    height: z.union([z.number(), z.string()]).optional(),
    formats: z.record(z.string(), z.object({ url: z.string().optional() })).optional()
  })
  .nullable();

const corpusSchema = z.object({
  seed: z.string(),
  notes: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        input: z.object({
          launchId: z.string(),
          missionId: z.string(),
          missionTitle: z.string().nullable(),
          confidence: z.number(),
          fetchedAt: z.string(),
          match: z.record(z.string(), z.unknown()).nullable(),
          infographicDesktopRaw: assetSchema,
          infographicMobileRaw: assetSchema,
          returnSite: z.string().nullable(),
          returnDateTime: z.string().nullable()
        }),
        expected: z.object({
          missionInfographic: z.object({
            exists: z.boolean(),
            source: z.string().optional(),
            constraintType: z.string().optional(),
            parseRuleId: z.string().optional(),
            parserVersion: z.string().optional(),
            confidence: z.number().optional(),
            launchPageUrl: z.string().optional(),
            infographicDesktop: z.boolean().optional(),
            infographicMobile: z.boolean().optional(),
            desktopUrl: z.string().optional(),
            desktopPreviewUrl: z.string().optional(),
            mobileUrl: z.string().optional(),
            mobilePreviewUrl: z.string().optional()
          }),
          landingHint: z.object({
            exists: z.boolean(),
            source: z.string().optional(),
            constraintType: z.string().optional(),
            parseRuleId: z.string().optional(),
            parserVersion: z.string().optional(),
            confidence: z.number().optional(),
            launchPageUrl: z.string().optional(),
            returnSite: z.string().optional(),
            returnDateTime: z.string().optional()
          })
        })
      })
    )
    .min(1)
});

type Corpus = z.infer<typeof corpusSchema>;

function readCorpus(): Corpus {
  const raw = fs.readFileSync(corpusPath, 'utf8');
  return corpusSchema.parse(JSON.parse(raw));
}

async function main() {
  const corpus = readCorpus();

  for (const fixture of corpus.cases) {
    const launchPageUrl = buildSpaceXLaunchPageUrl(fixture.input.missionId);
    const infographicDesktop = normalizeCmsAsset(fixture.input.infographicDesktopRaw);
    const infographicMobile = normalizeCmsAsset(fixture.input.infographicMobileRaw);

    const missionInfographic = await buildMissionInfographicConstraintRow({
      launchId: fixture.input.launchId,
      missionId: fixture.input.missionId,
      missionTitle: fixture.input.missionTitle,
      confidence: fixture.input.confidence,
      launchPageUrl,
      match: fixture.input.match,
      infographicDesktop,
      infographicMobile,
      fetchedAt: fixture.input.fetchedAt
    });

    const landingHint = await buildLandingHintConstraintRow({
      launchId: fixture.input.launchId,
      missionId: fixture.input.missionId,
      missionTitle: fixture.input.missionTitle,
      confidence: fixture.input.confidence,
      launchPageUrl,
      match: fixture.input.match,
      returnSite: fixture.input.returnSite,
      returnDateTime: fixture.input.returnDateTime,
      fetchedAt: fixture.input.fetchedAt
    });

    if (!fixture.expected.missionInfographic.exists) {
      assert.equal(missionInfographic, null, `${fixture.id} mission infographic should be null`);
    } else {
      assert.ok(missionInfographic, `${fixture.id} mission infographic should exist`);
      assert.equal(missionInfographic.source, fixture.expected.missionInfographic.source, `${fixture.id} mission infographic source`);
      assert.equal(
        missionInfographic.constraint_type,
        fixture.expected.missionInfographic.constraintType,
        `${fixture.id} mission infographic constraint type`
      );
      assert.equal(
        missionInfographic.parse_rule_id,
        fixture.expected.missionInfographic.parseRuleId,
        `${fixture.id} mission infographic parse rule`
      );
      assert.equal(
        missionInfographic.parser_version,
        fixture.expected.missionInfographic.parserVersion,
        `${fixture.id} mission infographic parser version`
      );
      assert.equal(missionInfographic.confidence, fixture.expected.missionInfographic.confidence, `${fixture.id} mission infographic confidence`);
      assert.equal(
        missionInfographic.data.launchPageUrl,
        fixture.expected.missionInfographic.launchPageUrl,
        `${fixture.id} mission infographic launch page`
      );
      assert.equal(
        missionInfographic.extracted_field_map.infographicDesktop,
        fixture.expected.missionInfographic.infographicDesktop,
        `${fixture.id} mission infographic desktop flag`
      );
      assert.equal(
        missionInfographic.extracted_field_map.infographicMobile,
        fixture.expected.missionInfographic.infographicMobile,
        `${fixture.id} mission infographic mobile flag`
      );
      assert.equal(
        missionInfographic.data.infographicDesktop?.url ?? null,
        fixture.expected.missionInfographic.desktopUrl ?? null,
        `${fixture.id} mission infographic desktop url`
      );
      assert.equal(
        missionInfographic.data.infographicDesktop?.previewUrl ?? null,
        fixture.expected.missionInfographic.desktopPreviewUrl ?? null,
        `${fixture.id} mission infographic desktop preview`
      );
      assert.equal(
        missionInfographic.data.infographicMobile?.url ?? null,
        fixture.expected.missionInfographic.mobileUrl ?? null,
        `${fixture.id} mission infographic mobile url`
      );
      assert.equal(
        missionInfographic.data.infographicMobile?.previewUrl ?? null,
        fixture.expected.missionInfographic.mobilePreviewUrl ?? null,
        `${fixture.id} mission infographic mobile preview`
      );
      assert.equal(typeof missionInfographic.source_hash, 'string', `${fixture.id} mission infographic source hash`);
      assert.equal(missionInfographic.source_hash.length, 64, `${fixture.id} mission infographic source hash length`);
    }

    if (!fixture.expected.landingHint.exists) {
      assert.equal(landingHint, null, `${fixture.id} landing hint should be null`);
    } else {
      assert.ok(landingHint, `${fixture.id} landing hint should exist`);
      assert.equal(landingHint.source, fixture.expected.landingHint.source, `${fixture.id} landing hint source`);
      assert.equal(landingHint.constraint_type, fixture.expected.landingHint.constraintType, `${fixture.id} landing hint constraint type`);
      assert.equal(landingHint.parse_rule_id, fixture.expected.landingHint.parseRuleId, `${fixture.id} landing hint parse rule`);
      assert.equal(landingHint.parser_version, fixture.expected.landingHint.parserVersion, `${fixture.id} landing hint parser version`);
      assert.equal(landingHint.confidence, fixture.expected.landingHint.confidence, `${fixture.id} landing hint confidence`);
      assert.equal(landingHint.data.launchPageUrl, fixture.expected.landingHint.launchPageUrl, `${fixture.id} landing hint launch page`);
      assert.equal(landingHint.data.returnSite ?? null, fixture.expected.landingHint.returnSite ?? null, `${fixture.id} landing hint return site`);
      assert.equal(
        landingHint.data.returnDateTime ?? null,
        fixture.expected.landingHint.returnDateTime ?? null,
        `${fixture.id} landing hint return datetime`
      );
      assert.equal(typeof landingHint.source_hash, 'string', `${fixture.id} landing hint source hash`);
      assert.equal(landingHint.source_hash.length, 64, `${fixture.id} landing hint source hash length`);
    }
  }

  console.log(`spacex-infographics-corpus-smoke: ok (${corpus.cases.length} cases)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
