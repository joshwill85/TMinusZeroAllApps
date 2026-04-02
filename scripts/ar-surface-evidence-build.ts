import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import {
  buildSurfaceEvidenceManifest,
  type SurfaceEvidenceInputSpec,
  type SurfaceEvidenceManifest,
  type SurfaceEvidenceSessionRow
} from '@/lib/ar/surfaceEvidence';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';

config({ path: '.env.local' });
config();

type CliArgs = {
  inputPath: string;
  outputPath: string;
  markdownPath: string;
  json: boolean;
  quiet: boolean;
};

const SESSION_ROW_SELECT = [
  'id',
  'created_at',
  'runtime_family',
  'client_profile',
  'client_env',
  'release_profile',
  'location_permission',
  'location_accuracy',
  'location_fix_state',
  'alignment_ready',
  'heading_status',
  'pose_mode',
  'overlay_mode',
  'trajectory_quality_state',
  'time_to_usable_ms',
  'time_to_lock_bucket',
  'tracking_state',
  'world_alignment',
  'geo_tracking_state',
  'fallback_reason',
  'mode_entered',
  'relocalization_count',
  'loop_restart_count'
].join(',');

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const value = (prefix: string) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return {
    inputPath: value('--input=') || 'scripts/fixtures/ar-surface-evidence-input.fixture.json',
    outputPath: value('--output=') || '.artifacts/ar-surface-evidence.json',
    markdownPath: value('--markdown=') || '.artifacts/ar-surface-evidence.md',
    json: args.includes('--json'),
    quiet: args.includes('--quiet')
  };
}

function resolvePath(pathArg: string) {
  return path.resolve(process.cwd(), pathArg);
}

function resolveRelativePath(baseFilePath: string, maybeRelativePath: string) {
  if (path.isAbsolute(maybeRelativePath)) return maybeRelativePath;
  return path.resolve(path.dirname(baseFilePath), maybeRelativePath);
}

function readJsonFile<T>(pathArg: string): T {
  const full = resolvePath(pathArg);
  if (!fs.existsSync(full)) throw new Error(`File not found: ${full}`);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
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

function fmtNumber(value: number | null | undefined, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function buildMarkdown(manifest: SurfaceEvidenceManifest) {
  const lines: string[] = [];
  lines.push('# AR Surface Evidence Manifest');
  lines.push('');
  lines.push(`- generatedAt: ${manifest.generatedAt}`);
  lines.push(`- runs: ${manifest.runs.length}`);
  lines.push(`- comparisons: ${manifest.comparisons?.length ?? 0}`);
  lines.push('');
  lines.push('| Profile | Surface | Status | Session | Runtime | Time To Usable (s) | Precision | Allowed | Reloc | Tracking resets | Notes |');
  lines.push('|---|---|---|---|---|---:|---|---|---:|---:|---|');
  for (const run of manifest.runs) {
    lines.push(
      `| ${run.profile} | ${run.surface} | ${run.status.toUpperCase()} | ${run.sessionId ?? '—'} | ${run.runtimeFamily ?? '—'} | ${fmtNumber(run.timeToUsableSeconds)} | ${
        run.canClaimPrecision == null ? '—' : run.canClaimPrecision ? 'yes' : 'no'
      } | ${run.precisionClaimAllowed == null ? '—' : run.precisionClaimAllowed ? 'yes' : 'no'} | ${fmtNumber(run.relocalizationCount, 0)} | ${fmtNumber(run.trackingResetCount, 0)} | ${run.notes ?? '—'} |`
    );
  }
  lines.push('');
  if ((manifest.comparisons?.length ?? 0) > 0) {
    lines.push('## Comparisons');
    lines.push('');
    lines.push('| Fixture | Observer | T+ (s) | Divergence (deg) | Degraded |');
    lines.push('|---|---|---:|---:|---|');
    for (const comparison of manifest.comparisons ?? []) {
      lines.push(
        `| ${comparison.fixtureId} | ${comparison.observerId} | ${comparison.tPlusSec} | ${fmtNumber(comparison.divergenceDeg)} | ${
          comparison.degraded ? 'yes' : 'no'
        } |`
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function loadRows(spec: SurfaceEvidenceInputSpec, specPath: string) {
  if (spec.source.type === 'file') {
    const full = resolveRelativePath(resolvePath(specPath), spec.source.path);
    if (!fs.existsSync(full)) throw new Error(`Surface evidence rows file not found: ${full}`);
    return JSON.parse(fs.readFileSync(full, 'utf8')) as SurfaceEvidenceSessionRow[];
  }

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    throw new Error('Supabase env is not configured for surface evidence export.');
  }

  const sessionIds = Array.from(
    new Set(spec.runs.map((run) => run.sessionId).filter((value): value is string => typeof value === 'string' && value.length > 0))
  );
  const releaseProfiles = Array.from(
    new Set(
      spec.runs
        .map((run) => run.releaseProfile ?? run.profile)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    )
  );
  const supabase = createSupabaseAdminClient();
  const rows: SurfaceEvidenceSessionRow[] = [];
  const seen = new Set<string>();

  if (sessionIds.length > 0) {
    const { data, error } = await supabase.from('ar_camera_guide_sessions').select(SESSION_ROW_SELECT).in('id', sessionIds);
    if (error) throw new Error(`Failed to load ar_camera_guide_sessions by session ID: ${error.message}`);
    for (const row of (Array.isArray(data) ? data : []) as SurfaceEvidenceSessionRow[]) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }

  if (releaseProfiles.length > 0) {
    const { data, error } = await supabase
      .from('ar_camera_guide_sessions')
      .select(SESSION_ROW_SELECT)
      .in('release_profile', releaseProfiles)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to load ar_camera_guide_sessions by release profile: ${error.message}`);
    for (const row of (Array.isArray(data) ? data : []) as SurfaceEvidenceSessionRow[]) {
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
  }

  return rows;
}

async function main() {
  const args = parseArgs(process.argv);
  const spec = readJsonFile<SurfaceEvidenceInputSpec>(args.inputPath);
  const rows = await loadRows(spec, args.inputPath);
  const manifest = buildSurfaceEvidenceManifest(spec, rows);

  writeJson(args.outputPath, manifest);
  writeText(args.markdownPath, buildMarkdown(manifest));

  if (!args.quiet && !args.json) {
    console.log('AR surface evidence');
    console.log(`Runs: ${manifest.runs.length}`);
    console.log(`Comparisons: ${manifest.comparisons?.length ?? 0}`);
    console.log(`Wrote manifest: ${resolvePath(args.outputPath)}`);
    console.log(`Wrote markdown: ${resolvePath(args.markdownPath)}`);
  }

  if (args.json) {
    console.log(JSON.stringify(manifest, null, 2));
  }
}

void main();
