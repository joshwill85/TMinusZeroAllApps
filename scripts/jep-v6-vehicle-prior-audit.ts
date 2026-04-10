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
  config_name?: string | null;
  config_full_name?: string | null;
  config_family?: string | null;
  config_manufacturer?: string | null;
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
  const { source, launches } = await loadLaunches(states);
  const configIds = [...new Set(launches.map((row) => row.ll2_rocket_config_id).filter((value): value is number => typeof value === 'number'))];

  const grouped = launches.reduce<Map<string, { launches: number; sampleNet: string | null; config: RocketConfigRow | null }>>((map, row) => {
    const key = JSON.stringify({
      padState: row.pad_state,
      rocketFullName: row.rocket_full_name,
      rocketFamily: row.rocket_family,
      ll2RocketConfigId: row.ll2_rocket_config_id
    });
    const existing = map.get(key);
    const configRow =
      typeof row.ll2_rocket_config_id === 'number'
        ? {
            ll2_config_id: row.ll2_rocket_config_id,
            name: row.config_name ?? null,
            full_name: row.config_full_name ?? row.rocket_full_name ?? null,
            family: row.config_family ?? row.rocket_family ?? null,
            manufacturer: row.config_manufacturer ?? null
          }
        : null;
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
    source,
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

async function loadLaunches(states: readonly string[]) {
  try {
    const launches = await loadLaunchesFromSupabase(states);
    return { source: 'supabase' as const, launches };
  } catch (error) {
    const launches = await loadLaunchesFromLl2(states);
    return {
      source: `ll2_upstream_fallback:${error instanceof Error ? error.message : String(error)}` as const,
      launches
    };
  }
}

async function loadLaunchesFromSupabase(states: readonly string[]) {
  const supabase = createSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: launchesData, error: launchesError } = await supabase
    .from('launches_public_cache')
    .select('launch_id, net, provider, pad_state, vehicle, rocket_full_name, rocket_family, ll2_rocket_config_id')
    .eq('hidden', false)
    .eq('pad_country_code', 'USA')
    .gte('net', nowIso)
    .in('pad_state', [...states])
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

  return launches.map((row) => {
    const config = row.ll2_rocket_config_id != null ? configsById.get(row.ll2_rocket_config_id) ?? null : null;
    return {
      ...row,
      config_name: config?.name ?? null,
      config_full_name: config?.full_name ?? null,
      config_family: config?.family ?? null,
      config_manufacturer: config?.manufacturer ?? null
    };
  });
}

async function loadLaunchesFromLl2(states: readonly string[]) {
  const url = new URL('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?format=api&limit=100');
  url.searchParams.set('lsp__name', 'SpaceX');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TMinusZero/0.1'
      }
    });
    if (!response.ok) {
      throw new Error(`LL2 upstream request failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
    };

    return (payload.results || [])
      .map((row) => mapLl2Launch(row))
      .filter((row): row is LaunchAuditRow => Boolean(row))
      .filter((row) => states.includes(String(row.pad_state || '').toUpperCase()));
  } finally {
    clearTimeout(timeout);
  }
}

function mapLl2Launch(row: Record<string, unknown>): LaunchAuditRow | null {
  const providerName = readText((row.launch_service_provider as Record<string, unknown> | null)?.name);
  if (!providerName || !providerName.toLowerCase().includes('spacex')) return null;

  const pad = (row.pad as Record<string, unknown> | null) ?? null;
  const rocket = (row.rocket as Record<string, unknown> | null) ?? null;
  const configuration = (rocket?.configuration as Record<string, unknown> | null) ?? null;
  const families = Array.isArray(configuration?.families) ? (configuration?.families as Array<Record<string, unknown>>) : [];

  const state = readText(pad?.state);
  const countryCode =
    readText((pad?.country as Record<string, unknown> | null)?.alpha_3_code) ||
    readText(((pad?.location as Record<string, unknown> | null)?.country as Record<string, unknown> | null)?.alpha_3_code);
  if (countryCode !== 'USA') return null;

  const familyName =
    readText(configuration?.family) || readText(families.at(-1)?.name) || readText(families[0]?.name) || null;

  return {
    launch_id: readText(row.id) || readText(row.url) || '',
    net: readText(row.net),
    provider: providerName,
    pad_state: state,
    vehicle: readText(row.name),
    rocket_full_name: readText(configuration?.full_name),
    rocket_family: familyName,
    ll2_rocket_config_id: readInteger(configuration?.id),
    config_name: readText(configuration?.name),
    config_full_name: readText(configuration?.full_name),
    config_family: familyName,
    config_manufacturer: 'SpaceX'
  };
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

function readText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
