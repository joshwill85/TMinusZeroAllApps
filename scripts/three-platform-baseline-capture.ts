import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

type ScenarioReport = {
  name: string;
  counts: {
    totalRequests: number;
    requestsByPath: Record<string, number>;
  };
  assertions: string[];
};

type MobileQueryGuardReport = {
  generatedAt: string;
  scenarios: ScenarioReport[];
};

type Phase3WebGuardReport = {
  generatedAt: string;
  mobileCriticalFilesScanned: number;
  totalWebFilesScanned: number;
  totalRawApiFetchCount: number;
  rawApiFetchFiles: Array<{
    file: string;
    count: number;
  }>;
  mobileCriticalViolations: string[];
  surfaceExpectations: Array<{
    file: string;
    ok: boolean;
    missingTokens: string[];
  }>;
};

type TtfbBenchReport = {
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

type CiTaskGraphReport = {
  generatedAt: string;
  workspaceCount: number;
  workspaces: Array<{
    name: string;
    path: string;
    tasks: string[];
  }>;
  turboTasks: Array<{
    task: string;
    dependsOn: string[];
    outputs: string[];
  }>;
  ciRelevantWorkspaceTaskCounts: Record<string, number>;
  dependencyEdgeCount: number;
};

type BaselineSummary = {
  generatedAt: string;
  requestCounts: MobileQueryGuardReport;
  webGuard: Phase3WebGuardReport;
  ttfb: {
    status: 'captured' | 'skipped';
    reason: string | null;
    report: TtfbBenchReport | null;
  };
  ciTaskGraph: CiTaskGraphReport;
  gaps: string[];
};

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, '.artifacts', 'three-platform-baseline');
const TURBO_TASK_NAMES = ['lint', 'type-check', 'type-check:ci', 'build'];

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const trimmed = arg.slice(2);
    const [key, ...rest] = trimmed.split('=');
    args.set(key, rest.join('='));
  }
  return args;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath: string, markdown: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${markdown.trimEnd()}\n`, 'utf8');
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function runCommand(
  command: string,
  args: string[],
  options: { optional?: boolean; env?: Record<string, string> } = {}
) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ...options.env
    }
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0 && !options.optional) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }

  return result;
}

function collectCiTaskGraphReport(): CiTaskGraphReport {
  const rootPackage = readJsonFile<{
    workspaces?: string[];
  }>(path.join(ROOT, 'package.json'));
  const turboConfig = readJsonFile<{
    tasks?: Record<string, { dependsOn?: string[]; outputs?: string[] }>;
  }>(path.join(ROOT, 'turbo.json'));

  const workspacePaths = resolveWorkspacePackagePaths(rootPackage.workspaces ?? []);
  const workspaces = workspacePaths.map((workspacePath) => {
    const packageJson = readJsonFile<{
      name?: string;
      scripts?: Record<string, string>;
    }>(path.join(ROOT, workspacePath, 'package.json'));
    const tasks = TURBO_TASK_NAMES.filter((task) => Boolean(packageJson.scripts?.[task]));

    return {
      name: packageJson.name || workspacePath,
      path: workspacePath,
      tasks
    };
  });

  const turboTasks = TURBO_TASK_NAMES.map((task) => ({
    task,
    dependsOn: turboConfig.tasks?.[task]?.dependsOn ?? [],
    outputs: turboConfig.tasks?.[task]?.outputs ?? []
  }));

  const ciRelevantWorkspaceTaskCounts = Object.fromEntries(
    TURBO_TASK_NAMES.map((task) => [task, workspaces.filter((workspace) => workspace.tasks.includes(task)).length])
  ) as Record<string, number>;

  return {
    generatedAt: new Date().toISOString(),
    workspaceCount: workspaces.length,
    workspaces,
    turboTasks,
    ciRelevantWorkspaceTaskCounts,
    dependencyEdgeCount: turboTasks.reduce((sum, task) => sum + task.dependsOn.length, 0)
  };
}

function resolveWorkspacePackagePaths(patterns: string[]) {
  const resolved = new Set<string>();

  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parentDir = path.join(ROOT, pattern.slice(0, -2));
      if (!fs.existsSync(parentDir)) continue;
      for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const relativePath = path.relative(ROOT, path.join(parentDir, entry.name));
        if (fs.existsSync(path.join(ROOT, relativePath, 'package.json'))) {
          resolved.add(relativePath);
        }
      }
      continue;
    }

    const relativePath = pattern.replace(/\/+$/, '');
    if (fs.existsSync(path.join(ROOT, relativePath, 'package.json'))) {
      resolved.add(relativePath);
    }
  }

  return [...resolved].sort((left, right) => left.localeCompare(right));
}

function renderMarkdown(summary: BaselineSummary) {
  const lines = [
    '# Three-Platform Baseline Evidence',
    '',
    `Generated: ${summary.generatedAt}`,
    '',
    '## Request Counts and Cache Reuse',
    ''
  ];

  for (const scenario of summary.requestCounts.scenarios) {
    lines.push(`### ${scenario.name}`);
    lines.push('');
    lines.push(`- Total requests: ${scenario.counts.totalRequests}`);
    for (const assertion of scenario.assertions) {
      lines.push(`- ${assertion}`);
    }
    lines.push('');
    lines.push('| request | count |');
    lines.push('| --- | ---: |');
    for (const [request, count] of Object.entries(scenario.counts.requestsByPath)) {
      lines.push(`| \`${request}\` | ${count} |`);
    }
    lines.push('');
  }

  lines.push('## Raw /api Fetch Guard');
  lines.push('');
  lines.push(`- Remaining raw \`fetch('/api/...')\` call sites in apps/web: ${summary.webGuard.totalRawApiFetchCount}`);
  lines.push(`- Mobile-critical violations: ${summary.webGuard.mobileCriticalViolations.length}`);
  lines.push('');
  lines.push('| file | count |');
  lines.push('| --- | ---: |');
  for (const finding of summary.webGuard.rawApiFetchFiles.slice(0, 20)) {
    lines.push(`| \`${finding.file}\` | ${finding.count} |`);
  }
  if (summary.webGuard.rawApiFetchFiles.length === 0) {
    lines.push('| none | 0 |');
  }
  lines.push('');

  lines.push('## TTFB');
  lines.push('');
  if (summary.ttfb.status === 'captured' && summary.ttfb.report) {
    lines.push(`- Requests per route: ${summary.ttfb.report.requests}`);
    lines.push(`- Warmup requests per route: ${summary.ttfb.report.warmupRequests}`);
    lines.push('');
    lines.push('| route | p50 ms | p95 ms | mean ms |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const route of summary.ttfb.report.routes) {
      lines.push(`| \`${route.route}\` | ${route.p50.toFixed(3)} | ${route.p95.toFixed(3)} | ${route.mean.toFixed(3)} |`);
    }
  } else {
    lines.push(`- Skipped: ${summary.ttfb.reason || 'unknown reason'}`);
  }
  lines.push('');

  lines.push('## CI Task Graph');
  lines.push('');
  lines.push(`- Workspaces scanned: ${summary.ciTaskGraph.workspaceCount}`);
  lines.push(`- Turbo dependency edges: ${summary.ciTaskGraph.dependencyEdgeCount}`);
  lines.push('');
  lines.push('| task | workspace count |');
  lines.push('| --- | ---: |');
  for (const task of TURBO_TASK_NAMES) {
    lines.push(`| \`${task}\` | ${summary.ciTaskGraph.ciRelevantWorkspaceTaskCounts[task] || 0} |`);
  }
  lines.push('');

  lines.push('## Remaining Gaps');
  lines.push('');
  for (const gap of summary.gaps) {
    lines.push(`- ${gap}`);
  }

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, args.get('out-dir') || DEFAULT_OUT_DIR);
  const ttfbRequests = args.get('ttfb-requests') || '40';
  const ttfbWarmup = args.get('ttfb-warmup') || '5';

  fs.mkdirSync(outDir, { recursive: true });

  const mobileQueryJson = path.join(outDir, 'mobile-query-guard.json');
  const mobileQueryMd = path.join(outDir, 'mobile-query-guard.md');
  runCommand(process.execPath, [
    '--loader',
    'ts-node/esm',
    'scripts/mobile-query-guard.mts',
    `--output=${mobileQueryJson}`,
    `--markdown=${mobileQueryMd}`
  ], {
    env: {
      TS_NODE_TRANSPILE_ONLY: '1'
    }
  });
  const requestCounts = readJsonFile<MobileQueryGuardReport>(mobileQueryJson);

  const webGuardJson = path.join(outDir, 'phase3-web-guard.json');
  const webGuardMd = path.join(outDir, 'phase3-web-guard.md');
  runCommand(process.execPath, [
    '--loader',
    'ts-node/esm',
    'scripts/phase3-web-closeout-guard.mts',
    `--output=${webGuardJson}`,
    `--markdown=${webGuardMd}`
  ], {
    env: {
      TS_NODE_TRANSPILE_ONLY: '1'
    }
  });
  const webGuard = readJsonFile<Phase3WebGuardReport>(webGuardJson);

  let ttfb: BaselineSummary['ttfb'];
  const buildIdPath = path.join(ROOT, 'apps', 'web', '.next', 'BUILD_ID');
  if (!fs.existsSync(buildIdPath)) {
    ttfb = {
      status: 'skipped',
      reason: 'apps/web/.next/BUILD_ID is missing; run a production web build first',
      report: null
    };
  } else {
    const ttfbJson = path.join(outDir, 'ttfb-bench.json');
    const ttfbMd = path.join(outDir, 'ttfb-bench.md');
    const tsNodeCli = path.join(ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
    runCommand(process.execPath, [
      tsNodeCli,
      '--project',
      'tsconfig.scripts.json',
      '--transpile-only',
      '-r',
      'tsconfig-paths/register',
      'scripts/ttfb-bench.ts',
      '--accept=application/json',
      '--route=/api/v1/launches?limit=20&region=all',
      '--route=/api/v1/search?q=starlink&limit=8',
      `--requests=${ttfbRequests}`,
      `--warmup=${ttfbWarmup}`,
      `--output=${ttfbJson}`,
      `--markdown=${ttfbMd}`
    ]);
    ttfb = {
      status: 'captured',
      reason: null,
      report: readJsonFile<TtfbBenchReport>(ttfbJson)
    };
  }

  const ciTaskGraph = collectCiTaskGraphReport();
  writeJson(path.join(outDir, 'ci-task-graph.json'), ciTaskGraph);

  const gaps = [
    'Feed render and scroll performance still require a browser/device harness or manual trace capture; this script records request/cache evidence only.',
    'Auth-return and upgrade intent are guarded statically through source-shape checks, not end-to-end browser execution.'
  ];
  if (ttfb.status === 'skipped' && ttfb.reason) {
    gaps.push(`TTFB capture skipped: ${ttfb.reason}.`);
  }

  const summary: BaselineSummary = {
    generatedAt: new Date().toISOString(),
    requestCounts,
    webGuard,
    ttfb,
    ciTaskGraph,
    gaps
  };

  writeJson(path.join(outDir, 'baseline-summary.json'), summary);
  writeMarkdown(path.join(outDir, 'baseline-summary.md'), renderMarkdown(summary));

  console.log(`three-platform-baseline-capture: ok (${outDir})`);
}

main();
