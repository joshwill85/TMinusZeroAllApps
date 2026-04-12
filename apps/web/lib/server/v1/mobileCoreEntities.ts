import {
  locationDetailSchemaV1,
  padDetailSchemaV1,
  providerDetailSchemaV1,
  rocketDetailSchemaV1
} from '@tminuszero/contracts';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { fetchNewsStreamPage } from '@/lib/server/newsStream';
import { fetchProviderBySlug, type ProviderSummary } from '@/lib/server/providers';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { buildNewsDetailHref } from '@/lib/server/v1/mobileNews';
import { loadCatalogDetailPayload } from '@/lib/server/v1/mobileReference';
import type { Launch } from '@/lib/types/launch';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import { buildLaunchHref, buildLocationHref, buildRocketHref, toProviderSlug } from '@/lib/utils/launchLinks';
import { buildSlugId, slugify } from '@/lib/utils/slug';

const ENTITY_DETAIL_LIMIT = 12;

const FALLBACK_PROVIDERS: Record<string, { name: string }> = {
  spacex: { name: 'SpaceX' },
  nasa: { name: 'NASA' },
  'united-launch-alliance-ula': { name: 'United Launch Alliance (ULA)' },
  'rocket-lab': { name: 'Rocket Lab' },
  'blue-origin': { name: 'Blue Origin' }
};

function toLaunchSummary(launch: Launch) {
  return {
    id: launch.id,
    name: launch.name,
    provider: launch.provider || null,
    vehicle: launch.rocket?.fullName || launch.vehicle || null,
    net: launch.net || null,
    netPrecision: launch.netPrecision || null,
    status: launch.status || null,
    statusText: launch.statusText || null,
    href: buildLaunchHref(launch)
  };
}

function normalizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseRouteId(raw: string | null | undefined) {
  const value = String(raw || '').trim();
  if (!value) return { raw: '', numeric: null };
  const decoded = safeDecode(value);
  if (/^\d+$/.test(decoded)) {
    const numeric = Number(decoded);
    return {
      raw: decoded,
      numeric: Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null
    };
  }
  const match = decoded.match(/-(\d+)$/);
  if (!match) return { raw: decoded, numeric: null };
  const numeric = Number(match[1]);
  return {
    raw: decoded,
    numeric: Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : null
  };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function asFacts(entries: Array<{ label: string; value: string | null | undefined }>) {
  return entries
    .map((entry) => ({
      label: entry.label,
      value: String(entry.value || '').trim()
    }))
    .filter((entry) => entry.value);
}

function asLinks(
  entries: Array<{ title: string; subtitle?: string | null; href?: string | null; badge?: string | null; external?: boolean }>
) {
  const seen = new Set<string>();
  return entries
    .map((entry) => ({
      title: entry.title,
      subtitle: normalizeText(entry.subtitle) ?? null,
      href: normalizeText(entry.href) ?? null,
      badge: normalizeText(entry.badge) ?? null,
      external: Boolean(entry.external)
    }))
    .filter((entry) => entry.href && entry.title)
    .filter((entry) => {
      const key = `${entry.title}:${entry.href}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      title: entry.title,
      subtitle: entry.subtitle,
      href: entry.href as string,
      badge: entry.badge,
      external: entry.external
    }));
}

function asStats(entries: Array<{ label: string; value: string | number | null | undefined; detail?: string | null }>) {
  return entries
    .map((entry) => ({
      label: entry.label,
      value: entry.value == null ? '' : typeof entry.value === 'number' ? new Intl.NumberFormat().format(entry.value) : String(entry.value).trim(),
      detail: normalizeText(entry.detail) ?? null
    }))
    .filter((entry) => entry.value);
}

function normalizeCatalogLinks(detail: Awaited<ReturnType<typeof loadCatalogDetailPayload>> | null) {
  return asLinks(
    (detail?.links ?? []).map((link) => ({
      title: link.label,
      subtitle: link.external ? 'External reference' : 'Native linked surface',
      href: link.href,
      badge: link.external ? 'external' : 'native',
      external: link.external
    }))
  );
}

function buildRocketPath(title: string, routeId: string | number | null | undefined) {
  const raw = String(routeId || '').trim();
  if (!raw) {
    return `/rockets/${encodeURIComponent(slugify(title) || 'rocket')}`;
  }
  return `/rockets/${encodeURIComponent(buildSlugId(title, raw))}`;
}

function buildPadPath(title: string, routeId: string | number | null | undefined) {
  const raw = String(routeId || '').trim();
  if (!raw) {
    return `/catalog/pads/${encodeURIComponent(slugify(title) || 'pad')}`;
  }
  return `/catalog/pads/${encodeURIComponent(buildSlugId(title, raw))}`;
}

function buildProviderPath(slug: string) {
  return `/launch-providers/${encodeURIComponent(slug)}`;
}

function quoteOrValue(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function fetchLaunchSplit(buildQuery: (supabase: ReturnType<typeof createSupabaseServerClient>) => any) {
  const supabase = createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const [upcomingRes, recentRes, upcomingCountRes, totalCountRes] = await Promise.all([
    buildQuery(supabase).gte('net', nowIso).order('net', { ascending: true }).limit(ENTITY_DETAIL_LIMIT),
    buildQuery(supabase).lt('net', nowIso).order('net', { ascending: false }).limit(ENTITY_DETAIL_LIMIT),
    buildQuery(supabase).select('launch_id', { count: 'exact', head: true }).gte('net', nowIso),
    buildQuery(supabase).select('launch_id', { count: 'exact', head: true })
  ]);

  if (upcomingRes.error || recentRes.error) {
    return null;
  }

  return {
    upcoming: (upcomingRes.data || []).map(mapPublicCacheRow),
    recent: (recentRes.data || []).map(mapPublicCacheRow),
    upcomingCount: upcomingCountRes.count ?? null,
    totalCount: totalCountRes.count ?? null
  };
}

function buildDistinctLinks(
  launches: Launch[],
  kind: 'rocket' | 'location' | 'provider' | 'pad',
  limit = 6
) {
  const seen = new Set<string>();
  const links: Array<{ title: string; subtitle: string | null; href: string; badge: string | null }> = [];

  for (const launch of launches) {
    let title: string | null = null;
    let subtitle: string | null = null;
    let href: string | null = null;
    let badge: string | null = null;

    if (kind === 'rocket') {
      title = normalizeText(launch.rocket?.fullName) || normalizeText(launch.vehicle);
      href = title ? buildRocketHref(launch, title) : null;
      subtitle = normalizeText(launch.provider);
      badge = 'vehicle';
    }

    if (kind === 'location') {
      title = normalizeText(launch.pad.locationName) || normalizeText(launch.pad.name);
      href = buildLocationHref(launch);
      subtitle = normalizeText(launch.pad.state) || normalizeText(launch.pad.countryCode);
      badge = 'location';
    }

    if (kind === 'provider') {
      title = normalizeText(launch.provider);
      href = title ? buildProviderPath(toProviderSlug(title)) : null;
      subtitle = normalizeText(launch.rocket?.fullName) || normalizeText(launch.vehicle);
      badge = 'provider';
    }

    if (kind === 'pad') {
      title = normalizeText(launch.pad.name) || normalizeText(launch.pad.shortCode);
      const rawId = launch.ll2PadId != null ? String(launch.ll2PadId) : slugify(title || 'pad');
      href = title ? buildPadPath(title, rawId) : null;
      subtitle = normalizeText(launch.pad.locationName);
      badge = 'pad';
    }

    if (!title || !href) continue;
    const key = `${kind}:${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ title, subtitle, href, badge });
    if (links.length >= limit) break;
  }

  return links;
}

function buildNewsPreviewItems(result: Awaited<ReturnType<typeof fetchNewsStreamPage>>) {
  return result.page.items.slice(0, 4).map((item) => ({
    id: item.snapi_uid,
    title: item.title,
    subtitle: [item.news_site || null, item.launch?.primary?.name || null].filter(Boolean).join(' • ') || null,
    publishedAt: item.published_at || null,
    href: buildNewsDetailHref(item.snapi_uid),
    external: false
  }));
}

function summarizeLaunches(launches: Launch[]) {
  const all = launches.length;
  const padCount = new Set(
    launches
      .map((launch) => String(launch.ll2PadId ?? launch.pad.name ?? '').trim())
      .filter(Boolean)
  ).size;
  const providerCount = new Set(launches.map((launch) => String(launch.provider || '').trim()).filter(Boolean)).size;
  return { all, padCount, providerCount };
}

async function resolveProvider(slugValue: string) {
  const slug = toProviderSlug(slugValue);
  if (!slug) return null;
  const provider = await fetchProviderBySlug(slug);
  if (provider) return provider;
  const fallback = FALLBACK_PROVIDERS[slug];
  if (!fallback) return null;
  return {
    name: fallback.name,
    slug,
    type: undefined,
    countryCode: undefined,
    description: undefined,
    logoUrl: undefined,
    imageUrl: undefined
  } satisfies ProviderSummary;
}

export async function loadProviderDetailPayload(rawSlug: string) {
  if (!isSupabaseConfigured()) return null;
  const provider = await resolveProvider(rawSlug);
  if (!provider) return null;

  const split = await fetchLaunchSplit((supabase) => supabase.from('launches_public_cache').select('*').eq('provider', provider.name));
  if (!split) return null;

  const combined = [...split.upcoming, ...split.recent];
  const summary = summarizeLaunches(combined);
  const nextLaunch = split.upcoming[0] ?? null;
  const news = await fetchNewsStreamPage({
    type: 'all',
    providerName: provider.name,
    cursor: 0,
    limit: 4
  });

  return providerDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity: 'provider',
    eyebrow: 'Provider',
    title: provider.name,
    description: provider.description || `Upcoming launches, recent history, and linked coverage for ${provider.name}.`,
    canonicalPath: buildProviderPath(provider.slug),
    imageUrl: normalizeImageUrl(provider.logoUrl || provider.imageUrl || null),
    badges: [
      { label: 'native detail', tone: 'accent' },
      ...(provider.type ? [{ label: provider.type, tone: 'default' as const }] : []),
      ...(provider.countryCode ? [{ label: provider.countryCode, tone: 'success' as const }] : [])
    ],
    facts: asFacts([
      { label: 'Provider slug', value: provider.slug },
      { label: 'Type', value: provider.type ?? null },
      { label: 'Country', value: provider.countryCode ?? null },
      { label: 'Next launch', value: nextLaunch?.name ?? null }
    ]),
    stats: asStats([
      { label: 'Upcoming launches', value: split.upcomingCount ?? split.upcoming.length },
      { label: 'Tracked launches', value: split.totalCount ?? summary.all },
      { label: 'Active pads', value: summary.padCount || null },
      { label: 'Related coverage', value: news.page.items.length }
    ]),
    links: asLinks([
      { title: 'Provider news', subtitle: 'Open the native filtered news stream', href: `/news?provider=${encodeURIComponent(provider.slug)}`, badge: 'native' },
      { title: 'Search', subtitle: 'Search this provider in-app', href: `/search?q=${encodeURIComponent(provider.name)}`, badge: 'native' }
    ]),
    relatedLinks: asLinks([
      ...buildDistinctLinks(combined, 'rocket'),
      ...buildDistinctLinks(combined, 'location')
    ]),
    relatedNews: buildNewsPreviewItems(news),
    upcomingLaunches: split.upcoming.map(toLaunchSummary),
    recentLaunches: split.recent.map(toLaunchSummary)
  });
}

export async function loadRocketDetailPayload(rawId: string) {
  if (!isSupabaseConfigured()) return null;
  const routeId = parseRouteId(rawId);
  const idValue = routeId.numeric != null ? String(routeId.numeric) : routeId.raw;
  if (!idValue) return null;

  const [catalogDetail, split] = await Promise.all([
    loadCatalogDetailPayload('launcher_configurations', idValue),
    routeId.numeric != null
      ? fetchLaunchSplit((supabase) => supabase.from('launches_public_cache').select('*').eq('ll2_rocket_config_id', routeId.numeric))
      : null
  ]);

  const launchSplit = split || { upcoming: [], recent: [], upcomingCount: null, totalCount: null };
  const combined = [...launchSplit.upcoming, ...launchSplit.recent];
  const sample = combined[0] ?? null;
  if (!catalogDetail && !sample) return null;

  const title = catalogDetail?.title || sample?.rocket?.fullName || sample?.vehicle || routeId.raw || 'Rocket';
  const description =
    catalogDetail?.description ||
    sample?.rocket?.description ||
    `Vehicle-linked upcoming launches and launch history for ${title}.`;

  return rocketDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity: 'rocket',
    eyebrow: 'Vehicle',
    title,
    description,
    canonicalPath: buildRocketPath(title, routeId.numeric ?? routeId.raw),
    imageUrl: normalizeImageUrl(catalogDetail?.imageUrl || sample?.rocket?.imageUrl || null),
    badges: [
      { label: 'native detail', tone: 'accent' },
      ...(sample?.rocket?.family ? [{ label: sample.rocket.family, tone: 'default' as const }] : []),
      ...(sample?.rocket?.manufacturer ? [{ label: sample.rocket.manufacturer, tone: 'success' as const }] : [])
    ],
    facts: asFacts([
      ...(catalogDetail?.facts ?? []),
      { label: 'Full name', value: sample?.rocket?.fullName ?? sample?.vehicle ?? null },
      { label: 'Manufacturer', value: sample?.rocket?.manufacturer ?? null },
      { label: 'Family', value: sample?.rocket?.family ?? null }
    ]),
    stats: asStats([
      { label: 'Upcoming launches', value: launchSplit.upcomingCount ?? launchSplit.upcoming.length },
      { label: 'Tracked launches', value: launchSplit.totalCount ?? combined.length },
      { label: 'Recent launches loaded', value: launchSplit.recent.length },
      { label: 'Related providers', value: summarizeLaunches(combined).providerCount || null }
    ]),
    links: normalizeCatalogLinks(catalogDetail),
    relatedLinks: asLinks([
      ...buildDistinctLinks(combined, 'provider'),
      ...buildDistinctLinks(combined, 'location')
    ]),
    relatedNews: [],
    upcomingLaunches: launchSplit.upcoming.map(toLaunchSummary),
    recentLaunches: launchSplit.recent.map(toLaunchSummary)
  });
}

export async function loadPadDetailPayload(rawId: string) {
  if (!isSupabaseConfigured()) return null;
  const routeId = parseRouteId(rawId);
  const idValue = routeId.numeric != null ? String(routeId.numeric) : routeId.raw;
  if (!idValue) return null;

  const [catalogDetail, split] = await Promise.all([
    loadCatalogDetailPayload('pads', idValue),
    routeId.numeric != null
      ? fetchLaunchSplit((supabase) => supabase.from('launches_public_cache').select('*').eq('ll2_pad_id', routeId.numeric))
      : fetchLaunchSplit((supabase) => supabase.from('launches_public_cache').select('*').eq('pad_name', routeId.raw))
  ]);

  if (!split) return null;
  const combined = [...split.upcoming, ...split.recent];
  const sample = combined[0] ?? null;
  if (!catalogDetail && !sample) return null;

  const title = catalogDetail?.title || sample?.pad?.name || routeId.raw || 'Pad';
  const locationHref = sample ? buildLocationHref(sample) : null;

  return padDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity: 'pad',
    eyebrow: 'Launch Pad',
    title,
    description: catalogDetail?.description || `Launch cadence, linked location context, and recent activity for ${title}.`,
    canonicalPath: buildPadPath(title, routeId.numeric ?? routeId.raw),
    imageUrl: normalizeImageUrl(catalogDetail?.imageUrl || null),
    badges: [
      { label: 'native detail', tone: 'accent' },
      ...(sample?.pad?.shortCode ? [{ label: sample.pad.shortCode, tone: 'default' as const }] : []),
      ...(sample?.pad?.state && sample.pad.state !== 'NA' ? [{ label: sample.pad.state, tone: 'success' as const }] : [])
    ],
    facts: asFacts([
      ...(catalogDetail?.facts ?? []),
      { label: 'Location', value: sample?.pad?.locationName ?? null },
      { label: 'Timezone', value: sample?.pad?.timezone ?? null },
      { label: 'Country', value: sample?.pad?.countryCode ?? null }
    ]),
    stats: asStats([
      { label: 'Upcoming launches', value: split.upcomingCount ?? split.upcoming.length },
      { label: 'Tracked launches', value: split.totalCount ?? combined.length },
      { label: 'Recent launches loaded', value: split.recent.length }
    ]),
    links: asLinks([
      ...normalizeCatalogLinks(catalogDetail),
      ...(locationHref && sample?.pad?.locationName
        ? [{ title: sample.pad.locationName, subtitle: 'Linked launch location', href: locationHref, badge: 'location', external: false }]
        : []),
      ...(sample?.pad?.mapUrl ? [{ title: 'Map', subtitle: 'Launch pad map reference', href: sample.pad.mapUrl, badge: 'external', external: true }] : [])
    ]),
    relatedLinks: asLinks([
      ...buildDistinctLinks(combined, 'provider'),
      ...buildDistinctLinks(combined, 'rocket')
    ]),
    relatedNews: [],
    upcomingLaunches: split.upcoming.map(toLaunchSummary),
    recentLaunches: split.recent.map(toLaunchSummary)
  });
}

export async function loadLocationDetailPayload(rawId: string) {
  if (!isSupabaseConfigured()) return null;
  const routeId = parseRouteId(rawId);
  const idValue = String(routeId.numeric ?? routeId.raw ?? '').trim();
  if (!idValue) return null;

  const supabase = createSupabaseServerClient();
  let locationSeed: Launch | null = null;

  if (routeId.numeric != null) {
    const { data } = await supabase.from('launches_public_cache').select('*').eq('ll2_pad_id', routeId.numeric).limit(1);
    locationSeed = (data || []).map(mapPublicCacheRow)[0] ?? null;
  } else {
    const quoted = quoteOrValue(routeId.raw);
    const { data } = await supabase
      .from('launches_public_cache')
      .select('*')
      .or(`pad_location_name.eq.${quoted},location_name.eq.${quoted}`)
      .limit(1);
    locationSeed = (data || []).map(mapPublicCacheRow)[0] ?? null;
  }

  if (!locationSeed) return null;

  const locationName = locationSeed.pad.locationName || locationSeed.pad.name || routeId.raw;
  const quotedLocation = quoteOrValue(locationName);
  const split = await fetchLaunchSplit((client) =>
    client.from('launches_public_cache').select('*').or(`pad_location_name.eq.${quotedLocation},location_name.eq.${quotedLocation}`)
  );
  if (!split) return null;

  const combined = [...split.upcoming, ...split.recent];
  const relatedPads = buildDistinctLinks(combined, 'pad');

  return locationDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity: 'location',
    eyebrow: 'Launch Location',
    title: locationName,
    description: `Launch history, linked pads, and upcoming activity for ${locationName}.`,
    canonicalPath: buildLocationHref(locationSeed),
    imageUrl: null,
    badges: [
      { label: 'native detail', tone: 'accent' },
      ...(locationSeed.pad.state && locationSeed.pad.state !== 'NA' ? [{ label: locationSeed.pad.state, tone: 'default' as const }] : []),
      ...(locationSeed.pad.countryCode ? [{ label: locationSeed.pad.countryCode, tone: 'success' as const }] : [])
    ],
    facts: asFacts([
      { label: 'Representative pad', value: locationSeed.pad.name },
      { label: 'Timezone', value: locationSeed.pad.timezone ?? null },
      { label: 'Country', value: locationSeed.pad.countryCode ?? null },
      { label: 'State', value: locationSeed.pad.state ?? null }
    ]),
    stats: asStats([
      { label: 'Upcoming launches', value: split.upcomingCount ?? split.upcoming.length },
      { label: 'Tracked launches', value: split.totalCount ?? combined.length },
      { label: 'Linked pads', value: relatedPads.length || null }
    ]),
    links: asLinks([
      { title: 'Search', subtitle: 'Search this location in-app', href: `/search?q=${encodeURIComponent(locationName)}`, badge: 'native' }
    ]),
    relatedLinks: asLinks([
      ...relatedPads,
      ...buildDistinctLinks(combined, 'provider')
    ]),
    relatedNews: [],
    upcomingLaunches: split.upcoming.map(toLaunchSummary),
    recentLaunches: split.recent.map(toLaunchSummary)
  });
}
