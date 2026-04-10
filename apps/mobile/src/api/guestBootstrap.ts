import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { clientBootstrapResponseSchemaV1, type ClientBootstrapRequestV1 } from '@tminuszero/contracts';
import { readOrCreateAuthInstallationId } from '@/src/auth/riskStorage';

export const APP_CLIENT_HEADER_NAME = 'X-TMZ-App-Client';
export const APP_GUEST_TOKEN_HEADER_NAME = 'X-TMZ-App-Guest-Token';

const GUEST_TOKEN_REFRESH_BUFFER_MS = 30_000;

export type GuestBootstrapState = {
  contextKey: string;
  clientHeaderValue: string;
  guestToken: string;
  expiresAtMs: number;
};

let cachedGuestBootstrapState: GuestBootstrapState | null = null;
let inFlightGuestBootstrapState: Promise<GuestBootstrapState | null> | null = null;

function readBuildProfile() {
  const extra = Constants.expoConfig?.extra;
  if (extra && typeof extra === 'object' && typeof (extra as { buildProfile?: unknown }).buildProfile === 'string') {
    const value = (extra as { buildProfile: string }).buildProfile.trim();
    return value || null;
  }
  return null;
}

function getGuestPlatform() {
  if (Platform.OS === 'ios') return 'ios' as const;
  if (Platform.OS === 'android') return 'android' as const;
  return null;
}

export function serializeAppClientContext(context: ClientBootstrapRequestV1) {
  const searchParams = new URLSearchParams();
  searchParams.set('installation_id', context.installationId);
  searchParams.set('platform', context.platform);
  if (context.appVersion) {
    searchParams.set('app_version', context.appVersion);
  }
  if (context.buildProfile) {
    searchParams.set('build_profile', context.buildProfile);
  }
  return searchParams.toString();
}

function buildGuestContextKey(context: ClientBootstrapRequestV1) {
  return JSON.stringify({
    installationId: context.installationId,
    platform: context.platform,
    appVersion: context.appVersion ?? null,
    buildProfile: context.buildProfile ?? null
  });
}

async function loadGuestBootstrapContext(): Promise<ClientBootstrapRequestV1 | null> {
  const platform = getGuestPlatform();
  if (!platform) {
    return null;
  }

  return {
    installationId: await readOrCreateAuthInstallationId(),
    platform,
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    buildProfile: readBuildProfile()
  };
}

async function fetchGuestBootstrap(baseUrl: string, context: ClientBootstrapRequestV1) {
  const response = await fetch(`${baseUrl}/api/v1/client/bootstrap`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(context)
  });

  if (!response.ok) {
    throw new Error(`client bootstrap failed (${response.status})`);
  }

  const payload = clientBootstrapResponseSchemaV1.parse(await response.json());
  const expiresAtMs = Date.parse(payload.expiresAt);
  return {
    contextKey: buildGuestContextKey(context),
    clientHeaderValue: serializeAppClientContext(context),
    guestToken: payload.guestToken,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 5 * 60 * 1000
  } satisfies GuestBootstrapState;
}

export async function ensureGuestBootstrap(baseUrl: string) {
  const context = await loadGuestBootstrapContext();
  if (!context) {
    return null;
  }

  const contextKey = buildGuestContextKey(context);
  if (
    cachedGuestBootstrapState &&
    cachedGuestBootstrapState.contextKey === contextKey &&
    cachedGuestBootstrapState.expiresAtMs > Date.now() + GUEST_TOKEN_REFRESH_BUFFER_MS
  ) {
    return cachedGuestBootstrapState;
  }

  if (!inFlightGuestBootstrapState) {
    inFlightGuestBootstrapState = fetchGuestBootstrap(baseUrl, context)
      .then((state) => {
        cachedGuestBootstrapState = state;
        return state;
      })
      .finally(() => {
        inFlightGuestBootstrapState = null;
      });
  }

  return inFlightGuestBootstrapState;
}
