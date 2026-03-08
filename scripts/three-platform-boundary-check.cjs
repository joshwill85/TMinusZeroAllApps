#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const ROOT_WEB_DIRS = [
  path.join(ROOT, 'apps', 'web', 'app'),
  path.join(ROOT, 'apps', 'web', 'components'),
  path.join(ROOT, 'app'),
  path.join(ROOT, 'components'),
];

const TARGETS = [
  {
    root: path.join(ROOT, 'packages'),
    label: 'shared package',
    forbidRootAppImports: true,
    forbidBrowserOnlyApis: true,
  },
  {
    root: path.join(ROOT, 'apps', 'mobile'),
    label: 'mobile app',
    forbidRootAppImports: true,
    forbidBrowserOnlyApis: true,
  },
];

const IMPORT_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const FORBIDDEN_IMPORT_RULES = [
  {
    test: (specifier) => specifier === 'next' || specifier.startsWith('next/'),
    message: 'must not import Next.js modules',
  },
  {
    test: (specifier) => specifier.includes('lib/server/') || specifier.endsWith('lib/server'),
    message: 'must not import server-only modules (`lib/server/*`)',
  },
  {
    test: (specifier) => specifier === '@/middleware' || specifier.endsWith('/middleware') || specifier.includes('/middleware/'),
    message: 'must not import root middleware modules',
  },
];

const ROOT_APP_IMPORT_RULES = [
  {
    test: (specifier) =>
      specifier.startsWith('@/app/') ||
      specifier.startsWith('@/components/') ||
      specifier.startsWith('app/') ||
      specifier.startsWith('components/'),
    message: 'must not import root web app/UI modules (`app/*` or `components/*`)',
  },
];

const BROWSER_ONLY_PATTERNS = [
  { pattern: /\bwindow\./, message: 'must not access `window`' },
  { pattern: /\bdocument\./, message: 'must not access `document`' },
  { pattern: /\blocalStorage\b/, message: 'must not access `localStorage`' },
  { pattern: /\bsessionStorage\b/, message: 'must not access `sessionStorage`' },
  { pattern: /\bnavigator\.serviceWorker\b/, message: 'must not access `navigator.serviceWorker`' },
  { pattern: /\bPushManager\b/, message: 'must not reference `PushManager`' },
  { pattern: /\bServiceWorkerGlobalScope\b/, message: 'must not reference `ServiceWorkerGlobalScope`' },
  { pattern: /\bNotification\./, message: 'must not access `Notification.*`' },
  { pattern: /\bnew\s+Notification\s*\(/, message: 'must not construct `Notification`' },
  { pattern: /\bself\.registration\b/, message: 'must not access service-worker registration state' },
  { pattern: /\bcaches\./, message: 'must not access the Cache Storage API' },
  { pattern: /\bclients\./, message: 'must not access service-worker clients' },
  { pattern: /\bHTMLElement\b/, message: 'must not reference DOM element types' },
  { pattern: /\bHTML[A-Z][A-Za-z0-9_]*Element\b/, message: 'must not reference DOM element types' },
];

function main() {
  const violations = [];
  const scannedRoots = [];

  for (const target of TARGETS) {
    if (!fs.existsSync(target.root)) continue;
    scannedRoots.push(path.relative(ROOT, target.root));
    for (const filePath of collectFiles(target.root)) {
      const relativePath = path.relative(ROOT, filePath);
      const source = fs.readFileSync(filePath, 'utf8');
      violations.push(...findImportViolations(relativePath, source, target));
      if (target.forbidBrowserOnlyApis) {
        violations.push(...findBrowserOnlyViolations(relativePath, source));
      }
    }
  }

  if (violations.length > 0) {
    console.error('three-platform-boundary-check: FAIL');
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  const summary = scannedRoots.length > 0 ? scannedRoots.join(', ') : '(no target directories present yet)';
  console.log(`three-platform-boundary-check: ok (${summary})`);
}

function collectFiles(dirPath) {
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    results.push(fullPath);
  }

  return results;
}

function findImportViolations(relativePath, source, target) {
  const violations = [];
  const rules = target.forbidRootAppImports ? FORBIDDEN_IMPORT_RULES.concat(ROOT_APP_IMPORT_RULES) : FORBIDDEN_IMPORT_RULES;
  const importerPath = path.join(ROOT, relativePath);

  for (const specifier of extractImportSpecifiers(source)) {
    if (target.forbidRootAppImports && resolvesIntoRootWebUi(importerPath, specifier)) {
      violations.push(`${relativePath}: import "${specifier}" must not import root web app/UI modules (\`app/*\` or \`components/*\`) in ${target.label} code`);
      continue;
    }
    for (const rule of rules) {
      if (rule.test(specifier)) {
        violations.push(`${relativePath}: import "${specifier}" ${rule.message} in ${target.label} code`);
      }
    }
  }

  return violations;
}

function findBrowserOnlyViolations(relativePath, source) {
  const violations = [];
  for (const rule of BROWSER_ONLY_PATTERNS) {
    if (rule.pattern.test(source)) {
      violations.push(`${relativePath}: ${rule.message}`);
    }
  }
  return violations;
}

function extractImportSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1] || match[2] || match[3];
    if (specifier) specifiers.push(specifier.trim());
  }
  return specifiers;
}

function resolvesIntoRootWebUi(importerPath, specifier) {
  if (!specifier.startsWith('.')) {
    return specifier.includes('/apps/web/app/') || specifier.includes('/apps/web/components/');
  }

  const resolvedBase = path.resolve(path.dirname(importerPath), specifier);
  const candidatePaths = [resolvedBase];
  for (const extension of EXTENSIONS) {
    candidatePaths.push(`${resolvedBase}${extension}`);
  }
  for (const extension of EXTENSIONS) {
    candidatePaths.push(path.join(resolvedBase, `index${extension}`));
  }

  return candidatePaths.some((candidatePath) => ROOT_WEB_DIRS.some((rootDir) => candidatePath === rootDir || candidatePath.startsWith(`${rootDir}${path.sep}`)));
}

main();
