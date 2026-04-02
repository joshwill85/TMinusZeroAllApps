import type { MetadataRoute } from 'next';

import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { fetchArtemisAwardeeIndex } from '@/lib/server/artemisAwardees';
import { fetchCanonicalContractsIndex } from '@/lib/server/contracts';
import { fetchBlueOriginTravelerSlugs } from '@/lib/server/blueOriginTravelers';
import { fetchSpaceXFlights } from '@/lib/server/spacexProgram';
import { fetchStarshipFlightIndex } from '@/lib/server/starship';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildLaunchHref, toProviderSlug } from '@/lib/utils/launchLinks';
import { buildArtemisAwardeeHref } from '@/lib/utils/artemisAwardees';
import { buildCatalogCollectionPath, catalogEntityOptions } from '@/lib/utils/catalog';
import { buildSlugId } from '@/lib/utils/slug';
import { createSupabasePublicClient } from '@/lib/server/supabaseServer';

export const SITEMAP_REVALIDATE_SECONDS = 60 * 60 * 6; // 6 hours
export const SITEMAP_CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';

const STATIC_PATHS: Array<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  priority: number;
}> = [
  { path: '/', changeFrequency: 'hourly', priority: 1 },
  { path: '/news', changeFrequency: 'hourly', priority: 0.8 },
  { path: '/info', changeFrequency: 'daily', priority: 0.7 },
  { path: '/starship', changeFrequency: 'daily', priority: 0.7 },
  { path: '/artemis', changeFrequency: 'daily', priority: 0.78 },
  { path: '/artemis-i', changeFrequency: 'daily', priority: 0.74 },
  { path: '/artemis-ii', changeFrequency: 'daily', priority: 0.8 },
  { path: '/artemis-iii', changeFrequency: 'daily', priority: 0.74 },
  { path: '/artemis-iv', changeFrequency: 'daily', priority: 0.72 },
  { path: '/artemis-v', changeFrequency: 'daily', priority: 0.71 },
  { path: '/artemis-vi', changeFrequency: 'daily', priority: 0.7 },
  { path: '/artemis-vii', changeFrequency: 'daily', priority: 0.69 },
  { path: '/artemis/awardees', changeFrequency: 'weekly', priority: 0.72 },
  { path: '/artemis/content', changeFrequency: 'daily', priority: 0.69 },
  { path: '/artemis/contracts', changeFrequency: 'daily', priority: 0.68 },
  { path: '/blue-origin', changeFrequency: 'daily', priority: 0.76 },
  { path: '/blue-origin/missions', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/blue-origin/missions/new-shepard', changeFrequency: 'daily', priority: 0.68 },
  { path: '/blue-origin/missions/new-glenn', changeFrequency: 'daily', priority: 0.68 },
  { path: '/blue-origin/missions/blue-moon', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/blue-origin/missions/blue-ring', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/blue-origin/missions/be-4', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/blue-origin/vehicles', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/blue-origin/vehicles/new-shepard', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/blue-origin/vehicles/new-glenn', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/blue-origin/vehicles/blue-moon', changeFrequency: 'weekly', priority: 0.63 },
  { path: '/blue-origin/vehicles/blue-ring', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/blue-origin/engines', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/blue-origin/engines/be-3pm', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/blue-origin/engines/be-3u', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/blue-origin/engines/be-4', changeFrequency: 'weekly', priority: 0.63 },
  { path: '/blue-origin/engines/be-7', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/blue-origin/flights', changeFrequency: 'daily', priority: 0.7 },
  { path: '/blue-origin/travelers', changeFrequency: 'daily', priority: 0.67 },
  { path: '/blue-origin/contracts', changeFrequency: 'daily', priority: 0.68 },
  { path: '/spacex', changeFrequency: 'daily', priority: 0.76 },
  { path: '/jellyfish-effect', changeFrequency: 'weekly', priority: 0.69 },
  { path: '/spacex/missions', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/spacex/missions/starship', changeFrequency: 'daily', priority: 0.68 },
  { path: '/spacex/missions/falcon-9', changeFrequency: 'daily', priority: 0.67 },
  { path: '/spacex/missions/falcon-heavy', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/spacex/missions/dragon', changeFrequency: 'daily', priority: 0.67 },
  { path: '/spacex/vehicles', changeFrequency: 'weekly', priority: 0.66 },
  { path: '/spacex/vehicles/starship-super-heavy', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/spacex/vehicles/falcon-9', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/spacex/vehicles/falcon-heavy', changeFrequency: 'weekly', priority: 0.63 },
  { path: '/spacex/vehicles/dragon', changeFrequency: 'weekly', priority: 0.63 },
  { path: '/spacex/engines', changeFrequency: 'weekly', priority: 0.64 },
  { path: '/spacex/engines/raptor', changeFrequency: 'weekly', priority: 0.63 },
  { path: '/spacex/engines/merlin-1d', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/spacex/engines/merlin-vac', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/spacex/engines/draco', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/spacex/engines/superdraco', changeFrequency: 'weekly', priority: 0.62 },
  { path: '/spacex/flights', changeFrequency: 'daily', priority: 0.7 },
  { path: '/spacex/drone-ships', changeFrequency: 'daily', priority: 0.7 },
  { path: '/spacex/drone-ships/ocisly', changeFrequency: 'daily', priority: 0.66 },
  { path: '/spacex/drone-ships/asog', changeFrequency: 'daily', priority: 0.66 },
  { path: '/spacex/drone-ships/jrti', changeFrequency: 'daily', priority: 0.66 },
  { path: '/spacex/contracts', changeFrequency: 'daily', priority: 0.68 },
  { path: '/contracts', changeFrequency: 'daily', priority: 0.72 },
  { path: '/catalog', changeFrequency: 'daily', priority: 0.7 },
  { path: '/satellites', changeFrequency: 'daily', priority: 0.68 },
  { path: '/launch-providers', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/upgrade', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/docs/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/docs/faq', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/docs/roadmap', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/legal/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/terms', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/data', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/legal/privacy-choices', changeFrequency: 'yearly', priority: 0.2 }
];

type PublicCacheScanResult = {
  coreLaunchEntries: MetadataRoute.Sitemap;
  longTailLaunchEntries: MetadataRoute.Sitemap;
  providerEntries: MetadataRoute.Sitemap;
  providerNewsEntries: MetadataRoute.Sitemap;
  rocketEntries: MetadataRoute.Sitemap;
  locationEntries: MetadataRoute.Sitemap;
};

type PublicCacheScanRow = {
  launch_id: string | null;
  name: string | null;
  slug: string | null;
  net: string | null;
  cache_generated_at: string | null;
  pad_country_code: string | null;
  provider: string | null;
  ll2_rocket_config_id: number | null;
  rocket_full_name: string | null;
  vehicle: string | null;
  ll2_pad_id: number | null;
  pad_location_name: string | null;
  pad_name: string | null;
};

type BlueOriginFlightLaunchRow = {
  launch_id: string | null;
  launch_date: string | null;
  updated_at: string | null;
};

type BlueOriginLaunchCacheRow = {
  launch_id: string | null;
  name: string | null;
  slug: string | null;
  net: string | null;
  cache_generated_at: string | null;
};

type CatalogEntityType = (typeof CATALOG_ENTITY_TYPES)[number];

type CatalogScanRow = {
  entity_type: CatalogEntityType | null;
  entity_id: string | null;
  fetched_at: string | null;
};

export type SitemapTiers = {
  siteUrl: string;
  coreEntries: MetadataRoute.Sitemap;
  launchEntries: MetadataRoute.Sitemap;
  entityEntries: MetadataRoute.Sitemap;
  catalogEntries: MetadataRoute.Sitemap;
};

export const SITEMAP_TIER_PAGE_SIZE = 10_000;

const LAUNCH_SCAN_PAGE_SIZE = 1000;
const CATALOG_SCAN_PAGE_SIZE = 1000;
const BLUE_ORIGIN_HISTORY_SCAN_PAGE_SIZE = 1000;
const BLUE_ORIGIN_LAUNCH_RESOLVE_CHUNK_SIZE = 250;

const CATALOG_ENTITY_TYPES = [
  'agencies',
  'astronauts',
  'space_stations',
  'expeditions',
  'docking_events',
  'launcher_configurations',
  'launchers',
  'spacecraft_configurations',
  'locations',
  'pads',
  'events'
] as const;

type ProgramFlightSitemapEntries = {
  spaceXFlightEntries: MetadataRoute.Sitemap;
  starshipFlightEntries: MetadataRoute.Sitemap;
};

export async function getSitemapTiers(): Promise<SitemapTiers> {
  const siteUrl = getSiteUrl();

  const catalogCollectionEntries: MetadataRoute.Sitemap = catalogEntityOptions.map((option) => ({
    url: `${siteUrl}${buildCatalogCollectionPath(option.value)}`,
    changeFrequency: 'daily',
    priority: 0.62
  }));
  const staticEntries: MetadataRoute.Sitemap = dedupeEntries([
    ...STATIC_PATHS.map(({ path, changeFrequency, priority }) => ({
      url: `${siteUrl}${path}`,
      changeFrequency,
      priority
    })),
    ...catalogCollectionEntries
  ]);

  const [publicCacheEntries, catalogEntries, awardeeEntries, programContractEntries, travelerEntries, blueOriginHistoricalLaunchEntries, programFlightEntries] =
    await Promise.all([
    getPublicCacheDerivedSitemapEntries(siteUrl),
    getCatalogSitemapEntries(siteUrl),
    getArtemisAwardeeSitemapEntries(siteUrl),
    getProgramContractSitemapEntries(siteUrl),
    getBlueOriginTravelerSitemapEntries(siteUrl),
    getBlueOriginHistoricalLaunchEntries(siteUrl),
    getProgramFlightSitemapEntries(siteUrl)
  ]);

  const coreEntries = dedupeEntries([...staticEntries, ...publicCacheEntries.coreLaunchEntries]);
  const coreEntryUrls = new Set(coreEntries.map((entry) => entry.url));
  const launchEntries = dedupeEntries([
    ...publicCacheEntries.longTailLaunchEntries,
    ...blueOriginHistoricalLaunchEntries,
    ...programFlightEntries.spaceXFlightEntries,
    ...programFlightEntries.starshipFlightEntries
  ]).filter((entry) => !coreEntryUrls.has(entry.url));

  return {
    siteUrl,
    coreEntries,
    launchEntries,
    entityEntries: dedupeEntries([
      ...publicCacheEntries.providerEntries,
      ...publicCacheEntries.providerNewsEntries,
      ...publicCacheEntries.rocketEntries,
      ...publicCacheEntries.locationEntries,
      ...awardeeEntries,
      ...programContractEntries,
      ...travelerEntries
    ]),
    catalogEntries: dedupeEntries(catalogEntries)
  };
}

async function getArtemisAwardeeSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  const rows = await fetchArtemisAwardeeIndex({ includeDraft: false, limit: 10_000 });

  return rows.map((row) => ({
    url: `${siteUrl}${buildArtemisAwardeeHref(row.slug)}`,
    lastModified: row.lastAwardedOn ? new Date(row.lastAwardedOn) : undefined,
    changeFrequency: 'weekly',
    priority: 0.62
  }));
}

async function getProgramContractSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  const canonicalContracts = await fetchCanonicalContractsIndex();
  return dedupeEntries(
    canonicalContracts.map((item) => ({
      url: `${siteUrl}${item.canonicalPath}`,
      lastModified: item.updatedAt ? new Date(item.updatedAt) : item.awardedOn ? new Date(`${item.awardedOn}T00:00:00Z`) : undefined,
      changeFrequency: 'weekly',
      priority: 0.63
    }))
  );
}

async function getBlueOriginTravelerSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  const slugs = await fetchBlueOriginTravelerSlugs();
  return slugs.map((slug) => ({
    url: `${siteUrl}/blue-origin/travelers/${slug}`,
    changeFrequency: 'monthly',
    priority: 0.59
  }));
}

export function buildSitemapXml(entries: MetadataRoute.Sitemap): string {
  const body = entries
    .map((entry) => {
      const parts = [`<loc>${escapeXml(entry.url)}</loc>`];
      const lastModified = normalizeLastModified(entry.lastModified);
      if (lastModified) parts.push(`<lastmod>${escapeXml(lastModified)}</lastmod>`);
      if (entry.changeFrequency) parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
      if (typeof entry.priority === 'number' && Number.isFinite(entry.priority)) {
        parts.push(`<priority>${formatPriority(entry.priority)}</priority>`);
      }
      return `<url>${parts.join('')}</url>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function buildSitemapIndexXml(urls: string[]) {
  const body = urls.map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</sitemapindex>`;
}

export function getSitemapPageCount(entries: MetadataRoute.Sitemap, pageSize = SITEMAP_TIER_PAGE_SIZE) {
  return Math.max(1, Math.ceil(entries.length / pageSize));
}

export function getSitemapPageEntries(entries: MetadataRoute.Sitemap, page: number, pageSize = SITEMAP_TIER_PAGE_SIZE) {
  const safePage = Math.max(1, Math.trunc(page));
  const start = (safePage - 1) * pageSize;
  return entries.slice(start, start + pageSize);
}

async function getPublicCacheDerivedSitemapEntries(siteUrl: string): Promise<PublicCacheScanResult> {
  const coreLaunchEntries: MetadataRoute.Sitemap = [];
  const longTailLaunchEntries: MetadataRoute.Sitemap = [];
  const providerBySlug = new Map<string, { lastModified?: Date }>();
  const rocketById = new Map<string, { name: string; lastModified?: Date }>();
  const locationById = new Map<string, { name: string; lastModified?: Date }>();
  const seenLaunchIds = new Set<string>();

  if (!isSupabaseConfigured()) {
    return {
      coreLaunchEntries,
      longTailLaunchEntries,
      providerEntries: [],
      providerNewsEntries: [],
      rocketEntries: [],
      locationEntries: []
    };
  }

  const supabase = createSupabasePublicClient();
  const nowMs = Date.now();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select(
        'launch_id, name, slug, net, cache_generated_at, pad_country_code, provider, ll2_rocket_config_id, rocket_full_name, vehicle, ll2_pad_id, pad_location_name, pad_name'
      )
      .order('net', { ascending: false, nullsFirst: false })
      .order('launch_id', { ascending: true })
      .range(offset, offset + LAUNCH_SCAN_PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data as PublicCacheScanRow[]) {
      if (!row.launch_id) continue;
      if (seenLaunchIds.has(row.launch_id)) continue;
      seenLaunchIds.add(row.launch_id);

      const href = buildLaunchHref({
        id: row.launch_id,
        name: row.name || 'Launch',
        slug: row.slug || undefined
      });
      const netMs = row.net ? Date.parse(row.net) : Number.NaN;
      const lastModified = row.cache_generated_at
        ? new Date(row.cache_generated_at)
        : row.net
          ? new Date(row.net)
          : undefined;
      const padCode = row.pad_country_code?.trim();
      const isUsLaunch = padCode ? (US_PAD_COUNTRY_CODES as readonly string[]).includes(padCode) : false;
      const isUpcoming = Number.isFinite(netMs) && netMs >= nowMs;
      const isNearTerm =
        Number.isFinite(netMs) && netMs >= nowMs - 1000 * 60 * 60 * 24 * 2 && netMs <= nowMs + 1000 * 60 * 60 * 24 * 30;

      const entry: MetadataRoute.Sitemap[number] = {
        url: `${siteUrl}${href}`,
        lastModified,
        changeFrequency: isNearTerm ? 'hourly' : isUpcoming ? 'daily' : 'monthly',
        priority: isUsLaunch ? 0.7 : isUpcoming ? 0.55 : 0.4
      };

      if (isNearTerm) coreLaunchEntries.push(entry);
      else longTailLaunchEntries.push(entry);

      const providerName = row.provider?.trim();
      if (providerName && providerName.toLowerCase() !== 'unknown') {
        const providerSlug = toProviderSlug(providerName);
        if (providerSlug) {
          const existing = providerBySlug.get(providerSlug);
          providerBySlug.set(providerSlug, { lastModified: maxDate(existing?.lastModified, lastModified) });
        }
      }

      if (Number.isFinite(row.ll2_rocket_config_id)) {
        const rocketId = String(row.ll2_rocket_config_id);
        const rocketLabel = row.rocket_full_name?.trim() || row.vehicle?.trim() || rocketId;
        const existing = rocketById.get(rocketId);
        rocketById.set(rocketId, {
          name: existing?.name ?? rocketLabel,
          lastModified: maxDate(existing?.lastModified, lastModified)
        });
      }

      if (Number.isFinite(row.ll2_pad_id)) {
        const padId = String(row.ll2_pad_id);
        const locationLabel = row.pad_location_name?.trim() || row.pad_name?.trim() || padId;
        const existing = locationById.get(padId);
        locationById.set(padId, {
          name: existing?.name ?? locationLabel,
          lastModified: maxDate(existing?.lastModified, lastModified)
        });
      }
    }

    if (data.length < LAUNCH_SCAN_PAGE_SIZE) break;
    offset += data.length;
  }

  const providerEntries: MetadataRoute.Sitemap = [...providerBySlug.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, meta]) => ({
      url: `${siteUrl}/launch-providers/${encodeURIComponent(slug)}`,
      lastModified: meta.lastModified,
      changeFrequency: 'daily',
      priority: 0.6
    }));

  const providerNewsEntries: MetadataRoute.Sitemap = [...providerBySlug.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, meta]) => ({
      url: `${siteUrl}/providers/${encodeURIComponent(slug)}`,
      lastModified: meta.lastModified,
      changeFrequency: 'daily',
      priority: 0.58
    }));

  const rocketEntries: MetadataRoute.Sitemap = [...rocketById.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([rocketId, meta]) => {
      const slugId = buildSlugId(meta.name, rocketId);
      return {
        url: `${siteUrl}/rockets/${encodeURIComponent(slugId)}`,
        lastModified: meta.lastModified,
        changeFrequency: 'weekly',
        priority: 0.6
      };
    });

  const locationEntries: MetadataRoute.Sitemap = [...locationById.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([padId, meta]) => {
      const slugId = buildSlugId(meta.name, padId);
      return {
        url: `${siteUrl}/locations/${encodeURIComponent(slugId)}`,
        lastModified: meta.lastModified,
        changeFrequency: 'weekly',
        priority: 0.6
      };
    });

  return {
    coreLaunchEntries,
    longTailLaunchEntries,
    providerEntries,
    providerNewsEntries,
    rocketEntries,
    locationEntries
  };
}

async function getProgramFlightSitemapEntries(siteUrl: string): Promise<ProgramFlightSitemapEntries> {
  try {
    const nowMs = Date.now();
    const [spaceXFlights, starshipFlights] = await Promise.all([fetchSpaceXFlights('all'), fetchStarshipFlightIndex()]);

    const spaceXFlightEntries = dedupeEntries(
      spaceXFlights.items.map((item) => {
        const netMs = Date.parse(item.launch.net);
        const isUpcoming = Number.isFinite(netMs) && netMs >= nowMs;
        const lastModifiedRaw = item.launch.cacheGeneratedAt || item.launch.lastUpdated || item.launch.net;
        const lastModifiedMs = lastModifiedRaw ? Date.parse(lastModifiedRaw) : Number.NaN;

        return {
          url: `${siteUrl}/spacex/flights/${encodeURIComponent(item.flightSlug)}`,
          lastModified: Number.isFinite(lastModifiedMs) ? new Date(lastModifiedMs) : undefined,
          changeFrequency: isUpcoming ? 'daily' : 'monthly',
          priority: isUpcoming ? 0.58 : 0.46
        } satisfies MetadataRoute.Sitemap[number];
      })
    );

    const starshipFlightEntries = dedupeEntries(
      starshipFlights.map((entry) => {
        const nextLaunchMs = entry.nextLaunch?.net ? Date.parse(entry.nextLaunch.net) : Number.NaN;
        const isUpcoming = Number.isFinite(nextLaunchMs) && nextLaunchMs >= nowMs;
        const lastModifiedMs = entry.lastUpdated ? Date.parse(entry.lastUpdated) : Number.NaN;

        return {
          url: `${siteUrl}/starship/${encodeURIComponent(entry.flightSlug)}`,
          lastModified: Number.isFinite(lastModifiedMs) ? new Date(lastModifiedMs) : undefined,
          changeFrequency: isUpcoming ? 'daily' : 'weekly',
          priority: isUpcoming ? 0.66 : 0.56
        } satisfies MetadataRoute.Sitemap[number];
      })
    );

    return { spaceXFlightEntries, starshipFlightEntries };
  } catch (error) {
    console.error('sitemap program flight entries error', error);
    return { spaceXFlightEntries: [], starshipFlightEntries: [] };
  }
}

async function getBlueOriginHistoricalLaunchEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const launchIds = new Set<string>();
  const launchDateById = new Map<string, string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('blue_origin_flights')
      .select('launch_id,launch_date,updated_at')
      .not('launch_id', 'is', null)
      .order('launch_date', { ascending: false, nullsFirst: false })
      .order('launch_id', { ascending: true })
      .range(offset, offset + BLUE_ORIGIN_HISTORY_SCAN_PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data as BlueOriginFlightLaunchRow[]) {
      const launchId = row.launch_id?.trim();
      if (!launchId) continue;
      launchIds.add(launchId);
      if (!launchDateById.has(launchId) && row.launch_date) {
        launchDateById.set(launchId, row.launch_date);
      }
    }

    if (data.length < BLUE_ORIGIN_HISTORY_SCAN_PAGE_SIZE) break;
    offset += data.length;
  }

  if (!launchIds.size) return [];

  const nowMs = Date.now();
  const entries: MetadataRoute.Sitemap = [];
  for (const chunk of chunkArray([...launchIds], BLUE_ORIGIN_LAUNCH_RESOLVE_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('launches_public_cache')
      .select('launch_id,name,slug,net,cache_generated_at')
      .in('launch_id', chunk)
      .limit(BLUE_ORIGIN_LAUNCH_RESOLVE_CHUNK_SIZE);

    if (error || !data || data.length === 0) continue;

    for (const row of data as BlueOriginLaunchCacheRow[]) {
      const launchId = row.launch_id?.trim();
      if (!launchId) continue;

      const href = buildLaunchHref({
        id: launchId,
        name: row.name || 'Launch',
        slug: row.slug || undefined
      });
      const netCandidate = row.net || launchDateById.get(launchId) || '';
      const netMs = Date.parse(netCandidate);
      const lastModifiedRaw = row.cache_generated_at || row.net || launchDateById.get(launchId) || null;
      const lastModifiedMs = lastModifiedRaw ? Date.parse(lastModifiedRaw) : Number.NaN;

      entries.push({
        url: `${siteUrl}${href}`,
        lastModified: Number.isFinite(lastModifiedMs) ? new Date(lastModifiedMs) : undefined,
        changeFrequency: Number.isFinite(netMs) && netMs >= nowMs ? 'daily' : 'monthly',
        priority: Number.isFinite(netMs) && netMs >= nowMs ? 0.56 : 0.45
      });
    }
  }

  return dedupeEntries(entries);
}

async function getCatalogSitemapEntries(siteUrl: string): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];

  const supabase = createSupabasePublicClient();
  const entries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('ll2_catalog_public_cache')
      .select('entity_type, entity_id, fetched_at')
      .in('entity_type', [...CATALOG_ENTITY_TYPES])
      .order('entity_type', { ascending: true })
      .order('entity_id', { ascending: true })
      .range(offset, offset + CATALOG_SCAN_PAGE_SIZE - 1);

    if (error || !data || data.length === 0) break;

    for (const row of data as CatalogScanRow[]) {
      if (!row.entity_type || !row.entity_id) continue;
      const key = `${row.entity_type}:${row.entity_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        url: `${siteUrl}/catalog/${encodeURIComponent(row.entity_type)}/${encodeURIComponent(row.entity_id)}`,
        lastModified: row.fetched_at ? new Date(row.fetched_at) : undefined,
        changeFrequency: 'weekly',
        priority: 0.4
      });
    }

    if (data.length < CATALOG_SCAN_PAGE_SIZE) break;
    offset += data.length;
  }

  return entries;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) return [] as T[][];
  const size = Math.max(1, Math.trunc(chunkSize));
  const out = [] as T[][];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function dedupeEntries(entries: MetadataRoute.Sitemap) {
  const seen = new Set<string>();
  const deduped: MetadataRoute.Sitemap = [];
  for (const entry of entries) {
    if (!entry?.url || seen.has(entry.url)) continue;
    seen.add(entry.url);
    deduped.push(entry);
  }
  return deduped;
}

function normalizeLastModified(value: string | Date | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

function formatPriority(priority: number) {
  const rounded = Math.round(priority * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function maxDate(a: Date | undefined, b: Date | undefined) {
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}
