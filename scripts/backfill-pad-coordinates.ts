import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env.local' });
config();

type Args = {
  all: boolean;
  dryRun: boolean;
  includeCache: boolean;
};

function parseArgs(argv: string[]): Args {
  const flags = new Set(argv.slice(2));
  return {
    all: flags.has('--all'),
    dryRun: flags.has('--dry-run') || flags.has('--dry'),
    includeCache: !flags.has('--no-cache')
  };
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
  const args = parseArgs(process.argv);
  const databaseUrl = buildDatabaseUrl();

  const ssl =
    databaseUrl.includes('sslmode=require') || databaseUrl.includes('.supabase.co')
      ? { rejectUnauthorized: false }
      : undefined;

  const pool = new Pool({ connectionString: databaseUrl, ssl });
  const client = await pool.connect();
  try {
    const scopeClause = buildScopeClause(args.all);

    const padCoordsCte = `
with pad_coords as (
  select
    p.ll2_pad_id,
    coalesce(p.latitude, loc.latitude) as latitude,
    coalesce(p.longitude, loc.longitude) as longitude
  from public.ll2_pads p
  left join public.ll2_locations loc
    on loc.ll2_location_id = p.ll2_location_id
)
`;

    const launchesUpdate = `
${padCoordsCte}
update public.launches l
set
  pad_latitude = coalesce(l.pad_latitude, pc.latitude),
  pad_longitude = coalesce(l.pad_longitude, pc.longitude),
  updated_at = now()
from pad_coords pc
where l.ll2_pad_id = pc.ll2_pad_id
  and (l.pad_latitude is null or l.pad_longitude is null)
  and (pc.latitude is not null or pc.longitude is not null)
  and ${scopeClause};
`;

    const launchesCount = `
${padCoordsCte}
select count(*)::int as count
from public.launches l
join pad_coords pc on pc.ll2_pad_id = l.ll2_pad_id
where (l.pad_latitude is null or l.pad_longitude is null)
  and (pc.latitude is not null or pc.longitude is not null)
  and ${scopeClause};
`;

    const cacheUpdate = `
${padCoordsCte}
update public.launches_public_cache c
set
  pad_latitude = coalesce(c.pad_latitude, l.pad_latitude, pc.latitude),
  pad_longitude = coalesce(c.pad_longitude, l.pad_longitude, pc.longitude),
  cache_generated_at = now()
from public.launches l
left join pad_coords pc on pc.ll2_pad_id = l.ll2_pad_id
where c.launch_id = l.id
  and (c.pad_latitude is null or c.pad_longitude is null)
  and (pc.latitude is not null or pc.longitude is not null)
  and ${scopeClause};
`;

    const cacheCount = `
${padCoordsCte}
select count(*)::int as count
from public.launches_public_cache c
join public.launches l on l.id = c.launch_id
left join pad_coords pc on pc.ll2_pad_id = l.ll2_pad_id
where (c.pad_latitude is null or c.pad_longitude is null)
  and (pc.latitude is not null or pc.longitude is not null)
  and ${scopeClause};
`;

    const launchesNeedRes = await client.query(launchesCount);
    const launchesNeed = launchesNeedRes.rows?.[0]?.count ?? 0;
    console.log(`pad-coords: launches needing backfill: ${launchesNeed}`);

    if (args.includeCache) {
      const cacheNeedRes = await client.query(cacheCount);
      const cacheNeed = cacheNeedRes.rows?.[0]?.count ?? 0;
      console.log(`pad-coords: public cache needing backfill: ${cacheNeed}`);
    }

    if (args.dryRun) {
      console.log('pad-coords: dry run (no updates applied).');
      return;
    }

    const launchesRes = await client.query(launchesUpdate);
    console.log(`pad-coords: launches updated: ${launchesRes.rowCount ?? 0}`);

    if (args.includeCache) {
      const cacheRes = await client.query(cacheUpdate);
      console.log(`pad-coords: public cache updated: ${cacheRes.rowCount ?? 0}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
