import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

type ParsedHead = {
  title: string | null;
  canonical: string | null;
  meta: Map<string, string>;
};

const REQUIRED_META_KEYS = [
  'description',
  'og:title',
  'og:description',
  'og:type',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:alt',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
  'twitter:image:alt'
];

const ROUTES_TO_VALIDATE = [
  '/',
  '/artemis',
  '/artemis/awardees',
  '/artemis/awardees/lockheed-martin',
  '/artemis-i',
  '/artemis-ii',
  '/artemis-iii',
  '/artemis-iv',
  '/artemis-v',
  '/artemis-vi',
  '/artemis-vii',
  '/artemis/content',
  '/catalog',
  '/catalog/astronauts',
  '/launch-providers/spacex',
  '/docs/about',
  '/starship',
  '/satellites',
  '/satellites/owners',
  '/blue-origin/travelers',
  '/about',
  '/legal/privacy'
];

const SNIPPET_BANNED_TEXT = ['loading telemetry', 'comm link', 'manifest'];
const TIERED_SITEMAP_ROUTES = [
  '/sitemap.xml',
  '/sitemap-launches.xml',
  '/sitemap-entities.xml',
  '/sitemap-catalog.xml',
  '/sitemap-satellites.xml',
  '/sitemap-satellite-owners.xml'
];

const WEB_DIR = path.join(process.cwd(), 'apps', 'web');

async function main() {
  assert(
    fs.existsSync(path.join(WEB_DIR, '.next', 'BUILD_ID')),
    'Missing production build. Run `npm run build` first.'
  );

  const port = await getFreePort();
  const server = startNextServer(port);
  try {
    await waitForServerReady({ port, path: '/' });
    for (const route of ROUTES_TO_VALIDATE) {
      const url = `http://localhost:${port}${route}`;
      const html = await fetchHtml(url);
      const head = parseHead(html);

      assert.ok(head.title, `[${route}] missing <title>`);
      assert.ok(head.canonical, `[${route}] missing canonical link`);

      for (const key of REQUIRED_META_KEYS) {
        assert.ok(head.meta.get(key), `[${route}] missing meta: ${key}`);
      }

      assert.equal(head.meta.get('og:type'), 'website', `[${route}] og:type should be "website"`);
      assert.equal(head.meta.get('twitter:card'), 'summary_large_image', `[${route}] twitter:card should be "summary_large_image"`);

      assert.ok(isAbsoluteUrl(head.canonical), `[${route}] canonical should be absolute: ${head.canonical}`);
      assert.ok(isAbsoluteUrl(head.meta.get('og:image')), `[${route}] og:image should be absolute: ${head.meta.get('og:image')}`);
      assert.ok(isAbsoluteUrl(head.meta.get('twitter:image')), `[${route}] twitter:image should be absolute: ${head.meta.get('twitter:image')}`);
      const canonicalPath = toPathname(head.canonical);
      assert.equal(canonicalPath, route, `[${route}] canonical path mismatch`);

      assert.equal(head.meta.get('og:image:width'), '1200', `[${route}] og:image:width should be 1200`);
      assert.equal(head.meta.get('og:image:height'), '630', `[${route}] og:image:height should be 630`);

      const bannedMatches = findBannedTextOutsideNosnippet(html, SNIPPET_BANNED_TEXT);
      assert.equal(bannedMatches.length, 0, `[${route}] snippet pollution: ${bannedMatches.join(', ')}`);
      const robots = (head.meta.get('robots') || '').toLowerCase();
      assert.ok(!robots.includes('noindex'), `[${route}] should be indexable`);
    }

    await assertRedirect({ port, route: '/artemis-2', expectedLocationPath: '/artemis-ii', expectedStatus: 308 });
    await assertRedirect({
      port,
      route: '/launch-providers/spacex:SpaceX',
      expectedLocationPath: '/launch-providers/spacex',
      expectedStatus: 308
    });
    await assertRedirect({
      port,
      route: '/catalog?entity=astronauts&q=neil&page=2',
      expectedLocationPath: '/catalog/astronauts',
      expectedLocationSearch: '?q=neil&page=2',
      expectedStatus: 308
    });

    const authHtml = await fetchHtml(`http://localhost:${port}/auth/sign-in`);
    const authHead = parseHead(authHtml);
    const authRobots = (authHead.meta.get('robots') || '').toLowerCase();
    assert.ok(authRobots.includes('noindex'), '[/auth/sign-in] expected robots noindex');

    const awardeeQueryHtml = await fetchHtml(`http://localhost:${port}/artemis/awardees?q=lockheed`);
    const awardeeQueryHead = parseHead(awardeeQueryHtml);
    const awardeeQueryRobots = (awardeeQueryHead.meta.get('robots') || '').toLowerCase();
    assert.ok(awardeeQueryRobots.includes('noindex'), '[/artemis/awardees?q=...] expected robots noindex');
    assert.equal(toPathname(awardeeQueryHead.canonical), '/artemis/awardees', '[/artemis/awardees?q=...] canonical path mismatch');

    await assertNoIndexRoute({ port, route: '/artemis/content?kind=photo', expectedCanonicalPath: '/artemis/content' });
    await assertNoIndexRoute({ port, route: '/catalog/astronauts?q=neil&page=2', expectedCanonicalPath: '/catalog/astronauts' });
    await assertNoIndexRoute({ port, route: '/search?q=starship', expectedCanonicalPath: '/search' });
    await assertNoIndexRoute({ port, route: '/spacex/contracts?show=200', expectedCanonicalPath: '/spacex/contracts' });
    await assertNoIndexRoute({ port, route: '/blue-origin/contracts?show=200', expectedCanonicalPath: '/blue-origin/contracts' });
    await assertNoIndexRoute({ port, route: '/artemis/contracts?show=200', expectedCanonicalPath: '/artemis/contracts' });
    await assertNoIndexRoute({ port, route: '/artemis?view=intel', expectedCanonicalPath: '/artemis' });
    await assertNoIndexRoute({ port, route: '/starship?view=timeline', expectedCanonicalPath: '/starship' });

    await assertHeaderContains({
      port,
      route: '/opengraph-image/jpeg?v=seo-tests',
      header: 'x-robots-tag',
      expectedSubstring: 'noindex'
    });
    await assertHeaderContains({
      port,
      route: '/launches/00000000-0000-0000-0000-000000000000/opengraph-image/seo-tests/jpeg',
      header: 'x-robots-tag',
      expectedSubstring: 'noindex'
    });

    await assertTieredSitemaps({ port });
  } finally {
    await stopServer(server);
  }

  console.log('SEO tests passed.');
}

function startNextServer(port: number) {
  const nextCli = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_OG_IMAGE_VERSION: 'seo-tests'
  };

  const child = spawn(process.execPath, [nextCli, 'start', '-p', String(port)], {
    cwd: WEB_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

async function stopServer(child: ReturnType<typeof startNextServer>) {
  if (child.exitCode != null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 5_000;
  while (child.exitCode == null && Date.now() < deadline) {
    await sleep(50);
  }
  if (child.exitCode == null) {
    child.kill('SIGKILL');
  }
}

async function waitForServerReady({ port, path: routePath }: { port: number; path: string }) {
  const url = `http://localhost:${port}${routePath}`;
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers: { 'x-forwarded-proto': 'https' },
        redirect: 'manual'
      });
      if (response.status === 200) return;
      lastError = new Error(`Unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw lastError instanceof Error ? lastError : new Error('Server did not become ready');
}

async function fetchHtml(url: string) {
  const response = await fetch(url, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(response.status, 200, `Expected 200 for ${url} but got ${response.status}`);
  return response.text();
}

async function assertRedirect({
  port,
  route,
  expectedLocationPath,
  expectedLocationSearch,
  expectedStatus
}: {
  port: number;
  route: string;
  expectedLocationPath: string;
  expectedLocationSearch?: string;
  expectedStatus: number;
}) {
  const response = await fetch(`http://localhost:${port}${route}`, {
    headers: { 'x-forwarded-proto': 'https' },
    redirect: 'manual'
  });

  assert.equal(response.status, expectedStatus, `[${route}] expected redirect status ${expectedStatus}, got ${response.status}`);

  const location = response.headers.get('location');
  assert.ok(location, `[${route}] missing redirect location`);

  const resolvedUrl = location.startsWith('http') ? new URL(location) : new URL(location, `http://localhost:${port}`);
  assert.equal(resolvedUrl.pathname, expectedLocationPath, `[${route}] expected redirect location ${expectedLocationPath}, got ${location}`);
  if (typeof expectedLocationSearch === 'string') {
    assert.equal(
      resolvedUrl.search,
      expectedLocationSearch,
      `[${route}] expected redirect search ${expectedLocationSearch}, got ${resolvedUrl.search || '(empty)'}`
    );
  }
}

async function assertHeaderContains({
  port,
  route,
  header,
  expectedSubstring
}: {
  port: number;
  route: string;
  header: string;
  expectedSubstring: string;
}) {
  const response = await fetch(`http://localhost:${port}${route}`, {
    headers: { 'x-forwarded-proto': 'https' },
    redirect: 'manual'
  });
  const value = (response.headers.get(header) || '').toLowerCase();
  assert.ok(value.includes(expectedSubstring.toLowerCase()), `[${route}] expected ${header} to include "${expectedSubstring}"`);
}

async function assertNoIndexRoute({
  port,
  route,
  expectedCanonicalPath
}: {
  port: number;
  route: string;
  expectedCanonicalPath: string;
}) {
  const html = await fetchHtml(`http://localhost:${port}${route}`);
  const head = parseHead(html);
  const robots = (head.meta.get('robots') || '').toLowerCase();
  assert.ok(robots.includes('noindex'), `[${route}] expected robots noindex`);
  assert.equal(toPathname(head.canonical), expectedCanonicalPath, `[${route}] canonical path mismatch`);
}

async function assertTieredSitemaps({ port }: { port: number }) {
  const robotsTxt = await fetchText(`http://localhost:${port}/robots.txt`);
  for (const route of TIERED_SITEMAP_ROUTES) {
    assert.ok(robotsTxt.includes(route), `[robots.txt] missing sitemap entry for ${route}`);
  }

  const coreLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap.xml`));
  const launchIndexLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-launches.xml`));
  const entityIndexLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-entities.xml`));
  const catalogIndexLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-catalog.xml`));
  const satelliteSitemapLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-satellites.xml`));
  const ownerSitemapLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-satellite-owners.xml`));

  const launchLeafLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-launches.xml?page=1`));
  const entityLeafLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-entities.xml?page=1`));
  const catalogLeafLocs = extractLocs(await fetchText(`http://localhost:${port}/sitemap-catalog.xml?page=1`));

  assert.ok(
    coreLocs.some((loc) => loc.endsWith('/artemis/awardees')),
    '[sitemap.xml] missing /artemis/awardees entry'
  );
  assert.ok(
    coreLocs.some((loc) => loc.endsWith('/artemis/content')),
    '[sitemap.xml] missing /artemis/content entry'
  );
  assert.ok(
    coreLocs.some((loc) => loc.endsWith('/catalog/astronauts')),
    '[sitemap.xml] missing /catalog/astronauts entry'
  );
  assert.ok(
    launchIndexLocs.some((loc) => loc.includes('/sitemap-launches.xml?page=1')),
    '[sitemap-launches.xml] missing first shard reference'
  );
  assert.ok(
    entityIndexLocs.some((loc) => loc.includes('/sitemap-entities.xml?page=1')),
    '[sitemap-entities.xml] missing first shard reference'
  );
  assert.ok(
    catalogIndexLocs.some((loc) => loc.includes('/sitemap-catalog.xml?page=1')),
    '[sitemap-catalog.xml] missing first shard reference'
  );
  assert.ok(
    entityLeafLocs.some((loc) => loc.endsWith('/artemis/awardees/lockheed-martin')),
    '[sitemap-entities.xml?page=1] missing /artemis/awardees/lockheed-martin entry'
  );
  assert.ok(
    launchLeafLocs.some((loc) => loc.includes('/launches/')),
    '[sitemap-launches.xml?page=1] missing launch detail entries'
  );
  assert.ok(
    catalogLeafLocs.some((loc) => loc.includes('/catalog/')),
    '[sitemap-catalog.xml?page=1] missing catalog detail entries'
  );
  assert.ok(
    satelliteSitemapLocs.some((loc) => loc.includes('/sitemap-satellites.xml?page=1')),
    '[sitemap-satellites.xml] missing first shard reference'
  );
  assert.ok(
    ownerSitemapLocs.some((loc) => loc.endsWith('/satellites/owners')),
    '[sitemap-satellite-owners.xml] missing /satellites/owners entry'
  );

  const lastLaunchLeaf = launchIndexLocs.at(-1);
  if (lastLaunchLeaf) {
    const lastLaunchLeafLocs = extractLocs(await fetchText(lastLaunchLeaf));
    assert.ok(lastLaunchLeafLocs.length > 0, '[sitemap-launches.xml] last shard should contain older launch entries');
  }
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(response.status, 200, `Expected 200 for ${url} but got ${response.status}`);
  return response.text();
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

function parseHead(html: string): ParsedHead {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  const head = headMatch ? headMatch[1] : html;

  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;

  const canonicalHref = (() => {
    const linkTags = head.match(/<link\s+[^>]*>/gi) ?? [];
    for (const tag of linkTags) {
      const attrs = parseTagAttributes(tag);
      if ((attrs.rel || '').toLowerCase() === 'canonical' && attrs.href) return attrs.href;
    }
    return null;
  })();

  const meta = new Map<string, string>();
  const metaTags = head.match(/<meta\s+[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const attrs = parseTagAttributes(tag);
    const key = attrs.property || attrs.name;
    if (!key) continue;
    if (!attrs.content) continue;
    meta.set(key, attrs.content);
  }

  return { title, canonical: canonicalHref, meta };
}

function toPathname(url: string | null): string {
  if (!url) return '';
  try {
    const pathname = new URL(url).pathname;
    return normalizePath(pathname);
  } catch {
    return normalizePath(url);
  }
}

function normalizePath(value: string): string {
  if (!value) return '';
  return value === '/' ? '/' : value.replace(/\/+$/, '');
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

function isAbsoluteUrl(value: string | null | undefined) {
  if (!value) return false;
  return value.startsWith('https://') || value.startsWith('http://');
}

function findBannedTextOutsideNosnippet(html: string, bannedText: string[]) {
  const banned = bannedText.map((value) => value.toLowerCase()).filter(Boolean);
  const found = new Set<string>();

  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr'
  ]);

  type Frame = { tag: string; nosnippet: boolean };
  const stack: Frame[] = [];
  let i = 0;
  let inScript = false;
  let inStyle = false;

  const isNosnippet = () => (stack.length ? stack[stack.length - 1].nosnippet : false);
  const shouldScanText = () => !inScript && !inStyle && !isNosnippet();

  const scanText = (text: string) => {
    if (!shouldScanText()) return;
    const lower = text.toLowerCase();
    for (const token of banned) {
      if (lower.includes(token)) found.add(token);
    }
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      scanText(html.slice(i));
      break;
    }

    if (lt > i) {
      scanText(html.slice(i, lt));
    }

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }

    const gt = html.indexOf('>', lt + 1);
    if (gt === -1) break;

    const rawTag = html.slice(lt + 1, gt);
    const trimmed = rawTag.trim();
    const isClosing = trimmed.startsWith('/');
    const cleaned = trimmed.replace(/^\/+/, '');
    const tagName = cleaned.split(/\s+/, 1)[0]?.toLowerCase() || '';
    const selfClosing = /\/\s*$/.test(trimmed) || voidTags.has(tagName);

    if (isClosing) {
      if (tagName === 'script') inScript = false;
      if (tagName === 'style') inStyle = false;

      for (let idx = stack.length - 1; idx >= 0; idx -= 1) {
        const frame = stack.pop();
        if (frame?.tag === tagName) break;
      }
      i = gt + 1;
      continue;
    }

    const parentNosnippet = isNosnippet();
    const thisNosnippet = parentNosnippet || /\bdata-nosnippet\b/i.test(rawTag);
    if (!selfClosing) {
      stack.push({ tag: tagName, nosnippet: thisNosnippet });
    }

    if (tagName === 'script') inScript = true;
    if (tagName === 'style') inStyle = true;

    i = gt + 1;
  }

  return [...found];
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
