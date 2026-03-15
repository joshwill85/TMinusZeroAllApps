export type SearchParamsReader = {
  get: (key: string) => string | null;
};

export type AuthIntent = 'upgrade';
export type AuthRouteMode = 'sign-in' | 'sign-up';
export type MobileRouteIntent = 'home' | 'authSignIn' | 'launchFeed' | 'calendar' | 'search' | 'profile' | 'saved' | 'preferences';

export type WebRouteIntent =
  | { route: 'launch'; launchId: string }
  | { route: 'calendar' }
  | { route: 'search'; query?: string | null }
  | { route: 'profile' }
  | { route: 'saved' }
  | { route: 'preferences' }
  | { route: 'privacyChoices' }
  | { route: 'upgrade'; returnTo?: string | null; autostart?: boolean | null }
  | { route: 'auth'; mode: AuthRouteMode; returnTo?: string | null; intent?: AuthIntent | null }
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

export function buildAuthQuery({
  returnTo,
  intent
}: {
  returnTo?: string | null;
  intent?: AuthIntent | null;
}) {
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
  return params.toString();
}

export function withAuthQuery(
  path: string,
  options: {
    returnTo?: string | null;
    intent?: AuthIntent | null;
  } = {}
) {
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
        intent: intent.intent
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

export function buildAuthHref(mode: AuthRouteMode, options: { returnTo?: string | null; intent?: AuthIntent | null } = {}) {
  return serializeWebIntent({
    route: 'auth',
    mode,
    returnTo: options.returnTo,
    intent: options.intent
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
