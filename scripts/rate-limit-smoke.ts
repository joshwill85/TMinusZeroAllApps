import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ensureLocalSupabaseStarted } from './three-platform-local-stack';

type ScenarioReport = {
  name: string;
  limit: number;
  attempts: number;
  allowed: number;
  blocked: number;
};

type RateLimitSmokeReport = {
  generatedAt: string;
  scenarios: ScenarioReport[];
};

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    markdown: { type: 'string' }
  }
});

function writeFile(filePath: string, contents: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function renderMarkdown(report: RateLimitSmokeReport) {
  return [
    '# Durable Rate Limit Smoke',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '| scenario | attempts | allowed | blocked |',
    '| --- | ---: | ---: | ---: |',
    ...report.scenarios.map(
      (scenario) => `| ${scenario.name} | ${scenario.attempts} | ${scenario.allowed} | ${scenario.blocked} |`
    )
  ].join('\n');
}

async function runScenario(
  name: string,
  options: {
    scope: string;
    limit: number;
    attempts: number;
    tokenKey?: string;
    clientId?: string;
  }
) {
  const { enforceDurableRateLimit } = await import('../apps/web/lib/server/apiRateLimit');

  const requests = Array.from({ length: options.attempts }, () =>
    enforceDurableRateLimit(
      new Request('http://127.0.0.1:3000/api/search', {
        headers: {
          'x-forwarded-for': '198.51.100.23',
          'user-agent': 'three-platform-rate-limit-smoke/1.0'
        }
      }),
      {
        scope: options.scope,
        limit: options.limit,
        windowSeconds: 60,
        tokenKey: options.tokenKey ?? null,
        clientId: options.clientId ?? null
      }
    )
  );

  const responses = await Promise.all(requests);
  const allowed = responses.filter((response) => response === null).length;
  const blocked = responses.filter((response) => response?.status === 429).length;

  if (allowed !== options.limit || blocked !== options.attempts - options.limit) {
    throw new Error(
      `${name} expected ${options.limit} allowed / ${options.attempts - options.limit} blocked but saw ${allowed} / ${blocked}.`
    );
  }

  return {
    name,
    limit: options.limit,
    attempts: options.attempts,
    allowed,
    blocked
  } satisfies ScenarioReport;
}

async function main() {
  const status = ensureLocalSupabaseStarted();
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_URL = status.API_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;

  const now = Date.now();
  const scenarios = [
    await runScenario('shared-bucket', {
      scope: `rate_limit_smoke_${now}`,
      limit: 3,
      attempts: 6,
      tokenKey: 'shared-token'
    }),
    await runScenario('isolated-bucket', {
      scope: `rate_limit_smoke_${now}`,
      limit: 3,
      attempts: 3,
      tokenKey: 'other-token'
    })
  ];

  const report: RateLimitSmokeReport = {
    generatedAt: new Date().toISOString(),
    scenarios
  };

  const outPath = typeof values.out === 'string' && values.out.trim() ? values.out.trim() : null;
  if (outPath) {
    const resolved = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
    writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`rate-limit-smoke: wrote ${path.relative(process.cwd(), resolved)}`);
  }

  const markdownPath = typeof values.markdown === 'string' && values.markdown.trim() ? values.markdown.trim() : null;
  if (markdownPath) {
    const resolved = path.isAbsolute(markdownPath) ? markdownPath : path.join(process.cwd(), markdownPath);
    writeFile(resolved, `${renderMarkdown(report)}\n`);
    console.log(`rate-limit-smoke: wrote ${path.relative(process.cwd(), resolved)}`);
  }

  if (!outPath && !markdownPath) {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
