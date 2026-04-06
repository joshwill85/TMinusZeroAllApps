import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const WS45_ALERT_KEYS = [
  'ws45_source_fetch_failed',
  'ws45_source_empty',
  'ws45_parse_missing_issued',
  'ws45_parse_missing_valid_window',
  'ws45_parse_required_fields_missing',
  'ws45_shape_unknown_detected',
  'ws45_match_unmatched_upcoming',
  'ws45_match_ambiguous_upcoming',
  'ws45_florida_launch_coverage_gap',
  'ws45_success_rate_degraded'
] as const;

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertPattern(filePath: string, pattern: RegExp, description: string) {
  const source = readRepoFile(filePath);
  assert.match(source, pattern, `${description} (${filePath})`);
}

function main() {
  let assertionCount = 0;

  assertPattern(
    'apps/web/app/admin/ws45/page.tsx',
    /fetch\('\/api\/admin\/ws45\/monitor'/,
    'WS45 admin page uses the dedicated monitor endpoint'
  );
  assertionCount += 1;

  assertPattern(
    'apps/web/app/api/admin/ws45/monitor/route.ts',
    /monitoring-check/,
    'WS45 monitor route targets the monitoring-check job'
  );
  assertionCount += 1;

  assertPattern(
    'apps/web/app/launches/[id]/page.tsx',
    /\.eq\('publish_eligible', true\)/,
    'web launch detail only reads publish-eligible WS45 forecasts'
  );
  assertionCount += 1;

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /\.eq\('publish_eligible', true\)/,
    'mobile API only reads publish-eligible WS45 forecasts'
  );
  assertionCount += 1;

  assertPattern(
    'apps/web/app/admin/_components/AdminNav.tsx',
    /href:\s*'\/admin\/ws45'/,
    'admin navigation exposes the dedicated WS45 page'
  );
  assertionCount += 1;

  const jobsSource = readRepoFile('apps/web/app/admin/_lib/jobs.ts');
  for (const key of WS45_ALERT_KEYS) {
    assert.match(
      jobsSource,
      new RegExp(`${key}:\\s*'ws45_forecasts_ingest'`),
      `WS45 alert key ${key} maps back to ws45_forecasts_ingest`
    );
    assertionCount += 1;
  }

  const monitoringSource = readRepoFile('supabase/functions/monitoring-check/index.ts');
  for (const key of WS45_ALERT_KEYS) {
    assert.match(monitoringSource, new RegExp(`'${key}'`), `monitoring-check emits or resolves ${key}`);
    assertionCount += 1;
  }

  console.log(`ws45-monitoring-guard: ok (${assertionCount} assertions)`);
}

main();
