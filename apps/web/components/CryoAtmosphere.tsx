'use client';

import { useEffect, useRef, useState } from 'react';

export type CryoStage = 'venting' | 'ignition';

export interface CryoAtmosphereProps {
  stage: CryoStage;
  intensity: number;
  width: number;
  height: number;
}

const MAX_PARTICLES = 160;
const BASE_SPAWN_RATE = 3;
const IGNITION_SPAWN_RATE = 6;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type ParticlePool = {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  alpha: Float32Array;
  size: Float32Array;
  growth: Float32Array;
  active: Uint8Array;
};

export function CryoAtmosphere({ stage, intensity, width, height }: CryoAtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const stageRef = useRef<CryoStage>(stage);
  const intensityRef = useRef<number>(intensity);
  const windRef = useRef(0);
  const windTargetRef = useRef(0);
  const pointerOverrideRef = useRef(false);
  const visibleRef = useRef(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    intensityRef.current = clamp(intensity, 0, 1);
  }, [intensity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const next = entries[0]?.isIntersecting ?? true;
      visibleRef.current = next;
      if (!next && rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setWindFromPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;

      const inside =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;

      if (!inside) {
        windTargetRef.current = 0;
        return false;
      }

      const relativeX = clamp((clientX - rect.left) / rect.width, 0, 1);
      windTargetRef.current = clamp((0.5 - relativeX) * 2, -1, 1);
      return true;
    };

    const resetPointerOverride = () => {
      pointerOverrideRef.current = false;
      windTargetRef.current = 0;
    };

    if (typeof window.PointerEvent !== 'undefined') {
      const handlePointerDown = (event: PointerEvent) => {
        if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
        pointerOverrideRef.current = setWindFromPoint(event.clientX, event.clientY);
      };

      const handlePointerMove = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
          if (!pointerOverrideRef.current) return;
        }
        setWindFromPoint(event.clientX, event.clientY);
      };

      const handlePointerEnd = (event: PointerEvent) => {
        if (event.pointerType === 'touch' || event.pointerType === 'pen') {
          resetPointerOverride();
        }
      };

      window.addEventListener('pointerdown', handlePointerDown, { passive: true });
      window.addEventListener('pointermove', handlePointerMove, { passive: true });
      window.addEventListener('pointerup', handlePointerEnd, { passive: true });
      window.addEventListener('pointercancel', handlePointerEnd, { passive: true });

      return () => {
        window.removeEventListener('pointerdown', handlePointerDown);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerEnd);
      };
    }

    const handleMouseMove = (event: MouseEvent) => {
      setWindFromPoint(event.clientX, event.clientY);
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      pointerOverrideRef.current = setWindFromPoint(touch.clientX, touch.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!pointerOverrideRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;
      setWindFromPoint(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = () => {
      if (pointerOverrideRef.current) resetPointerOverride();
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, []);

  useEffect(() => {
    if (disabled || reducedMotion) return;
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const fogSprite = createSprite([
      [0, 'rgba(255,255,255,0.35)'],
      [0.5, 'rgba(255,255,255,0.18)'],
      [1, 'rgba(255,255,255,0)']
    ]);
    const sparkSprite = createSprite([
      [0, 'rgba(255,214,120,0.75)'],
      [0.4, 'rgba(255,160,70,0.4)'],
      [1, 'rgba(255,90,20,0)']
    ]);

    const pool = createPool(MAX_PARTICLES);
    let cursor = 0;
    let lastTime = performance.now();
    let spawnAccumulator = 0;
    let lowFpsStart: number | null = null;

    const emitters = [
      { x: width * 0.48, y: height * 0.08, spread: width * 0.08 },
      { x: width * 0.52, y: height * 0.04, spread: width * 0.06 },
      { x: width * 0.5, y: height * 0.12, spread: width * 0.05 }
    ];

    const spawnParticle = (currentStage: CryoStage, strength: number) => {
      let attempts = 0;
      while (attempts < MAX_PARTICLES && pool.active[cursor] === 1) {
        cursor = (cursor + 1) % MAX_PARTICLES;
        attempts += 1;
      }
      if (pool.active[cursor] === 1) return;

      const emitter = emitters[Math.floor(Math.random() * emitters.length)];
      const spread = emitter.spread;
      pool.active[cursor] = 1;
      pool.x[cursor] = emitter.x + (Math.random() - 0.5) * spread;
      pool.y[cursor] = emitter.y + (Math.random() - 0.5) * spread * 0.2;

      if (currentStage === 'ignition') {
        pool.vx[cursor] = (Math.random() - 0.5) * 0.8;
        pool.vy[cursor] = -1.2 - Math.random() * (1.5 + strength);
        pool.size[cursor] = 6 + Math.random() * 8;
        pool.growth[cursor] = 0.02 + Math.random() * 0.04;
        pool.alpha[cursor] = 0.9;
      } else {
        pool.vx[cursor] = (Math.random() - 0.5) * 0.35;
        pool.vy[cursor] = 0.4 + Math.random() * (0.6 + strength * 0.3);
        pool.size[cursor] = 14 + Math.random() * 18;
        pool.growth[cursor] = 0.04 + Math.random() * 0.05;
        pool.alpha[cursor] = 0.55 + strength * 0.2;
      }

      cursor = (cursor + 1) % MAX_PARTICLES;
    };

    const frame = (now: number) => {
      if (!visibleRef.current) {
        rafRef.current = null;
        return;
      }

      const dt = Math.min(64, now - lastTime);
      lastTime = now;
      const fps = 1000 / dt;

      if (fps < 30) {
        if (lowFpsStart == null) lowFpsStart = now;
        if (now - lowFpsStart > 2000) {
          setDisabled(true);
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
          return;
        }
      } else {
        lowFpsStart = null;
      }

      const currentStage = stageRef.current;
      const strength = intensityRef.current;
      const windTarget = windTargetRef.current;
      windRef.current += (windTarget - windRef.current) * 0.06;

      spawnAccumulator += (currentStage === 'ignition' ? IGNITION_SPAWN_RATE : BASE_SPAWN_RATE) * strength * (dt / 16.67);
      while (spawnAccumulator >= 1) {
        spawnParticle(currentStage, strength);
        spawnAccumulator -= 1;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = currentStage === 'ignition' ? 'lighter' : 'source-over';

      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (pool.active[i] === 0) continue;

        if (currentStage === 'ignition') {
          pool.vy[i] -= 0.03 + strength * 0.08;
          pool.vx[i] += windRef.current * 0.04 + (Math.random() - 0.5) * 0.04;
          pool.alpha[i] -= 0.02 + strength * 0.01;
          pool.size[i] += pool.growth[i];
        } else {
          pool.vy[i] += 0.015 + strength * 0.03;
          pool.vx[i] += windRef.current * 0.02;
          pool.alpha[i] -= 0.006 + strength * 0.003;
          pool.size[i] += pool.growth[i];
        }

        pool.x[i] += pool.vx[i];
        pool.y[i] += pool.vy[i];

        if (
          pool.alpha[i] <= 0 ||
          pool.y[i] > height + 60 ||
          pool.x[i] < -60 ||
          pool.x[i] > width + 60
        ) {
          pool.active[i] = 0;
          continue;
        }

        ctx.globalAlpha = clamp(pool.alpha[i], 0, 1);
        const sprite = currentStage === 'ignition' ? sparkSprite : fogSprite;
        const size = pool.size[i];
        ctx.drawImage(sprite, pool.x[i] - size / 2, pool.y[i] - size / 2, size, size);
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [width, height, reducedMotion, disabled]);

  if (reducedMotion || disabled) {
    return <div className="cryo-static" aria-hidden="true" />;
  }

  return <canvas ref={canvasRef} className="cryo-canvas" aria-hidden="true" />;
}

function createSprite(stops: Array<[number, string]>) {
  const canvas = document.createElement('canvas');
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([stop, color]) => gradient.addColorStop(stop, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

function createPool(size: number): ParticlePool {
  return {
    x: new Float32Array(size),
    y: new Float32Array(size),
    vx: new Float32Array(size),
    vy: new Float32Array(size),
    alpha: new Float32Array(size),
    size: new Float32Array(size),
    growth: new Float32Array(size),
    active: new Uint8Array(size)
  };
}
