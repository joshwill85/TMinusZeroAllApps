import fs from 'node:fs';
import path from 'node:path';

type RawFetchFinding = {
  file: string;
  count: number;
};

type SurfaceExpectationResult = {
  file: string;
  ok: boolean;
  missingTokens: string[];
};

type Phase3WebGuardReport = {
  generatedAt: string;
  mobileCriticalFilesScanned: number;
  totalWebFilesScanned: number;
  totalRawApiFetchCount: number;
  rawApiFetchFiles: RawFetchFinding[];
  mobileCriticalViolations: string[];
  surfaceExpectations: SurfaceExpectationResult[];
};

const ROOT = process.cwd();
const WEB_ROOT = path.join(ROOT, 'apps', 'web');
const SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?)$/;

const MOBILE_CRITICAL_WEB_FILES = [
  'apps/web/components/LaunchFeed.tsx',
  'apps/web/components/LaunchCard.tsx',
  'apps/web/components/SiteChrome.tsx',
  'apps/web/components/DesktopRail.tsx',
  'apps/web/components/DockingBay.tsx',
  'apps/web/components/LaunchSearchModal.tsx',
  'apps/web/components/PremiumUpsellModal.tsx',
  'apps/web/components/UpgradePageContent.tsx',
  'apps/web/components/AuthForm.tsx',
  'apps/web/components/SignUpPanel.tsx',
  'apps/web/components/JepScorePanel.tsx',
  'apps/web/components/ar/SkyCompass.tsx',
  'apps/web/components/ar/ArSession.tsx',
  'apps/web/app/search/SearchPageClient.tsx',
  'apps/web/app/account/page.tsx',
  'apps/web/app/account/saved/page.tsx',
  'apps/web/app/account/integrations/page.tsx',
  'apps/web/app/me/preferences/page.tsx',
  'apps/web/app/legal/privacy-choices/privacy-choices-client.tsx',
  'apps/web/app/auth/callback/AuthCallbackClient.tsx',
  'apps/web/app/auth/sign-in/page.tsx',
  'apps/web/app/launches/[id]/ar/page.tsx',
  'apps/web/app/api/public/launches/[id]/trajectory/v2/route.ts',
  'apps/web/lib/server/siteSearch.ts',
  'apps/web/lib/server/v1/mobileApi.ts',
  'apps/web/lib/server/entitlements.ts',
  'apps/web/lib/server/viewerTier.ts',
  'apps/web/lib/server/jep.ts'
];

const BANNED_SPECIFIERS = new Map([
  ['@/lib/tiers', 'use @tminuszero/domain instead of the web-local tier helper'],
  ['@/lib/search/shared', 'use @tminuszero/domain instead of the web-local search helper'],
  ['@/lib/server/trajectoryContract', 'use @tminuszero/domain instead of the web-local trajectory contract helper'],
  ['@/lib/trajectory/milestones', 'use @tminuszero/domain instead of the web-local trajectory milestones helper'],
  [
    '@/lib/trajectory/trajectoryEvidencePresentation',
    'use @tminuszero/domain instead of the web-local trajectory presentation helper'
  ],
  ['@/lib/utils/returnTo', 'use @tminuszero/navigation instead of the compatibility shim']
]);

const SURFACE_EXPECTATIONS = new Map<string, string[]>([
  [
    'apps/web/components/LaunchFeed.tsx',
    ['useViewerSessionQuery', 'useViewerEntitlementsQuery', 'useFilterPresetsQuery', 'useWatchlistsQuery', 'buildAuthHref']
  ],
  [
    'apps/web/app/account/page.tsx',
    ['useProfileQuery', 'useMarketingEmailQuery', 'useNotificationPreferencesQuery', 'buildAuthHref', 'buildUpgradeHref']
  ],
  [
    'apps/web/app/account/saved/page.tsx',
    ['useFilterPresetsQuery', 'useWatchlistsQuery', 'buildAuthHref', 'buildProfileHref']
  ],
  [
    'apps/web/app/me/preferences/page.tsx',
    ['buildProfileHref', 'BRAND_NAME', 'Open profile', 'Open account']
  ],
  [
    'apps/web/app/auth/callback/AuthCallbackClient.tsx',
    ['buildAuthCallbackHref', 'buildAuthHref', 'readAuthIntent', 'readReturnTo', 'sanitizeReturnTo', 'invalidateViewerScopedQueries']
  ],
  [
    'apps/web/components/UpgradePageContent.tsx',
    ['buildAuthHref', 'buildProfileHref', 'useStartBillingCheckoutMutation', 'sanitizeReturnToPath']
  ]
]);

const IMPORT_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const RAW_FETCH_PATTERN = /\bfetch\(\s*['"`]\/api\//g;

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    const [key, ...rest] = trimmed.split('=');
    args.set(key, rest.join('='));
  }
  return args;
}

function ensureParentDir(filePath: string | null) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string | null, value: unknown) {
  if (!filePath) return;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string | null, markdown: string) {
  if (!filePath) return;
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function walkFiles(rootDir: string, out: string[] = []) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.turbo') continue;
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, out);
      continue;
    }
    if (SOURCE_FILE_PATTERN.test(entry.name)) {
      out.push(absolutePath);
    }
  }
  return out;
}

function extractImportSpecifiers(source: string) {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) specifiers.push(specifier.trim());
  }
  return specifiers;
}

function countRawApiFetches(source: string) {
  return [...source.matchAll(RAW_FETCH_PATTERN)].length;
}

export function collectPhase3WebGuardReport(): Phase3WebGuardReport {
  const mobileCriticalViolations: string[] = [];
  const surfaceExpectations: SurfaceExpectationResult[] = [];

  for (const relativePath of MOBILE_CRITICAL_WEB_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      mobileCriticalViolations.push(`${relativePath}: file missing from Phase 3 guard target list`);
      continue;
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    if (countRawApiFetches(source) > 0) {
      mobileCriticalViolations.push(`${relativePath}: direct fetch('/api/...') is not allowed on Phase 3 mobile-critical surfaces`);
    }

    for (const specifier of extractImportSpecifiers(source)) {
      const message = BANNED_SPECIFIERS.get(specifier);
      if (message) {
        mobileCriticalViolations.push(`${relativePath}: import "${specifier}" is banned; ${message}`);
      }
    }
  }

  for (const [relativePath, requiredTokens] of SURFACE_EXPECTATIONS.entries()) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      surfaceExpectations.push({
        file: relativePath,
        ok: false,
        missingTokens: ['file missing']
      });
      continue;
    }

    const source = fs.readFileSync(absolutePath, 'utf8');
    const missingTokens = requiredTokens.filter((token) => !source.includes(token));
    surfaceExpectations.push({
      file: relativePath,
      ok: missingTokens.length === 0,
      missingTokens
    });
    if (missingTokens.length > 0) {
      mobileCriticalViolations.push(`${relativePath}: missing required surface tokens: ${missingTokens.join(', ')}`);
    }
  }

  const allWebFiles = walkFiles(WEB_ROOT);
  const rawApiFetchFiles = allWebFiles
    .map((absolutePath) => {
      const source = fs.readFileSync(absolutePath, 'utf8');
      const count = countRawApiFetches(source);
      return {
        file: path.relative(ROOT, absolutePath),
        count
      };
    })
    .filter((entry) => entry.count > 0)
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.file.localeCompare(right.file);
    });

  return {
    generatedAt: new Date().toISOString(),
    mobileCriticalFilesScanned: MOBILE_CRITICAL_WEB_FILES.length,
    totalWebFilesScanned: allWebFiles.length,
    totalRawApiFetchCount: rawApiFetchFiles.reduce((sum, finding) => sum + finding.count, 0),
    rawApiFetchFiles,
    mobileCriticalViolations,
    surfaceExpectations
  };
}

function renderMarkdown(report: Phase3WebGuardReport) {
  const lines = [
    '# Phase 3 Web Closeout Guard',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Mobile-critical files scanned: ${report.mobileCriticalFilesScanned}`,
    `- Total apps/web source files scanned: ${report.totalWebFilesScanned}`,
    `- Remaining raw \`fetch('/api/...')\` call sites in apps/web: ${report.totalRawApiFetchCount}`,
    ''
  ];

  lines.push('## Surface Expectations');
  lines.push('');
  lines.push('| file | status | missing tokens |');
  lines.push('| --- | --- | --- |');
  for (const surface of report.surfaceExpectations) {
    lines.push(`| \`${surface.file}\` | ${surface.ok ? 'ok' : 'missing'} | ${surface.missingTokens.join(', ') || '—'} |`);
  }
  lines.push('');

  lines.push('## Remaining Raw /api Fetches');
  lines.push('');
  lines.push('| file | count |');
  lines.push('| --- | ---: |');
  for (const finding of report.rawApiFetchFiles.slice(0, 25)) {
    lines.push(`| \`${finding.file}\` | ${finding.count} |`);
  }
  if (report.rawApiFetchFiles.length === 0) {
    lines.push('| none | 0 |');
  }
  lines.push('');

  lines.push('## Violations');
  lines.push('');
  if (report.mobileCriticalViolations.length === 0) {
    lines.push('- none');
  } else {
    for (const violation of report.mobileCriticalViolations) {
      lines.push(`- ${violation}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = collectPhase3WebGuardReport();

  writeJson(args.get('output') || null, report);
  writeMarkdown(args.get('markdown') || null, renderMarkdown(report));

  if (report.mobileCriticalViolations.length > 0) {
    console.error('phase3-web-closeout-guard: FAIL');
    for (const violation of report.mobileCriticalViolations) {
      console.error(`- ${violation}`);
    }
    console.error(`remaining raw /api fetch count in apps/web: ${report.totalRawApiFetchCount}`);
    process.exit(1);
  }

  console.log(
    `phase3-web-closeout-guard: ok (${report.mobileCriticalFilesScanned} files scanned, ${report.totalRawApiFetchCount} remaining raw /api fetch call sites in apps/web)`
  );
}

await main();
