import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

type CheckResult = {
  host: string;
  https: { ok: boolean; status?: number; error?: string };
  http: { ok: boolean; status?: number; location?: string; error?: string };
};

const usage = `Usage:
  ts-node --project tsconfig.scripts.json --transpile-only scripts/check-https-subdomains.ts [options] <host...>

Options:
  -f, --file <path>        File with hosts (one per line, # comments ok)
  -t, --timeout <ms>       Per-request timeout in ms (default: 8000)
  -c, --concurrency <n>    Number of hosts to check in parallel (default: 4)
  -h, --help               Show this help

Examples:
  ts-node --project tsconfig.scripts.json --transpile-only scripts/check-https-subdomains.ts example.com blog.example.com
  ts-node --project tsconfig.scripts.json --transpile-only scripts/check-https-subdomains.ts -f subdomains.txt
`;

const { values, positionals } = parseArgs({
  options: {
    file: { type: 'string', short: 'f' },
    timeout: { type: 'string', short: 't' },
    concurrency: { type: 'string', short: 'c' },
    help: { type: 'boolean', short: 'h' }
  },
  allowPositionals: true
});

if (values.help) {
  console.log(usage);
  process.exit(0);
}

const timeoutMs = parseNumber(values.timeout, 8000, 'timeout');
const concurrency = parseNumber(values.concurrency, 4, 'concurrency');

const hosts = await loadHosts(values.file, positionals);
if (hosts.length === 0) {
  console.error('No hosts provided.\n');
  console.log(usage);
  process.exit(1);
}

const results = await runPool(hosts, Math.max(1, concurrency), checkHost);

printResults(results);

const hasFailures = results.some((result) => !result.https.ok || !result.http.ok);
if (hasFailures) {
  process.exitCode = 1;
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

async function loadHosts(filePath: string | undefined, args: string[]) {
  const inputs: string[] = [];

  if (filePath) {
    const contents = await readFile(filePath, 'utf8');
    for (const line of contents.split('\n')) {
      const stripped = line.split('#')[0]?.trim();
      if (stripped) inputs.push(stripped);
    }
  }

  inputs.push(...args);

  const seen = new Set<string>();
  const hosts: string[] = [];

  for (const input of inputs) {
    const host = normalizeHost(input);
    if (!host) continue;
    if (!seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  }

  return hosts;
}

function normalizeHost(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return '';

  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return new URL(trimmed).host;
    }
  } catch {
    // Fall back to manual cleanup below.
  }

  return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

async function checkHost(host: string): Promise<CheckResult> {
  const https = await checkHttps(host, timeoutMs);
  const http = await checkHttpRedirect(host, timeoutMs);

  return { host, https, http };
}

async function checkHttps(host: string, timeout: number) {
  const url = `https://${host}/`;
  let response = await request(url, 'HEAD', timeout);
  if (response?.status === 405) {
    response = await request(url, 'GET', timeout);
  }

  if (!response) {
    return { ok: false, error: 'no response' };
  }

  if ('error' in response) {
    return { ok: false, error: response.error };
  }

  return { ok: true, status: response.status };
}

async function checkHttpRedirect(host: string, timeout: number) {
  const url = `http://${host}/`;
  let response = await request(url, 'HEAD', timeout);
  if (response?.status === 405) {
    response = await request(url, 'GET', timeout);
  }

  if (!response) {
    return { ok: false, error: 'no response' };
  }

  if ('error' in response) {
    return { ok: false, error: response.error };
  }

  const location = response.headers.get('location') ?? '';
  const isRedirect = [301, 302, 307, 308].includes(response.status);
  const redirectsToHttps = isRedirect && location.toLowerCase().startsWith('https://');

  return {
    ok: redirectsToHttps,
    status: response.status,
    location: location || undefined
  };
}

async function request(url: string, method: 'HEAD' | 'GET', timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal
    });
    return response;
  } catch (error) {
    return { error: formatError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function formatError(error: unknown) {
  if (!error || typeof error !== 'object') return String(error);
  const err = error as { name?: string; message?: string; cause?: unknown; code?: string };
  if (err.name === 'AbortError') return 'timeout';

  const cause = err.cause as { code?: string; message?: string } | undefined;
  const code = cause?.code ?? err.code;
  const parts = [code, err.message].filter(Boolean);
  return parts.join(' ');
}

async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let index = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      results[current] = await worker(items[current]);
    }
  });

  await Promise.all(runners);
  return results;
}

function printResults(results: CheckResult[]) {
  const hostWidth = Math.max(4, ...results.map((result) => result.host.length));
  const httpsWidth = 18;
  const httpWidth = 24;

  const header = `${pad('Host', hostWidth)}  ${pad('HTTPS', httpsWidth)}  ${pad(
    'HTTP->HTTPS',
    httpWidth
  )}  Notes`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const result of results) {
    const httpsSummary = result.https.ok
      ? `ok (${result.https.status})`
      : `fail (${result.https.error ?? 'error'})`;
    const httpSummary = result.http.ok
      ? `ok (${result.http.status})`
      : result.http.error
        ? `error (${result.http.error})`
        : `fail (${result.http.status})`;
    const notes = result.http.ok
      ? ''
      : result.http.location
        ? `location=${result.http.location}`
        : '';

    console.log(
      `${pad(result.host, hostWidth)}  ${pad(httpsSummary, httpsWidth)}  ${pad(
        httpSummary,
        httpWidth
      )}  ${notes}`
    );
  }
}

function pad(value: string, width: number) {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}
