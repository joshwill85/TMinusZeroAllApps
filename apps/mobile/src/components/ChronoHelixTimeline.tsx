import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { PanResponder, Pressable, Text, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { useReducedMotion } from '@/src/hooks/useReducedMotion';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export type ChronoHelixNode = {
  id: string;
  title: string;
  subtitle?: string | null;
  date: string | null;
  status: 'success' | 'failure' | 'upcoming';
  statusLabel?: string | null;
  vehicleName: string;
  actionLabel?: string;
  onPress?: () => void;
};

type ChronoHelixTimelineProps = {
  nodes: ChronoHelixNode[];
  vehicleLabel?: string;
  title?: string;
  description?: string;
  emptyMessage?: string;
  testID?: string;
};

const HELIX_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.78
} as const;

const ANGLE_STEP = Math.PI / 5;

const STATUS_META: Record<
  ChronoHelixNode['status'],
  {
    label: string;
    badgeBorder: string;
    badgeBackground: string;
    badgeText: string;
    dot: string;
  }
> = {
  success: {
    label: 'Success',
    badgeBorder: 'rgba(52, 211, 153, 0.24)',
    badgeBackground: 'rgba(52, 211, 153, 0.12)',
    badgeText: '#7ff0bc',
    dot: '#34d399'
  },
  failure: {
    label: 'Failure',
    badgeBorder: 'rgba(248, 113, 113, 0.24)',
    badgeBackground: 'rgba(248, 113, 113, 0.12)',
    badgeText: '#ff9d98',
    dot: '#f87171'
  },
  upcoming: {
    label: 'Upcoming',
    badgeBorder: 'rgba(34, 211, 238, 0.24)',
    badgeBackground: 'rgba(34, 211, 238, 0.12)',
    badgeText: '#6fe8ff',
    dot: '#22d3ee'
  }
};

export function ChronoHelixTimeline({
  nodes,
  vehicleLabel,
  title = 'Vehicle timeline',
  description,
  emptyMessage = 'No mission-linked flight records are currently available.',
  testID
}: ChronoHelixTimelineProps) {
  const { theme } = useMobileBootstrap();
  const reduceMotion = useReducedMotion();
  const sortedNodes = useMemo(
    () =>
      [...nodes].sort((a, b) => {
        const aTime = Date.parse(a.date || '');
        const bTime = Date.parse(b.date || '');
        return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
      }),
    [nodes]
  );
  const initialIndex = useMemo(() => resolveInitialIndex(sortedNodes), [sortedNodes]);
  const maxIndex = Math.max(0, sortedNodes.length - 1);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeIndexRef = useRef(initialIndex);
  const dragStartIndexRef = useRef(initialIndex);
  const focus = useSharedValue(initialIndex);
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  useEffect(() => {
    activeIndexRef.current = initialIndex;
    setActiveIndex(initialIndex);
    focus.value = initialIndex;
  }, [focus, initialIndex]);

  const radius = useMemo(() => clampValue(layout.width * 0.22 || 72, 60, 96), [layout.width]);
  const verticalStep = useMemo(() => clampValue(layout.height / 4.35 || 88, 76, 108), [layout.height]);

  const stepToIndex = useCallback(
    (nextIndex: number) => {
      const clamped = clampValue(nextIndex, 0, maxIndex);
      activeIndexRef.current = clamped;
      setActiveIndex(clamped);
      focus.value = reduceMotion ? clamped : withSpring(clamped, HELIX_SPRING);
    },
    [focus, maxIndex, reduceMotion]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          !reduceMotion &&
          sortedNodes.length > 1 &&
          Math.abs(gestureState.dy) > 6 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderGrant: () => {
          dragStartIndexRef.current = activeIndexRef.current;
          focus.value = activeIndexRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextValue = clampValue(dragStartIndexRef.current - gestureState.dy / verticalStep, 0, maxIndex);
          focus.value = nextValue;
          const rounded = clampValue(Math.round(nextValue), 0, maxIndex);
          if (rounded !== activeIndexRef.current) {
            activeIndexRef.current = rounded;
            setActiveIndex(rounded);
          }
        },
        onPanResponderRelease: () => {
          stepToIndex(Math.round(focus.value));
        },
        onPanResponderTerminate: () => {
          stepToIndex(Math.round(focus.value));
        }
      }),
    [focus, maxIndex, reduceMotion, sortedNodes.length, stepToIndex, verticalStep]
  );

  const activeNode = sortedNodes[activeIndex] || null;
  const activeVehicleLabel = activeNode?.vehicleName || vehicleLabel || 'Launch vehicle';
  const summaryText =
    description || `${sortedNodes.length} mission-linked flight record${sortedNodes.length === 1 ? '' : 's'} rendered on the helix.`;
  const ghostNote = useMemo(() => buildGhostNote(sortedNodes, activeIndex), [activeIndex, sortedNodes]);

  if (!sortedNodes.length) {
    return <CustomerShellPanel title={title} description={emptyMessage} testID={testID} />;
  }

  if (reduceMotion) {
    return (
      <CustomerShellPanel title={title} description={summaryText} testID={testID}>
        <View style={{ gap: 10 }}>
          {sortedNodes.map((node) => {
            const statusMeta = STATUS_META[node.status];
            const isActive = node.id === activeNode?.id;
            return (
              <Pressable
                key={node.id}
                accessibilityRole={node.onPress ? 'button' : 'text'}
                disabled={!node.onPress}
                onPress={node.onPress}
                style={({ pressed }) => ({
                  gap: 8,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: isActive ? `${theme.accent}80` : theme.stroke,
                  backgroundColor: pressed && node.onPress ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 14,
                  paddingVertical: 14
                })}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <Text style={{ flex: 1, color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{node.title}</Text>
                  <View
                    style={{
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: statusMeta.badgeBorder,
                      backgroundColor: statusMeta.badgeBackground,
                      paddingHorizontal: 10,
                      paddingVertical: 5
                    }}
                  >
                    <Text
                      style={{
                        color: statusMeta.badgeText,
                        fontSize: 10,
                        fontWeight: '700',
                        letterSpacing: 1,
                        textTransform: 'uppercase'
                      }}
                    >
                      {node.statusLabel || statusMeta.label}
                    </Text>
                  </View>
                </View>
                <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{formatFullDate(node.date)}</Text>
                {node.subtitle ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{node.subtitle}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </CustomerShellPanel>
    );
  }

  return (
    <CustomerShellPanel title={title} description={summaryText} testID={testID}>
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text
            style={{
              color: theme.muted,
              fontSize: 11,
              fontWeight: '700',
              letterSpacing: 1.2,
              textTransform: 'uppercase'
            }}
          >
            Chrono-Helix
          </Text>
          <Text style={{ color: theme.muted, fontSize: 12 }}>
            {activeIndex + 1} / {sortedNodes.length}
          </Text>
        </View>

        <View
          onLayout={(event: LayoutChangeEvent) => {
            const { width, height } = event.nativeEvent.layout;
            if (width !== layout.width || height !== layout.height) {
              setLayout({ width, height });
            }
          }}
          style={{
            height: 388,
            overflow: 'hidden',
            borderRadius: 24,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(7, 9, 19, 0.92)',
            position: 'relative'
          }}
          {...panResponder.panHandlers}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -64,
              right: -34,
              width: 180,
              height: 180,
              borderRadius: 999,
              backgroundColor: 'rgba(34, 211, 238, 0.1)'
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -28,
              bottom: -48,
              width: 160,
              height: 160,
              borderRadius: 999,
              backgroundColor: 'rgba(124, 92, 255, 0.1)'
            }}
          />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: '50%',
              top: 24,
              bottom: 24,
              width: 2,
              marginLeft: -1,
              backgroundColor: 'rgba(255, 255, 255, 0.07)'
            }}
          />

          {sortedNodes.map((node, index) => (
            <HelixNode
              key={node.id}
              node={node}
              index={index}
              activeIndex={activeIndex}
              focus={focus}
              radius={radius}
              verticalStep={verticalStep}
              onFocus={() => stepToIndex(index)}
            />
          ))}

          {ghostNote ? (
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                right: 18,
                top: 20,
                maxWidth: 164,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(10, 12, 24, 0.86)',
                paddingHorizontal: 12,
                paddingVertical: 10
              }}
            >
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 10,
                  fontWeight: '700',
                  letterSpacing: 1.1,
                  textTransform: 'uppercase'
                }}
              >
                Time thread
              </Text>
              <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700', lineHeight: 17, marginTop: 4 }}>{ghostNote}</Text>
            </View>
          ) : null}

          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 18,
              right: 18,
              bottom: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <Text style={{ color: theme.muted, fontSize: 11, letterSpacing: 0.6 }}>Swipe the helix or tap a node</Text>
            <Text
              style={{
                color: theme.muted,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 1.2,
                textTransform: 'uppercase'
              }}
            >
              Earlier above / later below
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            disabled={activeIndex <= 0}
            onPress={() => stepToIndex(activeIndex - 1)}
            style={({ pressed }) => ({
              minWidth: 104,
              alignItems: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: activeIndex <= 0 ? 'rgba(255, 255, 255, 0.08)' : theme.stroke,
              backgroundColor: activeIndex <= 0 ? 'rgba(255, 255, 255, 0.02)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
              opacity: activeIndex <= 0 ? 0.45 : 1,
              paddingHorizontal: 14,
              paddingVertical: 12
            })}
          >
            <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Earlier</Text>
          </Pressable>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              numberOfLines={1}
              style={{
                color: theme.foreground,
                fontSize: 14,
                fontWeight: '700',
                textAlign: 'center'
              }}
            >
              {activeNode?.title || 'Flight'}
            </Text>
            <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12, textAlign: 'center', marginTop: 2 }}>
              {activeVehicleLabel}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={activeIndex >= maxIndex}
            onPress={() => stepToIndex(activeIndex + 1)}
            style={({ pressed }) => ({
              minWidth: 104,
              alignItems: 'center',
              borderRadius: 999,
              borderWidth: 1,
              borderColor: activeIndex >= maxIndex ? 'rgba(255, 255, 255, 0.08)' : theme.stroke,
              backgroundColor: activeIndex >= maxIndex ? 'rgba(255, 255, 255, 0.02)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
              opacity: activeIndex >= maxIndex ? 0.45 : 1,
              paddingHorizontal: 14,
              paddingVertical: 12
            })}
          >
            <Text style={{ color: theme.foreground, fontSize: 12, fontWeight: '700' }}>Later</Text>
          </Pressable>
        </View>
      </View>
    </CustomerShellPanel>
  );
}

function HelixNode({
  node,
  index,
  activeIndex,
  focus,
  radius,
  verticalStep,
  onFocus
}: {
  node: ChronoHelixNode;
  index: number;
  activeIndex: number;
  focus: SharedValue<number>;
  radius: number;
  verticalStep: number;
  onFocus: () => void;
}) {
  const { theme } = useMobileBootstrap();
  const statusMeta = STATUS_META[node.status];
  const isActive = index === activeIndex;
  const isNeighbor = Math.abs(index - activeIndex) === 1;

  const animatedStyle = useAnimatedStyle(() => {
    const delta = index - focus.value;
    const theta = delta * ANGLE_STEP;
    const translateX = radius * Math.sin(theta);
    const translateY = delta * verticalStep;
    const opacity = clampValue(1 - Math.abs(delta) * 0.34, 0.16, 1);
    const scale = clampValue(1 - Math.abs(delta) * 0.18, 0.55, 1);

    return {
      opacity,
      zIndex: 1000 - Math.round(Math.abs(delta) * 20),
      transform: [{ translateX }, { translateY }, { scale }]
    };
  }, [focus, index, radius, verticalStep]);

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          alignItems: 'center'
        },
        animatedStyle
      ]}
    >
      <Pressable
        accessibilityRole={isActive && node.onPress ? 'button' : 'text'}
        onPress={onFocus}
        style={({ pressed }) => ({
          opacity: pressed ? 0.92 : 1
        })}
      >
        {isActive ? (
          <View
            style={{
              width: 228,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: `${theme.accent}66`,
              backgroundColor: 'rgba(10, 12, 24, 0.9)',
              paddingHorizontal: 16,
              paddingVertical: 14,
              shadowColor: '#000',
              shadowOpacity: 0.34,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 }
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: -6,
                right: -6,
                bottom: -6,
                left: -6,
                borderRadius: 26,
                borderWidth: 1,
                borderColor: 'rgba(34, 211, 238, 0.18)'
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text
                style={{
                  color: theme.muted,
                  fontSize: 10,
                  fontWeight: '700',
                  letterSpacing: 1.4,
                  textTransform: 'uppercase'
                }}
              >
                Focused flight
              </Text>
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: statusMeta.badgeBorder,
                  backgroundColor: statusMeta.badgeBackground,
                  paddingHorizontal: 10,
                  paddingVertical: 5
                }}
              >
                <Text
                  style={{
                    color: statusMeta.badgeText,
                    fontSize: 10,
                    fontWeight: '700',
                    letterSpacing: 1,
                    textTransform: 'uppercase'
                  }}
                >
                  {node.statusLabel || statusMeta.label}
                </Text>
              </View>
            </View>

            <Text style={{ color: theme.foreground, fontSize: 17, fontWeight: '800', lineHeight: 22, marginTop: 10 }}>{node.title}</Text>
            <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 6 }}>{formatFullDate(node.date)}</Text>
            {node.subtitle ? <Text style={{ color: theme.muted, fontSize: 12, lineHeight: 18, marginTop: 6 }}>{node.subtitle}</Text> : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: `${theme.accent}90`,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Text
                  style={{
                    color: theme.accent,
                    fontSize: 10,
                    fontWeight: '800',
                    letterSpacing: 0.6,
                    textTransform: 'uppercase'
                  }}
                >
                  T-
                </Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, color: theme.foreground, fontSize: 12, fontWeight: '700' }}>
                {node.vehicleName}
              </Text>
            </View>

            {node.onPress ? (
              <Pressable
                accessibilityRole="button"
                onPress={node.onPress}
                style={({ pressed }) => ({
                  marginTop: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: `${theme.accent}90`,
                  backgroundColor: pressed ? `${theme.accent}22` : `${theme.accent}14`,
                  paddingHorizontal: 14,
                  paddingVertical: 11
                })}
              >
                <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '800', textAlign: 'center' }}>
                  {node.actionLabel || 'Open flight'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : isNeighbor ? (
          <View
            style={{
              width: 158,
              borderRadius: 18,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(10, 12, 24, 0.82)',
              paddingHorizontal: 12,
              paddingVertical: 11
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{
                  flex: 1,
                  color: theme.foreground,
                  fontSize: 12,
                  fontWeight: '700'
                }}
              >
                {node.title}
              </Text>
              <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: statusMeta.dot }} />
            </View>
            <Text
              style={{
                color: theme.muted,
                fontSize: 11,
                fontWeight: '700',
                letterSpacing: 0.8,
                marginTop: 6,
                textTransform: 'uppercase'
              }}
            >
              {formatShortDate(node.date)}
            </Text>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 999, backgroundColor: statusMeta.dot }} />
            <Text
              style={{
                color: theme.muted,
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 1,
                textTransform: 'uppercase'
              }}
            >
              {formatShortDate(node.date)}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function resolveInitialIndex(nodes: ChronoHelixNode[]) {
  if (nodes.length === 0) return 0;
  const now = Date.now();
  const upcomingIndex = nodes.findIndex((node) => {
    const timestamp = Date.parse(node.date || '');
    return Number.isFinite(timestamp) && timestamp >= now;
  });
  return upcomingIndex >= 0 ? upcomingIndex : Math.max(0, nodes.length - 1);
}

function buildGhostNote(nodes: ChronoHelixNode[], activeIndex: number) {
  if (nodes.length < 2 || activeIndex <= 0) return null;
  const previousTime = Date.parse(nodes[activeIndex - 1]?.date || '');
  const currentTime = Date.parse(nodes[activeIndex]?.date || '');
  if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return null;

  const gapDays = Math.max(1, Math.round((currentTime - previousTime) / 86400000));
  const allGaps = nodes
    .slice(1)
    .map((node, index) => {
      const earlier = Date.parse(nodes[index]?.date || '');
      const later = Date.parse(node.date || '');
      if (!Number.isFinite(earlier) || !Number.isFinite(later)) return null;
      return Math.max(1, Math.round((later - earlier) / 86400000));
    })
    .filter((value): value is number => value != null);

  const shortestGap = allGaps.length ? Math.min(...allGaps) : null;
  if (shortestGap != null && gapDays === shortestGap) {
    return `Fastest turnaround: ${gapDays} day${gapDays === 1 ? '' : 's'}`;
  }
  if (gapDays <= 30) {
    return `Quick turnaround: ${gapDays} day${gapDays === 1 ? '' : 's'}`;
  }
  return null;
}

function formatFullDate(value: string | null | undefined) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'Date pending';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp));
}

function formatShortDate(value: string | null | undefined) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp));
}

function clampValue(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}
