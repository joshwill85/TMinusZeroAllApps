import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  LAUNCH_INTENT_LANDING_KEYS,
  getLaunchIntentLandingConfig,
  type LaunchIntentLandingConfig
} from '@/lib/server/launchIntentLandingConfig';

type ParsedHead = {
  title: string | null;
  canonical: string | null;
  meta: Map<string, string>;
  jsonLd: Array<Record<string, unknown>>;
};

type RouteReport = {
  route: string;
  title: string;
  h1: string;
  canonical: string;
  description: string;
  robots: string;
  sitemap: 'included';
  schemaTypes: string[];
  intro: string;
  htmlSnippet: string;
};

const WEB_DIR = path.join(process.cwd(), 'apps', 'web');
const ROUTE_MAX_DESCRIPTION_LENGTH = 160;

async function main() {
  const port = await getFreePort();
  const server = startNextDevServer(port);

  try {
    await waitForServerReady(port, '/');

    const sitemapXml = await fetchText(`http://localhost:${port}/sitemap.xml`);
    const sitemapLocs = new Set(
      extractLocs(sitemapXml).map((loc) => {
        try {
          return new URL(loc).pathname;
        } catch {
          return loc;
        }
      })
    );

    const reports: RouteReport[] = [];

    for (const key of LAUNCH_INTENT_LANDING_KEYS) {
      const config = getLaunchIntentLandingConfig(key);
      reports.push(await auditRoute({ port, config, sitemapLocs }));
    }

    console.log(JSON.stringify(reports, null, 2));
  } finally {
    await stopServer(server);
  }
}

function startNextDevServer(port: number) {
  const nextCli = path.join(
    process.cwd(),
    'node_modules',
    'next',
    'dist',
    'bin',
    'next'
  );

  return spawn(process.execPath, [nextCli, 'dev', '-p', String(port)], {
    cwd: WEB_DIR,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
      NEXT_PUBLIC_OG_IMAGE_VERSION: 'intent-landing-audit',
      TMZ_ALLOW_LOCAL_INDEXING: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function auditRoute({
  port,
  config,
  sitemapLocs
}: {
  port: number;
  config: LaunchIntentLandingConfig;
  sitemapLocs: Set<string>;
}): Promise<RouteReport> {
  const html = await fetchText(`http://localhost:${port}${config.path}`);
  const head = parseHead(html);
  const description = head.meta.get('description') || null;
  const robots = (head.meta.get('robots') || 'index, follow').toLowerCase();
  const h1 = extractFirstHeading(html);
  const intro = extractIntroText(html);
  const hrefs = extractHrefValues(html);
  const schemaTypes = [...collectJsonLdTypes(head.jsonLd)].sort();

  assert.equal(head.title, config.title, `[${config.path}] title mismatch`);
  assert.equal(h1, config.title, `[${config.path}] h1 mismatch`);
  assert.equal(
    description,
    config.description,
    `[${config.path}] description mismatch`
  );
  assert.ok(
    description.length <= ROUTE_MAX_DESCRIPTION_LENGTH,
    `[${config.path}] description should be <= ${ROUTE_MAX_DESCRIPTION_LENGTH} chars`
  );
  assert.equal(
    toPathname(head.canonical),
    config.path,
    `[${config.path}] canonical path mismatch`
  );
  assert.ok(
    !robots.includes('noindex'),
    `[${config.path}] route should remain indexable`
  );
  assert.ok(
    html.includes('aria-label="Breadcrumb"'),
    `[${config.path}] missing breadcrumb navigation`
  );
  assert.equal(
    intro,
    config.intro,
    `[${config.path}] intro copy mismatch`
  );
  assert.ok(
    sitemapLocs.has(config.path),
    `[${config.path}] missing from sitemap.xml`
  );

  for (const link of config.relatedLinks) {
    assert.ok(
      hrefs.has(link.href),
      `[${config.path}] missing related internal link ${link.href}`
    );
  }

  for (const requiredType of getRequiredSchemaTypes(config)) {
    assert.ok(
      schemaTypes.includes(requiredType),
      `[${config.path}] missing JSON-LD type ${requiredType}. Found: ${schemaTypes.join(', ') || '(none)'}`
    );
  }

  return {
    route: config.path,
    title: head.title || '',
    h1: h1 || '',
    canonical: head.canonical || '',
    description: description || '',
    robots,
    sitemap: 'included',
    schemaTypes,
    intro,
    htmlSnippet: extractHtmlSnippet(html)
  };
}

function getRequiredSchemaTypes(config: LaunchIntentLandingConfig) {
  switch (config.source.kind) {
    case 'provider':
      return ['BreadcrumbList', 'CollectionPage', 'Organization'];
    case 'mission':
      return ['BreadcrumbList', 'CollectionPage', 'Product'];
    case 'location':
      return ['BreadcrumbList', 'CollectionPage', 'Place'];
    case 'state':
      return ['BreadcrumbList', 'CollectionPage', 'AdministrativeArea'];
    case 'today':
      return ['BreadcrumbList', 'CollectionPage'];
    case 'next-provider-launch':
      return ['BreadcrumbList', 'WebPage', 'Organization'];
  }
}

async function waitForServerReady(port: number, route: string) {
  const deadline = Date.now() + 90_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://localhost:${port}${route}`, {
        headers: { 'x-forwarded-proto': 'https' },
        redirect: 'manual'
      });
      if (response.status === 200) return;
      lastError = new Error(`Unexpected status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Next dev server did not become ready');
}

async function stopServer(child: ReturnType<typeof startNextDevServer>) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 10_000;
  while (child.exitCode == null && Date.now() < deadline) {
    await sleep(50);
  }
  if (child.exitCode == null) child.kill('SIGKILL');
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: { 'x-forwarded-proto': 'https' },
    redirect: 'manual'
  });
  assert.equal(response.status, 200, `Expected 200 for ${url}`);
  return response.text();
}

function parseHead(html: string): ParsedHead {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[1] : html;
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtml(stripTags(titleMatch[1])).trim() : null;
  const canonical = extractCanonicalHref(head);
  const meta = new Map<string, string>();

  for (const tag of head.match(/<meta\s+[^>]*>/gi) ?? []) {
    const attrs = parseTagAttributes(tag);
    const key = attrs.property || attrs.name;
    if (!key || !attrs.content) continue;
    meta.set(key, decodeHtml(attrs.content));
  }

  return {
    title,
    canonical,
    meta,
    jsonLd: parseJsonLd(html)
  };
}

function extractCanonicalHref(head: string) {
  for (const tag of head.match(/<link\s+[^>]*>/gi) ?? []) {
    const attrs = parseTagAttributes(tag);
    if ((attrs.rel || '').toLowerCase() === 'canonical' && attrs.href) {
      return attrs.href;
    }
  }
  return null;
}

function parseJsonLd(html: string) {
  const objects: Array<Record<string, unknown>> = [];
  const regex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html))) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const parsed = JSON.parse(raw);
    for (const node of normalizeJsonLdNodes(parsed)) {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        objects.push(node as Record<string, unknown>);
      }
    }
  }

  return objects;
}

function normalizeJsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeJsonLdNodes(entry));
  }
  return value == null ? [] : [value];
}

function collectJsonLdTypes(jsonLd: Array<Record<string, unknown>>) {
  const types = new Set<string>();
  for (const node of jsonLd) {
    const rawType = node['@type'];
    if (typeof rawType === 'string') {
      types.add(rawType);
      continue;
    }
    if (Array.isArray(rawType)) {
      for (const value of rawType) {
        if (typeof value === 'string') types.add(value);
      }
    }
  }
  return types;
}

function extractFirstHeading(html: string) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match?.[1] ? decodeHtml(stripTags(match[1])).trim() : null;
}

function extractIntroText(html: string) {
  const match = html.match(
    /<header[\s\S]*?<p[^>]*class="[^"]*max-w-3xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  );
  return match?.[1] ? decodeHtml(stripTags(match[1])).trim() : null;
}

function extractHrefValues(html: string) {
  const hrefs = new Set<string>();
  const regex = /<a\s+[^>]*href="([^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html))) {
    if (match[1]) hrefs.add(match[1]);
  }
  return hrefs;
}

function extractHtmlSnippet(html: string) {
  const h1Match = html.match(
    /(<h1[^>]*>[\s\S]*?<\/h1>[\s\S]*?<p[^>]*class="[^"]*max-w-3xl[^"]*"[^>]*>[\s\S]*?<\/p>)/i
  );
  const source = h1Match?.[1] || html;
  return source.replace(/\s+/g, ' ').trim().slice(0, 320);
}

function extractLocs(xml: string) {
  const locs: string[] = [];
  const regex = /<loc>([^<]+)<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml))) {
    if (match[1]) locs.push(match[1]);
  }
  return locs;
}

function parseTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z_:][a-zA-Z0-9_:\-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(tag))) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return attrs;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

function toPathname(url: string | null) {
  if (!url) return '';
  try {
    return normalizePath(new URL(url).pathname);
  } catch {
    return normalizePath(url);
  }
}

function normalizePath(value: string) {
  if (!value) return '';
  return value === '/' ? '/' : value.replace(/\/+$/, '');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const { port } = address;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
        return;
      }
      server.close();
      reject(new Error('Unable to determine free port'));
    });
    server.on('error', reject);
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
