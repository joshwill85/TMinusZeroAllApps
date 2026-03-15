import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildLocalMobileE2EEnv,
  buildLocalWebEnv,
  ensureLocalSupabaseStarted,
  resetLocalSupabase,
  ROOT,
  runRootCommand,
  spawnRootProcess,
  waitForHttpReady
} from './three-platform-local-stack';

type SeedArtifact = {
  users: {
    premium: {
      userId: string;
      email: string;
    };
  };
};

type LocalAcceptanceReport = {
  generatedAt: string;
  outDir: string;
  preflightDir: string;
  seedArtifact: string;
  rateLimitArtifact: string;
  webLog: string;
  mobileRuns: Array<{
    platform: 'ios' | 'android';
    command: string;
    status: 'passed' | 'failed' | 'skipped';
  }>;
};

const DEFAULT_OUT_DIR = path.join(ROOT, '.artifacts', 'three-platform-local-acceptance');

const { values } = parseArgs({
  options: {
    'out-dir': { type: 'string' },
    platform: { type: 'string' },
    'skip-mobile-e2e': { type: 'boolean' }
  }
});

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string, markdown: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function resolvePlatforms(platformValue: string | null) {
  const normalized = String(platformValue || 'all').trim().toLowerCase();
  if (normalized === 'ios') return ['ios'] as const;
  if (normalized === 'android') return ['android'] as const;
  return ['android', 'ios'] as const;
}

function renderSummary(report: LocalAcceptanceReport) {
  return [
    '# Three-Platform Local Acceptance',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Out dir: \`${path.relative(ROOT, report.outDir)}\``,
    '',
    `- Seed artifact: \`${path.relative(ROOT, report.seedArtifact)}\``,
    `- Preflight artifact dir: \`${path.relative(ROOT, report.preflightDir)}\``,
    `- Rate-limit smoke artifact: \`${path.relative(ROOT, report.rateLimitArtifact)}\``,
    `- Web log: \`${path.relative(ROOT, report.webLog)}\``,
    '',
    '| mobile platform | status | command |',
    '| --- | --- | --- |',
    ...report.mobileRuns.map((entry) => `| ${entry.platform} | ${entry.status} | \`${entry.command}\` |`)
  ].join('\n');
}

async function main() {
  const outDir = path.resolve(ROOT, String(values['out-dir'] || '').trim() || DEFAULT_OUT_DIR);
  const logsDir = path.join(outDir, 'logs');
  const preflightDir = path.join(outDir, 'preflight');
  const seedArtifactPath = path.join(outDir, 'seed.json');
  const rateLimitArtifactPath = path.join(outDir, 'rate-limit-smoke.json');
  const rateLimitMarkdownPath = path.join(outDir, 'rate-limit-smoke.md');
  const webLogPath = path.join(logsDir, 'web-dev.log');
  const reportPath = path.join(outDir, 'report.json');
  const summaryPath = path.join(outDir, 'summary.md');
  const skipMobileE2E = values['skip-mobile-e2e'] === true;
  const platforms = resolvePlatforms(typeof values.platform === 'string' ? values.platform : null);

  fs.mkdirSync(outDir, { recursive: true });

  let webProcess: ReturnType<typeof spawnRootProcess> | null = null;

  try {
    ensureLocalSupabaseStarted();
    const status = resetLocalSupabase();
    const webEnv = buildLocalWebEnv(status);

    runRootCommand('npm', ['run', 'seed:three-platform:local', '--', `--out=${seedArtifactPath}`], {
      env: webEnv
    });
    const seedArtifact = JSON.parse(fs.readFileSync(seedArtifactPath, 'utf8')) as SeedArtifact;

    webProcess = spawnRootProcess('npm', ['run', 'dev', '--workspace', '@tminuszero/web'], {
      env: webEnv,
      logFile: webLogPath
    });

    await waitForHttpReady('http://127.0.0.1:3000/api/v1/viewer/session', {
      timeoutMs: 180_000
    });

    runRootCommand(
      'npm',
      [
        'run',
        'acceptance:preflight',
        '--',
        `--out-dir=${preflightDir}`,
        `--billing-evidence-user-id=${seedArtifact.users.premium.userId}`
      ],
      {
        env: webEnv
      }
    );

    runRootCommand(
      'npm',
      ['run', 'test:rate-limit-smoke', '--', `--out=${rateLimitArtifactPath}`, `--markdown=${rateLimitMarkdownPath}`],
      {
        env: webEnv
      }
    );

    const mobileRuns: LocalAcceptanceReport['mobileRuns'] = [];

    for (const platform of platforms) {
      if (skipMobileE2E) {
        mobileRuns.push({
          platform,
          command: `npm run mobile:e2e:acceptance:${platform}`,
          status: 'skipped'
        });
        continue;
      }

      try {
        runRootCommand('npm', ['run', `mobile:e2e:acceptance:${platform}`], {
          env: buildLocalMobileE2EEnv(status, platform)
        });
        mobileRuns.push({
          platform,
          command: `npm run mobile:e2e:acceptance:${platform}`,
          status: 'passed'
        });
      } catch (error) {
        mobileRuns.push({
          platform,
          command: `npm run mobile:e2e:acceptance:${platform}`,
          status: 'failed'
        });
        throw error;
      }
    }

    const report: LocalAcceptanceReport = {
      generatedAt: new Date().toISOString(),
      outDir,
      preflightDir,
      seedArtifact: seedArtifactPath,
      rateLimitArtifact: rateLimitArtifactPath,
      webLog: webLogPath,
      mobileRuns
    };

    writeJson(reportPath, report);
    writeMarkdown(summaryPath, renderSummary(report));
  } finally {
    if (webProcess && webProcess.pid) {
      webProcess.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
