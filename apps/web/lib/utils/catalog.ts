const CATALOG_ENTITY_OPTIONS = [
  {
    value: 'agencies',
    label: 'Agencies',
    description: 'Launch service providers, manufacturers, and space agencies tied to the LL2 dataset.'
  },
  {
    value: 'astronauts',
    label: 'Astronauts',
    description: 'Crewed flight roster with status, agency, and mission links when available.'
  },
  {
    value: 'space_stations',
    label: 'Space Stations',
    description: 'Active and historic stations with ownership and orbit context.'
  },
  {
    value: 'expeditions',
    label: 'Expeditions',
    description: 'Station expeditions and associated crew activities.'
  },
  {
    value: 'docking_events',
    label: 'Docking Events',
    description: 'Vehicle dockings and departures for visiting spacecraft.'
  },
  {
    value: 'launcher_configurations',
    label: 'Launch Vehicles',
    description: 'Rocket configurations and variants with manufacturer context.'
  },
  {
    value: 'launchers',
    label: 'Reusable First Stages',
    description: 'Reusable cores and first stages with flight history when available.'
  },
  {
    value: 'spacecraft_configurations',
    label: 'Spacecraft',
    description: 'Crewed and uncrewed spacecraft configurations tracked by LL2.'
  },
  {
    value: 'locations',
    label: 'Locations',
    description: 'Launch sites and regions that host launch activity.'
  },
  {
    value: 'pads',
    label: 'Pads',
    description: 'Individual launch pads within each location.'
  },
  {
    value: 'events',
    label: 'Events',
    description: 'Non-launch events: landings, spacewalks, tests, and more.'
  }
] as const;

export const catalogEntityOptions = CATALOG_ENTITY_OPTIONS;
export const DEFAULT_CATALOG_ENTITY = 'agencies' as const;
export const CATALOG_PAGE_SIZE = 36;

export type CatalogEntityType = (typeof CATALOG_ENTITY_OPTIONS)[number]['value'];
export type CatalogRegion = 'all' | 'us';
export type CatalogEntityOption = (typeof CATALOG_ENTITY_OPTIONS)[number];

export function parseCatalogEntity(raw?: string | string[] | null) {
  const value = resolveSingle(raw);
  return (CATALOG_ENTITY_OPTIONS.find((option) => option.value === value)?.value || null) as CatalogEntityType | null;
}

export function resolveCatalogEntity(raw?: string | string[] | null) {
  return parseCatalogEntity(raw) || DEFAULT_CATALOG_ENTITY;
}

export function getCatalogEntityOption(entity: CatalogEntityType) {
  return CATALOG_ENTITY_OPTIONS.find((option) => option.value === entity) || CATALOG_ENTITY_OPTIONS[0];
}

export function resolveCatalogRegion(raw?: string | string[] | null): CatalogRegion {
  return resolveSingle(raw) === 'us' ? 'us' : 'all';
}

export function resolveCatalogQuery(raw?: string | string[] | null) {
  const value = resolveSingle(raw);
  return value ? value.slice(0, 80) : null;
}

export function resolveCatalogPage(raw?: string | string[] | null) {
  return clampInt(resolveSingle(raw), 1, 1, 10_000);
}

export function buildCatalogCollectionPath(entity: CatalogEntityType) {
  return `/catalog/${encodeURIComponent(entity)}`;
}

export function buildCatalogDetailPath(entity: CatalogEntityType, entityId: string) {
  return `${buildCatalogCollectionPath(entity)}/${encodeURIComponent(entityId)}`;
}

export function buildCatalogHref({
  entity,
  region = 'all',
  q = null,
  page = 1
}: {
  entity: CatalogEntityType;
  region?: CatalogRegion;
  q?: string | null;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (region !== 'all') params.set('region', region);
  if (q) params.set('q', q);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  const path = buildCatalogCollectionPath(entity);
  return query ? `${path}?${query}` : path;
}

export function buildLegacyCatalogRedirectHref({
  entity,
  region,
  q,
  page
}: {
  entity?: string | string[] | null;
  region?: string | string[] | null;
  q?: string | string[] | null;
  page?: string | string[] | null;
}) {
  const hasLegacyBrowseParams =
    resolveSingle(entity) !== null || resolveSingle(region) !== null || resolveSingle(q) !== null || resolveSingle(page) !== null;
  if (!hasLegacyBrowseParams) return null;

  return buildCatalogHref({
    entity: parseCatalogEntity(entity) || DEFAULT_CATALOG_ENTITY,
    region: resolveCatalogRegion(region),
    q: resolveCatalogQuery(q),
    page: resolveCatalogPage(page)
  });
}

function resolveSingle(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return resolveSingle(first || null);
  }
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function clampInt(value: string | null | undefined, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}
