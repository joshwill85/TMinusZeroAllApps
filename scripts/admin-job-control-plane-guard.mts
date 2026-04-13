import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import jobRegistry from '../apps/web/app/admin/_lib/jobRegistry.ts';

const {
  ADMIN_JOB_REGISTRY,
  ADMIN_RUNNABLE_JOB_IDS,
  getAdminJobRegistryEntry,
  normalizeAdminSyncJobId
} = jobRegistry as typeof import('../apps/web/app/admin/_lib/jobRegistry.ts');

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase/migrations');

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
}

function parseCurrentPgCronJobsFromMigrations() {
  const active = new Map<string, { slug: string | null; sourceFile: string }>();

  for (const fileName of listMigrationFiles()) {
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');

    const unscheduleRegex = /perform\s+cron\.unschedule\(\s*'([^']+)'\s*\)\s*;/gi;
    for (const match of sql.matchAll(unscheduleRegex)) {
      active.delete(match[1]);
    }

    const scheduleRegex = /perform\s+cron\.schedule\(\s*'([^']+)'\s*,[\s\S]*?(\$(\w*)\$)([\s\S]*?)\2\s*\)\s*;/gi;
    for (const match of sql.matchAll(scheduleRegex)) {
      const cronJobName = match[1];
      const commandBody = match[4];
      const edgeJobMatch = /invoke_edge_job\(\s*'([^']+)'\s*\)/i.exec(commandBody);
      const isLl2Bridge = /invoke_ll2_incremental_burst\s*\(/i.test(commandBody);
      if (edgeJobMatch) {
        active.set(cronJobName, { slug: edgeJobMatch[1], sourceFile: fileName });
      } else if (isLl2Bridge) {
        active.set(cronJobName, { slug: 'll2-incremental-burst', sourceFile: fileName });
      }
    }
  }

  return active;
}

function parseCurrentManagedJobsFromMigrations() {
  const active = new Map<string, { slug: string; sourceFile: string }>();

  for (const fileName of listMigrationFiles()) {
    const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');
    const insertRegex =
      /insert\s+into\s+public\.managed_scheduler_jobs\s*\([\s\S]*?\)\s*values\s*([\s\S]*?)\bon\s+conflict\b/gi;

    for (const match of sql.matchAll(insertRegex)) {
      const valuesBlock = match[1];
      const tupleRegex = /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,/g;
      for (const tuple of valuesBlock.matchAll(tupleRegex)) {
        active.set(tuple[1], { slug: tuple[2], sourceFile: fileName });
      }
    }
  }

  return active;
}

async function main() {
  const assertions: string[] = [];

  const ids = ADMIN_JOB_REGISTRY.map((job) => job.id);
  assert.equal(new Set(ids).size, ids.length, 'registry job ids must be unique');
  assertions.push('registry ids are unique');

  const requiredJobs = [
    'notifications_dispatch',
    'notifications_send',
    'billing_reconcile',
    'ops_metrics_collect',
    'og_prewarm',
    'celestrak_supgp_sync',
    'celestrak_supgp_ingest',
    'faa_tfr_ingest',
    'faa_notam_detail_ingest',
    'faa_launch_match',
    'faa_trajectory_hazard_ingest',
    'spacex_drone_ship_ingest',
    'spacex_drone_ship_wiki_sync',
    'artemis_nasa_blog_backfill',
    'artemis_crew_ingest',
    'artemis_components_ingest',
    'blue_origin_bootstrap',
    'blue_origin_vehicles_ingest',
    'blue_origin_engines_ingest',
    'blue_origin_missions_ingest',
    'blue_origin_news_ingest',
    'blue_origin_media_ingest',
    'blue_origin_passengers_ingest',
    'blue_origin_payloads_ingest',
    'blue_origin_contracts_ingest',
    'blue_origin_social_ingest',
    'blue_origin_snapshot_build'
  ] as const;

  for (const jobId of requiredJobs) {
    assert.ok(getAdminJobRegistryEntry(jobId), `registry is missing required job ${jobId}`);
  }
  assertions.push('required scheduled inventory is present');

  for (const jobId of ADMIN_RUNNABLE_JOB_IDS) {
    const job = getAdminJobRegistryEntry(jobId);
    assert.ok(job?.manualRunSupported, `${jobId} must be marked runnable`);
    assert.ok(job?.slug, `${jobId} must define a callable slug`);
  }
  assertions.push('every runnable job has a callable target');

  for (const job of ADMIN_JOB_REGISTRY) {
    if (job.schedulerKind === 'derived') {
      assert.equal(job.manualRunSupported, false, `${job.id} must not expose manual Run`);
      assert.equal(job.cronJobName ?? null, null, `${job.id} must not pretend to have a direct cron row`);
    }
  }
  assertions.push('derived jobs remain non-runnable telemetry-only entries');

  const registryByCronJobName = new Map(
    ADMIN_JOB_REGISTRY.filter((job) => job.cronJobName).map((job) => [job.cronJobName as string, job])
  );
  const pgCronJobsFromMigrations = parseCurrentPgCronJobsFromMigrations();
  const managedJobsFromMigrations = parseCurrentManagedJobsFromMigrations();

  for (const [cronJobName, scheduledJob] of pgCronJobsFromMigrations) {
    const registryJob = registryByCronJobName.get(cronJobName);
    assert.ok(registryJob, `active pg_cron job ${cronJobName} from ${scheduledJob.sourceFile} is missing from admin registry`);
    assert.equal(
      registryJob?.slug ?? null,
      scheduledJob.slug,
      `registry slug mismatch for pg_cron job ${cronJobName} from ${scheduledJob.sourceFile}`
    );
  }

  for (const [cronJobName, scheduledJob] of managedJobsFromMigrations) {
    const registryJob = registryByCronJobName.get(cronJobName);
    assert.ok(registryJob, `managed job ${cronJobName} from ${scheduledJob.sourceFile} is missing from admin registry`);
    assert.equal(
      registryJob?.schedulerKind,
      'managed',
      `registry scheduler kind mismatch for managed job ${cronJobName}`
    );
    assert.equal(
      registryJob?.slug ?? null,
      scheduledJob.slug,
      `registry slug mismatch for managed job ${cronJobName} from ${scheduledJob.sourceFile}`
    );
  }
  assertions.push('current migration-defined pg_cron and managed inventories are covered by the registry');

  assert.equal(normalizeAdminSyncJobId('sync_ll2'), 'll2_incremental');
  assert.equal(normalizeAdminSyncJobId('refresh_public_cache'), 'ingestion_cycle');
  assert.equal(normalizeAdminSyncJobId('dispatch_notifications'), 'notifications_dispatch');
  assertions.push('legacy sync aliases normalize into canonical registry ids');

  const migrationSource = readRepoFile('supabase/migrations/20260412120000_admin_job_control_plane_gate_alignment.sql');
  for (const job of ADMIN_JOB_REGISTRY) {
    if (!job.enabledKey || job.dispatcherGate !== 'invoke_edge_job' || !job.slug) continue;
    assert.match(
      migrationSource,
      new RegExp(`when '${escapeRegExp(job.slug)}' then '${job.enabledKey}'`),
      `${job.id} enabled key must be enforced in invoke_edge_job`
    );
  }
  assertions.push('invoke_edge_job gating matches the registry for gated jobs');

  const summaryRoute = readRepoFile('apps/web/app/api/admin/summary/route.ts');
  const syncRoute = readRepoFile('apps/web/app/api/admin/sync/route.ts');
  const opsPage = readRepoFile('apps/web/app/admin/ops/page.tsx');

  assert.match(summaryRoute, /const jobDefs = \[\.\.\.ADMIN_JOB_REGISTRY, \.\.\.localDefs\];/);
  assert.match(summaryRoute, /for \(const job of ADMIN_JOB_REGISTRY\) \{\s+if \(job\.enabledKey\) keys\.add\(job\.enabledKey\);\s+\}/m);
  assert.doesNotMatch(summaryRoute, /const SERVER_JOB_DEFS\s*=/);
  assert.match(syncRoute, /normalizeAdminSyncJobId/);
  assert.doesNotMatch(opsPage, /JOB_TRIGGER_BY_ID|type AdminSyncJob =/);
  assertions.push('summary, sync, and ops surfaces now consume registry-backed metadata');

  console.log(`admin-job-control-plane-guard: ok (${assertions.length} assertions)`);
}

await main();
