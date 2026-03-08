import fs from 'fs';
import path from 'path';

type Finding = {
  file: string;
  pattern: string;
  match: string;
};

const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'apps/web');

const FILES_TO_GUARD = [
  'app/page.tsx',
  'app/launch-providers/page.tsx',
  'app/launch-providers/[slug]/page.tsx',
  'app/locations/[id]/page.tsx',
  'app/rockets/[id]/page.tsx',
  'lib/server/usProviderCounts.ts',
  'lib/server/providers.ts'
] as const;

const BANNED_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "import next/headers", regex: /from\s+['"]next\/headers['"]/g },
  { label: 'cookies()', regex: /\bcookies\s*\(/g },
  { label: 'headers()', regex: /\bheaders\s*\(/g },
  { label: 'createSupabaseServerClient', regex: /\bcreateSupabaseServerClient\b/g },
  { label: 'createSupabaseAdminClient', regex: /\bcreateSupabaseAdminClient\b/g },
  { label: 'getViewerTier', regex: /\bgetViewerTier\b/g }
];

function readFileOrNull(filePath: string) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function previewMatch(content: string, index: number) {
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + 60);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
}

function scanFile(relPath: string): Finding[] {
  const absPath = path.join(webRoot, relPath);
  const content = readFileOrNull(absPath);
  if (content == null) {
    return [{ file: relPath, pattern: 'file_missing', match: 'Unable to read file' }];
  }

  const findings: Finding[] = [];
  for (const { label, regex } of BANNED_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      findings.push({ file: relPath, pattern: label, match: previewMatch(content, match.index) });
      if (findings.length >= 50) return findings;
    }
  }
  return findings;
}

function main() {
  const findings = FILES_TO_GUARD.flatMap(scanFile);
  if (findings.length === 0) {
    // eslint-disable-next-line no-console
    console.log('public-cache-guard: ok');
    return;
  }

  // eslint-disable-next-line no-console
  console.error('public-cache-guard: failed (public SEO pages must be cookie-free and cacheable)');
  for (const finding of findings) {
    // eslint-disable-next-line no-console
    console.error(`- ${finding.file}: ${finding.pattern} :: ${finding.match}`);
  }
  process.exitCode = 1;
}

main();
