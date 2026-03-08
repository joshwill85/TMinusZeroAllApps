import { config } from 'dotenv';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

type EndpointCheck = {
  label: string;
  url: string;
  expectedContentTypeIncludes: string;
};

type Result = {
  label: string;
  ok: boolean;
  status?: number;
  etag?: string | null;
  cacheControl?: string | null;
  contentType?: string | null;
  detail?: string;
};

config({ path: '.env.local' });
config();

const { values } = parseArgs({
  options: {
    baseUrl: { type: 'string' },
    calendarToken: { type: 'string' },
    rssToken: { type: 'string' },
    timeoutMs: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  npm run test:token-feeds -- --calendar-token=<uuid> --rss-token=<uuid>
  npm run test:token-feeds -- --base-url=https://tminuszero.app --calendar-token=<uuid>

Options:
  --base-url=<url>         Base URL (default: NEXT_PUBLIC_SITE_URL, else VERCEL_URL, else http://localhost:3000)
  --calendar-token=<uuid>  Calendar feed token to test (/api/calendar/<token>.ics)
  --rss-token=<uuid>       RSS feed token to test (/rss/<token>.xml + /rss/<token>.atom)
  --timeout-ms=<ms>        Per-request timeout (default: 10000)
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

async function main() {
  const baseUrl = resolveBaseUrl(values.baseUrl);
  const timeoutMs = parseNumber(values.timeoutMs, 10_000, 'timeout-ms');

  const calendarToken = normalizeUuid(values.calendarToken);
  const rssToken = normalizeUuid(values.rssToken);
  if (!calendarToken && !rssToken) {
    console.error('Provide at least one of: --calendar-token, --rss-token\n');
    console.log(usage);
    process.exitCode = 1;
    return;
  }

  const checks: EndpointCheck[] = [];
  if (calendarToken) {
    checks.push({
      label: 'Calendar (.ics)',
      url: `${baseUrl}/api/calendar/${encodeURIComponent(calendarToken)}.ics`,
      expectedContentTypeIncludes: 'text/calendar'
    });
  }
  if (rssToken) {
    checks.push(
      {
        label: 'RSS (.xml)',
        url: `${baseUrl}/rss/${encodeURIComponent(rssToken)}.xml`,
        expectedContentTypeIncludes: 'application/rss+xml'
      },
      {
        label: 'Atom (.atom)',
        url: `${baseUrl}/rss/${encodeURIComponent(rssToken)}.atom`,
        expectedContentTypeIncludes: 'application/atom+xml'
      }
    );
  }

  const results: Result[] = [];
  for (const check of checks) {
    results.push(...(await checkEndpoint(check, timeoutMs)));
  }

  printResults(results);

  const failed = results.filter((row) => !row.ok);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

function resolveBaseUrl(cliBaseUrl: string | undefined) {
  const raw =
    String(cliBaseUrl || '').trim() ||
    String(process.env.NEXT_PUBLIC_SITE_URL || '').trim() ||
    (() => {
      const vercelUrl = String(process.env.VERCEL_URL || '').trim();
      return vercelUrl ? `https://${vercelUrl.replace(/\/+$/, '')}` : '';
    })() ||
    'http://localhost:3000';

  return raw.replace(/\/+$/, '');
}

function parseNumber(raw: string | undefined, fallback: number, label: string) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Invalid ${label}: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

function normalizeUuid(value: string | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const cleaned = raw.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cleaned)) {
    console.error(`Invalid UUID: ${raw}`);
    process.exit(1);
  }
  return cleaned;
}

async function checkEndpoint(check: EndpointCheck, timeoutMs: number): Promise<Result[]> {
  const expectedCacheParts = ['public', 's-maxage=15', 'stale-while-revalidate=60'];

  const first = await fetchWithTimeout(check.url, { timeoutMs });
  const firstCacheControl = first.headers.get('cache-control');
  const firstContentType = first.headers.get('content-type');
  const firstEtag = first.headers.get('etag');

  const base: Result = {
    label: check.label,
    ok: true,
    status: first.status,
    etag: firstEtag,
    cacheControl: firstCacheControl,
    contentType: firstContentType
  };

  if (first.status !== 200) {
    const text = await safeReadBody(first, 256);
    return [
      {
        ...base,
        ok: false,
        detail: `Expected 200, got ${first.status}${text ? `; body: ${text}` : ''}`
      }
    ];
  }

  const cacheMissing = expectedCacheParts.filter((part) => !String(firstCacheControl || '').includes(part));
  if (cacheMissing.length > 0) {
    return [
      {
        ...base,
        ok: false,
        detail: `Cache-Control missing: ${cacheMissing.join(', ')}`
      }
    ];
  }

  if (!String(firstContentType || '').includes(check.expectedContentTypeIncludes)) {
    return [
      {
        ...base,
        ok: false,
        detail: `Unexpected Content-Type: ${firstContentType || '(missing)'}`
      }
    ];
  }

  if (!firstEtag) {
    return [
      {
        ...base,
        ok: false,
        detail: 'Missing ETag header'
      }
    ];
  }

  const second = await fetchWithTimeout(check.url, {
    timeoutMs,
    headers: { 'if-none-match': firstEtag }
  });

  const secondEtag = second.headers.get('etag');
  if (secondEtag && secondEtag !== firstEtag) {
    return [
      {
        ...base,
        ok: false,
        detail: `ETag changed between requests (${mask(firstEtag)} -> ${mask(secondEtag)})`
      }
    ];
  }

  if (second.status !== 304) {
    const text = await safeReadBody(second, 256);
    return [
      {
        ...base,
        ok: false,
        detail: `Expected 304 on If-None-Match, got ${second.status}${text ? `; body: ${text}` : ''}`
      }
    ];
  }

  return [base];
}

async function safeReadBody(response: Response, maxChars: number) {
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return '';
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars)}…`;
  } catch {
    return '';
  }
}

async function fetchWithTimeout(
  url: string,
  {
    timeoutMs,
    headers
  }: {
    timeoutMs: number;
    headers?: Record<string, string>;
  }
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function mask(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 10) return '***';
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`;
}

function printResults(results: Result[]) {
  const labelWidth = Math.max(5, ...results.map((row) => row.label.length));
  const statusWidth = 4;
  console.log(`${pad('Check', labelWidth)}  ${pad('OK?', statusWidth)}  Detail`);

  for (const row of results) {
    const status = row.ok ? 'YES' : 'NO';
    const detail = row.ok ? 'OK' : row.detail || 'Failed';
    console.log(`${pad(row.label, labelWidth)}  ${pad(status, statusWidth)}  ${detail}`);
  }
}

function pad(value: string, width: number) {
  assert.ok(width >= 0);
  const raw = String(value);
  if (raw.length >= width) return raw;
  return raw + ' '.repeat(width - raw.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

