#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const allowlist = new Set([
  'apps/web/app/account/login-methods/page.tsx',
  'apps/web/app/account/page.tsx',
  'apps/web/app/auth/callback/AuthCallbackClient.tsx',
  'apps/web/app/auth/forgot-password/page.tsx',
  'apps/web/app/auth/reset-password/ResetPasswordClient.tsx',
  'apps/web/app/legal/privacy-choices/privacy-choices-client.tsx',
  'apps/web/components/AuthForm.tsx',
  'apps/web/components/FeedbackWidget.tsx',
  'apps/web/components/NavBar.tsx',
  'apps/web/components/SocialReferrerDisclaimer.tsx',
  'apps/web/components/WebQueryProvider.tsx',
  'apps/web/lib/api/supabase.ts'
]);

function runRg(args) {
  try {
    return execFileSync('rg', args, { encoding: 'utf8' }).trim();
  } catch (error) {
    if (error && typeof error.status === 'number' && error.status === 1) {
      return '';
    }
    throw error;
  }
}

const files = runRg(['-l', 'getBrowserClient', 'apps/web', '-g', '*.ts', '-g', '*.tsx'])
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean)
  .sort();

const unexpected = files.filter((file) => !allowlist.has(file));
if (unexpected.length > 0) {
  console.error('Unexpected browser Supabase usage outside the auth/account allowlist:');
  for (const file of unexpected) {
    console.error(`- ${file}`);
  }
  process.exit(1);
}

const directProductQueries = runRg([
  '-n',
  'getBrowserClient\\(\\)\\.(from|rpc|schema)',
  'apps/web',
  '-g',
  '*.ts',
  '-g',
  '*.tsx'
]);

if (directProductQueries) {
  console.error('Direct browser Supabase data queries are not allowed:');
  console.error(directProductQueries);
  process.exit(1);
}

console.log(`browser-supabase-guard: ok (${files.length} allowlisted references)`);
