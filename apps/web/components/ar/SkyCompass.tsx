"use client";

import { useEffect, useRef } from 'react';
import {
  clamp,
  interpolateTrajectory,
  readTrajectoryPointCovariance,
  readTrajectoryPointSigmaDeg,
  type TrajectoryAzElPoint
} from '@/lib/ar/trajectory';
import type { TrajectoryMilestonePayload, TrajectoryTrackKind } from '@tminuszero/domain';

type Props = {
  points: TrajectoryAzElPoint[];
  trackPointsByKind: Partial<Record<TrajectoryTrackKind, TrajectoryAzElPoint[]>>;
  tSelectedSec: number;
  corridorMode: 'tight' | 'normal' | 'wide';
  events: TrajectoryMilestonePayload[];
  showMilestones: boolean;
  onLoopActiveChange?: (active: boolean) => void;
};

const DEG_TO_RAD = Math.PI / 180;

export function SkyCompass({
  points,
  trackPointsByKind,
  tSelectedSec,
  corridorMode,
  events,
  showMilestones,
  onLoopActiveChange
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ points, trackPointsByKind, tSelectedSec, corridorMode, events, showMilestones });

  useEffect(() => {
    stateRef.current.points = points;
    stateRef.current.trackPointsByKind = trackPointsByKind;
    stateRef.current.tSelectedSec = tSelectedSec;
    stateRef.current.corridorMode = corridorMode;
    stateRef.current.events = events;
    stateRef.current.showMilestones = showMilestones;
  }, [points, trackPointsByKind, tSelectedSec, corridorMode, events, showMilestones]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let timer = 0;
    let loopActive = false;
    const TARGET_FPS = 15;
    const FRAME_MS = Math.round(1000 / TARGET_FPS);
    const viewport = { width: 0, height: 0, dpr: 1, backingWidth: 0, backingHeight: 0 };

    const readViewport = () => {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const widthRaw = vv && typeof vv.width === 'number' ? vv.width : window.innerWidth;
      const heightRaw = vv && typeof vv.height === 'number' ? vv.height : window.innerHeight;
      const width = Math.max(1, Math.floor(Number(widthRaw) || 0));
      const height = Math.max(1, Math.floor(Number(heightRaw) || 0));
      const dprRaw =
        typeof window.devicePixelRatio === 'number' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
      const dpr = clamp(dprRaw, 1, 2);
      return { width, height, dpr };
    };

    const syncViewport = () => {
      const { width, height, dpr } = readViewport();
      const backingWidth = Math.max(1, Math.floor(width * dpr));
      const backingHeight = Math.max(1, Math.floor(height * dpr));

      viewport.width = width;
      viewport.height = height;
      viewport.dpr = dpr;
      viewport.backingWidth = backingWidth;
      viewport.backingHeight = backingHeight;

      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
    };

    syncViewport();

    const drawRoundedRectPath = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number
    ) => {
      const radius = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    };

    const rectsOverlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
      padding = 0
    ) =>
      a.x < b.x + b.w + padding &&
      a.x + a.w + padding > b.x &&
      a.y < b.y + b.h + padding &&
      a.y + a.h + padding > b.y;

    const draw = () => {
      const width = viewport.width || 1;
      const height = viewport.height || 1;
      const dpr = viewport.dpr || 1;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const {
        points: latestPoints,
        trackPointsByKind: latestTrackPointsByKind,
        tSelectedSec: latestT,
        corridorMode: latestCorridorMode,
        events: latestEvents,
        showMilestones: latestShowMilestones
      } = stateRef.current;
      const size = Math.min(width, height);
      const radius = size * 0.33;
      const cx = width / 2;
      const cy = height / 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const ring = (elevationDeg: number) => radius * (1 - clamp(elevationDeg, 0, 90) / 90);

      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      for (const el of [30, 60]) {
        ctx.beginPath();
        ctx.arc(cx, cy, ring(el), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', cx, cy - radius - 16);
      ctx.fillText('E', cx + radius + 16, cy);
      ctx.fillText('S', cx, cy + radius + 16);
      ctx.fillText('W', cx - radius - 16, cy);

      const toXY = (azDeg: number, elDeg: number) => {
        const r = ring(elDeg);
        const theta = (azDeg - 90) * DEG_TO_RAD;
        return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
      };

      const aim = latestPoints.length ? interpolateTrajectory(latestPoints, latestT) : null;
      const sigmaDegBase = readTrajectoryPointSigmaDeg(aim) ?? readTrajectoryPointSigmaDeg(latestPoints[0]) ?? 12;
      const covariance = readTrajectoryPointCovariance(aim) ?? readTrajectoryPointCovariance(latestPoints[0]) ?? null;
      const crossTrackSigmaDeg = covariance?.crossTrackDeg ?? sigmaDegBase;
      const alongTrackSigmaDeg = covariance?.alongTrackDeg ?? sigmaDegBase;
      const corridorScale = latestCorridorMode === 'tight' ? 0.6 : latestCorridorMode === 'wide' ? 1.6 : 1.0;
      const crossTrackSigmaDegScaled = crossTrackSigmaDeg * corridorScale;
      const anisotropyRatio = clamp(alongTrackSigmaDeg / Math.max(1, crossTrackSigmaDeg), 0.65, 2.4);

      if (latestPoints.length >= 2) {
        const aimRadiusPx = clamp((crossTrackSigmaDegScaled / 90) * radius * 2, 6, radius * 0.85);
        const pastLineWidth = clamp(1.7 + (anisotropyRatio - 1) * 0.35, 1.4, 2.8);
        const futureLineWidth = clamp(2.6 + (anisotropyRatio - 1) * 0.65, 2.2, 4.1);

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = aimRadiusPx;
        ctx.beginPath();
        for (let i = 0; i < latestPoints.length; i += 1) {
          const point = latestPoints[i];
          const { x, y } = toXY(point.azDeg, point.elDeg);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();

        const splitIndex = latestPoints.findIndex((p) => p.tPlusSec > latestT);

        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = pastLineWidth;
        ctx.beginPath();
        const pastEnd = splitIndex === -1 ? latestPoints.length : splitIndex;
        for (let i = 0; i < pastEnd; i += 1) {
          const point = latestPoints[i];
          const { x, y } = toXY(point.azDeg, point.elDeg);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (pastEnd > 1) ctx.stroke();

        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = futureLineWidth;
        ctx.setLineDash(anisotropyRatio >= 1.35 ? [8, 6] : []);
        ctx.beginPath();
        const futureStart = splitIndex === -1 ? latestPoints.length : splitIndex;
        for (let i = futureStart; i < latestPoints.length; i += 1) {
          const point = latestPoints[i];
          const { x, y } = toXY(point.azDeg, point.elDeg);
          if (i === futureStart) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (latestPoints.length - futureStart > 1) ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore();
      }

      if (latestShowMilestones && latestPoints.length >= 2 && latestEvents.length > 0) {
        const candidates = latestEvents
          .map((event) => {
            if (typeof event.tPlusSec !== 'number' || !Number.isFinite(event.tPlusSec) || !event.trackKind) return null;
            const eventPoints = latestTrackPointsByKind[event.trackKind] ?? [];
            if (eventPoints.length < 2) return null;
            const tMin = eventPoints[0].tPlusSec;
            const tMax = eventPoints[eventPoints.length - 1].tPlusSec;
            if (event.tPlusSec < tMin || event.tPlusSec > tMax) return null;
            const locationAtEvent = interpolateTrajectory(eventPoints, event.tPlusSec);
            if (!locationAtEvent) return null;
            const projected = toXY(locationAtEvent.azDeg, locationAtEvent.elDeg);

            const text = event.label.slice(0, 32);
            ctx.font = '11px sans-serif';
            const textW = Math.ceil(ctx.measureText(text).width);
            const padX = 8;
            const boxH = 22;
            const boxW = Math.max(56, textW + padX * 2);
            const side = projected.x < cx ? ('left' as const) : ('right' as const);
            const gap = 14;
            const boxXRaw = side === 'right' ? projected.x + gap : projected.x - gap - boxW;
            const marginX = 14;
            const boxX = clamp(boxXRaw, marginX, width - marginX - boxW);
            return {
              tPlusSec: event.tPlusSec,
              label: text,
              estimated: event.estimated === true,
              dotX: projected.x,
              dotY: projected.y,
              side,
              boxX,
              boxY: 0,
              boxW,
              boxH,
              padX
            };
          })
          .filter((item): item is NonNullable<typeof item> => item != null)
          .sort((a, b) => a.dotY - b.dotY);

        if (candidates.length > 0) {
          ctx.save();
          ctx.font = '11px sans-serif';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const topMargin = 16;
          let bottomMargin = Math.min(240, Math.max(120, Math.round(height * 0.32)));
          bottomMargin = Math.min(bottomMargin, Math.max(0, height - topMargin - 40));
          const maxLabelY = Math.max(topMargin, height - bottomMargin);

          const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
          const overlapPadding = 8;
          const offsets = [0, 22, -22, 44, -44, 66, -66, 88, -88];

          for (const item of candidates) {
            const yBase = clamp(item.dotY - item.boxH / 2, topMargin, maxLabelY - item.boxH);
            let y = yBase;

            for (const off of offsets) {
              const yTry = clamp(yBase + off, topMargin, maxLabelY - item.boxH);
              const rect = { x: item.boxX, y: yTry, w: item.boxW, h: item.boxH };
              if (!placed.some((p) => rectsOverlap(rect, p, overlapPadding))) {
                y = yTry;
                break;
              }
            }

            item.boxY = y;
            placed.push({ x: item.boxX, y, w: item.boxW, h: item.boxH });
          }

          for (const item of candidates) {
            const met = latestT >= item.tPlusSec;
            const elapsed = latestT - item.tPlusSec;
            const justMet = elapsed >= 0 && elapsed < 3;
            const justMetT = justMet ? elapsed / 3 : 0;
            const highlight = justMet ? 1 - justMetT : 0;

            const anchorX = item.side === 'right' ? item.boxX : item.boxX + item.boxW;
            const anchorY = item.boxY + item.boxH / 2;

            ctx.save();
            ctx.strokeStyle = met
              ? `rgba(255,255,255,${0.35 + highlight * 0.25})`
              : item.estimated
                ? 'rgba(250, 204, 21, 0.28)'
                : 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(item.dotX, item.dotY);
            ctx.lineTo(anchorX, anchorY);
            ctx.stroke();
            ctx.restore();

            if (justMet) {
              const ringR = 6 + justMetT * 16;
              ctx.save();
              ctx.strokeStyle = `rgba(255,255,255,${highlight * 0.7})`;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(item.dotX, item.dotY, ringR, 0, Math.PI * 2);
              ctx.stroke();
              ctx.restore();
            }

            ctx.save();
            ctx.shadowColor = met
              ? `rgba(255,255,255,${0.2 + highlight * 0.35})`
              : item.estimated
                ? 'rgba(250, 204, 21, 0.32)'
                : 'rgba(0,0,0,0)';
            ctx.shadowBlur = met ? 10 + highlight * 10 : 0;
            ctx.fillStyle = met ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
            ctx.beginPath();
            ctx.arc(item.dotX, item.dotY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.shadowColor = justMet ? `rgba(255,255,255,${highlight * 0.35})` : 'rgba(0,0,0,0)';
            ctx.shadowBlur = justMet ? 14 : 0;

            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.strokeStyle = met ? `rgba(255,255,255,${0.22 + highlight * 0.45})` : 'rgba(255,255,255,0.14)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            drawRoundedRectPath(ctx, item.boxX, item.boxY, item.boxW, item.boxH, 8);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = met ? `rgba(255,255,255,${0.9 + highlight * 0.1})` : 'rgba(255,255,255,0.82)';
            ctx.fillText(item.label, item.boxX + item.padX, item.boxY + item.boxH / 2);
            ctx.restore();
          }

          ctx.restore();
        }
      }

      if (aim) {
        const { x, y } = toXY(aim.azDeg, aim.elDeg);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '11px sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const label = `T+${Math.round(latestT)}s`;
        ctx.strokeText(label, x, y - 16);
        ctx.fillText(label, x, y - 16);
      }

    };

    const stop = () => {
      if (timer) window.clearTimeout(timer);
      timer = 0;
      if (loopActive) {
        loopActive = false;
        onLoopActiveChange?.(false);
      }
    };

    const tick = () => {
      timer = 0;
      if (document.visibilityState !== 'visible') return;
      draw();
      timer = window.setTimeout(tick, FRAME_MS);
    };

    const start = () => {
      if (timer) return;
      if (!loopActive) {
        loopActive = true;
        onLoopActiveChange?.(true);
      }
      timer = window.setTimeout(tick, 0);
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') stop();
      else start();
    };

    const handleResize = () => {
      syncViewport();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
      window.visualViewport.addEventListener('resize', handleResize);
      window.visualViewport.addEventListener('scroll', handleResize);
    }
    handleVisibility();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (window.visualViewport && typeof window.visualViewport.removeEventListener === 'function') {
        window.visualViewport.removeEventListener('resize', handleResize);
        window.visualViewport.removeEventListener('scroll', handleResize);
      }
      stop();
    };
  }, [onLoopActiveChange]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
