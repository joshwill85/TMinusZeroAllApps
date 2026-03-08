import { createClient } from '@supabase/supabase-js';

type PassengerRow = {
  id: string;
  name: string;
  traveler_slug: string | null;
  launch_id: string | null;
  flight_code: string | null;
  source: string | null;
};

type AliasRule = {
  flightCode: string;
  canonicalName: string;
  aliases: string[];
};

const ALIAS_RULES: AliasRule[] = [
  {
    flightCode: 'ns-30',
    canonicalName: 'Elaine Chia Hyde',
    aliases: ['Elaine Hyde']
  },
  {
    flightCode: 'ns-30',
    canonicalName: 'Russell Wilson',
    aliases: ['Russel Wilson']
  },
  {
    flightCode: 'ns-30',
    canonicalName: 'Jesus Calleja',
    aliases: ['Jesús Calleja']
  },
  {
    flightCode: 'ns-32',
    canonicalName: 'Aymette Medina Jorge',
    aliases: ['Amy Medina Jorge']
  },
  {
    flightCode: 'ns-32',
    canonicalName: 'Jaime Aleman',
    aliases: ['Jaime Alemán']
  },
  {
    flightCode: 'ns-36',
    canonicalName: 'Vitalii Ostrovskyi',
    aliases: ['Vitalii Ostrovsky']
  },
  {
    flightCode: 'ns-36',
    canonicalName: 'Will Lewis',
    aliases: ['William H. Lewis']
  }
];

const APPLY = process.argv.includes('--apply');

async function main() {
  const url = sanitizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = sanitizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase configuration (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).'
    );
  }

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const deletedAliasSlugs = new Set<string>();
  const summary: Array<{
    flightCode: string;
    canonicalName: string;
    aliases: string[];
    canonicalLaunchId: string | null;
    deleteRowIds: string[];
    deleteNames: string[];
    mode: 'dry-run' | 'apply';
  }> = [];

  for (const rule of ALIAS_RULES) {
    const { data, error } = await supabase
      .from('blue_origin_passengers')
      .select('id,name,traveler_slug,launch_id,flight_code,source')
      .eq('flight_code', rule.flightCode)
      .in('name', [rule.canonicalName, ...rule.aliases]);
    if (error) throw error;

    const rows = ((data || []) as PassengerRow[]).filter((row) => row.flight_code === rule.flightCode);
    const canonicalRows = rows.filter((row) => row.name === rule.canonicalName);
    if (!canonicalRows.length) {
      summary.push({
        flightCode: rule.flightCode,
        canonicalName: rule.canonicalName,
        aliases: rule.aliases,
        canonicalLaunchId: null,
        deleteRowIds: [],
        deleteNames: [],
        mode: APPLY ? 'apply' : 'dry-run'
      });
      continue;
    }

    const canonical = pickPreferredCanonicalRow(canonicalRows);
    const canonicalLaunchId = canonical.launch_id || null;
    const aliasRows = rows.filter((row) => {
      if (!rule.aliases.includes(row.name)) return false;
      if (canonicalLaunchId && row.launch_id !== canonicalLaunchId) return false;
      return true;
    });
    const deleteRowIds = aliasRows.map((row) => row.id);
    const deleteNames = aliasRows.map((row) => row.name);
    for (const row of aliasRows) {
      if (row.traveler_slug) deletedAliasSlugs.add(row.traveler_slug);
    }

    if (APPLY && deleteRowIds.length) {
      const { error: deleteError } = await supabase.from('blue_origin_passengers').delete().in('id', deleteRowIds);
      if (deleteError) throw deleteError;
    }

    summary.push({
      flightCode: rule.flightCode,
      canonicalName: rule.canonicalName,
      aliases: rule.aliases,
      canonicalLaunchId,
      deleteRowIds,
      deleteNames,
      mode: APPLY ? 'apply' : 'dry-run'
    });
  }

  const travelerCleanupResults: Array<{
    travelerSlug: string;
    remainingPassengerRows: number;
    deletedTravelerProfile: boolean;
    mode: 'dry-run' | 'apply';
  }> = [];

  for (const slug of deletedAliasSlugs) {
    const { count, error: countError } = await supabase
      .from('blue_origin_passengers')
      .select('id', { count: 'exact', head: true })
      .eq('traveler_slug', slug);
    if (countError) throw countError;

    const remainingPassengerRows = Number(count || 0);
    let deletedTravelerProfile = false;
    if (APPLY && remainingPassengerRows === 0) {
      const { error: travelerDeleteError } = await supabase
        .from('blue_origin_travelers')
        .delete()
        .eq('traveler_slug', slug);
      if (travelerDeleteError) throw travelerDeleteError;
      deletedTravelerProfile = true;
    }

    travelerCleanupResults.push({
      travelerSlug: slug,
      remainingPassengerRows,
      deletedTravelerProfile,
      mode: APPLY ? 'apply' : 'dry-run'
    });
  }

  const deletedPassengerRows = summary.reduce((acc, row) => acc + row.deleteRowIds.length, 0);
  const deletedTravelerProfiles = travelerCleanupResults.filter((row) => row.deletedTravelerProfile).length;
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        rulesEvaluated: ALIAS_RULES.length,
        deletedPassengerRows,
        deletedTravelerProfiles,
        summary,
        travelerCleanupResults
      },
      null,
      2
    )
  );
}

function pickPreferredCanonicalRow(rows: PassengerRow[]) {
  return [...rows].sort((left, right) => passengerRowScore(right) - passengerRowScore(left))[0] as PassengerRow;
}

function passengerRowScore(row: PassengerRow) {
  const source = (row.source || '').toLowerCase();
  let score = 0;
  if (source.startsWith('ll2-api:new-shepard-detailed')) score += 50;
  if (source.startsWith('ll2_api.launch_detailed')) score += 45;
  if (source.startsWith('blue-origin-wayback:new-shepard-astronaut-directory')) score += 40;
  if (source.startsWith('blue-origin-wayback:new-shepard-mission-page')) score += 35;
  if (source.startsWith('curated-fallback:')) score += 30;
  return score;
}

function sanitizeEnvValue(value: string | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1).trim();
  }
  return normalized;
}

main().catch((error) => {
  console.error('[blue-origin-passenger-alias-cleanup] failed', error);
  process.exit(1);
});
