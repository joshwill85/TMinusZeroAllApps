import { LL2_BASE, buildLl2Headers } from '@/lib/ingestion/ll2';
import { tryConsumeProvider } from '@/lib/ingestion/rateLimit';

export type LandingRole = 'booster' | 'spacecraft' | 'unknown';

type Ll2Landing = {
  id: number;
  landing_role?: LandingRole;
  attempt?: boolean;
  success?: boolean | null;
  description?: string | null;
  downrange_distance?: number | null;
  landing_location?: {
    id?: number;
    name?: string;
    abbrev?: string;
    latitude?: number | null;
    longitude?: number | null;
    location?: { name?: string } | null;
  } | null;
  type?: { id?: number; name?: string; abbrev?: string } | null;
};

async function fetchLandingsByQuery(query: string, role: LandingRole) {
  const rate = await tryConsumeProvider('ll2');
  if (!rate.allowed) {
    console.warn('LL2 rate limited; skipping landings call.');
    return [] as Ll2Landing[];
  }

  const url = `${LL2_BASE}/landings/?format=json&mode=detailed&limit=100&${query}`;
  const res = await fetch(url, { headers: buildLl2Headers() });
  if (!res.ok) {
    console.warn('LL2 landings fetch failed', res.status);
    return [] as Ll2Landing[];
  }
  const json = await res.json();
  const results = Array.isArray(json?.results) ? (json.results as Ll2Landing[]) : [];
  return results.map((row) => ({ ...row, landing_role: role }));
}

export async function fetchLandingsForLaunch(ll2LaunchId: string) {
  const firstStageResults = await fetchLandingsByQuery(
    `firststage_launch__ids=${encodeURIComponent(ll2LaunchId)}`,
    'booster'
  );
  const spacecraftResults = await fetchLandingsByQuery(
    `spacecraft_launch__ids=${encodeURIComponent(ll2LaunchId)}`,
    'spacecraft'
  );
  const byId = new Map<number, Ll2Landing>();
  // Prefer booster landings when the same landing appears in both query modes.
  for (const row of [...spacecraftResults, ...firstStageResults]) {
    if (typeof row.id === 'number') byId.set(row.id, row);
  }
  return [...byId.values()];
}
