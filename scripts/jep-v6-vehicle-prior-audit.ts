import { config } from 'dotenv';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

config({ path: '.env.local' });
config();

const DEFAULT_STATES = ['FL', 'CA', 'TX'] as const;

type LaunchAuditRow = {
  launch_id: string;
  net: string | null;
  provider: string | null;
  pad_state: string | null;
  vehicle: string | null;
  rocket_full_name: string | null;
  rocket_family: string | null;
  ll2_rocket_config_id: number | null;
};

type RocketConfigRow = {
  ll2_config_id: number;
  name: string | null;
  full_name: string | null;
  family: string | null;
  manufacturer: string | null;
};

async function main() {
  const states = parseStates(process.argv.slice(2));
  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: launchesData, error: launchesError } = await supabase
    .from('launches_public_cache')
    .select('launch_id, net, provider, pad_state, vehicle, rocket_full_name, rocket_family, ll2_rocket_config_id')
    .eq('hidden', false)
    .eq('pad_country_code', 'USA')
    .gte('net', nowIso)
    .in('pad_state', states)
    .ilike('provider', '%SpaceX%')
    .order('net', { ascending: true })
    .limit(500);

  if (launchesError) {
    throw new Error(`Failed to load future SpaceX launches: ${launchesError.message}`);
  }

  const launches = (launchesData || []) as LaunchAuditRow[];
  const configIds = [...new Set(launches.map((row) => row.ll2_rocket_config_id).filter((value): value is number => typeof value === 'number'))];

  const configsById = new Map<number, RocketConfigRow>();
  for (let index = 0; index < configIds.length; index += 200) {
    const slice = configIds.slice(index, index + 200);
    if (!slice.length) continue;
    const { data, error } = await supabase
      .from('ll2_rocket_configs')
      .select('ll2_config_id, name, full_name, family, manufacturer')
      .in('ll2_config_id', slice);
    if (error) throw new Error(`Failed to load ll2_rocket_configs: ${error.message}`);
    for (const row of (data || []) as RocketConfigRow[]) {
      configsById.set(row.ll2_config_id, row);
    }
  }

  const grouped = launches.reduce<Map<string, { launches: number; sampleNet: string | null; config: RocketConfigRow | null }>>((map, row) => {
    const key = JSON.stringify({
      padState: row.pad_state,
      rocketFullName: row.rocket_full_name,
      rocketFamily: row.rocket_family,
      ll2RocketConfigId: row.ll2_rocket_config_id
    });
    const existing = map.get(key);
    const configRow =
      typeof row.ll2_rocket_config_id === 'number' ? configsById.get(row.ll2_rocket_config_id) ?? null : null;
    if (existing) {
      existing.launches += 1;
      return map;
    }
    map.set(key, {
      launches: 1,
      sampleNet: row.net,
      config: configRow
    });
    return map;
  }, new Map());

  const summary = {
    generatedAt: new Date().toISOString(),
    states,
    futureLaunches: launches.length,
    withConfigId: launches.filter((row) => typeof row.ll2_rocket_config_id === 'number').length,
    distinctConfigIds: configIds.length,
    groupedFamilies: [...grouped.entries()]
      .map(([key, value]) => ({
        ...JSON.parse(key),
        launches: value.launches,
        sampleNet: value.sampleNet,
        configName: value.config?.name ?? null,
        configFullName: value.config?.full_name ?? null,
        configFamily: value.config?.family ?? null,
        configManufacturer: value.config?.manufacturer ?? null
      }))
      .sort((left, right) => right.launches - left.launches || String(left.padState || '').localeCompare(String(right.padState || '')))
  };

  console.log(JSON.stringify(summary, null, 2));
}

function parseStates(argv: string[]) {
  const statesArg = argv.find((arg) => arg.startsWith('--states='));
  if (!statesArg) return [...DEFAULT_STATES];
  const parsed = statesArg
    .split('=')[1]
    ?.split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .filter((value): value is (typeof DEFAULT_STATES)[number] => DEFAULT_STATES.includes(value as (typeof DEFAULT_STATES)[number]));
  return parsed?.length ? [...new Set(parsed)] : [...DEFAULT_STATES];
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
