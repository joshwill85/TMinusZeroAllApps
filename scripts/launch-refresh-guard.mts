import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDetailVersionToken,
  buildPendingFeedRefreshMessage,
  canAutoRefreshActiveSurface,
  getNextAdaptiveLaunchRefreshMs,
  getVisibleDetailUpdatedAt,
  getVisibleFeedUpdatedAt,
  hasVersionChanged,
  isLaunchRefreshHotWindow,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  shouldPrimeVersionRefresh
} from '../packages/domain/src/launchRefresh.ts';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertPattern(filePath: string, pattern: RegExp, description: string) {
  const source = readRepoFile(filePath);
  assert.match(source, pattern, `${description} (${filePath})`);
}

async function main() {
  const behaviorAssertions: string[] = [];
  const sourceAssertions: string[] = [];

  assert.equal(
    getVisibleFeedUpdatedAt(
      [
        { cacheGeneratedAt: '2026-03-08T11:58:00.000Z', lastUpdated: '2026-03-08T11:50:00.000Z' },
        { cacheGeneratedAt: '2026-03-08T12:01:00.000Z', lastUpdated: '2026-03-08T11:59:00.000Z' }
      ],
      'public'
    ),
    '2026-03-08T12:01:00.000Z'
  );
  behaviorAssertions.push('public feed updated-at selection prefers the freshest cache timestamp');

  assert.equal(
    getVisibleFeedUpdatedAt(
      [
        { cacheGeneratedAt: '2026-03-08T11:58:00.000Z', lastUpdated: '2026-03-08T11:50:00.000Z' },
        { cacheGeneratedAt: '2026-03-08T12:01:00.000Z', lastUpdated: '2026-03-08T12:02:00.000Z' }
      ],
      'live'
    ),
    '2026-03-08T12:02:00.000Z'
  );
  behaviorAssertions.push('live feed updated-at selection prefers the freshest live timestamp');

  assert.equal(getVisibleDetailUpdatedAt({ cacheGeneratedAt: '2026-03-08T12:00:00.000Z', lastUpdated: '2026-03-08T12:05:00.000Z' }), '2026-03-08T12:00:00.000Z');
  assert.equal(getVisibleDetailUpdatedAt({ cacheGeneratedAt: null, lastUpdated: '2026-03-08T12:05:00.000Z' }), '2026-03-08T12:05:00.000Z');
  behaviorAssertions.push('detail updated-at selection keeps public-first fallback semantics');

  assert.equal(shouldPrimeVersionRefresh('2026-03-08T12:05:00.000Z', '2026-03-08T12:00:00.000Z'), true);
  assert.equal(shouldPrimeVersionRefresh('2026-03-08T12:00:00.000Z', '2026-03-08T12:00:00.000Z'), false);
  assert.equal(shouldPrimeVersionRefresh(null, '2026-03-08T12:00:00.000Z'), false);
  behaviorAssertions.push('version priming only triggers when the backend timestamp is newer');

  assert.equal(hasVersionChanged('v1', 'v1'), false);
  assert.equal(hasVersionChanged('v1', 'v2'), true);
  assert.equal(hasVersionChanged(null, null), false);
  behaviorAssertions.push('version comparisons avoid false-positive refreshes');

  assert.equal(buildPendingFeedRefreshMessage(), 'Launch schedule updated.');
  behaviorAssertions.push('pending feed messaging uses the generic launch schedule update copy');

  assert.equal(isLaunchRefreshHotWindow('2026-03-08T13:00:00.000Z', Date.parse('2026-03-08T12:00:00.000Z')), true);
  assert.equal(isLaunchRefreshHotWindow('2026-03-08T13:00:00.000Z', Date.parse('2026-03-08T13:30:00.000Z')), false);
  behaviorAssertions.push('adaptive cadence enters at T-60 minutes and exits at T+30 minutes');

  assert.equal(
    getNextAdaptiveLaunchRefreshMs({
      nowMs: Date.parse('2026-03-08T12:00:10.000Z'),
      intervalSeconds: PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
      cadenceAnchorNet: '2026-03-08T13:01:00.000Z'
    }),
    Date.parse('2026-03-08T12:01:00.000Z')
  );
  behaviorAssertions.push('adaptive cadence wakes at the start of the hot window even when the default interval would skip past it');

  assert.equal(canAutoRefreshActiveSurface({ isFocused: true, appStateStatus: 'active' }), true);
  assert.equal(canAutoRefreshActiveSurface({ isFocused: false, appStateStatus: 'active' }), false);
  assert.equal(canAutoRefreshActiveSurface({ isFocused: true, appStateStatus: 'background' }), false);
  assert.equal(canAutoRefreshActiveSurface({ isFocused: true, appStateStatus: 'active', blocked: true }), false);
  behaviorAssertions.push('active-surface gating pauses refresh work when unfocused, backgrounded, or blocked');

  assert.equal(buildDetailVersionToken('launch-1', 'live', '2026-03-08T12:00:00.000Z'), 'launch-1|live|2026-03-08T12:00:00.000Z');
  behaviorAssertions.push('detail version tokens stay stable across screens');

  assertPattern(
    'apps/mobile/app/(tabs)/feed.tsx',
    /canAutoRefreshActiveSurface\(\{\s*isFocused,\s*appStateStatus,\s*blocked:\s*isFollowingFeed\s*\}\)/s,
    'mobile feed refresh loop is gated by focus, app state, and following-feed opt-out'
  );
  sourceAssertions.push('mobile feed uses shared active-surface gating');

  assertPattern(
    'apps/mobile/app/(tabs)/feed.tsx',
    /if \(feedScope !== 'live'\) \{[\s\S]*kind:\s*'anon_refresh'[\s\S]*Go Premium for near-live data[\s\S]*return;\s*\}/s,
    'mobile feed anon pull-to-refresh stays local and surfaces the scheduled refresh/upgrade notice'
  );
  sourceAssertions.push('mobile feed anon pull-to-refresh avoids network fetches');

  assertPattern(
    'apps/mobile/app/(tabs)/feed.tsx',
    /if \(snapshot\.feedScope === 'public'\) \{[\s\S]*await autoApplyPublicRefresh\(\);[\s\S]*return;\s*\}/s,
    'mobile feed auto-applies scheduled public updates instead of leaving anon users stranded on stale UI'
  );
  sourceAssertions.push('mobile feed public cadence auto-applies fresh public snapshots');

  assertPattern(
    'apps/mobile/app/(tabs)/feed.tsx',
    /getNextAdaptiveLaunchRefreshMs\(\{\s*nowMs:\s*Date\.now\(\),\s*intervalSeconds:\s*refreshIntervalSeconds,\s*cadenceAnchorNet\s*\}\)/s,
    'mobile feed schedules version checks with the adaptive cadence helper'
  );
  sourceAssertions.push('mobile feed uses adaptive cadence scheduling');

  assertPattern(
    'apps/mobile/app/launches/[id].tsx',
    /const detailVersionScope = entitlementsQuery\.data\?\.mode === 'live' \? 'live' : 'public';/,
    'mobile detail version checks resolve live vs public scope from entitlements'
  );
  sourceAssertions.push('mobile detail version scope follows entitlements');

  assertPattern(
    'apps/mobile/app/launches/[id].tsx',
    /fetchLaunchDetailVersion\(queryClient,\s*client,\s*launchId,\s*\{\s*scope:\s*detailVersionScope\s*\}\)/s,
    'mobile detail version checks use the resolved scope'
  );
  sourceAssertions.push('mobile detail version checks hit the scoped detail version route');

  assertPattern(
    'apps/mobile/app/launches/[id].tsx',
    /if \(detailVersionScope !== 'live'\) \{[\s\S]*kind:\s*'anon_refresh'[\s\S]*Go Premium for near-live data[\s\S]*return;\s*\}/s,
    'mobile detail anon pull-to-refresh stays local and surfaces the scheduled refresh/upgrade notice'
  );
  sourceAssertions.push('mobile detail anon pull-to-refresh avoids network fetches');

  assertPattern(
    'apps/mobile/app/launches/[id].tsx',
    /if \(detailVersionScope === 'public'\) \{[\s\S]*await applyResolvedDetailRefresh\(nextVersion\);[\s\S]*return;\s*\}/s,
    'mobile detail auto-applies scheduled public updates when the public version changes'
  );
  sourceAssertions.push('mobile detail public cadence auto-applies fresh public detail');

  assertPattern(
    'apps/mobile/app/launches/[id].tsx',
    /getNextAdaptiveLaunchRefreshMs\(\{\s*nowMs:\s*Date\.now\(\),\s*intervalSeconds:\s*refreshIntervalSeconds,\s*cadenceAnchorNet\s*\}\)/s,
    'mobile detail schedules version checks with the adaptive cadence helper'
  );
  sourceAssertions.push('mobile detail uses adaptive cadence scheduling');

  assertPattern(
    'apps/web/components/LaunchFeed.tsx',
    /buildPendingFeedRefreshMessage\(\)/,
    'web feed refresh banner copy uses the shared helper'
  );
  sourceAssertions.push('web feed banner messaging is sourced from the shared helper');

  assertPattern(
    'apps/web/components/LaunchDetailAutoRefresh.tsx',
    /hasVersionChanged\(lastSeenRef\.current,\s*nextVersion\)/,
    'web detail refresh only applies after a version change'
  );
  sourceAssertions.push('web detail avoids blind refetches when the version is unchanged');

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /const wantsLiveDetail = entitlement\.isAuthed && entitlement\.tier === 'premium';/,
    'mobile detail payload chooses live data for premium viewers'
  );
  sourceAssertions.push('premium mobile detail is wired to prefer the live launch row');

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /if \(liveClient\) \{[\s\S]*liveClient\.from\('launches'\)\.select\('\*'\)\.eq\('id',\s*parsedLaunch\.launchId\)\.eq\('hidden',\s*false\)/,
    'mobile detail live path reads from the live launches table'
  );
  sourceAssertions.push('premium mobile detail reads from the live launches table');

  assertPattern(
    'apps/web/lib/server/v1/mobileApi.ts',
    /const launch = useLiveDetail \? mapLiveLaunchRow\(data\) : mapPublicCacheRow\(data\);/,
    'mobile detail maps live rows through the live transformer'
  );
  sourceAssertions.push('mobile detail maps live rows with the live transformer');

  assertPattern(
    'apps/web/app/api/v1/launches/[id]/version/route.ts',
    /session\.authMode === 'bearer' && session\.accessToken[\s\S]*createSupabaseAccessTokenClient\(session\.accessToken\)/s,
    'detail version route supports bearer-auth live checks'
  );
  sourceAssertions.push('detail version route supports bearer-auth live refresh checks');

  assertPattern(
    'apps/web/app/api/v1/launches/route.ts',
    /enforceLaunchFeedPayloadRateLimit\(request,\s*\{\s*scope,\s*viewerId:\s*viewer\?\.userId \?\? null\s*\}\)/s,
    'feed payload route applies durable rate limiting before loading the feed'
  );
  sourceAssertions.push('feed payload route is rate limited');

  assertPattern(
    'apps/web/app/api/v1/launches/version/route.ts',
    /enforceLaunchFeedVersionRateLimit\(request,\s*\{\s*scope,\s*viewerId:\s*viewer\?\.userId \?\? null\s*\}\)/s,
    'feed version route applies durable rate limiting before returning versions'
  );
  sourceAssertions.push('feed version route is rate limited');

  assertPattern(
    'apps/web/app/api/v1/launches/[id]/route.ts',
    /enforceLaunchDetailPayloadRateLimit\(request,\s*\{[\s\S]*scope:\s*entitlement\.mode === 'live' \? 'live' : 'public',[\s\S]*viewerId:\s*entitlement\.userId/s,
    'detail payload route applies durable rate limiting before loading launch detail'
  );
  sourceAssertions.push('detail payload route is rate limited');

  assertPattern(
    'apps/web/app/api/v1/launches/[id]/version/route.ts',
    /enforceLaunchDetailVersionRateLimit\(request,\s*\{\s*scope,\s*viewerId:\s*viewer\.userId\s*\}\)/s,
    'detail version route applies durable rate limiting before returning versions'
  );
  sourceAssertions.push('detail version route is rate limited');

  assertPattern(
    'apps/web/lib/server/launchBoosterStats.ts',
    /^((?!fetchLl2LaunchDetail).)*$/s,
    'launch booster stats never trigger LL2 detail fetches on customer request paths'
  );
  sourceAssertions.push('launch booster stats stay DB-only on customer request paths');

  console.log(`launch-refresh-guard: ok (${behaviorAssertions.length + sourceAssertions.length} assertions)`);
}

await main();
