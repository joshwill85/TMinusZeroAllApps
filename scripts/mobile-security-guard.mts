import fs from 'node:fs';
import path from 'node:path';

type GuardReport = {
  generatedAt: string;
  checks: string[];
};

const ROOT = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertIncludes(content: string, expected: string, message: string, checks: string[]) {
  if (!content.includes(expected)) {
    throw new Error(message);
  }
  checks.push(message);
}

function assertExcludes(content: string, unexpected: string, message: string, checks: string[]) {
  if (content.includes(unexpected)) {
    throw new Error(message);
  }
  checks.push(message);
}

function assertExists(relativePath: string, message: string, checks: string[]) {
  if (!fs.existsSync(path.join(ROOT, relativePath))) {
    throw new Error(message);
  }
  checks.push(message);
}

function main() {
  const checks: string[] = [];
  const callbackContent = read('apps/mobile/app/auth/callback.tsx');
  const resetPasswordContent = read('apps/mobile/app/auth/reset-password.tsx');
  const appConfigContent = read('apps/mobile/app.config.ts');
  const apiConfigContent = read('apps/mobile/src/config/api.ts');
  const authStorageContent = read('apps/mobile/src/auth/storage.ts');
  const authVerifyContent = read('apps/web/app/auth/verify/route.ts');

  assertExcludes(callbackContent, 'access_token', 'mobile auth callback rejects raw access_token params', checks);
  assertExcludes(callbackContent, 'refresh_token', 'mobile auth callback rejects raw refresh_token params', checks);
  assertExcludes(resetPasswordContent, 'access_token', 'mobile password reset rejects raw access_token params', checks);
  assertExcludes(resetPasswordContent, 'refresh_token', 'mobile password reset rejects raw refresh_token params', checks);

  assertIncludes(appConfigContent, 'associatedDomains:', 'app config declares associated domains for verified auth links', checks);
  assertIncludes(appConfigContent, 'www.tminuszero.app', 'app config includes the www host for verified auth links', checks);
  assertIncludes(appConfigContent, 'tminuszero.app', 'app config includes the apex host for verified auth links', checks);
  assertIncludes(appConfigContent, "autoVerify: true", 'android auth links remain auto-verified', checks);
  assertIncludes(appConfigContent, "pathPrefix: '/auth/'", 'verified mobile app links stay scoped to auth routes', checks);

  assertIncludes(apiConfigContent, 'assertSecureHttpsUrl', 'mobile config enforces https in non-development builds', checks);
  assertExcludes(
    authVerifyContent,
    "protocol === 'tminuszero:'",
    'server auth verification no longer permits custom-scheme auth redirects',
    checks
  );
  assertExcludes(
    authVerifyContent,
    "protocol === 'exp+tminuszero:'",
    'server auth verification no longer permits Expo custom-scheme auth redirects',
    checks
  );
  assertIncludes(
    authStorageContent,
    'SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    'mobile auth tokens use a device-only SecureStore accessibility class',
    checks
  );

  assertExists(
    'apps/web/app/.well-known/apple-app-site-association/route.ts',
    'apple app-site-association route exists for verified auth links',
    checks
  );
  assertExists('apps/web/app/apple-app-site-association/route.ts', 'apple root app-site-association route exists', checks);
  assertExists('apps/web/app/.well-known/assetlinks.json/route.ts', 'android assetlinks route exists for verified auth links', checks);

  const report: GuardReport = {
    generatedAt: new Date().toISOString(),
    checks
  };

  console.log(`mobile-security-guard: ok (${report.checks.length} checks)`);
}

try {
  main();
} catch (error) {
  console.error('mobile-security-guard: FAIL');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
