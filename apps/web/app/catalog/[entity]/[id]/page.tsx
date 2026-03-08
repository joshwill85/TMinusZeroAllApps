import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache, type ReactNode } from 'react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { BRAND_NAME } from '@/lib/brand';
import { isDateOnlyNet } from '@/lib/time';
import type { Launch } from '@/lib/types/launch';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';
import { buildLaunchHref, buildLocationHref, buildRocketHref } from '@/lib/utils/launchLinks';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';

type EntityType =
  | 'agencies'
  | 'astronauts'
  | 'space_stations'
  | 'expeditions'
  | 'docking_events'
  | 'launcher_configurations'
  | 'launchers'
  | 'spacecraft_configurations'
  | 'locations'
  | 'pads'
  | 'events';

type CatalogDetailRow = {
  entity_type: EntityType;
  entity_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  country_codes?: string[] | null;
  image_url?: string | null;
  data?: Record<string, unknown> | null;
  fetched_at?: string | null;
};

const ENTITY_LABELS: Record<EntityType, string> = {
  agencies: 'Agency',
  astronauts: 'Astronaut',
  space_stations: 'Space Station',
  expeditions: 'Expedition',
  docking_events: 'Docking Event',
  launcher_configurations: 'Launch Vehicle',
  launchers: 'Reusable First Stage',
  spacecraft_configurations: 'Spacecraft',
  locations: 'Location',
  pads: 'Pad',
  events: 'Event'
};

const ENTITY_COLLECTION_LABELS: Record<EntityType, string> = {
  agencies: 'Agencies',
  astronauts: 'Astronauts',
  space_stations: 'Space Stations',
  expeditions: 'Expeditions',
  docking_events: 'Docking Events',
  launcher_configurations: 'Launch Vehicles',
  launchers: 'Reusable First Stages',
  spacecraft_configurations: 'Spacecraft',
  locations: 'Locations',
  pads: 'Pads',
  events: 'Events'
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  agencies: 'Launch service providers, manufacturers, and space agencies tied to the LL2 dataset.',
  astronauts: 'Crewed flight roster with status, agency, and mission links when available.',
  space_stations: 'Active and historic stations with ownership and orbit context.',
  expeditions: 'Station expeditions and associated crew activities.',
  docking_events: 'Vehicle dockings and departures for visiting spacecraft.',
  launcher_configurations: 'Rocket configurations and variants with manufacturer context.',
  launchers: 'Reusable cores and first stages with flight history when available.',
  spacecraft_configurations: 'Crewed and uncrewed spacecraft configurations tracked by LL2.',
  locations: 'Launch sites and regions that host launch activity.',
  pads: 'Individual launch pads within each location.',
  events: 'Non-launch events: landings, spacewalks, tests, and more.'
};

const ENTITY_TYPES: EntityType[] = Object.keys(ENTITY_LABELS) as EntityType[];

const fetchCatalogItem = cache(async (entity: EntityType, entityId: string): Promise<CatalogDetailRow | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ll2_catalog_public_cache')
    .select('entity_type, entity_id, name, description, image_url, data')
    .eq('entity_type', entity)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error || !data) return null;
  return data as CatalogDetailRow;
});

export async function generateMetadata({
  params
}: {
  params: { entity: string; id: string };
}): Promise<Metadata> {
  const entity = resolveEntity(params.entity);
  if (!entity) {
    return { title: `Not found | ${SITE_META.siteName}`, robots: { index: false, follow: false } };
  }

  const item = await fetchCatalogItem(entity, params.id);
  if (!item) {
    return { title: `Not found | ${SITE_META.siteName}`, robots: { index: false, follow: false } };
  }

  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const siteMeta = buildSiteMeta();
  const canonical = `/catalog/${encodeURIComponent(entity)}/${encodeURIComponent(item.entity_id)}`;
  const pageUrl = `${siteUrl}${canonical}`;
  const title = `${item.name} | ${BRAND_NAME}`;
  const description = item.description || ENTITY_DESCRIPTIONS[entity];
  const imageUrl = normalizeImageUrl(item.image_url);
  const image = imageUrl ? (imageUrl.startsWith('/') ? `${siteUrl}${imageUrl}` : imageUrl) : siteMeta.ogImage;
  const imageAlt = `${item.name} ${ENTITY_LABELS[entity]} record`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: pageUrl,
      type: 'website',
      siteName: SITE_META.siteName,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: imageAlt,
          type: 'image/jpeg'
        }
      ]
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [
        {
          url: image,
          alt: imageAlt
        }
      ]
    }
  };
}

export default async function CatalogEntityPage({ params }: { params: { entity: string; id: string } }) {
  const entity = resolveEntity(params.entity);
  if (!entity) return notFound();
  const item = await fetchCatalogItem(entity, params.id);
  if (!item) return notFound();

  const details = buildDetailFacts(entity, item.data || {});
  const externalLinks = buildExternalLinks(entity, item.data || {});
  const relatedLaunches = await fetchRelatedLaunches(entity, item.entity_id, item.name, item.data || {});
  const imageUrl = normalizeImageUrl(item.image_url);
  const siteUrl = getSiteUrl();
  const collectionLabel = ENTITY_COLLECTION_LABELS[entity] || ENTITY_LABELS[entity];
  const collectionPath = `/catalog/${encodeURIComponent(entity)}`;
  const canonicalPath = `/catalog/${encodeURIComponent(entity)}/${encodeURIComponent(item.entity_id)}`;
  const pageUrl = `${siteUrl}${canonicalPath}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Info', item: `${siteUrl}/info` },
      { '@type': 'ListItem', position: 3, name: 'Catalog', item: `${siteUrl}/catalog` },
      { '@type': 'ListItem', position: 4, name: collectionLabel, item: `${siteUrl}${collectionPath}` },
      { '@type': 'ListItem', position: 5, name: item.name, item: pageUrl }
    ]
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 md:px-8">
      <JsonLd data={breadcrumbJsonLd} />
      <Breadcrumbs
        className="mb-6"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Info', href: '/info' },
          { label: 'Catalog', href: '/catalog' },
          { label: collectionLabel, href: collectionPath },
          { label: item.name }
        ]}
      />
      <header className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-text3">{ENTITY_LABELS[entity]}</p>
            <h1 className="text-3xl font-semibold text-text1">{item.name}</h1>
          </div>
          <p className="max-w-2xl text-sm text-text2">{item.description || ENTITY_DESCRIPTIONS[entity]}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-text3">
            <Link
              href={collectionPath}
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
            >
              Back to {entity.replace(/_/g, ' ')}
            </Link>
            <Link
              href="/info"
              className="rounded-full border border-stroke px-3 py-1 uppercase tracking-[0.14em] hover:text-text1"
            >
              Info hub
            </Link>
          </div>
        </div>

        {imageUrl && (
          <div className="flex h-24 w-48 items-center justify-center overflow-hidden rounded-2xl border border-stroke bg-[rgba(7,9,19,0.6)] px-4 py-3 shadow-glow">
            <img
              src={imageUrl}
              alt=""
              className="max-h-full w-full object-contain"
              loading="lazy"
              decoding="async"
            />
          </div>
        )}
      </header>

      {details.length > 0 && (
        <section className="mt-6 rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Details</div>
          <dl className="mt-3 grid gap-3 md:grid-cols-2">
            {details.map((fact) => (
              <Fact key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </dl>
        </section>
      )}

      {(relatedLaunches.upcoming.length > 0 || relatedLaunches.recent.length > 0) && (
        <section className="mt-4 grid gap-4 md:grid-cols-2">
          <LaunchList
            title="Upcoming launches"
            launches={relatedLaunches.upcoming}
            emptyLabel="No upcoming launches found."
            rolesByLaunchId={relatedLaunches.rolesByLaunchId}
          />
          <LaunchList
            title="Launch history"
            launches={relatedLaunches.recent}
            emptyLabel="No launch history found."
            rolesByLaunchId={relatedLaunches.rolesByLaunchId}
          />
        </section>
      )}

      {externalLinks.length > 0 && (
        <section className="mt-4 rounded-2xl border border-stroke bg-surface-1 p-4">
          <div className="text-xs uppercase tracking-[0.1em] text-text3">Links</div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            {externalLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="text-primary hover:text-primary/80">
                {link.label}
              </a>
            ))}
          </div>
        </section>
      )}

      <p className="mt-6 text-xs text-text4">Data provided by The Space Devs - Launch Library 2.</p>
    </div>
  );
}

function resolveEntity(raw: string): EntityType | null {
  const value = (raw || '').trim();
  return (ENTITY_TYPES.find((entity) => entity === value) || null) as EntityType | null;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-stroke bg-surface-0 p-3">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-text3">{label}</dt>
      <dd className="mt-1 text-sm text-text1">{value}</dd>
    </div>
  );
}

function buildDetailFacts(entity: EntityType, data: Record<string, unknown>) {
  const facts: Array<{ label: string; value: ReactNode }> = [];
  const safe = (value: unknown) => (typeof value === 'string' ? value : value == null ? null : String(value));
  const extractNationalityLabel = (entry: Record<string, unknown>) => {
    const candidate =
      entry['nationality_name'] ??
      entry['nationality_name_composed'] ??
      entry['name'] ??
      entry['alpha_3_code'] ??
      entry['alpha_2_code'];
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  };
  const formatNationality = (value: unknown) => {
    if (typeof value === 'string') return value;
    if (value == null) return null;

    const parseEntry = (entry: unknown) => {
      if (!entry) return null;
      if (typeof entry === 'string') return entry;
      if (typeof entry === 'object') {
        return extractNationalityLabel(entry as Record<string, unknown>);
      }
      return null;
    };

    if (Array.isArray(value)) {
      const names = value.map(parseEntry).filter((name): name is string => Boolean(name));
      return names.length ? names.join(', ') : null;
    }

    if (typeof value === 'object') {
      return extractNationalityLabel(value as Record<string, unknown>);
    }

    return safe(value);
  };

  if (entity === 'agencies') {
    const abbrev = safe(data.abbrev);
    const type = safe(data.type);
    const country = safe(data.country_code);
    const admin = safe(data.administrator);
    const founding = safe(data.founding_year);
    if (abbrev) facts.push({ label: 'Abbreviation', value: abbrev });
    if (type) facts.push({ label: 'Type', value: type });
    if (country) facts.push({ label: 'Country', value: country });
    if (admin) facts.push({ label: 'Administrator', value: admin });
    if (founding) facts.push({ label: 'Founded', value: founding });
  }

  if (entity === 'astronauts') {
    const nationality = formatNationality(data.nationality);
    const status = safe((data.status as any)?.name ?? data.status);
    const inSpace = typeof data.in_space === 'boolean' ? (data.in_space ? 'Yes' : 'No') : null;
    if (status) facts.push({ label: 'Status', value: status });
    if (nationality) facts.push({ label: 'Nationality', value: nationality });
    if (inSpace) facts.push({ label: 'In space', value: inSpace });
    const agencyObj = data.agency as any;
    const agencyId = toFiniteNumber(agencyObj?.id);
    const agencyName = agencyObj?.name ?? agencyObj?.abbrev;
    if (agencyName) {
      facts.push({
        label: 'Agency',
        value: agencyId ? (
          <Link href={`/catalog/agencies/${encodeURIComponent(String(agencyId))}`} className="transition hover:text-primary">
            {String(agencyName)}
          </Link>
        ) : (
          String(agencyName)
        )
      });
    }
  }

  if (entity === 'space_stations') {
    const status = safe((data.status as any)?.name ?? data.status);
    const orbit = safe((data.orbit as any)?.name ?? data.orbit);
    const founded = safe(data.founded);
    const deorbited = safe(data.deorbited);
    if (status) facts.push({ label: 'Status', value: status });
    if (orbit) facts.push({ label: 'Orbit', value: orbit });
    if (founded) facts.push({ label: 'Founded', value: founded });
    if (deorbited) facts.push({ label: 'Deorbited', value: deorbited });
  }

  if (entity === 'expeditions') {
    const start = safe(data.start);
    const end = safe(data.end);
    const stationObj = data.space_station as any;
    const stationId = toFiniteNumber(stationObj?.id);
    const stationName = stationObj?.name;
    if (stationName) {
      facts.push({
        label: 'Station',
        value: stationId ? (
          <Link
            href={`/catalog/space_stations/${encodeURIComponent(String(stationId))}`}
            className="transition hover:text-primary"
          >
            {String(stationName)}
          </Link>
        ) : (
          String(stationName)
        )
      });
    }
    if (start) facts.push({ label: 'Start', value: start });
    if (end) facts.push({ label: 'End', value: end });
  }

  if (entity === 'docking_events') {
    const docking = safe(data.docking);
    const departure = safe(data.departure);
    const launchId = safe(data.launch_id);
    const stationObj = data.space_station as any;
    const stationId = toFiniteNumber(stationObj?.id);
    const stationName = stationObj?.name;
    if (stationName) {
      facts.push({
        label: 'Station',
        value: stationId ? (
          <Link
            href={`/catalog/space_stations/${encodeURIComponent(String(stationId))}`}
            className="transition hover:text-primary"
          >
            {String(stationName)}
          </Link>
        ) : (
          String(stationName)
        )
      });
    }
    if (docking) facts.push({ label: 'Docking', value: docking });
    if (departure) facts.push({ label: 'Departure', value: departure });
    if (launchId) facts.push({ label: 'Launch (LL2)', value: launchId });
  }

  if (entity === 'launcher_configurations') {
    const family = safe(data.family);
    const variant = safe(data.variant);
    const reusable = typeof data.reusable === 'boolean' ? (data.reusable ? 'Yes' : 'No') : null;
    const manufacturer = safe(data.manufacturer);
    const manufacturerId = toFiniteNumber((data as any).manufacturer_id);
    if (family) facts.push({ label: 'Family', value: family });
    if (variant) facts.push({ label: 'Variant', value: variant });
    if (reusable) facts.push({ label: 'Reusable', value: reusable });
    if (manufacturer) {
      facts.push({
        label: 'Manufacturer',
        value: manufacturerId ? (
          <Link href={`/catalog/agencies/${encodeURIComponent(String(manufacturerId))}`} className="transition hover:text-primary">
            {manufacturer}
          </Link>
        ) : (
          manufacturer
        )
      });
    }
  }

  if (entity === 'launchers') {
    const serial = safe(data.serial_number);
    const status = safe((data.status as any)?.name ?? data.status);
    const flightProven = typeof data.flight_proven === 'boolean' ? (data.flight_proven ? 'Yes' : 'No') : null;
    if (serial) facts.push({ label: 'Serial', value: serial });
    if (status) facts.push({ label: 'Status', value: status });
    if (flightProven) facts.push({ label: 'Flight proven', value: flightProven });
    const configObj = data.launcher_config as any;
    const configId = toFiniteNumber(configObj?.id);
    const configName = configObj?.full_name ?? configObj?.name;
    if (configName) {
      facts.push({
        label: 'Configuration',
        value: configId ? (
          <Link
            href={`/catalog/launcher_configurations/${encodeURIComponent(String(configId))}`}
            className="transition hover:text-primary"
          >
            {String(configName)}
          </Link>
        ) : (
          String(configName)
        )
      });
    }
  }

  if (entity === 'spacecraft_configurations') {
    const capability = safe(data.capability);
    const humanRated = typeof data.human_rated === 'boolean' ? (data.human_rated ? 'Yes' : 'No') : null;
    const crewCap = safe(data.crew_capacity);
    if (capability) facts.push({ label: 'Capability', value: capability });
    if (humanRated) facts.push({ label: 'Human rated', value: humanRated });
    if (crewCap) facts.push({ label: 'Crew capacity', value: crewCap });
    const agencyObj = data.agency as any;
    const agencyId = toFiniteNumber(agencyObj?.id);
    const agencyName = agencyObj?.name ?? agencyObj?.abbrev;
    if (agencyName) {
      facts.push({
        label: 'Agency',
        value: agencyId ? (
          <Link href={`/catalog/agencies/${encodeURIComponent(String(agencyId))}`} className="transition hover:text-primary">
            {String(agencyName)}
          </Link>
        ) : (
          String(agencyName)
        )
      });
    }
  }

  if (entity === 'locations') {
    const country = safe(data.country_code);
    const timezone = safe(data.timezone_name);
    const total = safe(data.total_launch_count);
    if (country) facts.push({ label: 'Country', value: country });
    if (timezone) facts.push({ label: 'Timezone', value: timezone });
    if (total) facts.push({ label: 'Total launches', value: total });
  }

  if (entity === 'pads') {
    const country = safe(data.country_code);
    const location = safe(data.location_name);
    const locationId = toFiniteNumber((data as any).location_id);
    const attempts = safe(data.orbital_launch_attempt_count);
    if (location) {
      facts.push({
        label: 'Location',
        value: locationId ? (
          <Link href={`/catalog/locations/${encodeURIComponent(String(locationId))}`} className="transition hover:text-primary">
            {location}
          </Link>
        ) : (
          location
        )
      });
    }
    if (country) facts.push({ label: 'Country', value: country });
    if (attempts) facts.push({ label: 'Orbital attempts', value: attempts });
  }

  if (entity === 'events') {
    const date = safe(data.date);
    const type = safe((data.type as any)?.name ?? data.type);
    const location = safe(data.location);
    const webcast = typeof data.webcast_live === 'boolean' ? (data.webcast_live ? 'Live' : 'Not live') : null;
    if (type) facts.push({ label: 'Type', value: type });
    if (date) facts.push({ label: 'Date', value: date });
    if (location) facts.push({ label: 'Location', value: location });
    if (webcast) facts.push({ label: 'Webcast', value: webcast });
  }

  return facts;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildExternalLinks(entity: EntityType, data: Record<string, unknown>) {
  const links: Array<{ label: string; href: string }> = [];
  const safe = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

  const infoUrl = safe(data.info_url);
  const wikiUrl = safe(data.wiki_url);
  const url = safe(data.url);
  const nationUrl = safe(data.nation_url);

  if (entity === 'events') {
    if (url) links.push({ label: 'Event details', href: url });
  }

  if (infoUrl) links.push({ label: 'Info', href: infoUrl });
  if (wikiUrl) links.push({ label: 'Wiki', href: wikiUrl });
  if (nationUrl) links.push({ label: 'Nation', href: nationUrl });

  return links;
}

type RelatedLaunches = {
  upcoming: Launch[];
  recent: Launch[];
  rolesByLaunchId?: Record<string, string | null>;
};

async function fetchRelatedLaunches(
  entity: EntityType,
  entityId: string,
  itemName: string,
  data: Record<string, unknown>
): Promise<RelatedLaunches> {
  if (!isSupabaseConfigured()) return { upcoming: [], recent: [] };
  const supabase = createSupabaseServerClient();
  const numericId = Number(entityId);
  const hasNumericId = Number.isFinite(numericId);

  if (entity === 'agencies' && hasNumericId) {
    return fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').eq('ll2_agency_id', numericId),
      limit: 24
    });
  }

  if (entity === 'launcher_configurations' && hasNumericId) {
    return fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').eq('ll2_rocket_config_id', numericId),
      limit: 24
    });
  }

  if (entity === 'pads' && hasNumericId) {
    const padMatches = await fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').eq('ll2_pad_id', numericId),
      limit: 24
    });
    if (padMatches.upcoming.length > 0 || padMatches.recent.length > 0) {
      return padMatches;
    }
  }
  if (entity === 'pads') {
    const padName = typeof data.name === 'string' ? data.name : itemName;
    const locationName = typeof data.location_name === 'string' ? data.location_name : null;
    if (!padName) return { upcoming: [], recent: [] };
    return fetchLaunchSplit({
      supabase,
      build: () => {
        let query = supabase.from('launches_public_cache').select('*').eq('pad_name', padName);
        if (locationName) {
          const escapedLocation = escapeOrValue(locationName);
          query = query.or(`pad_location_name.eq.${escapedLocation},location_name.eq.${escapedLocation}`);
        }
        return query;
      },
      limit: 24
    });
  }

  if (entity === 'locations') {
    const escaped = escapeOrValue(itemName);
    return fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').or(`pad_location_name.eq.${escaped},location_name.eq.${escaped}`),
      limit: 24
    });
  }

  if (entity === 'events' && hasNumericId) {
    const { data: joins, error } = await supabase
      .from('ll2_event_launches')
      .select('launch_id')
      .eq('ll2_event_id', numericId)
      .limit(200);
    if (error || !joins) return { upcoming: [], recent: [] };
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return { upcoming: [], recent: [] };
    return fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)),
      limit: 24
    });
  }

  if (entity === 'astronauts' && hasNumericId) {
    const { data: joins, error } = await supabase
      .from('ll2_astronaut_launches')
      .select('launch_id, role')
      .eq('ll2_astronaut_id', numericId)
      .limit(400);
    if (error || !joins) return { upcoming: [], recent: [] };
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return { upcoming: [], recent: [] };
    const rolesByLaunchId: Record<string, string | null> = {};
    for (const row of joins as any[]) {
      if (!row?.launch_id) continue;
      rolesByLaunchId[String(row.launch_id)] = typeof row.role === 'string' ? row.role : null;
    }
    const launches = await fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)),
      limit: 24
    });
    return { ...launches, rolesByLaunchId };
  }

  if (entity === 'launchers' && hasNumericId) {
    const { data: joins, error } = await supabase
      .from('ll2_launcher_launches')
      .select('launch_id')
      .eq('ll2_launcher_id', numericId)
      .limit(400);
    if (error || !joins) return { upcoming: [], recent: [] };
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return { upcoming: [], recent: [] };
    return fetchLaunchSplit({
      supabase,
      build: () => supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)),
      limit: 24
    });
  }

  if (entity === 'docking_events') {
    const ll2LaunchUuid = typeof data.launch_id === 'string' ? data.launch_id : null;
    if (!ll2LaunchUuid) return { upcoming: [], recent: [] };
    const { data: matches, error } = await supabase
      .from('launches_public_cache')
      .select('*')
      .eq('ll2_launch_uuid', ll2LaunchUuid)
      .limit(1);
    if (error || !matches || matches.length === 0) return { upcoming: [], recent: [] };
    const launch = mapPublicCacheRow(matches[0]);
    const nowMs = Date.now();
    const netMs = Date.parse(launch.net);
    const isUpcoming = Number.isFinite(netMs) ? netMs >= nowMs : false;
    return { upcoming: isUpcoming ? [launch] : [], recent: isUpcoming ? [] : [launch] };
  }

  return { upcoming: [], recent: [] };
}

async function fetchLaunchSplit({
  supabase,
  build,
  limit
}: {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  build: () => any;
  limit: number;
}): Promise<RelatedLaunches> {
  const nowIso = new Date().toISOString();
  const [upcomingRes, recentRes] = await Promise.all([
    (build() as any).gte('net', nowIso).order('net', { ascending: true }).limit(limit),
    (build() as any).lt('net', nowIso).order('net', { ascending: false }).limit(limit)
  ]);

  if (upcomingRes.error || recentRes.error) {
    return { upcoming: [], recent: [] };
  }

  return {
    upcoming: (upcomingRes.data || []).map(mapPublicCacheRow),
    recent: (recentRes.data || []).map(mapPublicCacheRow)
  };
}

function LaunchList({
  title,
  launches,
  emptyLabel,
  rolesByLaunchId
}: {
  title: string;
  launches: Launch[];
  emptyLabel: string;
  rolesByLaunchId?: Record<string, string | null>;
}) {
  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold text-text1">{title}</h2>
        <span className="rounded-full border border-stroke px-3 py-1 text-xs uppercase tracking-[0.08em] text-text3">
          {launches.length} items
        </span>
      </div>
      {launches.length === 0 ? (
        <p className="mt-3 text-sm text-text3">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {launches.map((launch) => {
            const netLabel = formatLaunchDate(launch);
            const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
            const role = rolesByLaunchId?.[launch.id] ?? null;
            const rocketHref = buildRocketHref(launch, launch.rocket?.fullName || launch.vehicle);
            const locationHref = buildLocationHref(launch);

            return (
              <li key={launch.id} className="rounded-xl border border-stroke bg-surface-0 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={buildLaunchHref(launch)} className="text-sm font-semibold text-text1 hover:text-primary">
                      {launch.name}
                    </Link>
                    <div className="mt-1 text-xs text-text3">
                      <Link
                        href={`/catalog/agencies?q=${encodeURIComponent(launch.provider)}`}
                        className="transition hover:text-primary"
                      >
                        {launch.provider}
                      </Link>{' '}
                      -{' '}
                      <Link href={rocketHref} className="transition hover:text-primary">
                        {launch.rocket?.fullName || launch.vehicle}
                      </Link>
                      {role ? <span className="text-text4"> • {role}</span> : null}
                    </div>
                  </div>
                  <div className="text-right text-xs text-text3">
                    <div>{netLabel}</div>
                    {dateOnly && (
                      <span className="mt-1 inline-flex rounded-full border border-stroke px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]">
                        Time TBD
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-xs text-text3">
                  Launch site:{' '}
                  <Link href={locationHref} className="transition hover:text-primary">
                    {launch.pad.locationName || launch.pad.name}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatLaunchDate(launch: Launch) {
  const date = new Date(launch.net);
  if (Number.isNaN(date.getTime())) return launch.net;
  const zone = launch.pad?.timezone || 'UTC';
  const dateOnly = isDateOnlyNet(launch.net, launch.netPrecision);
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { month: 'short', day: '2-digit', year: 'numeric', timeZone: zone }
    : {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: zone,
        timeZoneName: 'short'
      };
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

function escapeOrValue(value: string) {
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}
