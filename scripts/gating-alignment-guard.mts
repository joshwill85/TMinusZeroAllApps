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
  assert.equal(getTierCapabilities('premium').canUseOneOffCalendar, true);
  behaviorAssertions.push('one-off calendar is available for anon and premium entitlements');

  assert.equal(getTierCapabilities('anon').canUseBrowserLaunchAlerts, false);
  assert.equal(getTierCapabilities('premium').canUseBrowserLaunchAlerts, false);
  assert.equal(getTierCapabilities('anon').canUseLaunchDayEmail, false);
  assert.equal(getTierCapabilities('premium').canUseLaunchDayEmail, false);
  behaviorAssertions.push('browser alerts and launch-day email stay retired for every entitlement tier');

  assert.equal(getMobileViewerTier('anon'), 'anon');
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
    /capabilities:\s*getTierCapabilities\('anon'\)/,
    'guest viewer entitlements derive anon capabilities from shared domain helpers'
  );
  sourceAssertions.push('guest web entitlements derive capabilities from shared domain helpers');

  assertPattern(
    'apps/web/components/LaunchFeed.tsx',
    /Browse launches, filters, and the launch calendar on the public cadence\./,
    'web feed keeps public launch browsing and calendar access available without Premium'
  );
  sourceAssertions.push('web feed keeps public browsing and launch-calendar access in the anon experience');

  assertPattern(
    'apps/web/app/api/launches/[id]/ics/route.ts',
    /const disposition = \/iphone\|ipad\|ipod\/i\.test\(userAgent\) \? 'inline' : 'attachment';/,
    'web one-off ICS route no longer uses premium token authorization as an access gate'
  );
  sourceAssertions.push('web one-off ICS route is open without entitlement lookups');

  assertPattern(
    'apps/mobile/app/(tabs)/preferences.tsx',
    /getDefaultMobilePushPrelaunchOffsets\('broad'\)|getMobilePushMaxPrelaunchOffsets\(\{\s*advancedAllowed,\s*scopeKind: 'broad'/s,
    'mobile preferences derives broad reminder defaults and limits from shared mobile-push helpers'
  );
  sourceAssertions.push('mobile preferences uses shared mobile-push reminder defaults and limits');

  assertNoPattern(
    'apps/mobile/app/(tabs)/preferences.tsx',
    /launchDayEmail|useUpdateNotificationPreferencesMutation/,
    'mobile preferences removes launch-day email and dormant account-setting mutations from the native screen'
  );
  sourceAssertions.push('mobile preferences no longer carries launch-day email or dormant account-settings code');

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /notificationPreferencesUpdateSchemaV1\.parse\(await request\.json\(\)\.catch\(\(\) => undefined\)\);\s*throwRetiredLegacyNotifications\(\);/s,
    'shared notification preference route fully retires legacy launch-day email and browser-notification updates'
  );
  sourceAssertions.push('shared notification route fully retires legacy launch-day email and browser-notification updates');

  assertPattern(
    'supabase/functions/notifications-dispatch/index.ts',
    /reason: 'launch_day_email_retired'/,
    'notification dispatcher keeps launch-day email fully retired'
  );
  sourceAssertions.push('notification dispatcher reports launch-day email as retired instead of dispatching it');

  assertPattern(
    'scripts/mobile-query-guard.mts',
    /assert\.equal\(counts\.requestsByPath\['GET \/api\/filters\?mode=live&region=all'\] \?\? 0, 0\);/,
    'mobile query guard asserts that account bootstrap does not fetch launch-day email filter options'
  );
  sourceAssertions.push('mobile query guard protects against reintroducing mobile launch-day email filter fetches');

  console.log(`gating-alignment-guard: ok (${behaviorAssertions.length + sourceAssertions.length} assertions)`);
}

await main();
