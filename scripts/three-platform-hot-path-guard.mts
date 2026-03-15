import fs from 'node:fs';
import path from 'node:path';

type GuardResult = {
  generatedAt: string;
  checks: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;
};

const ROOT = process.cwd();
const args = new Map(
  process.argv.slice(2).flatMap((arg) => {
    if (!arg.startsWith('--')) return [];
    const [key, ...rest] = arg.slice(2).split('=');
    return [[key, rest.join('=')]];
  })
);

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function regexTest(source: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  return pattern.test(source);
}

function renderMarkdown(report: GuardResult) {
  return [
    '# Three-Platform Hot Path Guard',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| check | status | detail |',
    '| --- | --- | --- |',
    ...report.checks.map((check) => `| ${check.name} | ${check.ok ? 'ok' : 'failed'} | ${check.detail} |`)
  ].join('\n');
}

const middlewareSource = read('apps/web/middleware.ts');
const siteSearchSource = read('apps/web/lib/server/siteSearch.ts');
const searchRouteSource = read('apps/web/app/api/search/route.ts');
const legacySubscriptionSource = read('apps/web/app/api/me/subscription/route.ts');
const billingCoreSource = read('apps/web/lib/server/billingCore.ts');
const guardedRouteFiles = [
  'apps/web/app/api/search/route.ts',
  'apps/web/app/api/search/index/route.ts',
  'apps/web/app/api/calendar/[token]/route.ts',
  'apps/web/app/rss/[token]/route.ts',
  'apps/web/app/api/embed/next-launch/route.ts',
  'apps/web/app/api/launches/[id]/ics/route.ts',
  'apps/web/app/api/launches/ics/route.ts'
];

const checks = [
  {
    name: 'middleware-no-in-memory-rate-limit',
    ok:
      !middlewareSource.includes('rateLimitStore') &&
      !middlewareSource.includes('consumeRateLimit(') &&
      !middlewareSource.includes('pruneRateLimitStore('),
    detail: 'apps/web/middleware.ts should not own correctness-critical rate limiting.'
  },
  {
    name: 'legacy-search-no-refresh-on-read',
    ok: !siteSearchSource.includes('ensureSiteSearchFresh(') && siteSearchSource.includes('deprecated: true'),
    detail: 'siteSearch warm path must stay deprecated and search must not trigger freshness sync.'
  },
  {
    name: 'legacy-search-warm-is-no-op',
    ok: searchRouteSource.includes("searchParams.get('warm') === '1'"),
    detail: 'legacy /api/search warm path is retained only as a backward-compatible entrypoint.'
  },
  {
    name: 'legacy-subscription-no-reconcile-on-read',
    ok: legacySubscriptionSource.includes('reconcileStripe: false'),
    detail: 'legacy /api/me/subscription must not trigger Stripe reconciliation on read.'
  },
  {
    name: 'billing-summary-no-reconcile-on-read',
    ok:
      regexTest(
        billingCoreSource,
        /export async function loadBillingSummary[\s\S]{0,500}?reconcileStripe:\s*false/
      ) &&
      !regexTest(
        billingCoreSource,
        /export async function loadBillingSummary[\s\S]{0,500}?reconcileStripe:\s*true/
      ),
    detail: 'shared billing summary reads must not reconcile Stripe synchronously.'
  },
  {
    name: 'durable-rate-limit-applied-at-routes',
    ok: guardedRouteFiles.every((file) => read(file).includes('enforceDurableRateLimit')),
    detail: 'public and tokenized routes should use the durable DB-backed rate-limit helper.'
  }
];

const report: GuardResult = {
  generatedAt: new Date().toISOString(),
  checks
};

const outputPath = args.get('output') || '';
if (outputPath) {
  const resolved = path.isAbsolute(outputPath) ? outputPath : path.join(ROOT, outputPath);
  writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
}

const markdownPath = args.get('markdown') || '';
if (markdownPath) {
  const resolved = path.isAbsolute(markdownPath) ? markdownPath : path.join(ROOT, markdownPath);
  writeFile(resolved, `${renderMarkdown(report)}\n`);
}

const failingChecks = checks.filter((check) => !check.ok);
if (failingChecks.length > 0) {
  for (const check of failingChecks) {
    console.error(`${check.name}: ${check.detail}`);
  }
  process.exitCode = 1;
}
