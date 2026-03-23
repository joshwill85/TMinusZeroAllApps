import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { AppState, Linking, PermissionsAndroid, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ArTelemetrySessionEventV1, TrajectoryPublicV2ResponseV1 } from '@tminuszero/contracts';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import {
  useArTelemetrySessionMutation,
  useLaunchDetailQuery,
  useLaunchTrajectoryQuery,
  useViewerEntitlementsQuery
} from '@/src/api/queries';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatTimestamp } from '@/src/utils/format';
import {
  getCapabilitiesAsync,
  lockOrientationAsync,
  TmzArTrajectoryView,
  type TmzArTrajectoryCapabilities,
  type TmzArTrajectoryErrorEvent,
  type TmzArTrajectorySessionUpdate,
  type TmzArTrajectorySessionUpdateEvent,
  unlockOrientationAsync
} from '@/modules/tmz-ar-trajectory';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function createSessionId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `tmz-ar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildRenderTier(qualityState: TrajectoryPublicV2ResponseV1['qualityState']) {
  if (qualityState === 'precision') return 3;
  if (qualityState === 'safe_corridor') return 2;
  return 1;
}

function buildRenderTierLabel(qualityState: TrajectoryPublicV2ResponseV1['qualityState']) {
  if (qualityState === 'precision') return 'high' as const;
  if (qualityState === 'safe_corridor') return 'medium' as const;
  return 'low' as const;
}

function buildOverlayMode(qualityState: TrajectoryPublicV2ResponseV1['qualityState']) {
  if (qualityState === 'precision') return 'precision' as const;
  if (qualityState === 'safe_corridor') return 'guided' as const;
  return 'search' as const;
}

function buildTelemetryQualityState(qualityState: TrajectoryPublicV2ResponseV1['qualityState']) {
  if (qualityState === 'precision') return 'precision' as const;
  if (qualityState === 'safe_corridor') return 'guided' as const;
  return 'pad_only' as const;
}

function buildTrajectoryDurationSeconds(trajectory: TrajectoryPublicV2ResponseV1) {
  return Math.round(
    trajectory.tracks.reduce((maxValue, track) => {
      const lastSample = track.samples[track.samples.length - 1];
      return Math.max(maxValue, lastSample?.tPlusSec ?? 0);
    }, 0)
  );
}

function buildTrajectoryStepSeconds(trajectory: TrajectoryPublicV2ResponseV1) {
  const firstTrack = trajectory.tracks[0];
  if (!firstTrack || firstTrack.samples.length < 2) {
    return undefined;
  }

  const firstStep = firstTrack.samples[1].tPlusSec - firstTrack.samples[0].tPlusSec;
  return Number.isFinite(firstStep) && firstStep > 0 ? Math.round(firstStep) : undefined;
}

function bucketZoomRatio(value: number, supported: boolean) {
  if (!supported || !Number.isFinite(value) || value <= 0) {
    return 'unsupported';
  }
  if (value < 0.75) return '0.5..0.75';
  if (value < 1.0) return '0.75..1.0';
  if (value < 1.5) return '1.0..1.5';
  if (value < 2.0) return '1.5..2.0';
  if (value < 2.5) return '2.0..2.5';
  if (value < 3.0) return '2.5..3.0';
  return '3.0+';
}

function normalizePermissionState(
  value: TmzArTrajectorySessionUpdate['cameraPermission'],
  fallback: 'granted' | 'denied' | 'prompt' | 'error' = 'granted'
): 'granted' | 'denied' | 'prompt' | 'error' {
  if (value === 'denied' || value === 'prompt' || value === 'error') {
    return value;
  }
  if (value === 'granted') {
    return 'granted';
  }
  return fallback;
}

function buildTelemetryEvent({
  type,
  sessionId,
  launchId,
  runtimeFamily,
  startedAt,
  nativeUpdate,
  trajectory,
  endedAt
}: {
  type: ArTelemetrySessionEventV1['type'];
  sessionId: string;
  launchId: string;
  runtimeFamily: 'ios_native' | 'android_native';
  startedAt: string;
  nativeUpdate: TmzArTrajectorySessionUpdate;
  trajectory: TrajectoryPublicV2ResponseV1;
  endedAt?: string;
}): ArTelemetrySessionEventV1 {
  const durationMs = endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : undefined;
  const cameraStatus = normalizePermissionState(nativeUpdate.cameraPermission, 'prompt');
  const motionStatus = normalizePermissionState(nativeUpdate.motionPermission, 'granted');
  const headingSource = nativeUpdate.headingSource ?? (runtimeFamily === 'ios_native' ? 'arkit_world' : 'unknown');
  const poseSource = nativeUpdate.poseSource ?? (runtimeFamily === 'ios_native' ? 'arkit_world_tracking' : 'deviceorientation');
  const poseMode = nativeUpdate.poseMode ?? (runtimeFamily === 'ios_native' ? 'arkit_world_tracking' : 'sensor_fused');
  const visionBackend = nativeUpdate.visionBackend ?? (runtimeFamily === 'ios_native' ? 'vision_native' : 'none');
  const headingStatus =
    headingSource === 'arkit_world' || nativeUpdate.worldAlignment === 'gravity_and_heading' ? 'ok' : 'unknown';

  return {
    type,
    payload: {
      sessionId,
      launchId,
      startedAt,
      ...(endedAt ? { endedAt } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      runtimeFamily,
      cameraStatus,
      motionStatus,
      headingStatus,
      headingSource,
      poseSource,
      poseMode,
      overlayMode: buildOverlayMode(trajectory.qualityState),
      visionBackend,
      trackingState: nativeUpdate.trackingState,
      trackingReason: nativeUpdate.trackingReason ?? undefined,
      worldAlignment: nativeUpdate.worldAlignment,
      worldMappingStatus: nativeUpdate.worldMappingStatus,
      lidarAvailable: nativeUpdate.lidarAvailable,
      sceneDepthEnabled: nativeUpdate.sceneDepthEnabled,
      sceneReconstructionEnabled: nativeUpdate.sceneReconstructionEnabled,
      geoTrackingState: nativeUpdate.geoTrackingState,
      geoTrackingAccuracy: nativeUpdate.geoTrackingAccuracy,
      occlusionMode: nativeUpdate.occlusionMode,
      relocalizationCount: nativeUpdate.relocalizationCount,
      highResCaptureAttempted: nativeUpdate.highResCaptureAttempted,
      highResCaptureSucceeded: nativeUpdate.highResCaptureSucceeded,
      renderLoopRunning: nativeUpdate.renderLoopRunning,
      zoomSupported: nativeUpdate.zoomSupported,
      zoomRatioBucket: nativeUpdate.zoomRatioBucket ?? bucketZoomRatio(nativeUpdate.zoomRatio, nativeUpdate.zoomSupported),
      zoomControlPath: nativeUpdate.zoomControlPath,
      zoomApplyLatencyBucket: nativeUpdate.zoomApplyLatencyBucket,
      zoomProjectionSyncLatencyBucket: nativeUpdate.zoomProjectionSyncLatencyBucket,
      projectionSource: nativeUpdate.projectionSource,
      trajectoryVersion: trajectory.version,
      durationS: buildTrajectoryDurationSeconds(trajectory),
      stepS: buildTrajectoryStepSeconds(trajectory),
      tier: buildRenderTier(trajectory.qualityState),
      confidenceTierSeen: trajectory.confidenceTier ?? undefined,
      trajectoryQualityState: buildTelemetryQualityState(trajectory.qualityState),
      renderTier: buildRenderTierLabel(trajectory.qualityState)
    }
  };
}

export default function LaunchArTrajectoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useMobileBootstrap();
  const runtimeFamily: 'ios_native' | 'android_native' = Platform.OS === 'android' ? 'android_native' : 'ios_native';
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const detailQuery = useLaunchDetailQuery(launchId);
  const entitlementsQuery = useViewerEntitlementsQuery();
  const telemetryMutation = useArTelemetrySessionMutation();
  const [capabilities, setCapabilities] = useState<TmzArTrajectoryCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [lastNativeUpdate, setLastNativeUpdate] = useState<TmzArTrajectorySessionUpdate | null>(null);
  const [zoomTrayOpen, setZoomTrayOpen] = useState(false);
  const [targetZoomRatio, setTargetZoomRatio] = useState<number | null>(null);
  const [androidCameraPermission, setAndroidCameraPermission] = useState<'prompt' | 'granted' | 'denied'>(
    Platform.OS === 'android' ? 'prompt' : 'granted'
  );
  const [androidLocationPermission, setAndroidLocationPermission] = useState<'prompt' | 'granted' | 'denied'>(
    Platform.OS === 'android' ? 'prompt' : 'granted'
  );

  const detail = detailQuery.data ?? null;
  const launch = detail?.launchData ?? detail?.launch ?? null;
  const arTrajectory = detail?.arTrajectory ?? null;
  const canUseArTrajectory = entitlementsQuery.data?.capabilities.canUseArTrajectory ?? false;

  const isNativePlatform = Platform.OS === 'ios' || Platform.OS === 'android';
  const canOpenNativeAr =
    isNativePlatform &&
    Boolean(launchId) &&
    canUseArTrajectory &&
    arTrajectory?.eligible === true &&
    arTrajectory?.hasTrajectory === true &&
    (Platform.OS !== 'android' || androidCameraPermission === 'granted');
  const androidLocationStatus = Platform.OS === 'android' ? (lastNativeUpdate?.locationPermission ?? androidLocationPermission) : 'granted';

  const trajectoryQuery = useLaunchTrajectoryQuery(launchId, {
    enabled: canOpenNativeAr
  });

  const trajectory = trajectoryQuery.data ?? null;
  const trajectoryJson = useMemo(() => (trajectory ? JSON.stringify(trajectory) : null), [trajectory]);
  const zoomMin = useMemo(() => {
    const value = lastNativeUpdate?.zoomRangeMin ?? capabilities?.minZoomRatio ?? 1;
    return Number.isFinite(value) ? value : 1;
  }, [capabilities?.minZoomRatio, lastNativeUpdate?.zoomRangeMin]);
  const zoomMax = useMemo(() => {
    const value = lastNativeUpdate?.zoomRangeMax ?? capabilities?.maxZoomRatio ?? 1;
    const safeMax = Number.isFinite(value) ? value : 1;
    return Math.max(zoomMin, safeMax);
  }, [capabilities?.maxZoomRatio, lastNativeUpdate?.zoomRangeMax, zoomMin]);
  const zoomEnabled = useMemo(() => {
    const supported = lastNativeUpdate?.zoomSupported ?? capabilities?.supportsZoom ?? false;
    return supported && zoomMax > zoomMin + 0.01;
  }, [capabilities?.supportsZoom, lastNativeUpdate?.zoomSupported, zoomMax, zoomMin]);
  const zoomRatio = useMemo(() => {
    const value = lastNativeUpdate?.zoomRatio ?? targetZoomRatio ?? capabilities?.defaultZoomRatio ?? 1;
    if (!Number.isFinite(value)) return 1;
    return Math.min(Math.max(value, zoomMin), zoomMax);
  }, [capabilities?.defaultZoomRatio, lastNativeUpdate?.zoomRatio, targetZoomRatio, zoomMax, zoomMin]);

  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const lastNativeUpdateRef = useRef<TmzArTrajectorySessionUpdate | null>(null);
  const lastTelemetrySignatureRef = useRef<string | null>(null);
  const lastTelemetryUpdateAtRef = useRef<number>(0);
  const hasSentStartRef = useRef(false);
  const hasSentEndRef = useRef(false);

  const requestAndroidCameraPermission = useEffectEvent(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      const alreadyGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (alreadyGranted) {
        setAndroidCameraPermission('granted');
        return;
      }

      setAndroidCameraPermission('prompt');
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera access required',
        message: 'Camera access is required for native AR trajectory guidance.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now'
      });
      setAndroidCameraPermission(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
    } catch {
      setAndroidCameraPermission('denied');
    }
  });

  const requestAndroidLocationPermission = useEffectEvent(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      const hasFine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      const hasCoarse = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
      if (hasFine || hasCoarse) {
        setAndroidLocationPermission('granted');
        return;
      }

      setAndroidLocationPermission('prompt');
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
        title: 'Location access recommended',
        message: 'Location improves trajectory alignment for Android camera guidance.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now'
      });
      setAndroidLocationPermission(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
    } catch {
      setAndroidLocationPermission('denied');
    }
  });

  const syncAndroidPermissions = useEffectEvent(async () => {
    if (Platform.OS !== 'android') {
      return;
    }

    try {
      const [cameraGranted, hasFineLocation, hasCoarseLocation] = await Promise.all([
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
        PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)
      ]);

      setAndroidCameraPermission(cameraGranted ? 'granted' : 'denied');
      setAndroidLocationPermission(hasFineLocation || hasCoarseLocation ? 'granted' : 'denied');
    } catch {
      setAndroidCameraPermission('denied');
      setAndroidLocationPermission('denied');
    }
  });

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    void requestAndroidCameraPermission().then(async () => {
      const cameraGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!cameraGranted) {
        return;
      }
      await requestAndroidLocationPermission();
    });
  }, [requestAndroidCameraPermission, requestAndroidLocationPermission]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }
      void syncAndroidPermissions();
    });

    return () => {
      subscription.remove();
    };
  }, [syncAndroidPermissions]);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

    let active = true;
    void getCapabilitiesAsync()
      .then((value) => {
        if (!active) {
          return;
        }
        setCapabilities(value);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setCapabilityError(error instanceof Error ? error.message : 'Unable to read native AR capabilities.');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!zoomEnabled) {
      setZoomTrayOpen(false);
      if (targetZoomRatio != null) {
        setTargetZoomRatio(null);
      }
      return;
    }
    if (targetZoomRatio != null) {
      return;
    }
    const initial = capabilities?.defaultZoomRatio ?? zoomMin;
    const clamped = Math.min(Math.max(initial, zoomMin), zoomMax);
    setTargetZoomRatio(clamped);
  }, [capabilities?.defaultZoomRatio, targetZoomRatio, zoomEnabled, zoomMax, zoomMin]);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return;
    }

    void lockOrientationAsync('landscape');
    return () => {
      void unlockOrientationAsync();
    };
  }, []);

  const getOrCreateSession = useEffectEvent(() => {
    if (!sessionIdRef.current) {
      sessionIdRef.current = createSessionId();
      sessionStartedAtRef.current = new Date().toISOString();
    }

    return {
      sessionId: sessionIdRef.current,
      startedAt: sessionStartedAtRef.current ?? new Date().toISOString()
    };
  });

  const sendTelemetryEvent = useEffectEvent((type: ArTelemetrySessionEventV1['type'], nativeUpdate: TmzArTrajectorySessionUpdate) => {
    if (!trajectory) {
      return;
    }

    const { sessionId, startedAt } = getOrCreateSession();
    const endedAt = type === 'end' ? new Date().toISOString() : undefined;
    telemetryMutation.mutate(
      buildTelemetryEvent({
        type,
        sessionId,
        launchId,
        runtimeFamily,
        startedAt,
        nativeUpdate,
        trajectory,
        endedAt
      })
    );
  });

  const flushTelemetryOnExit = useEffectEvent(() => {
    if (!hasSentStartRef.current || hasSentEndRef.current) {
      return;
    }

    const lastUpdate =
      lastNativeUpdateRef.current ??
      ({
        sessionRunning: false,
        trackingState: 'not_available',
        trackingReason: 'session_closed',
        worldAlignment:
          runtimeFamily === 'android_native'
            ? capabilities?.preferredWorldAlignment ?? 'camera'
            : 'gravity_and_heading',
        worldMappingStatus: 'not_available',
        lidarAvailable: false,
        sceneDepthEnabled: false,
        sceneReconstructionEnabled: false,
        geoTrackingState: 'not_available',
        geoTrackingAccuracy: 'unknown',
        occlusionMode: 'none',
        relocalizationCount: 0,
        renderLoopRunning: false,
        highResCaptureAttempted: false,
        highResCaptureSucceeded: false,
        hasTrajectory: Boolean(trajectory),
        qualityState: trajectory?.qualityState ?? null,
        sampleCount: trajectory?.tracks.reduce((sum, track) => sum + track.samples.length, 0) ?? 0,
        milestoneCount: trajectory?.milestones.length ?? 0,
        zoomSupported: false,
        zoomRatio: 1,
        zoomRangeMin: 1,
        zoomRangeMax: 1,
        zoomControlPath: 'unsupported',
        projectionSource: 'inferred_fov',
        zoomRatioBucket: 'unsupported',
        zoomApplyLatencyBucket: 'unknown',
        zoomProjectionSyncLatencyBucket: 'unknown',
        cameraPermission: Platform.OS === 'android' ? androidCameraPermission : 'granted',
        motionPermission: 'granted',
        locationPermission: Platform.OS === 'android' ? androidLocationPermission : 'granted',
        lastUpdatedAt: new Date().toISOString()
      } satisfies TmzArTrajectorySessionUpdate);

    hasSentEndRef.current = true;
    sendTelemetryEvent('end', lastUpdate);
  });

  const handleNativeSessionUpdate = useEffectEvent((event: TmzArTrajectorySessionUpdateEvent) => {
    const update = event.nativeEvent;
    lastNativeUpdateRef.current = update;
    startTransition(() => {
      setLastNativeUpdate(update);
      setNativeError(null);
    });

    if (!trajectory) {
      return;
    }

    const signature = [
      update.trackingState,
      update.trackingReason ?? '',
      update.worldMappingStatus,
      update.occlusionMode,
      String(update.relocalizationCount),
      String(update.renderLoopRunning),
      String(update.zoomRatio),
      update.zoomControlPath
    ].join(':');
    const now = Date.now();

    if (!hasSentStartRef.current) {
      hasSentStartRef.current = true;
      hasSentEndRef.current = false;
      lastTelemetrySignatureRef.current = signature;
      lastTelemetryUpdateAtRef.current = now;
      sendTelemetryEvent('start', update);
      return;
    }

    if (signature !== lastTelemetrySignatureRef.current || now - lastTelemetryUpdateAtRef.current >= 15_000) {
      lastTelemetrySignatureRef.current = signature;
      lastTelemetryUpdateAtRef.current = now;
      sendTelemetryEvent('update', update);
    }
  });

  const handleNativeSessionError = useEffectEvent((event: TmzArTrajectoryErrorEvent) => {
    setNativeError(event.nativeEvent.message);
  });

  const handleZoomTo = useEffectEvent((value: number) => {
    if (!zoomEnabled) {
      return;
    }
    const clamped = Math.min(Math.max(value, zoomMin), zoomMax);
    setTargetZoomRatio(clamped);
  });

  useEffect(() => {
    if (!canOpenNativeAr) {
      flushTelemetryOnExit();
    }
  }, [canOpenNativeAr, flushTelemetryOnExit]);

  useEffect(() => {
    return () => {
      flushTelemetryOnExit();
    };
  }, [flushTelemetryOnExit]);

  let content: JSX.Element;

  if (!launchId) {
    content = <EmptyStateCard title="Missing launch id" body="An AR trajectory route was opened without a launch id." />;
  } else if (detailQuery.isPending || entitlementsQuery.isPending) {
    content = <LoadingStateCard title="Loading AR trajectory" body="Checking premium access and launch eligibility." />;
  } else if (detailQuery.isError) {
    content = <ErrorStateCard title="AR trajectory unavailable" body={detailQuery.error.message} />;
  } else if (entitlementsQuery.isError) {
    content = <ErrorStateCard title="Entitlements unavailable" body={entitlementsQuery.error.message} />;
  } else if (!detail || !arTrajectory) {
    content = <EmptyStateCard title="AR trajectory unavailable" body="Launch detail did not include an AR trajectory summary." />;
  } else if (!canUseArTrajectory) {
    content = (
      <SectionCard
        title="Premium required"
        description="AR trajectory is a premium feature and stays locked until the account has premium access."
      >
        <ArButton
          label="Open Premium"
          onPress={() => {
            router.push('/profile');
          }}
        />
      </SectionCard>
    );
  } else if (!arTrajectory.eligible) {
    content = (
      <EmptyStateCard
        title="Launch not eligible"
        body="This launch is outside the current AR-eligible program window, so AR trajectory guidance is disabled."
      />
    );
  } else if (!arTrajectory.hasTrajectory) {
    content = <EmptyStateCard title="Trajectory pending" body="This launch is AR-eligible, but the trajectory package has not been published yet." />;
  } else if (Platform.OS === 'android' && androidCameraPermission === 'prompt') {
    content = <LoadingStateCard title="Preparing native AR" body="Requesting camera access for Android native AR trajectory." />;
  } else if (Platform.OS === 'android' && androidCameraPermission !== 'granted') {
    content = (
      <SectionCard
        title="Camera access required"
        description="Android native AR trajectory requires camera access."
        body="You can grant camera permission in app settings and retry native AR."
      >
        <View style={{ gap: 10 }}>
          <ArButton
            label="Try again"
            onPress={() => {
              void requestAndroidCameraPermission();
            }}
          />
          <ArButton
            label="Open settings"
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        </View>
      </SectionCard>
    );
  } else if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    content = <EmptyStateCard title="AR unavailable" body="AR trajectory is available on supported iPhone and Android devices." />;
  } else if (capabilityError) {
    content = <ErrorStateCard title="Capability check failed" body={capabilityError} />;
  } else if (!capabilities) {
    content = <LoadingStateCard title="Preparing native AR" body="Reading device capabilities and locking the AR session orientation." />;
  } else if (!capabilities.isSupported) {
    content =
      Platform.OS === 'android' ? (
        <SectionCard
          title="Native AR unavailable"
          description="Native Android AR trajectory is unavailable on this device."
          body="This device cannot start the native AR runtime. You can continue tracking the launch from the native detail screen."
        >
          <ArButton
            label="Back to launch detail"
            onPress={() => {
              router.replace((`/launches/${launchId}`) as Href);
            }}
          />
        </SectionCard>
      ) : (
        <EmptyStateCard title="Device unsupported" body="This iPhone does not support ARKit world tracking, so the native AR trajectory runtime cannot start." />
      );
  } else if (trajectoryQuery.isPending) {
    content = <LoadingStateCard title="Loading trajectory package" body="Fetching the premium trajectory package for this launch." />;
  } else if (trajectoryQuery.isError) {
    content = <ErrorStateCard title="Trajectory load failed" body={trajectoryQuery.error.message} />;
  } else if (!trajectory || !trajectoryJson) {
    content = <EmptyStateCard title="Trajectory unavailable" body="The premium trajectory package was not returned for this launch." />;
  } else {
    content = (
      <View style={{ flex: 1, gap: 12 }}>
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(7, 9, 19, 0.84)',
            overflow: 'hidden',
            minHeight: 420,
            flex: 1
          }}
        >
          <TmzArTrajectoryView
            style={{ flex: 1 }}
            trajectoryJson={trajectoryJson}
            qualityState={trajectory.qualityState}
            worldAlignment={capabilities.preferredWorldAlignment}
            enableSceneDepth
            enableSceneReconstruction
            highResCaptureEnabled={false}
            enablePinchZoom={zoomEnabled}
            targetZoomRatio={zoomEnabled ? zoomRatio : undefined}
            showDebugStatistics={false}
            onSessionUpdate={handleNativeSessionUpdate}
            onSessionError={handleNativeSessionError}
          />
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              top: 12,
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12
            }}
          >
            <View
              style={{
                flex: 1,
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(7, 9, 19, 0.82)',
                padding: 12,
                gap: 6
              }}
            >
              <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{launch?.name ?? 'Launch trajectory'}</Text>
              <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                {Platform.OS === 'android'
                  ? androidLocationStatus === 'granted'
                    ? capabilities.supportsWorldTracking
                      ? 'Android ARCore world tracking with live zoom-aware premium trajectory overlays.'
                      : 'Android native camera guidance with live zoom-aware premium trajectory overlays.'
                    : capabilities.supportsWorldTracking
                      ? 'Android ARCore tracking is active. Enable location for cleaner launch-site alignment.'
                      : 'Android native camera guidance is active. Enable location for cleaner launch-site alignment.'
                  : `ARKit world tracking with ${capabilities.lidarAvailable ? 'LiDAR-aware occlusion' : 'camera-only guidance'} and premium trajectory overlays.`}
              </Text>
            </View>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(7, 9, 19, 0.82)',
                paddingHorizontal: 14,
                paddingVertical: 10,
                opacity: pressed ? 0.86 : 1
              })}
            >
              <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              alignItems: 'flex-end',
              gap: 8
            }}
          >
            <Pressable
              onPress={() => {
                if (!zoomEnabled) {
                  return;
                }
                setZoomTrayOpen((prev) => !prev);
              }}
              style={({ pressed }) => ({
                borderRadius: 999,
                borderWidth: 1,
                borderColor: 'rgba(255, 255, 255, 0.14)',
                backgroundColor: 'rgba(7, 9, 19, 0.86)',
                paddingHorizontal: 12,
                paddingVertical: 8,
                opacity: pressed ? 0.86 : 1
              })}
            >
              <Text style={{ color: zoomEnabled ? theme.foreground : theme.muted, fontSize: 12, fontWeight: '700' }}>
                {zoomEnabled ? `${zoomRatio.toFixed(2)}x` : 'Zoom unavailable'}
              </Text>
            </Pressable>
            {zoomEnabled && zoomTrayOpen && (
              <View
                style={{
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  backgroundColor: 'rgba(7, 9, 19, 0.9)',
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  gap: 8,
                  minWidth: 220
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                    Zoom
                  </Text>
                  <Text style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>{zoomRatio.toFixed(2)}x</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pressable
                    onPress={() => handleZoomTo(zoomRatio - 0.1)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.16)',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      width: 32,
                      height: 32,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.86 : 1
                    })}
                  >
                    <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>−</Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <View
                      style={{
                        height: 5,
                        borderRadius: 999,
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        overflow: 'hidden'
                      }}
                    >
                      <View
                        style={{
                          width: `${Math.max(0, Math.min(100, ((zoomRatio - zoomMin) / Math.max(zoomMax - zoomMin, 0.0001)) * 100))}%`,
                          height: '100%',
                          backgroundColor: theme.accent
                        }}
                      />
                    </View>
                  </View>
                  <Pressable
                    onPress={() => handleZoomTo(zoomRatio + 0.1)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: 'rgba(255, 255, 255, 0.16)',
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                      width: 32,
                      height: 32,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.86 : 1
                    })}
                  >
                    <Text style={{ color: theme.foreground, fontSize: 18, fontWeight: '700' }}>+</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[0.5, 1, 2, 3]
                    .filter((candidate) => candidate >= zoomMin - 0.01 && candidate <= zoomMax + 0.01)
                    .map((candidate) => (
                      <Pressable
                        key={candidate}
                        onPress={() => handleZoomTo(candidate)}
                        style={({ pressed }) => ({
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: Math.abs(zoomRatio - candidate) < 0.06 ? 'rgba(34, 211, 238, 0.4)' : 'rgba(255, 255, 255, 0.16)',
                          backgroundColor:
                            Math.abs(zoomRatio - candidate) < 0.06 ? 'rgba(34, 211, 238, 0.16)' : 'rgba(255, 255, 255, 0.06)',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          opacity: pressed ? 0.86 : 1
                        })}
                      >
                        <Text style={{ color: theme.foreground, fontSize: 11, fontWeight: '700' }}>{candidate.toFixed(candidate < 1 ? 1 : 0)}x</Text>
                      </Pressable>
                    ))}
                </View>
                <Text style={{ color: theme.muted, fontSize: 10 }}>
                  Pinch to zoom. Safe range {zoomMin.toFixed(2)}x to {zoomMax.toFixed(2)}x.
                </Text>
              </View>
            )}
          </View>
        </View>

        <SectionCard
          title="Session status"
          description={nativeError ?? buildSessionDescription(lastNativeUpdate, trajectory, Platform.OS === 'android')}
          body={trajectory.generatedAt ? `Trajectory package generated ${formatTimestamp(trajectory.generatedAt)}.` : undefined}
          compact
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Platform.OS === 'android' && androidLocationStatus !== 'granted' ? 10 : 0 }}>
            <StatusChip label={formatQualityLabel(trajectory.qualityState)} accent={trajectory.qualityState === 'precision'} />
            <StatusChip label={`Confidence ${trajectory.confidenceBadge}`} />
            <StatusChip label={lastNativeUpdate?.trackingState ?? 'starting'} />
            <StatusChip label={lastNativeUpdate?.occlusionMode ?? 'none'} />
            <StatusChip label={zoomEnabled ? `${zoomRatio.toFixed(2)}x` : 'zoom off'} />
            {Platform.OS === 'android' ? (
              <StatusChip label={androidLocationStatus === 'granted' ? 'location on' : 'location off'} accent={androidLocationStatus !== 'granted'} />
            ) : null}
          </View>
          {Platform.OS === 'android' && androidLocationStatus !== 'granted' ? (
            <ArButton
              label="Enable location"
              onPress={() => {
                void requestAndroidLocationPermission();
              }}
            />
          ) : null}
        </SectionCard>

        <SectionCard title="Launch cues" description="Milestones projected from the premium trajectory package." compact>
          <View style={{ gap: 10 }}>
            {trajectory.milestones.slice(0, 4).map((milestone) => (
              <View
                key={milestone.key}
                style={{
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  padding: 12,
                  gap: 4
                }}
              >
                <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{milestone.label}</Text>
                <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18 }}>
                  {milestone.timeText ?? (milestone.tPlusSec == null ? 'Projected timing pending' : `T+${milestone.tPlusSec.toFixed(0)}s`)}
                </Text>
              </View>
            ))}
          </View>
        </SectionCard>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false
        }}
      />
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: Math.max(insets.top, 16),
          paddingBottom: Math.max(insets.bottom, 16),
          paddingHorizontal: 16,
          gap: 12
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(7, 9, 19, 0.72)',
            paddingHorizontal: 16,
            paddingVertical: 11
          }}
        >
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Back</Text>
          </Pressable>
          <Text
            numberOfLines={1}
            style={{ color: theme.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase' }}
          >
            Native AR trajectory
          </Text>
          <Pressable
            onPress={() => {
              router.push((`/launches/${launchId}`) as Href);
            }}
            hitSlop={8}
          >
            <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700' }}>Launch</Text>
          </Pressable>
        </View>

        {content}
      </View>
    </>
  );
}

function ArButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useMobileBootstrap();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(34, 211, 238, 0.2)',
        backgroundColor: 'rgba(34, 211, 238, 0.1)',
        paddingHorizontal: 16,
        paddingVertical: 12,
        opacity: pressed ? 0.86 : 1
      })}
    >
      <Text style={{ color: theme.accent, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function StatusChip({ label, accent = false }: { label: string; accent?: boolean }) {
  const { theme } = useMobileBootstrap();

  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accent ? 'rgba(34, 211, 238, 0.2)' : theme.stroke,
        backgroundColor: accent ? 'rgba(34, 211, 238, 0.1)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 10,
        paddingVertical: 6
      }}
    >
      <Text
        style={{
          color: accent ? theme.accent : theme.muted,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 1,
          textTransform: 'uppercase'
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function formatQualityLabel(qualityState: TrajectoryPublicV2ResponseV1['qualityState']) {
  if (qualityState === 'precision') return 'Precision';
  if (qualityState === 'safe_corridor') return 'Safe corridor';
  return 'Pad guide';
}

function buildSessionDescription(
  nativeUpdate: TmzArTrajectorySessionUpdate | null,
  trajectory: TrajectoryPublicV2ResponseV1,
  isAndroid: boolean
) {
  if (!nativeUpdate) {
    return 'Waiting for the native AR session to emit its first tracking update.';
  }

  if (nativeUpdate.trackingState === 'limited' && nativeUpdate.trackingReason) {
    return `Tracking is limited: ${nativeUpdate.trackingReason.replace(/_/g, ' ')}. Move slowly and keep the pad horizon in frame.`;
  }

  if (nativeUpdate.trackingState === 'normal') {
    return `${formatQualityLabel(trajectory.qualityState)} guidance is live with ${nativeUpdate.occlusionMode.replace(/_/g, ' ')} occlusion.`;
  }

  if (isAndroid && nativeUpdate.locationPermission && nativeUpdate.locationPermission !== 'granted') {
    return 'Android camera guidance is running without location alignment. Grant location access for a cleaner sky fit.';
  }

  return isAndroid
    ? 'Native AR is initializing Android camera tracking and aligning the launch trajectory shell.'
    : 'Native AR is initializing ARKit world tracking and aligning the launch trajectory shell.';
}
