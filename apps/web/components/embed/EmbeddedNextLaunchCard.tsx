'use client';

import { useEffect, useState } from 'react';
import {
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS
} from '@tminuszero/domain';
import { Launch } from '@/lib/types/launch';
import { LaunchCard } from '@/components/LaunchCard';
import { SkeletonLaunchCard } from '@/components/SkeletonLaunchCard';

export function EmbeddedNextLaunchCard({
  token,
  initialLaunch,
  initialRecommendedIntervalSeconds,
  initialCadenceAnchorNet,
  initialNowMs
}: {
  token: string;
  initialLaunch: Launch | null;
  initialRecommendedIntervalSeconds: number;
  initialCadenceAnchorNet: string | null;
  initialNowMs: number;
}) {
  const [launch, setLaunch] = useState<Launch | null>(initialLaunch);
  const [scheduledRefreshIntervalSeconds, setScheduledRefreshIntervalSeconds] = useState<number>(initialRecommendedIntervalSeconds);
  const [cadenceAnchorNet, setCadenceAnchorNet] = useState<string | null>(initialCadenceAnchorNet);
  const refreshIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
    scheduledRefreshIntervalSeconds,
    PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS
  );

  useEffect(() => {
    setLaunch(initialLaunch);
    setScheduledRefreshIntervalSeconds(initialRecommendedIntervalSeconds);
    setCadenceAnchorNet(initialCadenceAnchorNet);
  }, [initialCadenceAnchorNet, initialLaunch, initialRecommendedIntervalSeconds]);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/embed/next-launch?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as {
          launch?: Launch | null;
          recommendedIntervalSeconds?: number;
          cadenceAnchorNet?: string | null;
        };
        if (cancelled) return;
        setLaunch(json.launch ?? null);
        setScheduledRefreshIntervalSeconds(
          getRecommendedLaunchRefreshIntervalSeconds(json.recommendedIntervalSeconds, PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS)
        );
        setCadenceAnchorNet(typeof json.cadenceAnchorNet === 'string' ? json.cadenceAnchorNet : null);
      } catch (err) {
        console.error('embed refresh error', err);
      }
    };

    const schedule = () => {
      if (cancelled) {
        return;
      }
      if (timeout != null) {
        window.clearTimeout(timeout);
        timeout = null;
      }

      const nextRefreshAt = getNextAdaptiveLaunchRefreshMs({
        nowMs: Date.now(),
        intervalSeconds: refreshIntervalSeconds,
        cadenceAnchorNet
      });

      timeout = window.setTimeout(() => {
        void tick();
        schedule();
      }, Math.max(0, nextRefreshAt - Date.now()));
    };

    schedule();
    return () => {
      cancelled = true;
      if (timeout != null) {
        window.clearTimeout(timeout);
      }
    };
  }, [cadenceAnchorNet, refreshIntervalSeconds, token]);

  return (
    <div className="mx-auto w-full max-w-lg p-3">
      {launch ? (
        <LaunchCard key={launch.id} launch={launch} isNext isAuthed={false} isPaid={false} initialNowMs={initialNowMs} />
      ) : (
        <SkeletonLaunchCard />
      )}
    </div>
  );
}
