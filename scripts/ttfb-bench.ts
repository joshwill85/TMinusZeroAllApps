import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

type RouteResult = {
  route: string;
  samplesMs: number[];
};

const WEB_DIR = path.join(process.cwd(), 'apps', 'web');
const ROUTES = ['/', '/robots.txt', '/legal/privacy'];

async function main() {
  assert(
    fs.existsSync(path.join(WEB_DIR, '.next', 'BUILD_ID')),
    'Missing production build. Run `npm run build` first.'
  );

  const thresholdMs = readThresholdMs();
  const port = await getFreePort();
  const server = startNextServer(port);

  try {
    await waitForServerReady({ port, path: '/' });

    const results: RouteResult[] = [];
    for (const route of ROUTES) {
      await warmup({ port, route, requests: 10 });
      const samplesMs = await measureTtfb({ port, route, requests: 100 });
      results.push({ route, samplesMs });
    }

    for (const result of results) {
      const { route, samplesMs } = result;
      const stats = summarize(samplesMs);
      console.log(
        `${route} TTFB(ms): p50=${stats.p50.toFixed(3)} p95=${stats.p95.toFixed(3)} min=${stats.min.toFixed(3)} mean=${stats.mean.toFixed(3)} max=${stats.max.toFixed(3)}`
      );
    }

    if (thresholdMs != null) {
      const failing = results
        .map((result) => ({ route: result.route, ...summarize(result.samplesMs) }))
        .filter((stats) => stats.p95 > thresholdMs);

      assert.equal(
        failing.length,
        0,
        `TTFB threshold failed (p95 > ${thresholdMs}ms): ${failing.map((s) => `${s.route} p95=${s.p95.toFixed(3)}ms`).join(', ')}`
      );
    }
  } finally {
    await stopServer(server);
  }
}

function readThresholdMs() {
  const raw = process.argv.find((arg) => arg.startsWith('--threshold-ms='));
  if (!raw) return null;
  const value = raw.split('=')[1]?.trim();
  const parsed = value ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --threshold-ms value: ${value}`);
  }
  return parsed;
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

async function waitForServerReady({ port, path: routePath }: { port: number; path: string }) {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await requestFully({ port, route: routePath });
      return;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw lastError instanceof Error ? lastError : new Error('Server did not become ready');
}

async function warmup({ port, route, requests }: { port: number; route: string; requests: number }) {
  for (let i = 0; i < requests; i += 1) {
    await requestFully({ port, route });
  }
}

async function measureTtfb({ port, route, requests }: { port: number; route: string; requests: number }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const samples: number[] = [];
  for (let i = 0; i < requests; i += 1) {
    const sample = await requestTtfbMs({ port, route, agent });
    samples.push(sample);
  }
  agent.destroy();
  return samples;
}

async function requestTtfbMs({
  port,
  route,
  agent
}: {
  port: number;
  route: string;
  agent: http.Agent;
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
          Accept: 'text/html'
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

async function requestFully({ port, route }: { port: number; route: string }) {
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
            Accept: 'text/html'
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
  const sorted = [...values].sort((a, b) => a - b);
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
