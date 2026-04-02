import Link from 'next/link';
import clsx from 'clsx';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { getSiteUrl } from '@/lib/server/env';
import { fetchCatalogCollection } from '@/lib/server/catalogCollection';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';
import {
  CATALOG_PAGE_SIZE,
  buildCatalogCollectionPath,
  buildCatalogDetailPath,
  buildCatalogHref,
  catalogEntityOptions,
  getCatalogEntityOption,
  type CatalogEntityType,
  type CatalogRegion
} from '@/lib/utils/catalog';
import type { CatalogCollectionItem } from '@/lib/server/catalogCollection';

export async function CatalogCollectionView({
  activeEntity,
  region,
  query,
  page
}: {
  activeEntity: CatalogEntityType;
  region: CatalogRegion;
  query: string | null;
  page: number;
}) {
  const offset = (page - 1) * CATALOG_PAGE_SIZE;
  const siteUrl = getSiteUrl().replace(/\/$/, '');
  const collectionPath = buildCatalogCollectionPath(activeEntity);
  const pageUrl = `${siteUrl}${collectionPath}`;
  const activeMeta = getCatalogEntityOption(activeEntity);

  let items: CatalogCollectionItem[] = [];
  let errorMessage: string | null = null;

  const result = await fetchCatalogCollection({
    entity: activeEntity,
    region,
    query,
    limit: CATALOG_PAGE_SIZE,
    offset,
    includeCounts: true
  });
  items = result.items;
  errorMessage = result.errorMessage;
  const supabaseReady = result.supabaseReady;

  const hasNext = items.length === CATALOG_PAGE_SIZE;
  const hasPrev = page > 1;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Info', item: `${siteUrl}/info` },
      { '@type': 'ListItem', position: 3, name: 'Catalog', item: `${siteUrl}/catalog` },
      { '@type': 'ListItem', position: 4, name: activeMeta.label, item: pageUrl }
    ]
  };
  const collectionPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name: `${activeMeta.label} catalog`,
    description: activeMeta.description
  };
  const itemListJsonLd =
    items.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          '@id': `${pageUrl}#items`,
          numberOfItems: items.length,
          itemListElement: items.slice(0, 100).map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: `${siteUrl}${buildCatalogDetailPath(item.entity_type, item.entity_id)}`,
            name: item.name
          }))
        }
      : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <JsonLd data={[breadcrumbJsonLd, collectionPageJsonLd, ...(itemListJsonLd ? [itemListJsonLd] : [])]} />
      <Breadcrumbs
        className="mb-6"
        items={[
          { label: 'Home', href: '/' },
          { label: 'Info', href: '/info' },
          { label: 'Catalog', href: '/catalog' },
          { label: activeMeta.label }
        ]}
      />

      <header className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text3">Catalog Collection</p>
          <h1 className="text-3xl font-semibold text-text1">{activeMeta.label}</h1>
        </div>
        <p className="max-w-3xl text-sm text-text2">{activeMeta.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-text3">
          <span className="rounded-full border border-stroke px-3 py-1">Dataset: Launch Library 2</span>
          <span className="rounded-full border border-stroke px-3 py-1">{region === 'us' ? 'US only' : 'Global coverage'}</span>
          {query ? <span className="rounded-full border border-stroke px-3 py-1">Query: {query}</span> : null}
        </div>
      </header>

      <section className="mt-6 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {catalogEntityOptions.map((option) => {
            const isActive = option.value === activeEntity;
            return (
              <Link
                key={option.value}
                href={buildCatalogHref({ entity: option.value, region, q: query, page: 1 })}
                className={clsx(
                  'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition',
                  isActive
                    ? 'border-primary bg-[rgba(34,211,238,0.16)] text-text1'
                    : 'border-stroke bg-[rgba(255,255,255,0.03)] text-text3 hover:text-text1'
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text2">Browse the clean collection URL for {activeMeta.label.toLowerCase()} and use filters only when you need a utility view.</p>
          <div className="flex items-center gap-2">
            {(['all', 'us'] as const).map((value) => {
              const isActive = value === region;
              const label = value === 'us' ? 'US only' : 'Global';
              return (
                <Link
                  key={value}
                  href={buildCatalogHref({ entity: activeEntity, region: value, q: query, page: 1 })}
                  className={clsx(
                    'rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.14em] transition',
                    isActive
                      ? 'border-primary bg-[rgba(34,211,238,0.16)] text-text1'
                      : 'border-stroke bg-[rgba(255,255,255,0.03)] text-text3 hover:text-text1'
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>

        <form className="flex flex-wrap items-center gap-3" action={collectionPath} method="get">
          {region !== 'all' ? <input type="hidden" name="region" value={region} /> : null}
          <input
            type="text"
            name="q"
            defaultValue={query || ''}
            placeholder={`Search ${activeMeta.label.toLowerCase()}...`}
            className="h-10 w-full rounded-xl border border-stroke bg-surface-1 px-3 text-sm text-text1 placeholder:text-text4 md:w-80"
          />
          <button
            type="submit"
            className="btn-secondary h-10 rounded-xl border border-stroke px-4 text-xs uppercase tracking-[0.14em] text-text3"
          >
            Search
          </button>
          {query ? (
            <Link
              href={buildCatalogHref({ entity: activeEntity, region, page: 1 })}
              className="text-xs uppercase tracking-[0.14em] text-text3 hover:text-text1"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </section>

      <section className="mt-6">
        {!supabaseReady && (
          <div className="rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
            Configure Supabase env vars to load catalog data.
          </div>
        )}

        {supabaseReady && errorMessage && (
          <div className="rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
            Unable to load catalog data right now. ({errorMessage})
          </div>
        )}

        {supabaseReady && !errorMessage && items.length === 0 && (
          <div className="rounded-2xl border border-stroke bg-surface-1 p-5 text-sm text-text2">
            No catalog entries found for this view yet.
          </div>
        )}

        {items.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const meta = buildMeta(item);
              const description = item.description ? truncateText(item.description, 140) : null;
              const imageUrl = normalizeImageUrl(item.image_url);
              return (
                <Link
                  key={`${item.entity_type}:${item.entity_id}`}
                  href={buildCatalogDetailPath(item.entity_type, item.entity_id)}
                  className="flex h-full flex-col overflow-hidden rounded-2xl border border-stroke bg-surface-1 transition hover:border-primary"
                >
                  <div className="relative h-36 w-full overflow-hidden">
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="h-full w-full bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.3),_transparent_60%)]" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                    <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-white">
                      {activeMeta.label}
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <div className="text-sm font-semibold text-text1">{item.name}</div>
                    {description ? <p className="text-xs text-text2">{description}</p> : null}
                    {meta.length > 0 && (
                      <div className="mt-auto flex flex-wrap items-center gap-2 text-[11px] text-text3">
                        {meta.map((entry) => (
                          <span key={entry} className="rounded-full border border-stroke px-2 py-1">
                            {entry}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {(hasPrev || hasNext) && (
          <div className="mt-6 flex items-center justify-between">
            <div>
              {hasPrev ? (
                <Link
                  href={buildCatalogHref({ entity: activeEntity, region, q: query, page: page - 1 })}
                  className="btn-secondary rounded-xl border border-stroke px-4 py-2 text-xs uppercase tracking-[0.14em] text-text3"
                >
                  Previous
                </Link>
              ) : null}
            </div>
            <div>
              {hasNext ? (
                <Link
                  href={buildCatalogHref({ entity: activeEntity, region, q: query, page: page + 1 })}
                  className="btn-secondary rounded-xl border border-stroke px-4 py-2 text-xs uppercase tracking-[0.14em] text-text3"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function buildMeta(item: CatalogCollectionItem) {
  const data = item.data || {};
  const meta: string[] = [];

  if (item.entity_type === 'agencies') {
    if ((data as { abbrev?: unknown }).abbrev) meta.push(String((data as { abbrev?: unknown }).abbrev));
    if ((data as { country_code?: unknown }).country_code) meta.push(String((data as { country_code?: unknown }).country_code));
    if ((data as { type?: unknown }).type) meta.push(String((data as { type?: unknown }).type));
  }

  if (item.entity_type === 'astronauts') {
    if ((data as { nationality?: unknown }).nationality) meta.push(String((data as { nationality?: unknown }).nationality));
    const status = (data as { status?: { name?: unknown } | unknown }).status;
    if (typeof status === 'object' && status && 'name' in status && status.name) meta.push(String(status.name));
    else if (status) meta.push(String(status));
    if (typeof item.launch_count === 'number' && item.launch_count > 0) meta.push(`${item.launch_count} launches`);
  }

  if (item.entity_type === 'space_stations') {
    const status = (data as { status?: { name?: unknown } | unknown }).status;
    const orbit = (data as { orbit?: { name?: unknown } | unknown }).orbit;
    if (typeof status === 'object' && status && 'name' in status && status.name) meta.push(String(status.name));
    else if (status) meta.push(String(status));
    if (typeof orbit === 'object' && orbit && 'name' in orbit && orbit.name) meta.push(String(orbit.name));
    else if (orbit) meta.push(String(orbit));
  }

  if (item.entity_type === 'expeditions') {
    const start = formatDate((data as { start?: string | null }).start);
    const end = formatDate((data as { end?: string | null }).end);
    if (start && end) meta.push(`${start} - ${end}`);
  }

  if (item.entity_type === 'docking_events') {
    const docking = formatDate((data as { docking?: string | null }).docking);
    const station = (data as { space_station?: { name?: unknown } }).space_station;
    if (docking) meta.push(`Docking ${docking}`);
    if (station?.name) meta.push(String(station.name));
  }

  if (item.entity_type === 'launcher_configurations') {
    const launcherData = data as {
      family?: unknown;
      reusable?: boolean | null;
      manufacturer?: unknown;
    };
    if (launcherData.family) meta.push(String(launcherData.family));
    if (launcherData.reusable === true) meta.push('Reusable');
    if (launcherData.reusable === false) meta.push('Expendable');
    if (launcherData.manufacturer) meta.push(String(launcherData.manufacturer));
  }

  if (item.entity_type === 'launchers') {
    const launcherData = data as {
      serial_number?: unknown;
      status?: { name?: unknown } | unknown;
      flight_proven?: boolean | null;
    };
    if (launcherData.serial_number) meta.push(String(launcherData.serial_number));
    if (typeof launcherData.status === 'object' && launcherData.status && 'name' in launcherData.status && launcherData.status.name) {
      meta.push(String(launcherData.status.name));
    } else if (launcherData.status) {
      meta.push(String(launcherData.status));
    }
    if (launcherData.flight_proven === true) meta.push('Flight proven');
    if (typeof item.launch_count === 'number' && item.launch_count > 0) meta.push(`${item.launch_count} launches`);
  }

  if (item.entity_type === 'spacecraft_configurations') {
    const spacecraftData = data as {
      capability?: unknown;
      human_rated?: boolean | null;
      agency?: { name?: unknown } | null;
    };
    if (spacecraftData.capability) meta.push(String(spacecraftData.capability));
    if (spacecraftData.human_rated === true) meta.push('Human-rated');
    if (spacecraftData.agency?.name) meta.push(String(spacecraftData.agency.name));
  }

  if (item.entity_type === 'locations') {
    const locationData = data as {
      country_code?: unknown;
      timezone_name?: unknown;
      total_launch_count?: unknown;
    };
    if (locationData.country_code) meta.push(String(locationData.country_code));
    if (locationData.timezone_name) meta.push(String(locationData.timezone_name));
    if (typeof locationData.total_launch_count === 'number') meta.push(`${locationData.total_launch_count} launches`);
  }

  if (item.entity_type === 'pads') {
    const padData = data as {
      country_code?: unknown;
      location_name?: unknown;
      orbital_launch_attempt_count?: unknown;
    };
    if (padData.country_code) meta.push(String(padData.country_code));
    if (padData.location_name) meta.push(String(padData.location_name));
    if (typeof padData.orbital_launch_attempt_count === 'number') meta.push(`${padData.orbital_launch_attempt_count} attempts`);
  }

  if (item.entity_type === 'events') {
    const eventData = data as {
      date?: string | null;
      type?: { name?: unknown } | null;
    };
    const date = formatDate(eventData.date);
    if (date) meta.push(date);
    if (eventData.type?.name) meta.push(String(eventData.type.name));
  }

  return meta.slice(0, 3);
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function truncateText(value: string, max = 140) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}...`;
}
