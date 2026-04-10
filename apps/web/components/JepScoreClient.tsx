'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { JepScorePanel, type JepFallbackReason, type JepLocationMode } from '@/components/JepScorePanel';
import type { LaunchJepScore } from '@/lib/types/jep';

type JepScoreClientProps = {
  launchId: string;
  initialScore: LaunchJepScore;
  padTimezone: string;
};

type GeolocationFailure = {
  code: number;
};

type JepViewpointPromptState = 'idle' | Exclude<JepFallbackReason, null> | 'resolving';

const GEOLOCATION_TIMEOUT_MS = 6000;
const GEOLOCATION_MAX_AGE_MS = 5 * 60 * 1000;

export function JepScoreClient({ launchId, initialScore, padTimezone }: JepScoreClientProps) {
  const [score, setScore] = useState<LaunchJepScore>(initialScore);
  const [locationMode, setLocationMode] = useState<JepLocationMode>(initialScore.observer.personalized ? 'user' : 'pad_fallback');
  const [fallbackReason, setFallbackReason] = useState<JepFallbackReason>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [promptVisible, setPromptVisible] = useState(!initialScore.observer.personalized);
  const [promptState, setPromptState] = useState<JepViewpointPromptState>('idle');
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setScore(initialScore);
    setLocationMode(initialScore.observer.personalized ? 'user' : 'pad_fallback');
    setFallbackReason(null);
    setIsRefining(false);
    setPromptVisible(!initialScore.observer.personalized);
    setPromptState('idle');
  }, [initialScore, launchId]);

  const fetchScore = useCallback(
    async (observer?: { lat: number; lon: number }) => {
      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;
      try {
        const response = await fetch(`/api/public/launches/${encodeURIComponent(launchId)}/jep`, {
          method: observer ? 'POST' : 'GET',
          headers: observer
            ? {
                'Content-Type': 'application/json'
              }
            : undefined,
          cache: 'no-store',
          signal: controller.signal,
          body: observer
            ? JSON.stringify({
                observerLat: Number(observer.lat.toFixed(5)),
                observerLon: Number(observer.lon.toFixed(5))
              })
            : undefined
        });

        if (!response.ok) {
          if (response.status === 404) throw new Error('jep_not_found');
          if (response.status === 429) throw new Error('jep_rate_limited');
          throw new Error(`jep_fetch_${response.status}`);
        }

        return (await response.json()) as LaunchJepScore;
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
      }
    },
    [launchId]
  );

  const selectLaunchSiteReference = useCallback(async () => {
    setPromptVisible(false);
    setPromptState('idle');
    setFallbackReason(null);

    if (!score.observer.personalized) {
      setLocationMode('pad_fallback');
      return;
    }

    setIsRefining(true);
    try {
      const payload = await fetchScore();
      setScore(payload);
      setLocationMode('pad_fallback');
    } catch (error) {
      if (!isAbortError(error)) {
        setFallbackReason('error');
      }
    } finally {
      setIsRefining(false);
    }
  }, [fetchScore, score.observer.personalized]);

  const requestCurrentLocation = useCallback(async () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

    setPromptState('resolving');
    setIsRefining(true);

    try {
      if (!navigator.geolocation) {
        setLocationMode('pad_fallback');
        setFallbackReason('unsupported');
        setPromptState('unsupported');
        setPromptVisible(true);
        return;
      }

      const denied = await isGeolocationDenied();
      if (denied) {
        setLocationMode('pad_fallback');
        setFallbackReason('denied');
        setPromptState('denied');
        setPromptVisible(true);
        return;
      }

      const position = await getCurrentPosition();
      const payload = await fetchScore({
        lat: position.coords.latitude,
        lon: position.coords.longitude
      });

      if (payload?.observer?.personalized === true) {
        setScore(payload);
        setLocationMode('user');
        setFallbackReason(null);
        setPromptState('idle');
        setPromptVisible(false);
        return;
      }

      setScore(payload);
      setLocationMode('pad_fallback');
      setFallbackReason('unavailable');
      setPromptState('unavailable');
      setPromptVisible(true);
    } catch (error) {
      if (isAbortError(error)) return;

      const geoReason = mapGeolocationFailure(error);
      setLocationMode('pad_fallback');
      if (geoReason) {
        setFallbackReason(geoReason);
        setPromptState(geoReason);
        setPromptVisible(true);
        return;
      }

      const message = error instanceof Error ? error.message : '';
      if (message === 'jep_rate_limited') {
        setFallbackReason(null);
        setPromptState('idle');
        setPromptVisible(false);
        return;
      }

      setFallbackReason(message === 'jep_not_found' ? 'unavailable' : 'error');
      setPromptState(message === 'jep_not_found' ? 'unavailable' : 'error');
      setPromptVisible(true);
    } finally {
      setIsRefining(false);
    }
  }, [fetchScore]);

  return (
    <JepScorePanel
      score={score}
      padTimezone={padTimezone}
      locationMode={locationMode}
      fallbackReason={fallbackReason}
      personalizationLoading={isRefining}
      viewpointPrompt={{
        visible: promptVisible,
        state: promptState,
        onUseMyLocation: () => {
          void requestCurrentLocation();
        },
        onUseLaunchSite: () => {
          void selectLaunchSiteReference();
        }
      }}
      onLocationModeChange={(nextMode) => {
        if (nextMode === 'user') {
          void requestCurrentLocation();
          return;
        }
        void selectLaunchSiteReference();
      }}
    />
  );
}

async function isGeolocationDenied() {
  if (typeof navigator === 'undefined') return false;
  if (!('permissions' in navigator) || typeof navigator.permissions?.query !== 'function') return false;

  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state === 'denied';
  } catch {
    return false;
  }
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject({ code: error.code } satisfies GeolocationFailure),
      {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_MAX_AGE_MS
      }
    );
  });
}

function mapGeolocationFailure(error: unknown): JepFallbackReason {
  if (!isGeolocationFailure(error)) return null;
  if (error.code === 1) return 'denied';
  if (error.code === 2) return 'unavailable';
  if (error.code === 3) return 'timeout';
  return 'error';
}

function isGeolocationFailure(value: unknown): value is GeolocationFailure {
  if (!value || typeof value !== 'object') return false;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'number' && Number.isFinite(code);
}

function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: string }).name === 'AbortError';
}
