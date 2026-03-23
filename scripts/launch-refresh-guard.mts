import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDetailVersionToken,
  buildPendingFeedRefreshMessage,
  canAutoRefreshActiveSurface,
  getVisibleDetailUpdatedAt,
  getVisibleFeedUpdatedAt,
  hasVersionChanged,
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

  assert.equal(
    buildPendingFeedRefreshMessage({
      matchCount: 5,
      visibleCount: 3,
      canCompareCount: true
    }),
    '2 new launches are ready.'
  );
  assert.equal(
    buildPendingFeedRefreshMessage({
      matchCount: 3,
      visibleCount: 3,
      canCompareCount: false
    }),
    'Launch schedule updated.'
  );
  behaviorAssertions.push('pending feed messaging preserves delta copy and generic fallback copy');

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
    /setPendingRefresh\(null\);[\s\S]*<RefreshControl[\s\S]*void applyFeedRefresh\(\);/s,
    'mobile feed pull-to-refresh clears pending refresh state through the manual refresh path'
  );
  sourceAssertions.push('mobile feed pull-to-refresh keeps pending-refresh state coherent');

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
    /<RefreshControl[\s\S]*void refreshDetail\(null\);/s,
    'mobile detail exposes pull-to-refresh for manual reloads'
  );
  sourceAssertions.push('mobile detail keeps manual refresh available');

  assertPattern(
    'apps/web/components/LaunchFeed.tsx',
    /buildPendingFeedRefreshMessage\(\{\s*matchCount:\s*pendingRefresh\.matchCount,\s*visibleCount:\s*launches\.length,\s*canCompareCount:\s*!hasMore && !query\s*\}\)/s,
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
    /const wantsLiveDetail = entitlement\.isAuthed && \(entitlement\.isAdmin \|\| entitlement\.tier === 'premium'\);/,
    'mobile detail payload chooses live data for premium and admin viewers'
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

  console.log(`launch-refresh-guard: ok (${behaviorAssertions.length + sourceAssertions.length} assertions)`);
}

await main();
