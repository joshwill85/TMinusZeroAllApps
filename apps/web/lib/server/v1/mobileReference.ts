import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { BRAND_NAME, SUPPORT_EMAIL } from '@/lib/brand';
import {
  catalogCollectionSchemaV1,
  catalogDetailSchemaV1,
  catalogHubSchemaV1,
  contentPageSchemaV1,
  infoHubSchemaV1,
  type CatalogEntityTypeV1
} from '@tminuszero/contracts';
import { resolveDocsFaqEntries } from '@/lib/content/faq/resolvers';
import { mapPublicCacheRow } from '@/lib/server/transformers';
import { US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { buildCatalogCollectionPath, buildCatalogDetailPath, catalogEntityOptions, getCatalogEntityOption, parseCatalogEntity } from '@/lib/utils/catalog';

type CatalogRow = {
  entity_type: string;
  entity_id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  country_codes?: string[] | null;
  image_url?: string | null;
  data?: Record<string, unknown> | null;
  fetched_at?: string | null;
  launch_count?: number | null;
};

type ContentPageDefinition = {
  slug: string;
  aliases: readonly string[];
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  actions: readonly { label: string; href: string; external?: boolean }[];
  sections: readonly { title: string; body: string; bullets?: readonly string[] }[];
};

const CONTENT_PAGES: ContentPageDefinition[] = [
  {
    slug: 'about',
    aliases: ['about', 'docs/about'],
    eyebrow: 'About',
    title: `About ${BRAND_NAME}`,
    description: 'What the product is, why it exists, and how the launch reference experience is organized.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'Info hub', href: '/info' },
      { label: 'FAQ', href: '/docs/faq' },
      { label: 'Catalog', href: '/catalog' },
      { label: 'Privacy', href: '/legal/privacy' }
    ],
    sections: [
      {
        title: 'Mission',
        body: 'T-Minus Zero is built for launch fans and operators who want a fast, trustworthy signal on what is happening across launches, programs, and related reference data.'
      },
      {
        title: 'Product model',
        body: 'The public web surface remains the reference implementation, while the API surfaces provide typed summaries and browse data for native clients.'
      }
    ]
  },
  {
    slug: 'docs/faq',
    aliases: ['docs/faq', 'faq'],
    eyebrow: 'Docs',
    title: 'FAQ',
    description: 'Answers to the most common questions about launch tracking, alerts, and public data.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'Privacy choices', href: '/legal/privacy-choices' },
      { label: 'Roadmap', href: '/docs/roadmap' },
      { label: 'About', href: '/about' }
    ],
    sections: resolveDocsFaqEntries().map((entry) => ({
      title: entry.question,
      body: entry.answer,
      bullets: []
    }))
  },
  {
    slug: 'docs/roadmap',
    aliases: ['docs/roadmap', 'roadmap'],
    eyebrow: 'Docs',
    title: 'Roadmap',
    description: 'The published product phases and planned improvement areas.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'Info hub', href: '/info' },
      { label: 'Catalog', href: '/catalog' },
      { label: 'About', href: '/about' }
    ],
    sections: [
      {
        title: 'Phase 0 - Foundations',
        body: 'Bootstrap the app shell, theming, and the public reference surfaces.'
      },
      {
        title: 'Phase 1 - Data plumbing',
        body: 'Build shared ingest, public cache derivation, and reliable server routes.'
      },
      {
        title: 'Phase 2 - Notifications and billing',
        body: 'Keep account, alerts, and subscription flows aligned across surfaces.'
      },
      {
        title: 'Phase 3 - Admin and ops',
        body: 'Internal tooling remains web-first and is excluded from the mobile parity work.'
      }
    ]
  },
  {
    slug: 'docs/sms-opt-in',
    aliases: ['docs/sms-opt-in', 'legal/sms'],
    eyebrow: 'Docs',
    title: 'Notifications',
    description: 'Native push notification guidance and operational notes for launch alerts.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'Preferences', href: '/preferences' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' }
    ],
    sections: [
      {
        title: 'Program description',
        body: `${BRAND_NAME} delivers launch alerts through native push notifications on iOS and Android.`
      },
      {
        title: 'Setup',
        body: 'Users open notification settings, register a device, and enable the launch alert scopes they want.'
      },
      {
        title: 'Help and support',
        body: `Contact ${SUPPORT_EMAIL} if you need help with the notification setup.`
      }
    ]
  },
  {
    slug: 'jellyfish-effect',
    aliases: ['jellyfish-effect', 'spacex/jellyfish-effect'],
    eyebrow: 'Guide',
    title: 'The Rocket Jellyfish Effect',
    description: 'What the jellyfish effect is, why it happens, and how to plan the best viewing window.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'News', href: '/news' },
      { label: 'Launch feed', href: '/feed' },
      { label: 'FAQ', href: '/docs/faq' }
    ],
    sections: [
      {
        title: 'What it is',
        body: 'The jellyfish effect is the luminous twilight plume pattern that appears when rocket exhaust remains sunlit after launch while the ground is already in darkness or deep twilight.'
      },
      {
        title: 'Why it happens',
        body: 'The plume expands dramatically at altitude, and the lighting geometry can make it glow against a dark sky for viewers on the ground.'
      },
      {
        title: 'How to plan',
        body: 'Twilight timing, cloud cover, launch azimuth, and local horizon quality all matter. Treat it as a timing and visibility problem rather than a guarantee.'
      }
    ]
  },
  {
    slug: 'legal/data',
    aliases: ['legal/data', 'data'],
    eyebrow: 'Legal',
    title: 'Data & Attribution',
    description: 'Public source inventory and attribution notes for the customer-facing product surfaces.',
    lastUpdated: '2026-03-20',
    actions: [
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Info hub', href: '/info' }
    ],
    sections: [
      {
        title: 'Core sources',
        body: 'Launch, news, and catalog surfaces use shared product data sources and typed public-cache views rather than browser-only page loaders.'
      },
      {
        title: 'Feature sources',
        body: 'Some surfaces also rely on specialty weather, telemetry, contract, or satellite data to add detail and related-link context.'
      },
      {
        title: 'Attribution',
        body: 'Source attribution should stay visible and should not imply endorsement by any provider, agency, or publisher.'
      }
    ]
  },
  {
    slug: 'legal/privacy',
    aliases: ['legal/privacy', 'privacy'],
    eyebrow: 'Legal',
    title: 'Privacy Notice',
    description: 'How the service collects, uses, and discloses personal information.',
    lastUpdated: '2026-01-20',
    actions: [
      { label: 'Privacy choices', href: '/legal/privacy-choices' },
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Account', href: '/account' }
    ],
    sections: [
      {
        title: 'What we collect',
        body: 'Account details, notification preferences, billing state, usage data, and optional marketing email settings.'
      },
      {
        title: 'How we use it',
        body: 'To operate the service, authenticate users, send requested notifications, process billing, and improve reliability.'
      },
      {
        title: 'Your rights',
        body: 'Users can access, correct, delete, or obtain a copy of their data and can manage privacy choices through the self-serve flows.'
      }
    ]
  },
  {
    slug: 'legal/privacy-choices',
    aliases: ['legal/privacy-choices', 'privacy-choices'],
    eyebrow: 'Legal',
    title: 'Privacy Choices',
    description: 'Self-serve controls for data export, deletion, and state privacy preferences.',
    lastUpdated: '2026-01-20',
    actions: [
      { label: 'Privacy notice', href: '/legal/privacy' },
      { label: 'Account', href: '/account' },
      { label: 'Profile', href: '/profile' }
    ],
    sections: [
      {
        title: 'Choices',
        body: 'Manage opt-outs, sensitive data limits, and third-party embed blocking.'
      },
      {
        title: 'Export and delete',
        body: 'Signed-in users can request an account export or initiate account deletion from the self-serve surface.'
      }
    ]
  },
  {
    slug: 'legal/terms',
    aliases: ['legal/terms', 'terms'],
    eyebrow: 'Legal',
    title: 'Terms of Service',
    description: 'The service terms, subscription terms, and notification guidance.',
    lastUpdated: '2026-01-30',
    actions: [
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Preferences', href: '/preferences' },
      { label: 'Account', href: '/account' }
    ],
    sections: [
      {
        title: 'Service rules',
        body: 'The service is informational, may change quickly, and is not a safety-critical system.'
      },
      {
        title: 'Subscriptions',
        body: 'Premium features renew automatically until canceled through the appropriate billing flow.'
      },
      {
        title: 'Push alerts',
        body: 'Push alerts are optional, require device registration, and can be disabled at any time.'
      }
    ]
  }
];

export function loadInfoHubPayload() {
  return infoHubSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Info',
    description: 'Mission-control style navigation for public pages, catalog browsing, satellites, and account documentation.',
    cards: [
      { title: 'Command Deck', description: 'Open the public command deck and platform guide.', href: '/info', badge: 'Hub' },
      { title: 'News', description: 'Mission coverage and launch-linked article feeds.', href: '/news', badge: 'Feed' },
      { title: 'Contracts', description: 'Canonical government contract stories across supported programs.', href: '/contracts', badge: 'Browse' },
      { title: 'Catalog', description: 'Browse Launch Library 2 catalog collections and detail pages.', href: '/catalog', badge: 'Browse' },
      { title: 'Satellites', description: 'Search NORAD records and owner hubs.', href: '/satellites', badge: 'Browse' },
      { title: 'About', description: 'Learn what the product is and why it exists.', href: '/about', badge: 'Docs' },
      { title: 'FAQ', description: 'Read common questions about the service.', href: '/docs/faq', badge: 'Docs' },
      { title: 'Roadmap', description: 'Review the public product roadmap.', href: '/docs/roadmap', badge: 'Docs' },
      { title: 'Jellyfish Effect', description: 'Guide to the twilight rocket plume phenomenon and visibility planning.', href: '/jellyfish-effect', badge: 'Guide' },
      { title: 'Data & Attribution', description: 'Review public sources and attribution notes.', href: '/legal/data', badge: 'Legal' },
      { title: 'Privacy', description: 'Read how data is collected and used.', href: '/legal/privacy', badge: 'Legal' },
      { title: 'Privacy Choices', description: 'Manage opt-outs, export, and delete flows.', href: '/legal/privacy-choices', badge: 'Legal' },
      { title: 'Terms', description: 'Review the service terms and push notification guidance.', href: '/legal/terms', badge: 'Legal' }
    ]
  });
}

export function loadContentPagePayload(slugValue: string | null | undefined) {
  const page = resolveContentPage(slugValue);
  if (!page) return null;

  return contentPageSchemaV1.parse({
    slug: page.slug,
    eyebrow: page.eyebrow,
    title: page.title,
    description: page.description,
    lastUpdated: page.lastUpdated,
    actions: page.actions.map((action) => ({
      label: action.label,
      href: action.href,
      external: Boolean(action.external)
    })),
    sections: page.sections.map((section) => ({
      title: section.title,
      body: section.body,
      bullets: [...(section.bullets ?? [])]
    }))
  });
}

export function loadCatalogHubPayload() {
  return catalogHubSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    title: 'Launch Library 2 Catalog',
    description: 'Browse collection pages for agencies, astronauts, vehicles, stations, locations, pads, and event references.',
    entities: catalogEntityOptions.map((option) => ({
      entity: option.value,
      label: option.label,
      description: option.description,
      href: buildCatalogCollectionPath(option.value)
    }))
  });
}

export async function loadCatalogCollectionPayload(request: Request, rawEntity: string) {
  const entity = parseCatalogEntity(rawEntity);
  if (!entity) return null;

  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') === 'us' ? 'us' : 'all';
  const query = normalizeQuery(searchParams.get('q'));
  const limit = clampInt(searchParams.get('limit'), 36, 1, 200);
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);

  if (!isSupabaseConfigured()) {
    return catalogCollectionSchemaV1.parse({
      generatedAt: new Date().toISOString(),
      entity,
      label: getCatalogEntityOption(entity).label,
      description: getCatalogEntityOption(entity).description,
      region,
      query,
      limit,
      offset,
      items: []
    });
  }

  const supabase = createSupabaseServerClient();
  let catalogQuery = supabase.from('ll2_catalog_public_cache').select('entity_type, entity_id, name, description, country_codes, image_url, fetched_at').eq('entity_type', entity);

  if (region === 'us') {
    catalogQuery = catalogQuery.overlaps('country_codes', US_PAD_COUNTRY_CODES);
  }

  if (query) {
    const pattern = `%${query}%`;
    catalogQuery = catalogQuery.or(`name.ilike.${pattern},description.ilike.${pattern}`);
  }

  const { data, error } = await catalogQuery.order('name', { ascending: true }).range(offset, offset + limit - 1);
  if (error) {
    console.error('catalog collection v1 api error', error);
    return null;
  }

  const rows = (data || []) as CatalogRow[];
  return catalogCollectionSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity,
    label: getCatalogEntityOption(entity).label,
    description: getCatalogEntityOption(entity).description,
    region,
    query,
    limit,
    offset,
    items: rows.map((row) => mapCatalogCollectionItem(entity, row))
  });
}

export async function loadCatalogDetailPayload(rawEntity: string, entityId: string) {
  const entity = parseCatalogEntity(rawEntity);
  if (!entity) return null;

  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ll2_catalog_public_cache')
    .select('entity_type, entity_id, name, description, country_codes, image_url, data')
    .eq('entity_type', entity)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as CatalogRow;
  const facts = buildCatalogFacts(entity, row.data || {});
  const links = buildCatalogLinks(entity, row.entity_id, row.name, row.data || {});
  const relatedLaunches = await fetchCatalogRelatedLaunches(entity, row.entity_id, row.name, row.data || {});

  return catalogDetailSchemaV1.parse({
    generatedAt: new Date().toISOString(),
    entity,
    label: getCatalogEntityOption(entity).label,
    title: row.name,
    description: row.description || getCatalogEntityOption(entity).description,
    imageUrl: row.image_url ?? null,
    href: buildCatalogDetailPath(entity, row.entity_id),
    facts,
    links,
    relatedLaunches
  });
}

function resolveContentPage(slugValue: string | null | undefined) {
  const normalized = normalizeContentSlug(slugValue);
  if (!normalized) return null;
  return CONTENT_PAGES.find((page) => page.aliases.includes(normalized) || page.slug === normalized) ?? null;
}

function normalizeContentSlug(value: string | null | undefined) {
  const raw = String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!raw) return null;
  return raw.replace(/\/{2,}/g, '/');
}

function normalizeQuery(raw: string | null) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .slice(0, 80) || null;
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function mapCatalogCollectionItem(entity: CatalogEntityTypeV1, row: CatalogRow) {
  return {
    entityType: entity,
    entityId: row.entity_id,
    name: row.name,
    description: row.description ?? null,
    imageUrl: row.image_url ?? null,
    countryCodes: Array.isArray(row.country_codes) ? row.country_codes.filter((code): code is string => typeof code === 'string') : [],
    launchCount: typeof row.launch_count === 'number' ? row.launch_count : null,
    href: buildCatalogDetailPath(entity, row.entity_id)
  };
}

function buildCatalogFacts(entity: CatalogEntityTypeV1, data: Record<string, unknown>) {
  const facts: Array<{ label: string; value: string }> = [];
  const safe = (value: unknown) => (typeof value === 'string' ? value : value == null ? null : String(value));

  if (entity === 'agencies') {
    pushFact(facts, 'Abbreviation', safe(data.abbrev));
    pushFact(facts, 'Type', safe(data.type));
    pushFact(facts, 'Country', safe(data.country_code));
    pushFact(facts, 'Administrator', safe(data.administrator));
    pushFact(facts, 'Founded', safe(data.founding_year));
  }

  if (entity === 'astronauts') {
    pushFact(facts, 'Status', safe((data.status as any)?.name ?? data.status));
    pushFact(facts, 'Nationality', formatListValue(data.nationality));
    pushFact(facts, 'In space', typeof data.in_space === 'boolean' ? (data.in_space ? 'Yes' : 'No') : null);
    const agency = data.agency as Record<string, unknown> | undefined;
    pushFact(facts, 'Agency', safe(agency?.name ?? agency?.abbrev));
  }

  if (entity === 'space_stations') {
    pushFact(facts, 'Status', safe((data.status as any)?.name ?? data.status));
    pushFact(facts, 'Orbit', safe((data.orbit as any)?.name ?? data.orbit));
    pushFact(facts, 'Founded', safe(data.founded));
    pushFact(facts, 'Deorbited', safe(data.deorbited));
  }

  if (entity === 'expeditions') {
    const station = data.space_station as Record<string, unknown> | undefined;
    pushFact(facts, 'Station', safe(station?.name));
    pushFact(facts, 'Start', safe(data.start));
    pushFact(facts, 'End', safe(data.end));
  }

  if (entity === 'docking_events') {
    const station = data.space_station as Record<string, unknown> | undefined;
    pushFact(facts, 'Station', safe(station?.name));
    pushFact(facts, 'Docking', safe(data.docking));
    pushFact(facts, 'Departure', safe(data.departure));
    pushFact(facts, 'Launch (LL2)', safe(data.launch_id));
  }

  if (entity === 'launcher_configurations') {
    pushFact(facts, 'Family', safe(data.family));
    pushFact(facts, 'Variant', safe(data.variant));
    pushFact(facts, 'Reusable', typeof data.reusable === 'boolean' ? (data.reusable ? 'Yes' : 'No') : null);
    pushFact(facts, 'Manufacturer', safe(data.manufacturer));
  }

  if (entity === 'launchers') {
    pushFact(facts, 'Serial', safe(data.serial_number));
    pushFact(facts, 'Status', safe((data.status as any)?.name ?? data.status));
    pushFact(facts, 'Flight proven', typeof data.flight_proven === 'boolean' ? (data.flight_proven ? 'Yes' : 'No') : null);
    const config = data.launcher_config as Record<string, unknown> | undefined;
    pushFact(facts, 'Configuration', safe(config?.full_name ?? config?.name));
  }

  if (entity === 'spacecraft_configurations') {
    pushFact(facts, 'Capability', safe(data.capability));
    pushFact(facts, 'Human rated', typeof data.human_rated === 'boolean' ? (data.human_rated ? 'Yes' : 'No') : null);
    pushFact(facts, 'Crew capacity', safe(data.crew_capacity));
    const agency = data.agency as Record<string, unknown> | undefined;
    pushFact(facts, 'Agency', safe(agency?.name ?? agency?.abbrev));
  }

  if (entity === 'locations') {
    pushFact(facts, 'Country', safe(data.country_code));
    pushFact(facts, 'Timezone', safe(data.timezone_name));
    pushFact(facts, 'Total launches', safe(data.total_launch_count));
  }

  if (entity === 'pads') {
    const location = data.location_name as string | undefined;
    pushFact(facts, 'Location', safe(location));
    pushFact(facts, 'Country', safe(data.country_code));
    pushFact(facts, 'Orbital attempts', safe(data.orbital_launch_attempt_count));
  }

  if (entity === 'events') {
    pushFact(facts, 'Type', safe((data.type as any)?.name ?? data.type));
    pushFact(facts, 'Date', safe(data.date));
    pushFact(facts, 'Location', safe(data.location));
    pushFact(facts, 'Webcast', typeof data.webcast_live === 'boolean' ? (data.webcast_live ? 'Live' : 'Not live') : null);
  }

  return facts;
}

function buildCatalogLinks(entity: CatalogEntityTypeV1, entityId: string, name: string, data: Record<string, unknown>) {
  const links: Array<{ label: string; href: string; external?: boolean }> = [
    { label: 'Canonical route', href: buildCatalogDetailPath(entity as any, entityId) },
    { label: 'Collection', href: buildCatalogCollectionPath(entity as any) }
  ];

  const infoUrl = asString(data.info_url);
  const wikiUrl = asString(data.wiki_url);
  const url = asString(data.url);
  const nationUrl = asString(data.nation_url);

  if (entity === 'events' && url) {
    links.push({ label: 'Event details', href: url, external: true });
  }

  if (infoUrl) links.push({ label: 'Info', href: infoUrl, external: true });
  if (wikiUrl) links.push({ label: 'Wiki', href: wikiUrl, external: true });
  if (nationUrl) links.push({ label: 'Nation', href: nationUrl, external: true });

  return links;
}

async function fetchCatalogRelatedLaunches(entity: CatalogEntityTypeV1, entityId: string, itemName: string, data: Record<string, unknown>) {
  if (!isSupabaseConfigured()) return [];
  const supabase = createSupabaseServerClient();
  const numericId = Number(entityId);
  const hasNumericId = Number.isFinite(numericId);

  if (entity === 'agencies' && hasNumericId) {
    return fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').eq('ll2_agency_id', numericId));
  }

  if (entity === 'launcher_configurations' && hasNumericId) {
    return fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').eq('ll2_rocket_config_id', numericId));
  }

  if (entity === 'pads' && hasNumericId) {
    const byId = await fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').eq('ll2_pad_id', numericId));
    if (byId.length > 0) return byId;
  }

  if (entity === 'pads') {
    const padName = asString(data.name) || itemName;
    const locationName = asString(data.location_name);
    if (!padName) return [];
    let query = supabase.from('launches_public_cache').select('*').eq('pad_name', padName);
    if (locationName) {
      query = query.or(`pad_location_name.eq.${escapeOrValue(locationName)},location_name.eq.${escapeOrValue(locationName)}`);
    }
    return fetchLaunchesByQuery(query);
  }

  if (entity === 'locations') {
    const escaped = escapeOrValue(itemName);
    return fetchLaunchesByQuery(
      supabase.from('launches_public_cache').select('*').or(`pad_location_name.eq.${escaped},location_name.eq.${escaped}`)
    );
  }

  if (entity === 'events' && hasNumericId) {
    const { data: joins, error } = await supabase.from('ll2_event_launches').select('launch_id').eq('ll2_event_id', numericId).limit(200);
    if (error || !joins) return [];
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return [];
    return fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)));
  }

  if (entity === 'astronauts' && hasNumericId) {
    const { data: joins, error } = await supabase.from('ll2_astronaut_launches').select('launch_id, role').eq('ll2_astronaut_id', numericId).limit(400);
    if (error || !joins) return [];
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return [];
    return fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)));
  }

  if (entity === 'launchers' && hasNumericId) {
    const { data: joins, error } = await supabase.from('ll2_launcher_launches').select('launch_id').eq('ll2_launcher_id', numericId).limit(400);
    if (error || !joins) return [];
    const ids = joins.map((row) => (row as any)?.launch_id).filter(Boolean) as string[];
    if (ids.length === 0) return [];
    return fetchLaunchesByQuery(supabase.from('launches_public_cache').select('*').in('launch_id', ids.slice(0, 200)));
  }

  if (entity === 'docking_events') {
    const ll2LaunchUuid = asString(data.launch_id);
    if (!ll2LaunchUuid) return [];
    const { data: matches, error } = await supabase.from('launches_public_cache').select('*').eq('ll2_launch_uuid', ll2LaunchUuid).limit(1);
    if (error || !matches || matches.length === 0) return [];
    return [mapPublicCacheRow(matches[0])];
  }

  return [];
}

async function fetchLaunchesByQuery(query: any) {
  const { data, error } = await query.limit(24);
  if (error || !data) return [];
  return (data as any[]).map((row) => mapPublicCacheRow(row)).map((launch) => ({
    id: launch.id,
    name: launch.name,
    provider: launch.provider,
    vehicle: launch.vehicle,
    net: launch.net,
    netPrecision: launch.netPrecision,
    status: launch.status,
    statusText: launch.statusText,
    href: buildLaunchHref({
      id: launch.id,
      name: launch.name,
      slug: launch.slug || undefined
    })
  }));
}

function pushFact(facts: Array<{ label: string; value: string }>, label: string, value: string | null) {
  if (!value) return;
  facts.push({ label, value });
}

function formatListValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : item && typeof item === 'object' ? asString((item as Record<string, unknown>).name) : null))
      .filter((item): item is string => Boolean(item))
      .join(', ');
  }

  if (value && typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    return asString(entry.name || entry.alpha_3_code || entry.alpha_2_code);
  }

  return asString(value);
}

function asString(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (value == null) return null;
  return String(value);
}

function escapeOrValue(value: string) {
  return value.replace(/[,%]/g, ' ');
}
