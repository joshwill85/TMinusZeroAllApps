import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

config({ path: '.env.local' });
config();

type CliArgs = {
  days: number;
  outputPath: string;
  markdownPath: string;
  json: boolean;
  quiet: boolean;
  warnOnly: boolean;
};

type SessionRow = {
  id: string | null;
  started_at: string | null;
  created_at: string | null;
  client_profile: string | null;
  lock_on_mode: string | null;
  lock_on_attempted: boolean | null;
  lock_on_acquired: boolean | null;
  time_to_lock_bucket: string | null;
  lock_loss_count: number | null;
  dropped_frame_bucket: string | null;
  pose_update_rate_bucket: string | null;
  fallback_reason: string | null;
  mode_entered: string | null;
};

type Thresholds = {
  minLockAcquireRate: number;
  minLockLe5Rate: number;
  minStableLockRateAmongAcquired: number;
  minLowDropRate: number;
  maxHighDropRate: number;
  minHealthyPoseRate: number;
};

type Metric = {
  key: string;
  label: string;
  value: number | null;
  threshold: string;
  pass: boolean;
};

const THRESHOLDS: Thresholds = {
  minLockAcquireRate: 0.65,
  minLockLe5Rate: 0.6,
  minStableLockRateAmongAcquired: 0.8,
  minLowDropRate: 0.75,
  maxHighDropRate: 0.1,
  minHealthyPoseRate: 0.8
};

function parseNumberArg(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    days: Math.max(1, Math.min(30, Math.floor(parseNumberArg(value('--days='), 14)))),
    outputPath: value('--output=') || '.artifacts/ar-lock-on-field-report.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-lock-on-field-report.md',
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
    warnOnly: args.includes('--warn-only')
  };
}

function safeRate(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function fmt(value: number | null | undefined, digits = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function fmtPct(value: number | null | undefined, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function writeJson(pathArg: string, value: unknown) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(pathArg: string, value: string) {
  const full = resolvePath(pathArg);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, value, 'utf8');
}

function buildMarkdown({
  generatedAt,
  windowDays,
  windowStart,
  attemptedSessions,
  metrics,
  sessions
}: {
  generatedAt: string;
  windowDays: number;
  windowStart: string;
  attemptedSessions: number;
  metrics: Metric[];
  sessions: Array<{
    id: string | null;
    createdAt: string | null;
    clientProfile: string | null;
    lockAcquired: boolean;
    lockLe5: boolean;
    lockLossCount: number;
    stableLock: boolean;
    fallback: boolean;
  }>;
}) {
  const lines: string[] = [];
  lines.push('# AR Lock-On Field Report');
  lines.push('');
  lines.push(`- generatedAt: ${generatedAt}`);
  lines.push(`- windowDays: ${windowDays}`);
  lines.push(`- windowStart: ${windowStart}`);
  lines.push(`- attemptedSessions: ${attemptedSessions}`);
  lines.push('');

  lines.push('## Threshold Metrics');
  lines.push('');
  lines.push('| Metric | Value | Threshold | Pass |');
  lines.push('|---|---:|---:|---|');
  for (const row of metrics) {
    lines.push(`| ${row.label} | ${fmtPct(row.value)} | ${row.threshold} | ${row.pass ? 'yes' : 'no'} |`);
  }
  lines.push('');

  lines.push('## Recent Sessions');
  lines.push('');
  lines.push('| Created | Session ID | Profile | Acquired | <=5s | Lock losses | Stable <=2 | Fallback |');
  lines.push('|---|---|---|---|---|---:|---|---|');
  if (sessions.length === 0) {
    lines.push('| — | — | — | — | — | — | — | — |');
  } else {
    for (const row of sessions) {
      lines.push(
        `| ${row.createdAt ?? '—'} | ${row.id ?? '—'} | ${row.clientProfile ?? '—'} | ${row.lockAcquired ? 'yes' : 'no'} | ${row.lockLe5 ? 'yes' : 'no'} | ${row.lockLossCount} | ${row.stableLock ? 'yes' : 'no'} | ${row.fallback ? 'yes' : 'no'} |`
      );
    }
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new Error('Supabase env is not configured for lock-on field report.');
  }

  const windowStart = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('ar_camera_guide_sessions')
    .select('*')
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(10000);

  if (error) throw new Error(`Failed to load ar_camera_guide_sessions: ${error.message}`);

  const scoped = ((Array.isArray(data) ? data : []) as SessionRow[]).filter((row) => {
    const profile = typeof row.client_profile === 'string' ? row.client_profile : '';
    if (profile !== 'android_chrome' && profile !== 'desktop_debug') return false;
    const mode = typeof row.lock_on_mode === 'string' && row.lock_on_mode ? row.lock_on_mode : 'auto';
    if (mode !== 'auto') return false;
    return row.lock_on_attempted === true;
  });

  let acquired = 0;
  let lockLe5 = 0;
  let acquiredWithLossSamples = 0;
  let stableLocks = 0;
  let lowDrop = 0;
  let highDrop = 0;
  let healthyPose = 0;

  for (const row of scoped) {
    if (row.lock_on_acquired === true) acquired += 1;
    if (row.time_to_lock_bucket === '<2s' || row.time_to_lock_bucket === '2..5s') lockLe5 += 1;

    if (row.lock_on_acquired === true) {
      const lockLossCount = typeof row.lock_loss_count === 'number' && Number.isFinite(row.lock_loss_count) ? row.lock_loss_count : 0;
      acquiredWithLossSamples += 1;
      if (lockLossCount <= 2) stableLocks += 1;
    }

    if (row.dropped_frame_bucket === '0..1' || row.dropped_frame_bucket === '1..5') lowDrop += 1;
    if (row.dropped_frame_bucket === '15..30' || row.dropped_frame_bucket === '30+') highDrop += 1;
    if (
      row.pose_update_rate_bucket === '15..30' ||
      row.pose_update_rate_bucket === '30..60' ||
      row.pose_update_rate_bucket === '60+'
    ) {
      healthyPose += 1;
    }
  }

  const attemptedSessions = scoped.length;
  const lockAcquireRate = safeRate(acquired, attemptedSessions);
  const lockLe5Rate = safeRate(lockLe5, attemptedSessions);
  const stableLockRate = safeRate(stableLocks, acquiredWithLossSamples);
  const lowDropRate = safeRate(lowDrop, attemptedSessions);
  const highDropRate = safeRate(highDrop, attemptedSessions);
  const healthyPoseRate = safeRate(healthyPose, attemptedSessions);

  const metrics: Metric[] = [
    {
      key: 'lock_acquire_rate',
      label: 'Lock acquisition rate',
      value: lockAcquireRate,
      threshold: `>= ${THRESHOLDS.minLockAcquireRate}`,
      pass: (lockAcquireRate ?? -1) >= THRESHOLDS.minLockAcquireRate
    },
    {
      key: 'lock_le5_rate',
      label: 'Lock <=5s rate',
      value: lockLe5Rate,
      threshold: `>= ${THRESHOLDS.minLockLe5Rate}`,
      pass: (lockLe5Rate ?? -1) >= THRESHOLDS.minLockLe5Rate
    },
    {
      key: 'stable_lock_rate',
      label: 'Stable lock rate (<=2 losses)',
      value: stableLockRate,
      threshold: `>= ${THRESHOLDS.minStableLockRateAmongAcquired}`,
      pass: (stableLockRate ?? -1) >= THRESHOLDS.minStableLockRateAmongAcquired
    },
    {
      key: 'low_drop_rate',
      label: 'Low drop-frame rate',
      value: lowDropRate,
      threshold: `>= ${THRESHOLDS.minLowDropRate}`,
      pass: (lowDropRate ?? -1) >= THRESHOLDS.minLowDropRate
    },
    {
      key: 'high_drop_rate',
      label: 'High drop-frame rate',
      value: highDropRate,
      threshold: `<= ${THRESHOLDS.maxHighDropRate}`,
      pass: highDropRate != null && highDropRate <= THRESHOLDS.maxHighDropRate
    },
    {
      key: 'healthy_pose_rate',
      label: 'Healthy pose update rate',
      value: healthyPoseRate,
      threshold: `>= ${THRESHOLDS.minHealthyPoseRate}`,
      pass: (healthyPoseRate ?? -1) >= THRESHOLDS.minHealthyPoseRate
    }
  ];

  const overallPass = metrics.every((row) => row.pass);
  const recentSessions = scoped.slice(0, 25).map((row) => {
    const lockLossCount = typeof row.lock_loss_count === 'number' && Number.isFinite(row.lock_loss_count) ? row.lock_loss_count : 0;
    const lockLe5Session = row.time_to_lock_bucket === '<2s' || row.time_to_lock_bucket === '2..5s';
    return {
      id: row.id ?? null,
      createdAt: row.created_at ?? row.started_at ?? null,
      clientProfile: row.client_profile ?? null,
      lockAcquired: row.lock_on_acquired === true,
      lockLe5: lockLe5Session,
      lockLossCount,
      stableLock: row.lock_on_acquired === true ? lockLossCount <= 2 : false,
      fallback: typeof row.fallback_reason === 'string' || row.mode_entered === 'sky_compass'
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    windowDays: args.days,
    windowStart,
    attemptedSessions,
    acquiredSessions: acquired,
    metrics: metrics.map((row) => ({
      ...row,
      value: fmt(row.value)
    })),
    overallPass,
    thresholds: THRESHOLDS,
    recentSessions
  };

  writeJson(args.outputPath, report);
  writeText(
    args.markdownPath,
    buildMarkdown({
      generatedAt: report.generatedAt,
      windowDays: report.windowDays,
      windowStart: report.windowStart,
      attemptedSessions: report.attemptedSessions,
      metrics,
      sessions: recentSessions
    })
  );

  if (!args.quiet && !args.json) {
    console.log('AR lock-on field report');
    console.log(`Window: last ${args.days} days (start ${windowStart})`);
    console.log(`Attempted sessions: ${attemptedSessions}`);
    for (const row of metrics) {
      console.log(`- ${row.label}: ${fmtPct(row.value)} (${row.threshold}) ${row.pass ? 'PASS' : 'FAIL'}`);
    }
    console.log(`Overall: ${overallPass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!overallPass && !args.warnOnly) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
