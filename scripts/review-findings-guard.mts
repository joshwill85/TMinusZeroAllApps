import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertPattern(filePath: string, pattern: RegExp, description: string) {
  const source = readRepoFile(filePath);
  assert.match(source, pattern, `${description} (${filePath})`);
}

function assertNoPattern(filePath: string, pattern: RegExp, description: string) {
  const source = readRepoFile(filePath);
  assert.doesNotMatch(source, pattern, `${description} (${filePath})`);
}

async function main() {
  const assertions: string[] = [];

  for (const filePath of ['apps/mobile/app/(tabs)/feed.tsx', 'apps/mobile/app/launches/[id].tsx']) {
    assertPattern(filePath, /key:\s*'launch_notifications'/, 'mobile public reminder option remains available');
    assertNoPattern(filePath, /key:\s*'launch_locked'/, 'mobile guest follow sheets do not replace launch reminders with premium-only launch locks');
    assertNoPattern(
      filePath,
      /basicFollowCapacityLabel\s*=\s*canUseSavedItems\s*\|\|\s*!isAuthed/,
      'mobile guest reminder capacity labels are not hidden behind sign-in state'
    );
    assertNoPattern(
      filePath,
      /Premium unlocks launch reminders, followed-launch tracking, and broader follow scopes from this sheet\./,
      'mobile guest follow-sheet copy does not falsely claim launch reminders are premium-only'
    );
  }
  assertions.push('mobile guest reminder regressions are guarded');

  assertPattern(
    'supabase/functions/_shared/ll2Ingest.ts',
    /function mergeLl2RocketConfigReferenceRows/,
    'LL2 ingest defines a dedicated null-safe merge path for rocket config references'
  );
  assertPattern(
    'supabase/functions/_shared/ll2Ingest.ts',
    /family:\s*normalizeNonEmptyString\(row\.family\)\s*\?\?\s*previous\?\.family\s*\?\?\s*existing\?\.family\s*\?\?\s*null/,
    'LL2 ingest preserves existing rocket family metadata when incoming rows omit family'
  );
  assertPattern(
    'supabase/functions/_shared/ll2Ingest.ts',
    /upsertRocketConfigReferences\(supabase,\s*\[\.\.\.rockets\.values\(\)\]\)/,
    'LL2 ingest routes rocket config writes through the null-safe merge helper'
  );
  assertNoPattern(
    'supabase/functions/_shared/ll2Ingest.ts',
    /upsertReference\(supabase,\s*'ll2_rocket_configs',\s*\[\.\.\.rockets\.values\(\)\],\s*'ll2_config_id'\)/,
    'LL2 ingest no longer blind-upserts rocket configs during incremental syncs'
  );
  assertions.push('LL2 rocket-config null clobber regression is guarded');

  assertPattern(
    'apps/web/app/api/admin/jep/shadow-review/route.ts',
    /const summary = buildSummary\(reviewRows\);/,
    'shadow-review summary is built from the full filtered row set'
  );
  assertNoPattern(
    'apps/web/app/api/admin/jep/shadow-review/route.ts',
    /buildSummary\(trimmedRows\)/,
    'shadow-review summary is not built from the paginated slice'
  );
  assertNoPattern(
    'apps/web/app/api/admin/jep/shadow-review/route.ts',
    /Number\.NEGATIVE_INFINITY/,
    'shadow-review delta sorting no longer treats missing deltas as infinite-magnitude changes'
  );
  assertPattern(
    'apps/web/app/api/admin/jep/shadow-review/route.ts',
    /compareNullableNumbers/,
    'shadow-review route uses null-aware delta comparisons'
  );
  assertPattern(
    'apps/web/app/api/admin/jep/shadow-review/route.ts',
    /returnedLaunches:\s*trimmedRows\.length/,
    'shadow-review route exposes returned launch counts alongside full-population summaries'
  );
  assertPattern(
    'apps/web/app/admin/ops/jep/page.tsx',
    /Showing the first \{data\.returnedLaunches\} of \{data\.summary\.targetLaunches\} filtered launches\./,
    'admin shadow-review page surfaces truncation when the table is paginated'
  );
  assertions.push('shadow-review sorting and summary regressions are guarded');

  console.log(`review-findings-guard: ok (${assertions.length} assertions)`);
}

await main();
