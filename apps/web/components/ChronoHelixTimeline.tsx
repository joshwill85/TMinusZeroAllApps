'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import { useHydrated } from '@/lib/hooks/useHydrated';
import clsx from 'clsx';
import { motion, useMotionValue, useSpring, useReducedMotion, useMotionValueEvent, useTransform } from 'framer-motion';
import type { MotionValue } from 'framer-motion';

export type TimelineNode = {
  id: string;
  date: string;
  status: 'success' | 'failure' | 'upcoming';
  vehicleName: string;
  missionName: string;
  isCurrent: boolean;
  statusLabel?: string;
  href?: string | null;
};

type ChronoHelixTimelineProps = {
  nodes: TimelineNode[];
  initialLaunchId: string;
  vehicleLabel?: string;
  vehicleHref?: string;
  initialNowMs?: number;
};

const PERSPECTIVE = 1000;
const ANGLE_STEP = Math.PI / 5;

const STATUS_META: Record<TimelineNode['status'], { label: string; tone: string; dot: string }> = {
  success: {
    label: 'Success',
    tone: 'border-success/40 text-success bg-success/10',
    dot: 'bg-success'
  },
  failure: {
    label: 'Failure',
    tone: 'border-danger/40 text-danger bg-danger/10',
    dot: 'bg-danger'
  },
  upcoming: {
    label: 'Upcoming',
    tone: 'border-primary/40 text-primary bg-primary/10',
    dot: 'bg-primary'
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const quantize = (value: number, decimals = 6) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

function useElementSize<T extends HTMLElement>(ref: RefObject<T>) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function ChronoHelixTimeline({
  nodes,
  initialLaunchId,
  vehicleLabel,
  vehicleHref,
  initialNowMs
}: ChronoHelixTimelineProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const reducedMotion = useReducedMotion();
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
    });
  }, [nodes]);

  const initialIndex = useMemo(() => {
    const byId = sortedNodes.findIndex((node) => node.id === initialLaunchId);
    if (byId >= 0) return byId;
    const byCurrent = sortedNodes.findIndex((node) => node.isCurrent);
    if (byCurrent >= 0) return byCurrent;
    const now = typeof initialNowMs === 'number' && Number.isFinite(initialNowMs) ? initialNowMs : Date.now();
    const upcoming = sortedNodes.findIndex((node) => new Date(node.date).getTime() >= now);
    return upcoming >= 0 ? upcoming : Math.max(0, sortedNodes.length - 1);
  }, [sortedNodes, initialLaunchId, initialNowMs]);
  const maxIndex = Math.max(0, sortedNodes.length - 1);

  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const vehicleText = useMemo(
    () => vehicleLabel || sortedNodes[activeIndex]?.vehicleName || 'Launch vehicle',
    [activeIndex, sortedNodes, vehicleLabel]
  );

  const dateLocale = hydrated ? undefined : 'en-US';
  const dateTimeZone = hydrated ? undefined : 'UTC';
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        ...(dateTimeZone ? { timeZone: dateTimeZone } : {})
      }),
    [dateLocale, dateTimeZone]
  );
  const shortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(dateLocale, {
        month: 'short',
        day: 'numeric',
        ...(dateTimeZone ? { timeZone: dateTimeZone } : {})
      }),
    [dateLocale, dateTimeZone]
  );
  const formatDateLabel = useCallback(
    (iso: string) => {
      if (!iso) return 'TBD';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return 'TBD';
      return dateFormatter.format(date);
    },
    [dateFormatter]
  );
  const formatShortDateLabel = useCallback(
    (iso: string) => {
      if (!iso) return 'TBD';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return 'TBD';
      return shortDateFormatter.format(date);
    },
    [shortDateFormatter]
  );
  const activeIndexRef = useRef(activeIndex);
  const targetIndex = useMotionValue(initialIndex);
  const activeSpring = useSpring(targetIndex, { stiffness: 240, damping: 32, mass: 0.7 });

  useEffect(() => {
    setActiveIndex(initialIndex);
    activeIndexRef.current = initialIndex;
    targetIndex.set(initialIndex);
  }, [initialIndex, targetIndex]);

  useMotionValueEvent(activeSpring, 'change', (latest) => {
    const rounded = clamp(Math.round(latest), 0, maxIndex);
    if (rounded !== activeIndexRef.current) {
      activeIndexRef.current = rounded;
      setActiveIndex(rounded);
    }
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const radius = useMemo(() => {
    if (!size.width) return 210;
    return clamp(size.width * 0.35, 140, 280);
  }, [size.width]);
  const verticalStep = useMemo(() => {
    if (!size.height) return 82;
    return clamp(size.height / 5.2, 90, 140);
  }, [size.height]);

  const clampIndex = useCallback(
    (value: number) => clamp(value, 0, Math.max(0, sortedNodes.length - 1)),
    [sortedNodes.length]
  );

  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({ startY: 0, startIndex: 0 });
  const dragMovedRef = useRef(false);
  const wheelTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapToNearest = useCallback(() => {
    const snapped = clampIndex(Math.round(targetIndex.get()));
    targetIndex.set(snapped);
  }, [clampIndex, targetIndex]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      dragMovedRef.current = false;
      dragState.current = { startY: event.clientY, startIndex: targetIndex.get() };
    },
    [reducedMotion, targetIndex]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || reducedMotion) return;
      const deltaY = event.clientY - dragState.current.startY;
      if (Math.abs(deltaY) > 6) {
        dragMovedRef.current = true;
      }
      const nextIndex = clampIndex(dragState.current.startIndex - deltaY / verticalStep);
      targetIndex.set(nextIndex);
    },
    [clampIndex, isDragging, reducedMotion, targetIndex, verticalStep]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (reducedMotion) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setIsDragging(false);
      snapToNearest();
      if (dragMovedRef.current) {
        requestAnimationFrame(() => {
          dragMovedRef.current = false;
        });
      }
    },
    [reducedMotion, snapToNearest]
  );

  const applyWheelDelta = useCallback(
    (deltaY: number) => {
      const nextIndex = clampIndex(targetIndex.get() + deltaY / verticalStep);
      targetIndex.set(nextIndex);
      if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
      wheelTimeout.current = setTimeout(snapToNearest, 120);
    },
    [clampIndex, snapToNearest, targetIndex, verticalStep]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        targetIndex.set(clampIndex(Math.round(targetIndex.get()) - 1));
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        targetIndex.set(clampIndex(Math.round(targetIndex.get()) + 1));
      }
    },
    [clampIndex, targetIndex]
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (reducedMotion || event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      applyWheelDelta(event.deltaY);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [applyWheelDelta, reducedMotion]);

  const handleNodeActivate = useCallback(
    (node: TimelineNode, index: number) => {
      if (isDragging || dragMovedRef.current) return;
      if (node.href) {
        router.push(node.href);
        return;
      }
      if (node.id && node.id !== initialLaunchId) {
        router.push(buildLaunchHref({ id: node.id, name: node.missionName }));
        return;
      }
      targetIndex.set(clampIndex(index));
      snapToNearest();
    },
    [clampIndex, initialLaunchId, isDragging, router, snapToNearest, targetIndex]
  );

  const threadPath = useRef('');
  const [threadPathState, setThreadPathState] = useState('');
  const threadRaf = useRef<number | null>(null);

  const updateThreadPath = useCallback(
    (focusIndex: number) => {
      if (!size.width || !size.height || sortedNodes.length < 2) return '';
      const visibleRange = Math.ceil(size.height / verticalStep) + 3;
      const points: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < sortedNodes.length; i += 1) {
        const delta = i - focusIndex;
        if (Math.abs(delta) > visibleRange) continue;
        const theta = delta * ANGLE_STEP;
        const x = radius * Math.sin(theta);
        const y = delta * verticalStep;
        const z = radius * Math.cos(theta) - radius - radius * 0.35;
        const scale = PERSPECTIVE / (PERSPECTIVE - z);
        points.push({
          x: size.width / 2 + x * scale,
          y: size.height / 2 + y * scale
        });
      }

      const nextPath = buildBezierPath(points);
      if (nextPath && nextPath !== threadPath.current) {
        threadPath.current = nextPath;
        setThreadPathState(nextPath);
      }
    },
    [radius, size.height, size.width, sortedNodes.length, verticalStep]
  );

  useEffect(() => {
    if (reducedMotion) return;
    updateThreadPath(activeSpring.get());
  }, [activeSpring, reducedMotion, updateThreadPath]);

  useMotionValueEvent(activeSpring, 'change', (latest) => {
    if (reducedMotion) return;
    if (threadRaf.current != null) return;
    threadRaf.current = requestAnimationFrame(() => {
      threadRaf.current = null;
      updateThreadPath(latest);
    });
  });

  useEffect(() => {
    return () => {
      if (threadRaf.current != null) cancelAnimationFrame(threadRaf.current);
      if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
    };
  }, []);

  const ghostNote = useMemo(() => {
    if (sortedNodes.length < 2) return null;
    if (activeIndex <= 0) return null;
    const previous = sortedNodes[activeIndex - 1];
    const current = sortedNodes[activeIndex];
    if (!previous || !current) return null;
    const prevTime = new Date(previous.date).getTime();
    const currentTime = new Date(current.date).getTime();
    if (Number.isNaN(prevTime) || Number.isNaN(currentTime)) return null;
    const deltaDays = Math.max(1, Math.round((currentTime - prevTime) / (1000 * 60 * 60 * 24)));

    const gaps: number[] = [];
    for (let i = 1; i < sortedNodes.length; i += 1) {
      const a = new Date(sortedNodes[i - 1].date).getTime();
      const b = new Date(sortedNodes[i].date).getTime();
      if (!Number.isNaN(a) && !Number.isNaN(b)) {
        gaps.push(Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24))));
      }
    }
    const minGap = gaps.length > 0 ? Math.min(...gaps) : null;

    if (minGap != null && deltaDays === minGap) {
      return `Fastest turnaround: ${deltaDays} days`;
    }
    if (deltaDays <= 30) {
      return `Quick turnaround: ${deltaDays} days`;
    }
    return null;
  }, [activeIndex, sortedNodes]);

  if (!sortedNodes.length) return null;

  return (
    <div className="rounded-2xl border border-stroke bg-surface-1 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.08em] text-text3">Chrono-Helix</div>
          <h2 className="text-xl font-semibold text-text1">Vehicle timeline</h2>
          <p className="text-sm text-text2">
            {vehicleHref ? (
              <Link href={vehicleHref} className="transition hover:text-primary">
                {vehicleText}
              </Link>
            ) : (
              vehicleText
            )}{' '}
            launches across time.
          </p>
        </div>
        <div className="text-xs text-text3">Drag, scroll, or use arrow keys.</div>
      </div>

      {reducedMotion ? (
        <div role="list" className="mt-4 space-y-3">
          {sortedNodes.map((node, index) => {
            const statusMeta = STATUS_META[node.status];
            const isActive = node.id === initialLaunchId || node.isCurrent;
            const missionLabel = node.missionName || 'Launch';
            return (
              <button
                key={node.id}
                type="button"
                role="listitem"
                aria-current={isActive ? 'step' : undefined}
                onClick={() => handleNodeActivate(node, index)}
                title={isActive ? missionLabel : `View ${missionLabel} details`}
                className={clsx(
                  'w-full rounded-xl border p-3 text-left',
                  isActive ? 'border-primary/60 bg-[rgba(34,211,238,0.08)]' : 'border-stroke bg-surface-0'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-text1">{missionLabel}</div>
                  <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] uppercase', statusMeta.tone)}>
                    {node.statusLabel || statusMeta.label}
                  </span>
                </div>
                <div className="mt-1 text-xs text-text3">
                  {formatDateLabel(node.date)} - {node.vehicleName}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="relative mt-4 h-[420px] touch-none overscroll-contain overflow-hidden rounded-2xl border border-stroke bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.08),_transparent_65%)] md:h-[520px]"
          style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: 'center' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="region"
          aria-label="Chrono-Helix launch timeline"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom,_rgba(124,92,255,0.12),_transparent_55%)]" />
          <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
            {threadPathState && (
              <svg
                className="pointer-events-none absolute inset-0"
                viewBox={`0 0 ${Math.max(size.width, 1)} ${Math.max(size.height, 1)}`}
                preserveAspectRatio="none"
                style={{ transform: `translateZ(${-radius * 0.45}px)` }}
              >
                <path
                  d={threadPathState}
                  fill="none"
                  stroke="rgba(124, 92, 255, 0.35)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d={threadPathState}
                  fill="none"
                  stroke="rgba(34, 211, 238, 0.35)"
                  strokeWidth="1"
                  strokeDasharray="6 10"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>

          <div
            className="absolute inset-0"
            style={{ transformStyle: 'preserve-3d' }}
            role="list"
            aria-label="Launches"
          >
            {sortedNodes.map((node, index) => (
              <LaunchNode
                key={node.id}
                node={node}
                index={index}
                activeIndex={activeIndex}
                activeSpring={activeSpring}
                radius={radius}
                verticalStep={verticalStep}
                isCurrentLaunch={node.id === initialLaunchId}
                onActivate={handleNodeActivate}
                formatDateLabel={formatDateLabel}
                formatShortDateLabel={formatShortDateLabel}
              />
            ))}
          </div>

          {ghostNote && (
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 max-w-[220px] rounded-lg border border-stroke bg-[rgba(7,9,19,0.85)] px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-text2 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
              style={{
                transform: `translate3d(${radius * 0.55}px, ${-verticalStep * 0.75}px, ${-radius * 0.4}px)`
              }}
            >
              {ghostNote}
            </div>
          )}

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-[0.2em] text-text4">
            Past below / Future above
          </div>
        </div>
      )}
    </div>
  );
}

function LaunchNode({
  node,
  index,
  activeIndex,
  activeSpring,
  radius,
  verticalStep,
  isCurrentLaunch,
  onActivate,
  formatDateLabel,
  formatShortDateLabel
}: {
  node: TimelineNode;
  index: number;
  activeIndex: number;
  activeSpring: MotionValue<number>;
  radius: number;
  verticalStep: number;
  isCurrentLaunch: boolean;
  onActivate: (node: TimelineNode, index: number) => void;
  formatDateLabel: (iso: string) => string;
  formatShortDateLabel: (iso: string) => string;
}) {
  const delta = useTransform(activeSpring, (latest) => index - latest);
  const x = useTransform(delta, (value) => quantize(radius * Math.sin(value * ANGLE_STEP)));
  const y = useTransform(delta, (value) => quantize(value * verticalStep));
  const z = useTransform(delta, (value) => quantize(radius * Math.cos(value * ANGLE_STEP) - radius));
  const opacity = useTransform(delta, (value) => quantize(clamp(1 - Math.abs(value) * 0.35, 0.18, 1), 3));
  const scale = useTransform(delta, (value) => quantize(clamp(1 - Math.abs(value) * 0.18, 0.55, 1), 3));
  const blur = useTransform(z, (value) => quantize(clamp(Math.abs(value) / 140, 0, 8)));
  const filter = useTransform(blur, (value) => `blur(${quantize(value)}px)`);
  const zIndex = useTransform(delta, (value) => 1000 - Math.round(Math.abs(value) * 20));

  const statusMeta = STATUS_META[node.status];
  const isActive = index === activeIndex;
  const isNeighbor = Math.abs(index - activeIndex) === 1;
  const missionLabel = node.missionName || 'Launch';

  return (
    <motion.div
      role="listitem"
      aria-current={isActive ? 'step' : undefined}
      suppressHydrationWarning
      className="absolute left-1/2 top-1/2"
      style={{
        x,
        y,
        z,
        opacity,
        scale,
        filter,
        zIndex
      }}
    >
      <button
        type="button"
        onClick={() => onActivate(node, index)}
        title={isCurrentLaunch ? missionLabel : `View ${missionLabel} details`}
        className={clsx('relative', isCurrentLaunch ? 'cursor-default' : 'cursor-pointer')}
      >
        <div className="-translate-x-1/2 -translate-y-1/2 transform">
          {isActive ? (
            <div className="relative w-[220px] rounded-2xl border border-stroke bg-[rgba(11,16,35,0.85)] px-4 py-3 text-left shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
              <div className="absolute -inset-2 rounded-[22px] border border-primary/40 shadow-[0_0_22px_rgba(34,211,238,0.28)]" />
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-text3">
                <span>{node.isCurrent ? 'Current launch' : 'Focused launch'}</span>
                <span className={clsx('rounded-full border px-2 py-0.5', statusMeta.tone)}>
                  {node.statusLabel || statusMeta.label}
                </span>
              </div>
              <div className="mt-2 text-base font-semibold text-text1">{node.missionName || 'Launch'}</div>
              <div className="mt-1 text-xs text-text2">{formatDateLabel(node.date)}</div>
              <div className="mt-2 flex items-center gap-2 text-xs text-text3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/60 text-[9px] uppercase text-primary">
                  T-
                </span>
                <span className="truncate">{node.vehicleName}</span>
              </div>
            </div>
          ) : isNeighbor ? (
            <div className="w-[160px] rounded-xl border border-stroke bg-[rgba(7,9,19,0.82)] px-3 py-2 text-left">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-text3">
                <span>{node.statusLabel || statusMeta.label}</span>
                <span className={clsx('h-2 w-2 rounded-full', statusMeta.dot)} />
              </div>
              <div className="mt-1 text-xs font-semibold text-text1">{formatDateLabel(node.date)}</div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className={clsx('h-2.5 w-2.5 rounded-full', statusMeta.dot)} />
              <span className="text-[10px] uppercase tracking-[0.2em] text-text4">
                {formatShortDateLabel(node.date)}
              </span>
            </div>
          )}
        </div>
      </button>
    </motion.div>
  );
}

function buildBezierPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return '';
  const segments: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segments.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }
  return segments.join(' ');
}
