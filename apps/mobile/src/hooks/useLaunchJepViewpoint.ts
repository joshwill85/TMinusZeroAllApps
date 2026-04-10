import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import type { LaunchJepRequest, LaunchJepScoreV1 } from '@tminuszero/api-client';
import { useLaunchJepQuery } from '@/src/api/queries';

export type MobileJepLocationMode = 'user' | 'pad_fallback';
export type MobileJepFallbackReason = 'denied' | 'unsupported' | 'timeout' | 'unavailable' | 'error' | null;
export type MobileJepViewpointPromptState = 'idle' | Exclude<MobileJepFallbackReason, null> | 'resolving';

const LOCATION_TIMEOUT_MS = 8_000;
const LAST_KNOWN_MAX_AGE_MS = 5 * 60 * 1000;
const LAST_KNOWN_REQUIRED_ACCURACY_M = 3_000;

function hasObserverRequest(request: LaunchJepRequest) {
  return typeof request.observerLat === 'number' && typeof request.observerLon === 'number';
}

function buildObserverRequest(latitude: number, longitude: number): LaunchJepRequest {
  return {
    observerLat: Number(latitude.toFixed(5)),
    observerLon: Number(longitude.toFixed(5))
  };
}

function isPersonalizedScore(score: LaunchJepScoreV1 | null | undefined) {
  return Boolean(score?.observer.personalized && !score?.observer.usingPadFallback);
}

async function resolveCurrentPosition() {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracy: LAST_KNOWN_REQUIRED_ACCURACY_M
  });
  if (lastKnown) return lastKnown;

  return await Promise.race([
    Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    }),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('location_timeout')), LOCATION_TIMEOUT_MS);
    })
  ]);
}

function mapLocationFailure(error: unknown): Exclude<MobileJepFallbackReason, null> {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
      ? String((error as { code: string }).code).toUpperCase()
      : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (code.includes('DENIED') || code.includes('UNAUTHORIZED') || message.includes('denied') || message.includes('unauthorized')) {
    return 'denied';
  }
  if (code.includes('TIMEOUT') || message.includes('timeout') || message.includes('timed out')) {
    return 'timeout';
  }
  if (
    code.includes('UNAVAILABLE') ||
    code.includes('POSITION') ||
    message.includes('services') ||
    message.includes('unavailable') ||
    message.includes('accuracy')
  ) {
    return 'unavailable';
  }
  return 'error';
}

export function useLaunchJepViewpoint({
  launchId,
  enabled
}: {
  launchId: string;
  enabled: boolean;
}) {
  const [request, setRequest] = useState<LaunchJepRequest>({});
  const query = useLaunchJepQuery(launchId, request, { enabled });
  const [resolvedPadFallbackScore, setResolvedPadFallbackScore] = useState<LaunchJepScoreV1 | null>(null);
  const [resolvedPersonalizedScore, setResolvedPersonalizedScore] = useState<LaunchJepScoreV1 | null>(null);
  const [locationMode, setLocationMode] = useState<MobileJepLocationMode>('pad_fallback');
  const [fallbackReason, setFallbackReason] = useState<MobileJepFallbackReason>(null);
  const [promptVisible, setPromptVisible] = useState(true);
  const [promptState, setPromptState] = useState<MobileJepViewpointPromptState>('idle');

  useEffect(() => {
    setRequest({});
    setResolvedPadFallbackScore(null);
    setResolvedPersonalizedScore(null);
    setLocationMode('pad_fallback');
    setFallbackReason(null);
    setPromptVisible(true);
    setPromptState('idle');
  }, [launchId]);

  useEffect(() => {
    if (query.data) {
      if (isPersonalizedScore(query.data)) {
        setResolvedPersonalizedScore(query.data);
        return;
      }

      setResolvedPadFallbackScore(query.data);
    }
  }, [query.data]);

  useEffect(() => {
    if (!enabled) return;

    const requestedPersonalization = hasObserverRequest(request);
    if (query.isFetching) return;

    if (requestedPersonalization && query.error) {
      setRequest({});
      setLocationMode('pad_fallback');
      setFallbackReason('error');
      setPromptState('error');
      setPromptVisible(true);
      return;
    }

    if (!query.data) return;

    if (requestedPersonalization) {
      if (isPersonalizedScore(query.data)) {
        setLocationMode('user');
        setFallbackReason(null);
        setPromptState('idle');
        setPromptVisible(false);
        return;
      }

      setRequest({});
      setLocationMode('pad_fallback');
      setFallbackReason('unavailable');
      setPromptState('unavailable');
      setPromptVisible(true);
      return;
    }

    setLocationMode(isPersonalizedScore(query.data) ? 'user' : 'pad_fallback');
  }, [enabled, query.data, query.error, query.isFetching, request]);

  const requestCurrentLocation = useCallback(async () => {
    setPromptState('resolving');
    setPromptVisible(true);
    setFallbackReason(null);

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setLocationMode('pad_fallback');
        setFallbackReason('unavailable');
        setPromptState('unavailable');
        return;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationMode('pad_fallback');
        setFallbackReason('denied');
        setPromptState('denied');
        return;
      }

      const position = await resolveCurrentPosition();
      setLocationMode('user');
      setFallbackReason(null);
      setPromptState('resolving');
      setRequest(buildObserverRequest(position.coords.latitude, position.coords.longitude));
    } catch (error) {
      const reason = mapLocationFailure(error);
      setLocationMode('pad_fallback');
      setFallbackReason(reason);
      setPromptState(reason);
      setRequest({});
    }
  }, []);

  const selectLaunchSiteReference = useCallback(() => {
    setRequest({});
    setLocationMode('pad_fallback');
    setFallbackReason(null);
    setPromptState('idle');
    setPromptVisible(false);
  }, []);

  const showLocationLoading = promptState === 'resolving' || (hasObserverRequest(request) && query.isFetching);
  const score = useMemo(() => {
    if (query.data) {
      return query.data;
    }

    if (locationMode === 'user') {
      return resolvedPersonalizedScore ?? resolvedPadFallbackScore;
    }

    return resolvedPadFallbackScore;
  }, [locationMode, query.data, resolvedPadFallbackScore, resolvedPersonalizedScore]);

  return {
    score,
    query,
    locationMode,
    fallbackReason,
    promptVisible,
    promptState,
    showLocationLoading,
    requestCurrentLocation,
    selectLaunchSiteReference
  };
}
