'use client';

import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; z: number; pz: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createStar(cx: number, cy: number, depth: number): Star {
  const x = (Math.random() * 2 - 1) * cx;
  const y = (Math.random() * 2 - 1) * cy;
  const z = Math.random() * (depth - 2) + 2;
  return { x, y, z, pz: z };
}

function desiredStarCount(width: number, height: number) {
  const count = Math.round((width * height) / 6500);
  return clamp(count, 90, 420);
}

export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const context: CanvasRenderingContext2D = ctx;

    const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let reducedMotion = Boolean(mediaQuery?.matches);

    let animationId: number | null = null;
    let stars: Star[] = [];
    let width = 0;
    let height = 0;
    let dpr = 1;
    let cx = 0;
    let cy = 0;
    let depth = 0;
    let fov = 0;

    let lastScrollY = window.scrollY;
    let lastTime = performance.now();
    let velocityPxPerSec = 0;
    let warpSpeed = 0;
    let lastMotionAt = lastTime;
    let parallaxTargetX = 0;
    let parallaxTargetY = 0;
    let parallaxX = 0;
    let parallaxY = 0;

    function resetStars() {
      const count = desiredStarCount(width, height);
      stars = Array.from({ length: count }, () => createStar(cx, cy, depth));
    }

    function resize() {
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      canvasEl.width = Math.floor(width * dpr);
      canvasEl.height = Math.floor(height * dpr);
      canvasEl.style.width = `${width}px`;
      canvasEl.style.height = `${height}px`;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = width / 2;
      cy = height / 2;
      depth = Math.max(width, height) * 1.15;
      fov = Math.min(width, height) * 0.62;
      resetStars();
      drawFrame(0);
    }

    function updateStars(speedPerSec: number, dtSec: number) {
      for (const s of stars) {
        s.pz = s.z;
        s.z -= speedPerSec * dtSec;

        if (s.z < 2) {
          const next = createStar(cx, cy, depth);
          s.x = next.x;
          s.y = next.y;
          s.z = depth;
          s.pz = s.z;
        }
      }
    }

    function drawFrame(warp: number) {
      context.clearRect(0, 0, width, height);

      const showStreaks = warp > 0.18 && !reducedMotion;
      const streakAlpha = 0.14 + warp * 0.62;
      const pointAlpha = 0.18 + warp * 0.28;

      context.lineCap = 'round';
      context.lineJoin = 'round';

      const vx = cx + parallaxX * 28;
      const vy = cy + parallaxY * 22 - warp * 12;

      for (const s of stars) {
        const z = Math.max(2, s.z);
        const pz = Math.max(2, s.pz);

        const x1 = (s.x / pz) * fov + vx;
        const y1 = (s.y / pz) * fov + vy;
        const x2 = (s.x / z) * fov + vx;
        const y2 = (s.y / z) * fov + vy;

        if (x2 < -40 || x2 > width + 40 || y2 < -40 || y2 > height + 40) continue;

        const depthGlow = 1 - z / depth;
        const size = clamp(0.8 + depthGlow * 1.8 + warp * 0.8, 0.8, 3.2);
        const alpha = clamp(pointAlpha + depthGlow * 0.55, 0.08, 0.95);

        if (showStreaks) {
          context.strokeStyle = `rgba(255,255,255,${clamp(streakAlpha + depthGlow * 0.5, 0.08, 0.98)})`;
          context.lineWidth = size;
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          context.stroke();
        } else {
          context.fillStyle = `rgba(255,255,255,${alpha})`;
          context.fillRect(Math.round(x2), Math.round(y2), Math.round(size), Math.round(size));
        }
      }
    }

    function stop() {
      if (animationId != null) cancelAnimationFrame(animationId);
      animationId = null;
    }

    function start() {
      if (animationId != null || reducedMotion) return;
      lastTime = performance.now();
      lastMotionAt = lastTime;
      animationId = requestAnimationFrame(tick);
    }

    function tick(now: number) {
      const dtMs = clamp(now - lastTime, 12, 48);
      lastTime = now;

      const scrollY = window.scrollY;
      const rawVelocity = ((scrollY - lastScrollY) / dtMs) * 1000; // px/s
      lastScrollY = scrollY;

      velocityPxPerSec = velocityPxPerSec * 0.82 + Math.abs(rawVelocity) * 0.18;

      const warp = clamp(velocityPxPerSec / 1900, 0, 1);

      const targetSpeed = warp * 980;
      warpSpeed = warpSpeed * 0.86 + targetSpeed * 0.14;

      parallaxX = parallaxX * 0.9 + parallaxTargetX * 0.1;
      parallaxY = parallaxY * 0.9 + parallaxTargetY * 0.1;

      if (warp > 0.02) lastMotionAt = now;

      if (warpSpeed > 0.2) updateStars(warpSpeed, dtMs / 1000);
      drawFrame(warp);

      if (warp < 0.008 && warpSpeed < 2.2 && now - lastMotionAt > 220) {
        drawFrame(0);
        stop();
        return;
      }

      animationId = requestAnimationFrame(tick);
    }

    function drawStatic() {
      stop();
      drawFrame(0);
    }

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const onMotionChange = () => {
      reducedMotion = Boolean(mediaQuery?.matches);
      if (reducedMotion) drawStatic();
      else start();
    };

    const onPointer = (e: PointerEvent) => {
      const nx = width ? (e.clientX - width / 2) / (width / 2) : 0;
      const ny = height ? (e.clientY - height / 2) / (height / 2) : 0;
      parallaxTargetX = clamp(nx, -1, 1);
      parallaxTargetY = clamp(ny, -1, 1);
    };

    const onScroll = () => {
      if (!reducedMotion) start();
    };

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    mediaQuery?.addEventListener?.('change', onMotionChange);

    resize();
    if (!reducedMotion) start();

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      mediaQuery?.removeEventListener?.('change', onMotionChange);
    };
  }, []);

  return (
    <div className="starfield" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
