"use client";

import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { detectArClientProfile, getArClientProfilePolicy } from '@/lib/ar/clientProfile';

type Props = {
  href: string;
  launchId: string;
  className?: string;
  children: ReactNode;
};

function prefetchTrajectory(launchId: string, signal?: AbortSignal) {
  fetch(`/api/public/launches/${encodeURIComponent(launchId)}/trajectory`, { signal }).catch(() => null);
}

const AR_MOTION_PERMISSION_SESSION_KEY = 'ar:motionPermission';
type MotionRequestResult = 'granted' | 'denied' | 'unknown';

async function requestMotionPermissionIfNeeded(): Promise<MotionRequestResult> {
  if (typeof window === 'undefined') return 'unknown';
  const requestOrientationPermission = (window as any).DeviceOrientationEvent?.requestPermission;
  const requestMotionPermission = (window as any).DeviceMotionEvent?.requestPermission;
  if (typeof requestOrientationPermission !== 'function' && typeof requestMotionPermission !== 'function') return 'granted';
  try {
    const orientationResult = typeof requestOrientationPermission === 'function' ? await requestOrientationPermission() : 'granted';
    const motionResult = typeof requestMotionPermission === 'function' ? await requestMotionPermission() : 'granted';
    return orientationResult === 'granted' && motionResult === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unknown';
  }
}

export function CameraGuideButton({ href, launchId, className, children }: Props) {
  const router = useRouter();
  const warmedRef = useRef(false);
  const navigatingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    prefetchTrajectory(launchId, controller.signal);
    warmedRef.current = true;
    return () => controller.abort();
  }, [href, launchId, router]);

  return (
    <Link
      href={href}
      prefetch={false}
      onPointerDown={() => {
        if (!warmedRef.current) {
          prefetchTrajectory(launchId);
          warmedRef.current = true;
        }
      }}
      onClick={(event) => {
        if (navigatingRef.current) return;
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;

        // Fallback-first profiles (notably iOS WebKit) require the motion prompt
        // to be triggered by a direct user gesture before entering AR.
        event.preventDefault();
        navigatingRef.current = true;
        void (async () => {
          const profile = detectArClientProfile(typeof navigator !== 'undefined' ? navigator.userAgent : '');
          const policy = getArClientProfilePolicy(profile);
          if (policy.motionPermissionPreflight) {
            const permission = await requestMotionPermissionIfNeeded();
            if (permission !== 'unknown') {
              try {
                window.sessionStorage.setItem(AR_MOTION_PERMISSION_SESSION_KEY, permission);
              } catch {
                // ignore
              }
            }
          }
          router.push(href);
        })();
      }}
      className={className}
    >
      {children}
    </Link>
  );
}
