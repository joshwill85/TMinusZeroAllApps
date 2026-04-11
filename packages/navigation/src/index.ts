export type SearchParamsReader = {
  get: (key: string) => string | null;
};

export type AuthIntent = 'upgrade';
export type AuthRouteMode = 'sign-in' | 'sign-up';
export type AuthQueryOptions = {
  returnTo?: string | null;
  intent?: AuthIntent | null;
  claimToken?: string | null;
};
export type MobileRouteIntent = 'home' | 'authSignIn' | 'launchFeed' | 'calendar' | 'search' | 'profile' | 'saved' | 'preferences';
export type ProgramHubKey = 'blueOrigin' | 'spacex' | 'artemis';

export type WebRouteIntent =
  | { route: 'launch'; launchId: string }
  | { route: 'calendar' }
  | { route: 'search'; query?: string | null }
  | { route: 'profile' }
  | { route: 'saved' }
  | { route: 'preferences' }
  | { route: 'privacyChoices' }
  | { route: 'upgrade'; returnTo?: string | null; autostart?: boolean | null }
  | { route: 'auth'; mode: AuthRouteMode; returnTo?: string | null; intent?: AuthIntent | null; claimToken?: string | null }
  | { route: 'authCallback'; returnTo?: string | null; intent?: AuthIntent | null };

const mobileRoutes: Record<MobileRouteIntent, string> = {
  home: '/',
  authSignIn: '/sign-in',
  launchFeed: '/feed',
  calendar: '/calendar',
  search: '/search',
  profile: '/profile',
  saved: '/saved',
  preferences: '/preferences'
};

const PROGRAM_HUB_ROOTS: Record<ProgramHubKey, string> = {
  blueOrigin: '/blue-origin',
  spacex: '/spacex',
  artemis: '/artemis'
};

const BLUE_ORIGIN_MISSION_SEGMENTS = new Set(['new-shepard', 'new-glenn', 'blue-moon', 'blue-ring', 'be-4']);
const BLUE_ORIGIN_VEHICLE_SEGMENTS = new Set(['new-shepard', 'new-glenn', 'blue-moon', 'blue-ring']);
const BLUE_ORIGIN_ENGINE_SEGMENTS = new Set(['be-3pm', 'be-3u', 'be-4', 'be-7']);
const SPACEX_MISSION_SEGMENTS = new Set(['starship', 'falcon-9', 'falcon-heavy', 'dragon']);
const SPACE_X_VEHICLE_SEGMENTS = new Set(['starship-super-heavy', 'falcon-9', 'falcon-heavy', 'dragon']);
const SPACE_X_ENGINE_SEGMENTS = new Set(['raptor', 'merlin-1d', 'merlin-vac', 'draco', 'superdraco']);
const ARTEMIS_MISSION_SEGMENTS = new Set(['artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii']);
const CATALOG_ENTITY_SEGMENTS = new Set([
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
]);
const ARTEMIS_ALIAS_SEGMENTS: Record<string, string> = {
  'artemis-1': 'artemis-i',
  'artemis-2': 'artemis-ii',
  'artemis-3': 'artemis-iii',
  'artemis-4': 'artemis-iv',
  'artemis-5': 'artemis-v',
  'artemis-6': 'artemis-vi',
  'artemis-7': 'artemis-vii'
};

function normalizeLocalPathname(pathname: string) {
  return pathname.replace(/\/+$/g, '') || '/';
}

function decodeUriSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeUriSegment(value: string) {
  return encodeURIComponent(decodeUriSegment(value));
}

function readSingleSegment(pathname: string, prefix: string) {
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  if (!segment || segment.includes('/')) return null;
  return encodeUriSegment(segment);
}

export function toProviderSlug(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 64);
}

export function normalizeNativeCoreEntityHref(value: string | null | undefined) {
  const href = String(value || '').trim();
  if (!href.startsWith('/')) return null;

  try {
    const parsed = new URL(href, 'https://entity.local');
    const pathname = normalizeLocalPathname(parsed.pathname);
    const suffix = `${parsed.search}${parsed.hash}`;

    if (pathname === '/launch-providers') return `${pathname}${suffix}`;
    if (pathname === '/providers') return `/launch-providers${suffix}`;

    const launchProviderSlug = readSingleSegment(pathname, '/launch-providers/');
    if (launchProviderSlug) return `/launch-providers/${launchProviderSlug}${suffix}`;

    const providerSlug = readSingleSegment(pathname, '/providers/');
    if (providerSlug) return `/launch-providers/${providerSlug}${suffix}`;

    if (pathname === '/catalog/agencies') {
      const slug = toProviderSlug(parsed.searchParams.get('q'));
      if (slug) {
        const providerSuffix = parsed.hash || '';
        return `/launch-providers/${encodeURIComponent(slug)}${providerSuffix}`;
      }
    }

    const catalogAgencyId = readSingleSegment(pathname, '/catalog/agencies/');
    if (catalogAgencyId) return `/launch-providers/${catalogAgencyId}${suffix}`;

    const rocketId = readSingleSegment(pathname, '/rockets/');
    if (rocketId) return `/rockets/${rocketId}${suffix}`;

    const catalogLauncherConfigId = readSingleSegment(pathname, '/catalog/launcher_configurations/');
    if (catalogLauncherConfigId) return `/rockets/${catalogLauncherConfigId}${suffix}`;

    const catalogRocketId = readSingleSegment(pathname, '/catalog/rockets/');
    if (catalogRocketId) return `/rockets/${catalogRocketId}${suffix}`;

    const catalogLauncherId = readSingleSegment(pathname, '/catalog/launchers/');
    if (catalogLauncherId) return `/rockets/${catalogLauncherId}${suffix}`;

    const locationId = readSingleSegment(pathname, '/locations/');
    if (locationId) return `/locations/${locationId}${suffix}`;

    const catalogLocationId = readSingleSegment(pathname, '/catalog/locations/');
    if (catalogLocationId) return `/locations/${catalogLocationId}${suffix}`;

    const padId = readSingleSegment(pathname, '/catalog/pads/');
    if (padId) return `/catalog/pads/${padId}${suffix}`;
  } catch {
    return null;
  }

  return null;
}

export function isNativeCoreEntityHref(value: string | null | undefined) {
  return Boolean(normalizeNativeCoreEntityHref(value));
}

function normalizeNativeStaticCustomerHref(pathname: string, suffix: string) {
  if (pathname === '/') return `/feed${suffix}`;
  if (pathname === '/feed') return `/feed${suffix}`;
  if (pathname === '/calendar') return `/calendar${suffix}`;
  if (pathname === '/search') return `/search${suffix}`;
  if (pathname === '/news') return `/news${suffix}`;
  if (pathname === '/contracts') return `/contracts${suffix}`;
  if (pathname === '/satellites') return `/satellites${suffix}`;
  if (pathname === '/satellites/owners') return `/satellites/owners${suffix}`;
  if (pathname === '/about') return `/about${suffix}`;
  if (pathname === '/info') return `/info${suffix}`;
  if (pathname === '/docs') return `/docs${suffix}`;
  if (pathname === '/docs/about') return `/docs/about${suffix}`;
  if (pathname === '/docs/faq') return `/docs/faq${suffix}`;
  if (pathname === '/docs/roadmap') return `/docs/roadmap${suffix}`;
  if (pathname === '/support') return `/support${suffix}`;
  if (pathname === '/legal/data') return `/legal/data${suffix}`;
  if (pathname === '/account' || pathname === '/profile') return `/profile${suffix}`;
  if (pathname === '/account/membership') return `/account/membership${suffix}`;
  if (pathname === '/account/login-methods') return `/account/login-methods${suffix}`;
  if (pathname === '/account/saved' || pathname === '/saved') return `/saved${suffix}`;
  if (pathname === '/me/preferences' || pathname === '/preferences') return `/preferences${suffix}`;
  if (pathname === '/account/integrations') return `/account/integrations${suffix}`;
  if (pathname === '/premium-onboarding/legal') return `/premium-onboarding/legal${suffix}`;
  if (pathname === '/legal/privacy-choices') return `/legal/privacy-choices${suffix}`;
  if (pathname === '/legal/privacy') return `/legal/privacy${suffix}`;
  if (pathname === '/legal/terms') return `/legal/terms${suffix}`;
  if (pathname === '/jellyfish-effect') return `/jellyfish-effect${suffix}`;
  if (pathname === '/catalog') return `/catalog${suffix}`;
  if (pathname === '/unsubscribe') return `/unsubscribe${suffix}`;
  return null;
}

export function normalizeNativeMobileCustomerHref(value: string | null | undefined) {
  const href = String(value || '').trim();
  if (!href.startsWith('/')) return null;

  try {
    const parsed = new URL(href, 'https://mobile.local');
    const pathname = normalizeLocalPathname(parsed.pathname);
    const suffix = `${parsed.search}${parsed.hash}`;
    const staticHref = normalizeNativeStaticCustomerHref(pathname, suffix);
    if (staticHref) {
      return staticHref;
    }
    const programHubHref = normalizeNativeProgramHubHref(`${pathname}${suffix}`);
    if (programHubHref) {
      return programHubHref;
    }

    if (pathname === '/spacex/jellyfish-effect') {
      return `/jellyfish-effect${suffix}`;
    }
    if (pathname === '/new-glenn') return `/blue-origin/missions/new-glenn${suffix}`;
    if (pathname === '/new-shepard') return `/blue-origin/missions/new-shepard${suffix}`;
    if (pathname === '/blue-moon') return `/blue-origin/missions/blue-moon${suffix}`;
    if (pathname === '/blue-ring') return `/blue-origin/missions/blue-ring${suffix}`;
    if (pathname === '/be-4') return `/blue-origin/missions/be-4${suffix}`;

    const coreEntityHref = normalizeNativeCoreEntityHref(`${pathname}${suffix}`);
    if (coreEntityHref) {
      return coreEntityHref;
    }

    const contractUid = readSingleSegment(pathname, '/contracts/');
    if (contractUid) return `/contracts/${contractUid}${suffix}`;

    const satelliteNorad = readSingleSegment(pathname, '/satellites/');
    if (satelliteNorad) return `/satellites/${satelliteNorad}${suffix}`;

    const satelliteOwner = readSingleSegment(pathname, '/satellites/owners/');
    if (satelliteOwner) return `/satellites/owners/${satelliteOwner}${suffix}`;

    const catalogCollectionMatch = pathname.match(/^\/catalog\/([^/]+)$/);
    if (catalogCollectionMatch && CATALOG_ENTITY_SEGMENTS.has(String(catalogCollectionMatch[1] || '').toLowerCase())) {
      return `/catalog/${encodeUriSegment(String(catalogCollectionMatch[1]))}${suffix}`;
    }

    const catalogDetailMatch = pathname.match(/^\/catalog\/([^/]+)\/([^/]+)$/);
    if (
      catalogDetailMatch &&
      CATALOG_ENTITY_SEGMENTS.has(String(catalogDetailMatch[1] || '').toLowerCase()) &&
      String(catalogDetailMatch[2] || '').trim()
    ) {
      return `/catalog/${encodeUriSegment(String(catalogDetailMatch[1]))}/${encodeUriSegment(String(catalogDetailMatch[2]))}${suffix}`;
    }
  } catch {
    return null;
  }

  return null;
}

export function isNativeMobileCustomerHref(value: string | null | undefined) {
  return Boolean(normalizeNativeMobileCustomerHref(value));
}

export function sanitizeReturnTo(value: string | null | undefined, fallback = '/') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'https://auth.local');
    if (parsed.origin !== 'https://auth.local') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function readReturnTo(searchParams: SearchParamsReader, fallback = '/') {
  const explicit = searchParams.get('return_to');
  if (explicit) return sanitizeReturnTo(explicit, fallback);
  return sanitizeReturnTo(searchParams.get('next'), fallback);
}

export function readAuthIntent(searchParams: SearchParamsReader): AuthIntent | null {
  const intent = String(searchParams.get('intent') || '')
    .trim()
    .toLowerCase();
  return intent === 'upgrade' ? 'upgrade' : null;
}

export function readClaimToken(searchParams: SearchParamsReader) {
  const claimToken = String(searchParams.get('claim_token') || '').trim();
  return claimToken || null;
}

export function buildAuthQuery({ returnTo, intent, claimToken }: AuthQueryOptions = {}) {
  const params = new URLSearchParams();
  const safeReturnTo = sanitizeReturnTo(returnTo, '/');
  if (safeReturnTo && safeReturnTo !== '/') {
    params.set('return_to', safeReturnTo);
  } else if (safeReturnTo === '/') {
    params.set('return_to', '/');
  }
  if (intent) {
    params.set('intent', intent);
  }
  if (claimToken) {
    params.set('claim_token', claimToken);
  }
  return params.toString();
}

export function withAuthQuery(path: string, options: AuthQueryOptions = {}) {
  const query = buildAuthQuery(options);
  return query ? `${path}?${query}` : path;
}

export function serializeWebIntent(intent: WebRouteIntent) {
  switch (intent.route) {
    case 'launch':
      return `/launches/${encodeURIComponent(intent.launchId)}`;
    case 'calendar':
      return '/calendar';
    case 'search': {
      const trimmed = String(intent.query || '').trim();
      if (!trimmed) return '/search';
      const search = new URLSearchParams({ q: trimmed }).toString();
      return `/search?${search}`;
    }
    case 'profile':
      return '/account';
    case 'saved':
      return '/account/saved';
    case 'preferences':
      return '/me/preferences';
    case 'privacyChoices':
      return '/legal/privacy-choices';
    case 'upgrade': {
      const params = new URLSearchParams();
      const returnTo = intent.returnTo ? sanitizeReturnTo(intent.returnTo, '') : '';
      if (returnTo) {
        params.set('return_to', returnTo);
      }
      if (intent.autostart) {
        params.set('autostart', '1');
      }
      const query = params.toString();
      return query ? `/upgrade?${query}` : '/upgrade';
    }
    case 'auth':
      return withAuthQuery(intent.mode === 'sign-up' ? '/auth/sign-up' : '/auth/sign-in', {
        returnTo: intent.returnTo,
        intent: intent.intent,
        claimToken: intent.claimToken
      });
    case 'authCallback':
      return withAuthQuery('/auth/callback', {
        returnTo: intent.returnTo,
        intent: intent.intent
      });
  }
}

export function buildMobileRoute(intent: MobileRouteIntent) {
  return mobileRoutes[intent];
}

export function resolveMobileAuthRedirectPath({
  returnTo,
  intent,
  fallback = buildMobileRoute('profile')
}: {
  returnTo?: string | null;
  intent?: AuthIntent | null;
  fallback?: string;
}) {
  const defaultPath = intent === 'upgrade' ? buildMobileRoute('profile') : fallback;
  const safeReturnTo = sanitizeReturnTo(returnTo, '');
  if (!safeReturnTo || safeReturnTo === '/') {
    return defaultPath;
  }

  try {
    const parsed = new URL(safeReturnTo, 'https://mobile.local');
    const suffix = `${parsed.search}${parsed.hash}`;

    if (parsed.pathname === '/account' || parsed.pathname === '/profile') {
      return `${buildMobileRoute('profile')}${suffix}`;
    }
    if (parsed.pathname === '/account/saved' || parsed.pathname === '/saved') {
      return `${buildMobileRoute('saved')}${suffix}`;
    }
    if (parsed.pathname === '/me/preferences' || parsed.pathname === '/preferences') {
      return `${buildMobileRoute('preferences')}${suffix}`;
    }
    if (parsed.pathname === '/calendar') {
      return `${buildMobileRoute('calendar')}${suffix}`;
    }
    if (parsed.pathname === '/search') {
      return `${buildMobileRoute('search')}${suffix}`;
    }
    if (parsed.pathname === '/feed') {
      return `${buildMobileRoute('launchFeed')}${suffix}`;
    }
    if (parsed.pathname.startsWith('/launches/')) {
      return `${parsed.pathname}${suffix}`;
    }
    const nativeCustomerHref = normalizeNativeMobileCustomerHref(`${parsed.pathname}${suffix}`);
    if (nativeCustomerHref) {
      return nativeCustomerHref;
    }
    if (parsed.pathname === '/auth/sign-in') {
      return `/sign-in${suffix}`;
    }
    if (parsed.pathname === '/auth/sign-up') {
      return `/sign-up${suffix}`;
    }
  } catch {
    return defaultPath;
  }

  return defaultPath;
}

export function serializeMobileIntent(intent: MobileRouteIntent) {
  return buildMobileRoute(intent);
}

export function buildProgramHubHref(hub: ProgramHubKey) {
  return PROGRAM_HUB_ROOTS[hub];
}

export function getProgramHubKeyFromHref(value: string | null | undefined): ProgramHubKey | null {
  const href = String(value || '').trim();
  if (!href.startsWith('/')) return null;

  try {
    const parsed = new URL(href, 'https://hub.local');
    const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    if (pathname === '/blue-origin' || pathname.startsWith('/blue-origin/')) return 'blueOrigin';
    if (pathname === '/spacex' || pathname.startsWith('/spacex/')) return 'spacex';
    if (pathname === '/starship' || pathname.startsWith('/starship/')) return 'spacex';
    if (pathname === '/artemis' || pathname.startsWith('/artemis/')) return 'artemis';
  } catch {
    return null;
  }

  return null;
}

export function normalizeNativeProgramHubHref(value: string | null | undefined) {
  const href = String(value || '').trim();
  if (!href.startsWith('/')) return null;

  try {
    const parsed = new URL(href, 'https://hub.local');
    const pathname = parsed.pathname.replace(/\/+$/g, '') || '/';
    const suffix = `${parsed.search}${parsed.hash}`;

    if (pathname === '/blue-origin') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/flights') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/travelers') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/vehicles') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/engines') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/contracts') return `${pathname}${suffix}`;
    if (pathname === '/blue-origin/missions') return `${pathname}${suffix}`;

    const blueOriginMissionMatch = pathname.match(/^\/blue-origin\/missions\/([^/]+)$/);
    if (blueOriginMissionMatch && BLUE_ORIGIN_MISSION_SEGMENTS.has(String(blueOriginMissionMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const blueOriginFlightMatch = pathname.match(/^\/blue-origin\/flights\/([^/]+)$/);
    if (blueOriginFlightMatch && String(blueOriginFlightMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    const blueOriginTravelerMatch = pathname.match(/^\/blue-origin\/travelers\/([^/]+)$/);
    if (blueOriginTravelerMatch && String(blueOriginTravelerMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    const blueOriginVehicleMatch = pathname.match(/^\/blue-origin\/vehicles\/([^/]+)$/);
    if (blueOriginVehicleMatch && BLUE_ORIGIN_VEHICLE_SEGMENTS.has(String(blueOriginVehicleMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const blueOriginEngineMatch = pathname.match(/^\/blue-origin\/engines\/([^/]+)$/);
    if (blueOriginEngineMatch && BLUE_ORIGIN_ENGINE_SEGMENTS.has(String(blueOriginEngineMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const blueOriginContractMatch = pathname.match(/^\/blue-origin\/contracts\/([^/]+)$/);
    if (blueOriginContractMatch && String(blueOriginContractMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    if (pathname === '/spacex') return `${pathname}${suffix}`;
    if (pathname === '/spacex/flights') return `${pathname}${suffix}`;
    if (pathname === '/spacex/vehicles') return `${pathname}${suffix}`;
    if (pathname === '/spacex/engines') return `${pathname}${suffix}`;
    if (pathname === '/spacex/contracts') return `${pathname}${suffix}`;
    if (pathname === '/spacex/missions') return `${pathname}${suffix}`;
    if (pathname === '/spacex/drone-ships') return `${pathname}${suffix}`;

    const spaceXMissionMatch = pathname.match(/^\/spacex\/missions\/([^/]+)$/);
    if (spaceXMissionMatch && SPACEX_MISSION_SEGMENTS.has(String(spaceXMissionMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const spaceXDroneShipMatch = pathname.match(/^\/spacex\/drone-ships\/([^/]+)$/);
    if (spaceXDroneShipMatch && ['ocisly', 'asog', 'jrti'].includes(String(spaceXDroneShipMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const spaceXFlightMatch = pathname.match(/^\/spacex\/flights\/([^/]+)$/);
    if (spaceXFlightMatch && String(spaceXFlightMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    const spaceXVehicleMatch = pathname.match(/^\/spacex\/vehicles\/([^/]+)$/);
    if (spaceXVehicleMatch && SPACE_X_VEHICLE_SEGMENTS.has(String(spaceXVehicleMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const spaceXEngineMatch = pathname.match(/^\/spacex\/engines\/([^/]+)$/);
    if (spaceXEngineMatch && SPACE_X_ENGINE_SEGMENTS.has(String(spaceXEngineMatch[1] || '').toLowerCase())) {
      return `${pathname}${suffix}`;
    }

    const spaceXContractMatch = pathname.match(/^\/spacex\/contracts\/([^/]+)$/);
    if (spaceXContractMatch && String(spaceXContractMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    if (pathname === '/starship') return `${pathname}${suffix}`;
    const starshipFlightMatch = pathname.match(/^\/starship\/([^/]+)$/);
    if (starshipFlightMatch && /^flight-\d{1,3}$/i.test(String(starshipFlightMatch[1] || ''))) {
      return `/starship/${encodeUriSegment(String(starshipFlightMatch[1]))}${suffix}`;
    }

    if (pathname === '/artemis') return `${pathname}${suffix}`;
    if (pathname === '/artemis/contracts') return `${pathname}${suffix}`;
    if (pathname === '/artemis/awardees') return `${pathname}${suffix}`;
    if (pathname === '/artemis/content') return `${pathname}${suffix}`;

    const artemisContractMatch = pathname.match(/^\/artemis\/contracts\/([^/]+)$/);
    if (artemisContractMatch && String(artemisContractMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    const artemisAwardeeMatch = pathname.match(/^\/artemis\/awardees\/([^/]+)$/);
    if (artemisAwardeeMatch && String(artemisAwardeeMatch[1] || '').trim()) {
      return `${pathname}${suffix}`;
    }

    if (ARTEMIS_MISSION_SEGMENTS.has(pathname.slice(1))) {
      return `${pathname}${suffix}`;
    }
    const canonicalArtemisAlias = ARTEMIS_ALIAS_SEGMENTS[pathname.slice(1)];
    if (canonicalArtemisAlias) {
      return `/${canonicalArtemisAlias}${suffix}`;
    }
  } catch {
    return null;
  }

  return null;
}

export function isNativeProgramHubHref(value: string | null | undefined) {
  return Boolean(normalizeNativeProgramHubHref(value));
}

export function buildLaunchHref(launchId: string) {
  return serializeWebIntent({ route: 'launch', launchId });
}

export function buildCalendarHref() {
  return serializeWebIntent({ route: 'calendar' });
}

export function buildSearchHref(query: string) {
  return serializeWebIntent({ route: 'search', query });
}

export function buildProfileHref() {
  return serializeWebIntent({ route: 'profile' });
}

export function buildSavedHref() {
  return serializeWebIntent({ route: 'saved' });
}

export function buildPreferencesHref() {
  return serializeWebIntent({ route: 'preferences' });
}

export function buildPrivacyChoicesHref() {
  return serializeWebIntent({ route: 'privacyChoices' });
}

export function buildUpgradeHref(options: { returnTo?: string | null; autostart?: boolean | null } = {}) {
  return serializeWebIntent({
    route: 'upgrade',
    returnTo: options.returnTo,
    autostart: options.autostart
  });
}

export function buildAuthHref(mode: AuthRouteMode, options: AuthQueryOptions = {}) {
  return serializeWebIntent({
    route: 'auth',
    mode,
    returnTo: options.returnTo,
    intent: options.intent,
    claimToken: options.claimToken
  });
}

export function buildAuthCallbackHref(options: { returnTo?: string | null; intent?: AuthIntent | null } = {}) {
  return serializeWebIntent({
    route: 'authCallback',
    returnTo: options.returnTo,
    intent: options.intent
  });
}

export type PushNavigationPayload = {
  url?: string | null;
  launchId?: string | null;
  eventType?: string | null;
};

export function resolvePushHref(payload: PushNavigationPayload) {
  const normalizedUrl = String(payload.url || '').trim();
  if (normalizedUrl.startsWith('/')) {
    return normalizedUrl;
  }

  const launchId = String(payload.launchId || '').trim();
  if (launchId) {
    return buildLaunchHref(launchId);
  }

  return buildMobileRoute('preferences');
}
