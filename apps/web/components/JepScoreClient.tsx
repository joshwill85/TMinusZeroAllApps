'use client';

import { useEffect, useRef, useState } from 'react';
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

const GEOLOCATION_TIMEOUT_MS = 6000;
const GEOLOCATION_MAX_AGE_MS = 5 * 60 * 1000;

export function JepScoreClient({ launchId, initialScore, padTimezone }: JepScoreClientProps) {
  const [score, setScore] = useState<LaunchJepScore>(initialScore);
  const [locationMode, setLocationMode] = useState<JepLocationMode>(initialScore.observer.personalized ? 'user' : 'pad_fallback');
  const [fallbackReason, setFallbackReason] = useState<JepFallbackReason>(null);
  const [isRefining, setIsRefining] = useState(false);
  const attemptedLaunchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!launchId || attemptedLaunchRef.current === launchId) return;
    attemptedLaunchRef.current = launchId;

    let isCanceled = false;
    const controller = new AbortController();

    const run = async () => {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

      if (!navigator.geolocation) {
        if (!isCanceled) {
          setLocationMode('pad_fallback');
          setFallbackReason('unsupported');
        }
        return;
      }

      const denied = await isGeolocationDenied();
      if (denied) {
        if (!isCanceled) {
          setLocationMode('pad_fallback');
          setFallbackReason('denied');
        }
        return;
      }

      setIsRefining(true);

      try {
        const position = await getCurrentPosition();
        if (isCanceled) return;

        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const response = await fetch(`/api/public/launches/${encodeURIComponent(launchId)}/jep`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({
            observerLat: Number(lat.toFixed(5)),
            observerLon: Number(lon.toFixed(5))
          })
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('jep_not_found');
          }
          throw new Error(`jep_fetch_${response.status}`);
        }

        const payload = (await response.json()) as LaunchJepScore;
        if (isCanceled) return;

        if (payload?.observer?.personalized === true) {
          setScore(payload);
          setLocationMode('user');
          setFallbackReason(null);
          return;
        }

        setLocationMode('pad_fallback');
        setFallbackReason('unavailable');
      } catch (error) {
        if (isCanceled || isAbortError(error)) return;

        const geoReason = mapGeolocationFailure(error);
        setLocationMode('pad_fallback');
        if (geoReason) {
          setFallbackReason(geoReason);
          return;
        }

        const message = error instanceof Error ? error.message : '';
        setFallbackReason(message === 'jep_not_found' ? 'unavailable' : 'error');
      } finally {
        if (!isCanceled) {
          setIsRefining(false);
        }
      }
    };

    void run();

    return () => {
      isCanceled = true;
      controller.abort();
    };
  }, [launchId]);

  return (
    <JepScorePanel
      score={score}
      padTimezone={padTimezone}
      locationMode={locationMode}
      fallbackReason={fallbackReason}
      personalizationLoading={isRefining}
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
