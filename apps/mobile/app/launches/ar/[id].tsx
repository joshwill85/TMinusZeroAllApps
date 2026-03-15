import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { Platform, Pressable, Text, View } from 'react-native';
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

function buildTelemetryEvent({
  type,
  sessionId,
  launchId,
  startedAt,
  nativeUpdate,
  trajectory,
  endedAt
}: {
  type: ArTelemetrySessionEventV1['type'];
  sessionId: string;
  launchId: string;
  startedAt: string;
  nativeUpdate: TmzArTrajectorySessionUpdate;
  trajectory: TrajectoryPublicV2ResponseV1;
  endedAt?: string;
}): ArTelemetrySessionEventV1 {
  const durationMs = endedAt ? Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)) : undefined;

  return {
    type,
    payload: {
      sessionId,
      launchId,
      startedAt,
      ...(endedAt ? { endedAt } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      runtimeFamily: 'ios_native',
      cameraStatus: 'granted',
      motionStatus: 'granted',
      headingStatus: nativeUpdate.worldAlignment === 'gravity_and_heading' ? 'ok' : 'unknown',
      headingSource: 'arkit_world',
      poseSource: 'arkit_world_tracking',
      poseMode: 'arkit_world_tracking',
      overlayMode: buildOverlayMode(trajectory.qualityState),
      visionBackend: 'vision_native',
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
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const detailQuery = useLaunchDetailQuery(launchId);
  const entitlementsQuery = useViewerEntitlementsQuery();
  const telemetryMutation = useArTelemetrySessionMutation();
  const [capabilities, setCapabilities] = useState<TmzArTrajectoryCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [lastNativeUpdate, setLastNativeUpdate] = useState<TmzArTrajectorySessionUpdate | null>(null);

  const detail = detailQuery.data ?? null;
  const launch = detail?.launchData ?? detail?.launch ?? null;
  const arTrajectory = detail?.arTrajectory ?? null;
  const canUseArTrajectory = entitlementsQuery.data?.capabilities.canUseArTrajectory ?? false;
  const isAuthed = entitlementsQuery.data?.isAuthed ?? false;

  const canOpenNativeAr =
    Platform.OS === 'ios' &&
    Boolean(launchId) &&
    canUseArTrajectory &&
    arTrajectory?.eligible === true &&
    arTrajectory?.hasTrajectory === true;

  const trajectoryQuery = useLaunchTrajectoryQuery(launchId, {
    enabled: canOpenNativeAr
  });

  const trajectory = trajectoryQuery.data ?? null;
  const trajectoryJson = useMemo(() => (trajectory ? JSON.stringify(trajectory) : null), [trajectory]);

  const sessionIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<string | null>(null);
  const lastNativeUpdateRef = useRef<TmzArTrajectorySessionUpdate | null>(null);
  const lastTelemetrySignatureRef = useRef<string | null>(null);
  const lastTelemetryUpdateAtRef = useRef<number>(0);
  const hasSentStartRef = useRef(false);
  const hasSentEndRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
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
    if (Platform.OS !== 'ios') {
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
        worldAlignment: 'gravity_and_heading',
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
      String(update.renderLoopRunning)
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
  } else if (Platform.OS !== 'ios') {
    content = <EmptyStateCard title="iPhone only" body="Native AR trajectory is only available on iPhone builds of the app." />;
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
        description="AR trajectory is a premium-only iPhone feature and stays locked until the account has premium access."
      >
        <ArButton
          label={isAuthed ? 'Open profile' : 'Sign in'}
          onPress={() => {
            router.push((isAuthed ? '/profile' : '/sign-in') as Href);
          }}
        />
      </SectionCard>
    );
  } else if (!arTrajectory.eligible) {
    content = (
      <EmptyStateCard
        title="Launch not eligible"
        body="This launch is outside the current AR-eligible program window, so native trajectory guidance is disabled."
      />
    );
  } else if (!arTrajectory.hasTrajectory) {
    content = <EmptyStateCard title="Trajectory pending" body="This launch is AR-eligible, but the native trajectory package has not been published yet." />;
  } else if (capabilityError) {
    content = <ErrorStateCard title="Capability check failed" body={capabilityError} />;
  } else if (!capabilities) {
    content = <LoadingStateCard title="Preparing native AR" body="Reading device capabilities and locking the AR session orientation." />;
  } else if (!capabilities.isSupported) {
    content = <EmptyStateCard title="Device unsupported" body="This iPhone does not support ARKit world tracking, so the native AR trajectory runtime cannot start." />;
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
            worldAlignment="gravity_and_heading"
            enableSceneDepth
            enableSceneReconstruction
            highResCaptureEnabled={false}
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
                ARKit world tracking with {capabilities.lidarAvailable ? 'LiDAR-aware occlusion' : 'camera-only guidance'} and premium trajectory overlays.
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
        </View>

        <SectionCard
          title="Session status"
          description={nativeError ?? buildSessionDescription(lastNativeUpdate, trajectory)}
          body={trajectory.generatedAt ? `Trajectory package generated ${formatTimestamp(trajectory.generatedAt)}.` : undefined}
          compact
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <StatusChip label={formatQualityLabel(trajectory.qualityState)} accent={trajectory.qualityState === 'precision'} />
            <StatusChip label={`Confidence ${trajectory.confidenceBadge}`} />
            <StatusChip label={lastNativeUpdate?.trackingState ?? 'starting'} />
            <StatusChip label={lastNativeUpdate?.occlusionMode ?? 'none'} />
          </View>
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
  trajectory: TrajectoryPublicV2ResponseV1
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

  return 'Native AR is initializing world tracking and aligning the launch trajectory shell.';
}
