import { parse } from 'https://deno.land/std@0.224.0/flags/mod.ts';
import { loadSync } from 'https://deno.land/std@0.224.0/dotenv/mod.ts';

type CliArgs = {
  help: boolean;
  respectFlags: boolean;
  force: boolean;
  maxCells?: number;
  horizonDays?: number;
  normalizationScope?: string;
  states?: string[];
  triggerMode: 'manual' | 'backfill' | 'retry';
};

const usage = `Usage:
  deno run -A scripts/jep-black-marble-batch.mts [options]

Options:
  --respect-flags               Respect live system_settings gates instead of overriding them.
  --force                       Force the run even if a gate is disabled.
  --max-cells=<n>               Override jep_background_light_max_cells_per_run for this batch run.
  --horizon-days=<n>            Override jep_background_light_horizon_days for this batch run.
  --states=FL,CA,TX             Override the US launch-state filter for this batch run.
  --normalization-scope=value   Override the normalization scope (default: tile_land).
  --trigger-mode=manual         One of: manual, backfill, retry. Default: backfill.
  --help                        Show this usage text.

Environment:
  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  JEP_BLACK_MARBLE_DOWNLOAD_TOKEN
`;

function loadLocalEnv() {
  for (const path of ['.env.local', '.env']) {
    try {
      const values = loadSync({ envPath: path, export: false });
      for (const [key, value] of Object.entries(values)) {
        if (value && !Deno.env.get(key)) {
          Deno.env.set(key, value);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  if (!Deno.env.get('SUPABASE_URL')) {
    const alias = Deno.env.get('NEXT_PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_PROJECT_URL');
    if (alias) Deno.env.set('SUPABASE_URL', alias);
  }
  if (!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    const alias = Deno.env.get('SERVICE_ROLE_KEY');
    if (alias) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', alias);
  }
}

function parseArgs(args: string[]): CliArgs {
  const parsed = parse(args, {
    boolean: ['help', 'respect-flags', 'force'],
    string: ['states', 'normalization-scope', 'trigger-mode', 'max-cells', 'horizon-days'],
    alias: { h: 'help' },
    default: { force: false, 'respect-flags': false, 'trigger-mode': 'backfill' }
  });

  const triggerModeRaw = String(parsed['trigger-mode'] || 'backfill').trim().toLowerCase();
  const triggerMode =
    triggerModeRaw === 'manual' || triggerModeRaw === 'retry' ? triggerModeRaw : 'backfill';

  return {
    help: Boolean(parsed.help),
    respectFlags: Boolean(parsed['respect-flags']),
    force: Boolean(parsed.force),
    maxCells: readOptionalPositiveInt(parsed['max-cells']),
    horizonDays: readOptionalPositiveInt(parsed['horizon-days']),
    normalizationScope: readOptionalText(parsed['normalization-scope']),
    states: readStates(parsed.states),
    triggerMode
  };
}

function readOptionalPositiveInt(value: unknown) {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return Math.trunc(parsed);
}

function readOptionalText(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readStates(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const states = value
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return states.length ? [...new Set(states)] : undefined;
}

function buildRunOptions(cliArgs: CliArgs): RunJepBackgroundLightRefreshOptions {
  const settingsOverrides = cliArgs.respectFlags
    ? {
        maxCellsPerRun: cliArgs.maxCells,
        horizonDays: cliArgs.horizonDays,
        normalizationScope: cliArgs.normalizationScope,
        usLaunchStates: cliArgs.states
      }
    : {
        enabled: true,
        sourceJobsEnabled: true,
        backgroundSourceEnabled: true,
        maxCellsPerRun: cliArgs.maxCells,
        horizonDays: cliArgs.horizonDays,
        normalizationScope: cliArgs.normalizationScope,
        usLaunchStates: cliArgs.states
      };

  return {
    force: cliArgs.force || !cliArgs.respectFlags,
    runner: 'batch',
    triggerMode: cliArgs.triggerMode,
    settingsOverrides
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs(Deno.args);

  if (args.help) {
    console.log(usage);
    return;
  }

  const { runJepBackgroundLightRefresh } = await import('../supabase/functions/jep-background-light-refresh/index.ts');
  const result = await runJepBackgroundLightRefresh(buildRunOptions(args));
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

type RunJepBackgroundLightRefreshOptions = {
  force: boolean;
  runner: 'batch';
  triggerMode: 'manual' | 'backfill' | 'retry';
  settingsOverrides: {
    enabled?: boolean;
    sourceJobsEnabled?: boolean;
    backgroundSourceEnabled?: boolean;
    maxCellsPerRun?: number;
    horizonDays?: number;
    normalizationScope?: string;
    usLaunchStates?: string[];
  };
};
