import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasLaunchDayEmailPreferenceInput } from '../packages/domain/src/notificationPreferences.ts';
import { getMobileViewerTier, getTierCapabilities } from '../packages/domain/src/viewer.ts';

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
  const behaviorAssertions: string[] = [];
  const sourceAssertions: string[] = [];

  assert.equal(getTierCapabilities('anon').canUseOneOffCalendar, true);
  assert.equal(getTierCapabilities('free').canUseOneOffCalendar, true);
  assert.equal(getTierCapabilities('premium').canUseOneOffCalendar, true);
  behaviorAssertions.push('one-off calendar is available for anon, free, and premium entitlements');

  assert.equal(getMobileViewerTier('anon'), 'anon');
  assert.equal(getMobileViewerTier('free'), 'anon');
  assert.equal(getMobileViewerTier('premium'), 'premium');
  behaviorAssertions.push('mobile viewer tier projection stays anon-or-premium only');

  assert.equal(hasLaunchDayEmailPreferenceInput({ launchDayEmailEnabled: false }), true);
  assert.equal(hasLaunchDayEmailPreferenceInput({ launchDayEmailProviders: [] }), true);
  assert.equal(hasLaunchDayEmailPreferenceInput({ launchDayEmailStates: [] }), true);
  assert.equal(hasLaunchDayEmailPreferenceInput({}), false);
  assert.equal(hasLaunchDayEmailPreferenceInput(null), false);
  behaviorAssertions.push('launch-day email updates are detected whenever any mobile-blocked field is present');

  assertPattern(
    'apps/web/lib/api/queries.ts',
    /canUseOneOffCalendar:\s*true/,
    'guest viewer entitlements keep one-off calendar enabled'
  );
  sourceAssertions.push('guest web entitlements expose one-off calendar');

  assertPattern(
    'apps/web/components/LaunchFeed.tsx',
    /const canUseOneOffCalendar = Boolean\(viewerCapabilities\?\.canUseOneOffCalendar\);/,
    'web feed no longer requires auth to expose one-off calendar access'
  );
  sourceAssertions.push('web feed passes through open one-off calendar capability');

  assertPattern(
    'apps/web/app/api/launches/[id]/ics/route.ts',
    /const disposition = \/iphone\|ipad\|ipod\/i\.test\(userAgent\) \? 'inline' : 'attachment';/,
    'web one-off ICS route no longer uses premium token authorization as an access gate'
  );
  sourceAssertions.push('web one-off ICS route is open without entitlement lookups');

  assertPattern(
    'apps/mobile/app/(tabs)/preferences.tsx',
    /const tier = getMobileViewerTier\(entitlementsQuery\.data\?\.tier \?\? 'anon'\);/,
    'mobile preferences normalizes shared entitlements to the native anon-premium model'
  );
  sourceAssertions.push('mobile preferences uses the normalized mobile tier');

  assertNoPattern(
    'apps/mobile/app/(tabs)/preferences.tsx',
    /launchDayEmail|useUpdateNotificationPreferencesMutation/,
    'mobile preferences removes launch-day email and dormant account-setting mutations from the native screen'
  );
  sourceAssertions.push('mobile preferences no longer carries launch-day email or dormant account-settings code');

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /if \(session\.authMode === 'bearer' && hasLaunchDayEmailPreferenceInput\(parsedBody\)\) \{\s*throw new MobileApiRouteError\(400, 'unsupported_on_mobile'\);/s,
    'shared notification preference route rejects launch-day email mutations from bearer-auth mobile clients'
  );
  sourceAssertions.push('shared notification route blocks mobile launch-day email mutations');

  assertPattern(
    'scripts/mobile-query-guard.mts',
    /assert\.equal\(counts\.requestsByPath\['GET \/api\/filters\?mode=live&region=all'\] \?\? 0, 0\);/,
    'mobile query guard asserts that account bootstrap does not fetch launch-day email filter options'
  );
  sourceAssertions.push('mobile query guard protects against reintroducing mobile launch-day email filter fetches');

  console.log(`gating-alignment-guard: ok (${behaviorAssertions.length + sourceAssertions.length} assertions)`);
}

await main();
