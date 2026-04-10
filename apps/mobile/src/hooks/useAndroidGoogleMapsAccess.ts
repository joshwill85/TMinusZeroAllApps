import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  androidGoogleMapsAccessResponseSchemaV1,
  type AndroidGoogleMapsAccessSurfaceV1
} from '@tminuszero/contracts';
import { ensureGuestBootstrap, APP_CLIENT_HEADER_NAME, APP_GUEST_TOKEN_HEADER_NAME } from '@/src/api/guestBootstrap';
import { getApiBaseUrl } from '@/src/config/api';

type AndroidGoogleMapsAccessState = {
  allowed: boolean;
  checked: boolean;
  reason: string | null;
};

type CachedAccessEntry = {
  expiresAtMs: number;
  value: AndroidGoogleMapsAccessState;
};

const accessCache = new Map<string, CachedAccessEntry>();

function buildCacheKey(surface: AndroidGoogleMapsAccessSurfaceV1, launchId?: string | null) {
  return `${surface}:${String(launchId || '').trim() || 'none'}`;
}

async function requestAndroidGoogleMapsAccess(surface: AndroidGoogleMapsAccessSurfaceV1, launchId?: string | null) {
  const baseUrl = getApiBaseUrl();
  const guestBootstrap = await ensureGuestBootstrap(baseUrl);
  if (!guestBootstrap) {
    return {
      allowed: false,
      checked: true,
      reason: 'Native guest bootstrap is unavailable for Android launch maps.'
    } satisfies AndroidGoogleMapsAccessState;
  }

  const response = await fetch(`${baseUrl}/api/v1/client/android-map-access`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [APP_CLIENT_HEADER_NAME]: guestBootstrap.clientHeaderValue,
      [APP_GUEST_TOKEN_HEADER_NAME]: guestBootstrap.guestToken
    },
    body: JSON.stringify({
      surface,
      launchId: launchId?.trim() || null
    })
  });

  if (!response.ok) {
    return {
      allowed: false,
      checked: true,
      reason: `Android map access check failed (${response.status}).`
    } satisfies AndroidGoogleMapsAccessState;
  }

  const payload = androidGoogleMapsAccessResponseSchemaV1.parse(await response.json());
  const expiresAtMs = Date.parse(payload.expiresAt);
  const value = {
    allowed: payload.enabled,
    checked: true,
    reason: payload.reason ?? null
  } satisfies AndroidGoogleMapsAccessState;
  accessCache.set(buildCacheKey(surface, launchId), {
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 15 * 60 * 1000,
    value
  });
  return value;
}

export function useAndroidGoogleMapsAccess({
  surface,
  launchId,
  enabled
}: {
  surface: AndroidGoogleMapsAccessSurfaceV1;
  launchId?: string | null;
  enabled: boolean;
}) {
  const [state, setState] = useState<AndroidGoogleMapsAccessState>({
    allowed: Platform.OS !== 'android',
    checked: Platform.OS !== 'android',
    reason: null
  });

  useEffect(() => {
    let active = true;

    if (Platform.OS !== 'android') {
      setState({
        allowed: true,
        checked: true,
        reason: null
      });
      return () => {
        active = false;
      };
    }

    if (!enabled) {
      setState({
        allowed: false,
        checked: true,
        reason: null
      });
      return () => {
        active = false;
      };
    }

    const cacheKey = buildCacheKey(surface, launchId);
    const cached = accessCache.get(cacheKey);
    if (cached && cached.expiresAtMs > Date.now()) {
      setState(cached.value);
      return () => {
        active = false;
      };
    }

    setState({
      allowed: false,
      checked: false,
      reason: null
    });

    void requestAndroidGoogleMapsAccess(surface, launchId)
      .then((nextState) => {
        if (active) {
          setState(nextState);
        }
      })
      .catch((error) => {
        if (active) {
          setState({
            allowed: false,
            checked: true,
            reason: error instanceof Error ? error.message : 'Android map access is unavailable right now.'
          });
        }
      });

    return () => {
      active = false;
    };
  }, [enabled, launchId, surface]);

  return state;
}
