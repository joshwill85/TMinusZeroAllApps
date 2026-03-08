'use client';

import { useEffect, useMemo, useState } from 'react';
import { Launch } from '@/lib/types/launch';
import { getTierRefreshSeconds } from '@/lib/tiers';
import { LaunchCard } from '@/components/LaunchCard';
import { SkeletonLaunchCard } from '@/components/SkeletonLaunchCard';

export function EmbeddedNextLaunchCard({
  token,
  initialLaunch,
  initialNowMs
}: {
  token: string;
  initialLaunch: Launch | null;
  initialNowMs: number;
}) {
  const [launch, setLaunch] = useState<Launch | null>(initialLaunch);
  const refreshIntervalMs = useMemo(() => getTierRefreshSeconds('premium') * 1000, []);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/embed/next-launch?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { launch?: Launch | null };
        if (cancelled) return;
        setLaunch(json.launch ?? null);
      } catch (err) {
        console.error('embed refresh error', err);
      }
    };

    void tick();
    const id = window.setInterval(tick, refreshIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshIntervalMs, token]);

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
