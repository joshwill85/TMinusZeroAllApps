import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local' });
config();

type CliArgs = {
  jobs: string[];
  timeoutSeconds: number;
  dryRun: boolean;
  warnOnly: boolean;
  outputPath: string;
  markdownPath: string;
  quiet: boolean;
  json: boolean;
};

type InvocationResult = {
  job: string;
  ok: boolean;
  httpStatus: number | null;
  elapsedMs: number;
  skipped: boolean;
  reason: string | null;
  error: string | null;
};

type RefreshReport = {
  generatedAt: string;
  dryRun: boolean;
  jobs: string[];
  pass: boolean;
  results: InvocationResult[];
};

const DEFAULT_JOBS = [
  'trajectory-orbit-ingest',
  'trajectory-constraints-ingest',
  'navcen-bnm-ingest',
  'trajectory-products-generate'
] as const;

type SettingRow = { key: string; value: unknown };

function parseNumberArg(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const jobsRaw = value('--jobs=');
  const jobs =
    jobsRaw && jobsRaw.trim()
      ? jobsRaw
          .split(',')
          .map((row) => row.trim())
          .filter(Boolean)
      : [...DEFAULT_JOBS];
  return {
    jobs,
    timeoutSeconds: Math.max(5, Math.min(15 * 60, Math.floor(parseNumberArg(value('--timeout-seconds='), 120)))),
    dryRun: args.includes('--dry-run'),
    warnOnly: args.includes('--warn-only'),
    outputPath: value('--output=') || '.artifacts/ar-trajectory-refresh-jobs.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-trajectory-refresh-jobs.md',
    quiet: args.includes('--quiet'),
    json: args.includes('--json')
  };
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

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function pickFirstToken(raw: string) {
  const token = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)[0];
  if (!token) throw new Error('system_settings.jobs_auth_token is empty');
  return token;
}

function buildMarkdown(report: RefreshReport) {
  const lines: string[] = [];
  lines.push('# AR Trajectory Refresh Jobs');
  lines.push('');
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- dryRun: ${report.dryRun ? 'yes' : 'no'}`);
  lines.push(`- result: ${report.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('| Job | Result | HTTP | Elapsed ms | Skipped | Reason/Error |');
  lines.push('|---|---|---:|---:|---|---|');
  for (const row of report.results) {
    lines.push(
      `| ${row.job} | ${row.ok ? 'ok' : 'fail'} | ${row.httpStatus ?? '—'} | ${row.elapsedMs} | ${row.skipped ? 'yes' : 'no'} | ${row.reason ?? row.error ?? '—'} |`
    );
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv);

  const results: InvocationResult[] = [];
  if (args.dryRun) {
    for (const job of args.jobs) {
      results.push({
        job,
        ok: true,
        httpStatus: null,
        elapsedMs: 0,
        skipped: true,
        reason: 'dry_run',
        error: null
      });
    }
  } else {
    const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data: settings, error: settingsError } = await admin
      .from('system_settings')
      .select('key,value')
      .eq('key', 'jobs_auth_token')
      .maybeSingle();
    if (settingsError) throw new Error(`Failed to read system_settings.jobs_auth_token (${settingsError.message})`);
    const jobsAuthToken = pickFirstToken(asString((settings as SettingRow | null)?.value));

    for (const job of args.jobs) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), args.timeoutSeconds * 1000);
      const startedAt = Date.now();
      try {
        const response = await admin.functions.invoke(job, {
          method: 'POST',
          body: {},
          headers: { 'x-job-token': jobsAuthToken },
          signal: controller.signal
        });
        const elapsedMs = Date.now() - startedAt;
        if (response.error) {
          const context = (response.error as any)?.context;
          const contextBody = typeof context?.body === 'string' ? context.body : null;
          results.push({
            job,
            ok: false,
            httpStatus: (response as any)?.response?.status ?? (typeof context?.status === 'number' ? context.status : null),
            elapsedMs,
            skipped: false,
            reason: null,
            error: contextBody || response.error.message || response.error.name
          });
          continue;
        }

        const payload = response.data as { ok?: boolean; skipped?: boolean; reason?: string; error?: string } | null;
        results.push({
          job,
          ok: payload?.ok !== false && !payload?.error,
          httpStatus: (response as any)?.response?.status ?? null,
          elapsedMs,
          skipped: payload?.skipped === true,
          reason: typeof payload?.reason === 'string' ? payload.reason : null,
          error: typeof payload?.error === 'string' ? payload.error : null
        });
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        results.push({
          job,
          ok: false,
          httpStatus: null,
          elapsedMs,
          skipped: false,
          reason: null,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const pass = results.every((row) => row.ok);
  const report: RefreshReport = {
    generatedAt: new Date().toISOString(),
    dryRun: args.dryRun,
    jobs: args.jobs,
    pass,
    results
  };

  writeJson(args.outputPath, report);
  writeText(args.markdownPath, buildMarkdown(report));

  if (!args.quiet && !args.json) {
    const failed = results.filter((row) => !row.ok);
    console.log('AR trajectory refresh jobs');
    console.log(`Dry run: ${args.dryRun ? 'yes' : 'no'}`);
    console.log(`Result: ${pass ? 'PASS' : args.warnOnly ? 'WARN' : 'FAIL'}`);
    console.log(`Jobs: ${results.length}, failures: ${failed.length}`);
    if (failed.length) {
      console.log('Failed jobs:');
      for (const row of failed) {
        console.log(`- ${row.job}: ${row.error || row.reason || 'unknown failure'}`);
      }
    }
    console.log(`Wrote report: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!pass && !args.warnOnly) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
