import { parseArgs } from 'node:util';
import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local' });
config();

type Mode = 'report' | 'backfill';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'report' },
    write: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    noCache: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  # Read-only audit of blank launch families that can be repaired from LL2 rocket configs
  ts-node --project tsconfig.scripts.json --transpile-only scripts/trajectory-rocket-family-backfill.ts

  # Backfill launches and launches_public_cache for the active/future window
  ts-node --project tsconfig.scripts.json --transpile-only scripts/trajectory-rocket-family-backfill.ts --mode=backfill --write

Options:
  --mode=report|backfill   default: report
  --write                  required to persist updates in backfill mode
  --all                    include historical launches, not just active/future rows
  --noCache                skip launches_public_cache updates
`;

if (values.help) {
  console.log(usage);
  process.exit(0);
}

function parseMode(raw: string | undefined): Mode {
  return raw === 'backfill' ? 'backfill' : 'report';
}

function buildDatabaseUrl() {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) return direct;

  const projectId = process.env.SUPABASE_PROJECT_ID?.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (!projectId || !password) {
    throw new Error('Missing DATABASE_URL (or SUPABASE_PROJECT_ID + SUPABASE_DB_PASSWORD) in environment.');
  }

  const encoded = encodeURIComponent(password);
  return `postgresql://postgres:${encoded}@db.${projectId}.supabase.co:5432/postgres?sslmode=require`;
}

function buildScopeClause(all: boolean) {
  if (all) return 'true';
  return `(l.net is null or l.net >= now() or l.window_start >= now() or l.window_end >= now())`;
}

async function main() {
  const mode = parseMode(values.mode);
  const shouldWrite = values.write === true;
  const includeCache = values.noCache !== true;
  const scopeClause = buildScopeClause(values.all === true);

  if (mode === 'backfill' && !shouldWrite) {
    console.log('[trajectory-rocket-family] backfill mode running in dry-run; pass --write to persist changes');
  }

  const databaseUrl = buildDatabaseUrl();
  const ssl =
    databaseUrl.includes('sslmode=require') || databaseUrl.includes('.supabase.co')
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new Pool({ connectionString: databaseUrl, ssl });
  const client = await pool.connect();

  try {
    const launchesCountQuery = `
with config_families as (
  select ll2_config_id, btrim(family) as family
  from public.ll2_rocket_configs
  where nullif(btrim(family), '') is not null
)
select count(*)::int as count
from public.launches l
join config_families cf on cf.ll2_config_id = l.ll2_rocket_config_id
where nullif(btrim(coalesce(l.rocket_family, '')), '') is null
  and ${scopeClause};
`;

    const cacheCountQuery = `
with config_families as (
  select ll2_config_id, btrim(family) as family
  from public.ll2_rocket_configs
  where nullif(btrim(family), '') is not null
)
select count(*)::int as count
from public.launches_public_cache c
join public.launches l on l.id = c.launch_id
join config_families cf on cf.ll2_config_id = l.ll2_rocket_config_id
where nullif(btrim(coalesce(c.rocket_family, '')), '') is null
  and ${scopeClause};
`;

    const sampleQuery = `
with config_families as (
  select ll2_config_id, btrim(family) as family
  from public.ll2_rocket_configs
  where nullif(btrim(family), '') is not null
)
select
  l.id as launch_id,
  l.name,
  l.net,
  l.vehicle,
  l.ll2_rocket_config_id,
  l.rocket_family as existing_launch_family,
  c.rocket_family as existing_cache_family,
  cf.family as config_family
from public.launches l
left join public.launches_public_cache c on c.launch_id = l.id
join config_families cf on cf.ll2_config_id = l.ll2_rocket_config_id
where nullif(btrim(coalesce(l.rocket_family, '')), '') is null
  and ${scopeClause}
order by l.net asc nulls last
limit 25;
`;

    const launchesNeedResult = await client.query<{ count: number }>(launchesCountQuery);
    const launchesNeed = launchesNeedResult.rows?.[0]?.count ?? 0;
    console.log(`[trajectory-rocket-family] launches needing repair: ${launchesNeed}`);

    if (includeCache) {
      const cacheNeedResult = await client.query<{ count: number }>(cacheCountQuery);
      const cacheNeed = cacheNeedResult.rows?.[0]?.count ?? 0;
      console.log(`[trajectory-rocket-family] public cache needing repair: ${cacheNeed}`);
    }

    const sampleResult = await client.query(sampleQuery);
    if (sampleResult.rows.length > 0) {
      console.log('[trajectory-rocket-family] sample rows:');
      console.table(sampleResult.rows);
    }

    if (mode !== 'backfill' || !shouldWrite) return;

    await client.query('begin');

    const launchesUpdateQuery = `
with config_families as (
  select ll2_config_id, btrim(family) as family
  from public.ll2_rocket_configs
  where nullif(btrim(family), '') is not null
)
update public.launches l
set
  rocket_family = cf.family,
  updated_at = now()
from config_families cf
where l.ll2_rocket_config_id = cf.ll2_config_id
  and nullif(btrim(coalesce(l.rocket_family, '')), '') is null
  and ${scopeClause};
`;

    const cacheUpdateQuery = `
with config_families as (
  select ll2_config_id, btrim(family) as family
  from public.ll2_rocket_configs
  where nullif(btrim(family), '') is not null
)
update public.launches_public_cache c
set
  rocket_family = cf.family,
  cache_generated_at = now()
from public.launches l
join config_families cf on cf.ll2_config_id = l.ll2_rocket_config_id
where c.launch_id = l.id
  and nullif(btrim(coalesce(c.rocket_family, '')), '') is null
  and ${scopeClause};
`;

    const launchesUpdateResult = await client.query(launchesUpdateQuery);
    console.log(`[trajectory-rocket-family] launches updated: ${launchesUpdateResult.rowCount ?? 0}`);

    if (includeCache) {
      const cacheUpdateResult = await client.query(cacheUpdateQuery);
      console.log(`[trajectory-rocket-family] public cache updated: ${cacheUpdateResult.rowCount ?? 0}`);
    }

    await client.query('commit');
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Ignore rollback failures if the transaction never started.
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
