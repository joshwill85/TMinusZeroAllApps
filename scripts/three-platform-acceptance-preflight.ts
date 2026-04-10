import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

type StepStatus = 'passed' | 'failed' | 'skipped';

type StepReport = {
  name: string;
  command: string;
  status: StepStatus;
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  logFile: string | null;
  note: string | null;
};

type AcceptancePreflightReport = {
  generatedAt: string;
  outDir: string;
  includeMobileE2E: boolean;
  billingEvidenceUserId: string | null;
  steps: StepReport[];
  artifacts: {
    baselineDir: string;
    billingEvidence: string;
    billingRegression: string;
    summaryMarkdown: string;
  };
};

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, '.artifacts', 'three-platform-acceptance');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PINNED_NPM_VERSION =
  PKG.volta?.npm || String(PKG.packageManager || '').replace(/^npm@/, '') || '11.11.0';

const { values } = parseArgs({
  options: {
    'out-dir': { type: 'string' },
    'billing-evidence-user-id': { type: 'string' },
    'include-mobile-e2e': { type: 'boolean' },
    'mobile-e2e-command': { type: 'string' },
    'ttfb-requests': { type: 'string' },
    'ttfb-warmup': { type: 'string' }
  }
});

function ensureDir(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string, markdown: string) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function runStep({
  name,
  command,
  args,
  logFile,
  note = null
}: {
  name: string;
  command: string;
  args: string[];
  logFile: string;
  note?: string | null;
}): StepReport {
  const npmExecPath = process.env.npm_execpath?.trim();
  const resolvedCommand = command === 'npm' && npmExecPath ? process.execPath : command;
  const resolvedArgs = command === 'npm' && npmExecPath ? [npmExecPath, ...args] : args;
  const startedAt = new Date();
  const result = spawnSync(resolvedCommand, resolvedArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_user_agent: `npm/${PINNED_NPM_VERSION} node/v${process.version.replace(/^v/, '')} ${process.platform} ${process.arch} workspaces/true`
    },
    stdio: 'pipe'
  });
  const endedAt = new Date();
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  ensureDir(path.dirname(logFile));
  fs.writeFileSync(logFile, output, 'utf8');

  return {
    name,
    command: [resolvedCommand, ...resolvedArgs].join(' '),
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    logFile: path.relative(ROOT, logFile),
    note
  };
}

function skippedStep(name: string, note: string): StepReport {
  const now = new Date().toISOString();
  return {
    name,
    command: '',
    status: 'skipped',
    exitCode: null,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    logFile: null,
    note
  };
}

function renderSummary(report: AcceptancePreflightReport) {
  const lines = [
    '# Three-Platform Acceptance Preflight',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Out dir: \`${path.relative(ROOT, report.outDir)}\``,
    '',
    '| step | status | duration ms | note |',
    '| --- | --- | ---: | --- |'
  ];

  for (const step of report.steps) {
    lines.push(`| ${step.name} | ${step.status} | ${step.durationMs} | ${step.note ?? ''} |`);
  }

  lines.push('');
  lines.push('## Artifact Paths');
  lines.push('');
  lines.push(`- Baseline: \`${path.relative(ROOT, report.artifacts.baselineDir)}\``);
  lines.push(`- Billing evidence: \`${path.relative(ROOT, report.artifacts.billingEvidence)}\``);
  lines.push(`- Billing regression: \`${path.relative(ROOT, report.artifacts.billingRegression)}\``);
  lines.push('');
  lines.push('## Mobile E2E');
  lines.push('');
  lines.push(
    report.includeMobileE2E
      ? '- Mobile Detox was included in this preflight run.'
      : '- Mobile Detox was not executed here. This repo-owned preflight does not replace the separate `Mobile E2E` workflow or dedicated simulator/device acceptance evidence.'
  );
  return lines.join('\n');
}

async function main() {
  const requestedOutDir =
    typeof values['out-dir'] === 'string' && values['out-dir'].trim() ? values['out-dir'].trim() : null;
  const outDir = requestedOutDir
    ? path.isAbsolute(requestedOutDir)
      ? requestedOutDir
      : path.join(ROOT, requestedOutDir)
    : DEFAULT_OUT_DIR;
  const logsDir = path.join(outDir, 'logs');
  const baselineDir = path.join(outDir, 'baseline');
  const billingDir = path.join(outDir, 'billing');
  const billingEvidencePath = path.join(billingDir, 'billing-evidence.json');
  const billingRegressionPath = path.join(billingDir, 'billing-regression.json');
  const summaryMarkdownPath = path.join(outDir, 'summary.md');
  const reportPath = path.join(outDir, 'report.json');
  const includeMobileE2E = values['include-mobile-e2e'] === true;
  const mobileE2ECommand =
    typeof values['mobile-e2e-command'] === 'string' && values['mobile-e2e-command'].trim()
      ? values['mobile-e2e-command'].trim()
      : 'mobile:e2e:acceptance';
  const billingEvidenceUserId =
    typeof values['billing-evidence-user-id'] === 'string' ? values['billing-evidence-user-id'].trim() || null : null;
  const ttfbRequests =
    typeof values['ttfb-requests'] === 'string' && values['ttfb-requests'].trim() ? values['ttfb-requests'].trim() : '15';
  const ttfbWarmup =
    typeof values['ttfb-warmup'] === 'string' && values['ttfb-warmup'].trim() ? values['ttfb-warmup'].trim() : '5';

  ensureDir(outDir);

  const stepDefinitions = [
    ['Toolchain doctor', ['run', 'doctor']],
    ['Three-platform boundary check', ['run', 'check:three-platform:boundaries']],
    ['Shared domain smoke', ['run', 'test:shared-domain']],
    ['Phase 3 web closeout guard', ['run', 'test:phase3-web-guard']],
    ['Three-platform hot path guard', ['run', 'test:three-platform:hot-path']],
    ['Web regression smoke', ['run', 'test:web-regression']],
    ['Billing regression smoke', ['run', 'test:billing-regression', '--', `--out=${billingRegressionPath}`]],
    ['V1 contracts', ['run', 'test:v1-contracts']],
    ['Mobile query guard', ['run', 'test:mobile-query-guard']],
    ['Mobile security guard', ['run', 'test:mobile-security-guard']],
    ['Mobile type-check', ['run', 'type-check:mobile']],
    ['Mobile lint', ['run', 'lint', '--workspace', '@tminuszero/mobile']],
    ['Web lint', ['run', 'lint']],
    ['Smoke tests', ['run', 'test:smoke']],
    ['Web build', ['run', 'build']],
    ['Web type-check after build', ['run', 'type-check:ci']],
    ['Three-platform baseline capture', ['run', 'baseline:three-platform', '--', `--out-dir=${baselineDir}`, `--ttfb-requests=${ttfbRequests}`, `--ttfb-warmup=${ttfbWarmup}`]],
    [
      'Billing evidence export',
      [
        'run',
        'export:billing-evidence',
        '--',
        `--out=${billingEvidencePath}`,
        '--skip-when-unavailable',
        ...(billingEvidenceUserId ? [`--user-id=${billingEvidenceUserId}`] : [])
      ]
    ]
  ] as const;

  const steps: StepReport[] = [];

  if (includeMobileE2E) {
    const mobileStep = runStep({
      name: 'Mobile E2E acceptance',
      command: 'npm',
      args: ['run', mobileE2ECommand],
      logFile: path.join(logsDir, 'mobile-e2e-acceptance.log'),
      note: `npm run ${mobileE2ECommand}`
    });
    steps.push(mobileStep);
    if (mobileStep.status === 'failed') {
      finalizeAndExit({
        outDir,
        includeMobileE2E,
        billingEvidenceUserId,
        steps,
        baselineDir,
        billingEvidencePath,
        billingRegressionPath,
        summaryMarkdownPath,
        reportPath
      });
      process.exitCode = 1;
      return;
    }
  } else {
    steps.push(
      skippedStep(
        'Mobile E2E acceptance',
        'Run separately with `npm run mobile:e2e:acceptance` or pass `--include-mobile-e2e --mobile-e2e-command=<root-script>` in a simulator-capable workflow.'
      )
    );
  }

  for (const [name, args] of stepDefinitions) {
    const step = runStep({
      name,
      command: 'npm',
      args: [...args],
      logFile: path.join(logsDir, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.log`)
    });
    steps.push(step);
    if (step.status === 'failed') {
      finalizeAndExit({
        outDir,
        includeMobileE2E,
        billingEvidenceUserId,
        steps,
        baselineDir,
        billingEvidencePath,
        billingRegressionPath,
        summaryMarkdownPath,
        reportPath
      });
      process.exitCode = 1;
      return;
    }
  }

  finalizeAndExit({
    outDir,
    includeMobileE2E,
    billingEvidenceUserId,
    steps,
    baselineDir,
    billingEvidencePath,
    billingRegressionPath,
    summaryMarkdownPath,
    reportPath
  });
}

function finalizeAndExit({
  outDir,
  includeMobileE2E,
  billingEvidenceUserId,
  steps,
  baselineDir,
  billingEvidencePath,
  billingRegressionPath,
  summaryMarkdownPath,
  reportPath
}: {
  outDir: string;
  includeMobileE2E: boolean;
  billingEvidenceUserId: string | null;
  steps: StepReport[];
  baselineDir: string;
  billingEvidencePath: string;
  billingRegressionPath: string;
  summaryMarkdownPath: string;
  reportPath: string;
}) {
  const report: AcceptancePreflightReport = {
    generatedAt: new Date().toISOString(),
    outDir,
    includeMobileE2E,
    billingEvidenceUserId,
    steps,
    artifacts: {
      baselineDir,
      billingEvidence: billingEvidencePath,
      billingRegression: billingRegressionPath,
      summaryMarkdown: summaryMarkdownPath
    }
  };

  writeJson(reportPath, report);
  writeMarkdown(summaryMarkdownPath, renderSummary(report));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
