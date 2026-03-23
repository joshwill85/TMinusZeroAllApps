import type { ViewerSessionV1 } from '@tminuszero/api-client';
import {
  buildProgramHubHref,
  getProgramHubKeyFromHref,
  normalizeNativeProgramHubHref,
  type ProgramHubKey
} from '@tminuszero/navigation';

const DEFAULT_MOBILE_HUB_ROLLOUT: ViewerSessionV1['mobileHubRollout'] = {
  blueOrigin: {
    nativeEnabled: false,
    externalDeepLinksEnabled: false
  },
  spacex: {
    nativeEnabled: false,
    externalDeepLinksEnabled: false
  },
  artemis: {
    nativeEnabled: false,
    externalDeepLinksEnabled: false
  }
};

const PROGRAM_HUB_CORE_FALLBACK_ROUTES: Partial<Record<ProgramHubKey, string>> = {
  blueOrigin: '/launch-providers/blue-origin',
  spacex: '/launch-providers/spacex'
};

export function getMobileHubRollout(session: ViewerSessionV1 | null | undefined) {
  return session?.mobileHubRollout ?? DEFAULT_MOBILE_HUB_ROLLOUT;
}

export function isNativeProgramHubEnabled(session: ViewerSessionV1 | null | undefined, hub: ProgramHubKey) {
  return getMobileHubRollout(session)[hub].nativeEnabled;
}

export function isExternalProgramHubDeepLinksEnabled(session: ViewerSessionV1 | null | undefined, hub: ProgramHubKey) {
  return getMobileHubRollout(session)[hub].externalDeepLinksEnabled;
}

export function resolveNativeProgramHubHref(session: ViewerSessionV1 | null | undefined, href: string | null | undefined) {
  const hub = getProgramHubKeyFromHref(href);
  if (!hub) return null;
  if (!isNativeProgramHubEnabled(session, hub)) return null;
  return normalizeNativeProgramHubHref(href);
}

export function getProgramHubEntryHref(session: ViewerSessionV1 | null | undefined, hub: ProgramHubKey) {
  return isNativeProgramHubEnabled(session, hub) ? buildProgramHubHref(hub) : null;
}

export function resolveNativeProgramHubOrCoreHref(session: ViewerSessionV1 | null | undefined, href: string | null | undefined) {
  const normalizedHubHref = normalizeNativeProgramHubHref(href);
  const hub = getProgramHubKeyFromHref(href);
  if (normalizedHubHref && hub) {
    if (isNativeProgramHubEnabled(session, hub) || normalizedHubHref !== buildProgramHubHref(hub)) {
      return normalizedHubHref;
    }
  }

  const nativeHubHref = resolveNativeProgramHubHref(session, href);
  if (nativeHubHref) return nativeHubHref;

  if (!hub) return null;
  return PROGRAM_HUB_CORE_FALLBACK_ROUTES[hub] ?? null;
}

export function getProgramHubEntryOrCoreHref(session: ViewerSessionV1 | null | undefined, hub: ProgramHubKey) {
  return getProgramHubEntryHref(session, hub) ?? PROGRAM_HUB_CORE_FALLBACK_ROUTES[hub] ?? null;
}
