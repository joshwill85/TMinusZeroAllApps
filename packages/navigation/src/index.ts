export type MobileRouteIntent = 'home' | 'authSignIn' | 'launchFeed' | 'search' | 'profile' | 'saved' | 'preferences';

const mobileRoutes: Record<MobileRouteIntent, string> = {
  home: '/',
  authSignIn: '/sign-in',
  launchFeed: '/feed',
  search: '/search',
  profile: '/profile',
  saved: '/saved',
  preferences: '/preferences'
};

export function buildMobileRoute(intent: MobileRouteIntent) {
  return mobileRoutes[intent];
}

export function buildLaunchHref(launchId: string) {
  return `/launches/${launchId}`;
}

export function buildSearchHref(query: string) {
  const search = new URLSearchParams({ q: query }).toString();
  return `/search?${search}`;
}

export function buildProfileHref() {
  return '/account';
}
