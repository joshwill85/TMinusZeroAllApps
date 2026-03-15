import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

type RouteResult = {
  route: string;
  accept: string;
  samplesMs: number[];
};

type BenchReport = {
  generatedAt: string;
  requests: number;
  warmupRequests: number;
  thresholdMs: number | null;
  routes: Array<{
    route: string;
    accept: string;
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
  }>;
};

type BenchOptions = {
  routes: string[];
  accept: string;
  requests: number;
  warmupRequests: number;
  thresholdMs: number | null;
  outputPath: string | null;
  markdownPath: string | null;
};

const WEB_DIR = path.join(process.cwd(), 'apps', 'web');
const DEFAULT_ROUTES = ['/', '/robots.txt', '/legal/privacy'];

async function main() {
  assert(
    fs.existsSync(path.join(WEB_DIR, '.next', 'BUILD_ID')),
    'Missing production build. Run `npm run build` first.'
  );

  const options = readOptions(process.argv.slice(2));
  const report = await runBench(options);

  for (const result of report.routes) {
    console.log(
      `${result.route} TTFB(ms): p50=${result.p50.toFixed(3)} p95=${result.p95.toFixed(3)} min=${result.min.toFixed(3)} mean=${result.mean.toFixed(3)} max=${result.max.toFixed(3)}`
    );
  }

  writeJson(options.outputPath, report);
  writeMarkdown(options.markdownPath, renderMarkdown(report));
}

export async function runBench(options: BenchOptions): Promise<BenchReport> {
  const port = await getFreePort();
  const server = startNextServer(port);

  try {
    await waitForServerReady({ port, routePath: options.routes[0] || '/' });

    const results: RouteResult[] = [];
    for (const route of options.routes) {
      await warmup({ port, route, requests: options.warmupRequests, accept: options.accept });
      const samplesMs = await measureTtfb({
        port,
        route,
        requests: options.requests,
        accept: options.accept
      });
      results.push({ route, accept: options.accept, samplesMs });
    }

    if (options.thresholdMs != null) {
      const failing = results
        .map((result) => ({ route: result.route, ...summarize(result.samplesMs) }))
        .filter((stats) => stats.p95 > options.thresholdMs!);

      assert.equal(
        failing.length,
        0,
        `TTFB threshold failed (p95 > ${options.thresholdMs}ms): ${failing.map((s) => `${s.route} p95=${s.p95.toFixed(3)}ms`).join(', ')}`
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      requests: options.requests,
      warmupRequests: options.warmupRequests,
      thresholdMs: options.thresholdMs,
      routes: results.map((result) => ({
        route: result.route,
        accept: result.accept,
        ...summarize(result.samplesMs)
      }))
    };
  } finally {
    await stopServer(server);
  }
}

function readOptions(argv: string[]): BenchOptions {
  const routes = argv
    .filter((arg) => arg.startsWith('--route='))
    .map((arg) => arg.slice('--route='.length).trim())
    .filter(Boolean);

  return {
    routes: routes.length > 0 ? routes : DEFAULT_ROUTES,
    accept: readStringOption(argv, 'accept') || 'text/html',
    requests: readPositiveIntOption(argv, 'requests', 100),
    warmupRequests: readPositiveIntOption(argv, 'warmup', 10),
    thresholdMs: readOptionalPositiveNumberOption(argv, 'threshold-ms'),
    outputPath: readStringOption(argv, 'output'),
    markdownPath: readStringOption(argv, 'markdown')
  };
}

function readStringOption(argv: string[], key: string) {
  const prefix = `--${key}=`;
  const match = argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : null;
}

function readPositiveIntOption(argv: string[], key: string, fallback: number) {
  const raw = readStringOption(argv, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --${key} value: ${raw}`);
  }
  return value;
}

function readOptionalPositiveNumberOption(argv: string[], key: string) {
  const raw = readStringOption(argv, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --${key} value: ${raw}`);
  }
  return value;
}

function writeJson(filePath: string | null, value: unknown) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string | null, markdown: string) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function renderMarkdown(report: BenchReport) {
  const lines = [
    '# TTFB Bench',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Requests per route: ${report.requests}`,
    `- Warmup requests per route: ${report.warmupRequests}`,
    `- Threshold: ${report.thresholdMs == null ? 'none' : `${report.thresholdMs}ms p95`}`,
    '',
    '| route | accept | p50 ms | p95 ms | min ms | mean ms | max ms |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |'
  ];

  for (const route of report.routes) {
    lines.push(
      `| \`${route.route}\` | \`${route.accept}\` | ${route.p50.toFixed(3)} | ${route.p95.toFixed(3)} | ${route.min.toFixed(3)} | ${route.mean.toFixed(3)} | ${route.max.toFixed(3)} |`
    );
  }

  return lines.join('\n');
}

function startNextServer(port: number) {
  const nextCli = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_OG_IMAGE_VERSION: 'ttfb-bench'
  };

  return spawn(process.execPath, [nextCli, 'start', '-p', String(port)], {
    cwd: WEB_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
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

async function waitForServerReady({ port, routePath }: { port: number; routePath: string }) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await requestFully({ port, route: routePath, accept: '*/*' });
      return;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw lastError instanceof Error ? lastError : new Error('Server did not become ready');
}

async function warmup({ port, route, requests, accept }: { port: number; route: string; requests: number; accept: string }) {
  for (let i = 0; i < requests; i += 1) {
    await requestFully({ port, route, accept });
  }
}

async function measureTtfb({
  port,
  route,
  requests,
  accept
}: {
  port: number;
  route: string;
  requests: number;
  accept: string;
}) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const samples: number[] = [];
  for (let i = 0; i < requests; i += 1) {
    const sample = await requestTtfbMs({ port, route, agent, accept });
    samples.push(sample);
  }
  agent.destroy();
  return samples;
}

async function requestTtfbMs({
  port,
  route,
  agent,
  accept
}: {
  port: number;
  route: string;
  agent: http.Agent;
  accept: string;
}): Promise<number> {
  return await new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: route,
        agent,
        headers: {
          'x-forwarded-proto': 'https',
          Accept: accept
        }
      },
      (res) => {
        let ttfbMs: number | null = null;
        res.once('data', () => {
          ttfbMs = performance.now() - start;
        });
        res.on('data', () => {});
        res.on('end', () => {
          resolve(ttfbMs ?? performance.now() - start);
        });
        res.on('error', reject);
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function requestFully({ port, route, accept }: { port: number; route: string; accept: string }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method: 'GET',
          path: route,
          agent,
          headers: {
            'x-forwarded-proto': 'https',
            Accept: accept
          }
        },
        (res) => {
          res.on('data', () => {});
          res.on('end', resolve);
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    });
  } finally {
    agent.destroy();
  }
}

function summarize(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  const mean = sorted.length ? sum / sorted.length : 0;
  return {
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95)
  };
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  const clamped = Math.min(sortedValues.length - 1, Math.max(0, index));
  return sortedValues[clamped]!;
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        server.close((error) => {
          if (error) reject(error);
          else resolve(port);
        });
      } else {
        reject(new Error('Unable to allocate port'));
      }
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main();
