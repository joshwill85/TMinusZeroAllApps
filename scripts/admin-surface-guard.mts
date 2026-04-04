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

  assertPattern(
    'apps/web/app/admin/layout.tsx',
    /await requireAdminViewer\(\);/,
    'web admin layout server-gates the admin tree before rendering the shell'
  );
  assertions.push('web admin layout hard-gates the route tree');

  assertPattern(
    'apps/web/app/api/admin/_lib/auth.ts',
    /status:\s*404/,
    'shared admin API auth helper returns 404 for outsider requests'
  );
  assertNoPattern(
    'apps/web/app/api/admin/_lib/auth.ts',
    /error:\s*'unauthorized'|error:\s*'forbidden'/,
    'shared admin API auth helper no longer exposes unauthorized/forbidden admin errors'
  );
  assertions.push('shared admin API auth is fail-closed');

  assertPattern(
    'apps/web/app/api/v1/me/admin-access-override/route.ts',
    /error\.status === 401 \|\| error\.status === 403 \? 404 : error\.status/,
    'admin self-service override route maps outsider access failures to 404'
  );
  assertions.push('admin override route hard-hides outsider access');

  assertNoPattern('apps/web/components/NavBar.tsx', /href="\/admin"/, 'web navbar exposes no admin link');
  assertNoPattern('apps/web/components/DockingBay.tsx', /href:\s*'\/admin'/, 'web dock exposes no admin link');
  assertions.push('normal web navigation has no admin entry point');

  assertNoPattern(
    'apps/web/app/account/page.tsx',
    /Admin Access Testing|useAdminAccessOverrideQuery|useUpdateAdminAccessOverrideMutation/,
    'web account page contains no embedded admin access tooling'
  );
  assertNoPattern(
    'apps/mobile/app/(tabs)/profile.tsx',
    /Admin access testing|useAdminAccessOverrideQuery|useUpdateAdminAccessOverrideMutation|label="Admin"/,
    'mobile profile contains no embedded admin tooling or admin badge'
  );
  assertions.push('customer account roots no longer embed admin controls');

  assertNoPattern(
    'apps/mobile/src/features/account/AccountMembershipScreen.tsx',
    /Stored billing on this device is separate from admin-controlled access|Admin access can stay premium|label="Admin"/,
    'mobile membership screen contains no customer-visible admin wording'
  );
  assertNoPattern(
    'apps/mobile/src/features/account/ProfileScreenUi.tsx',
    /Admin test mode|Admin default|Admin access|Your admin role/,
    'shared mobile account copy is admin-blind outside admin routes'
  );
  assertions.push('customer entitlement copy is admin-blind');

  assertNoPattern(
    'apps/web/components/RocketVolatilitySection.tsx',
    /admin credentials/i,
    'public rocket volatility copy no longer references admin credentials'
  );
  assertNoPattern(
    'apps/web/app/docs/roadmap/page.tsx',
    /Admin \+ Ops|Admin and ops/i,
    'public roadmap page contains no admin roadmap wording'
  );
  assertNoPattern(
    'apps/web/lib/server/v1/mobileReference.ts',
    /Admin and ops|Internal tooling remains web-first/i,
    'public mobile reference content contains no admin roadmap wording'
  );
  assertions.push('public editorial and diagnostic copy hides admin/internal wording');

  assertPattern(
    'apps/web/app/admin/access/page.tsx',
    /Customer access testing/,
    'web admin access screen exists'
  );
  assertPattern(
    'apps/mobile/app/admin/_layout.tsx',
    /sessionQuery\.data\?\.role !== 'admin'[\s\S]*<NotFoundScreen \/>/,
    'mobile admin route group fails closed to the not-found screen'
  );
  assertPattern(
    'apps/mobile/app/admin/access.tsx',
    /AdminAccessScreen/,
    'mobile admin access route exists'
  );
  assertPattern(
    'apps/mobile/src/features/admin/AdminAccessScreen.tsx',
    /Customer access testing/,
    'mobile admin access screen exists'
  );
  assertions.push('admin-only destinations exist on web and mobile');

  assertPattern(
    'apps/mobile/e2e/core-shell.e2e.js',
    /tminuszero:\/\/admin\/access/,
    'mobile E2E suite covers non-admin deep links to admin routes'
  );
  assertions.push('mobile regression coverage checks the hidden admin route');

  console.log(`admin-surface-guard: ok (${assertions.length} assertions)`);
}

await main();
