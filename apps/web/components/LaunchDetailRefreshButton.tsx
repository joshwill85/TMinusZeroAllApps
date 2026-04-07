'use client';

import { useMemo, useState, useTransition } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  buildDetailVersionToken,
  getNextAdaptiveLaunchRefreshMs,
  getRecommendedLaunchRefreshIntervalSeconds,
  getTierRefreshSeconds,
  hasVersionChanged,
  PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
  tierToMode,
  type ViewerTier
} from '@tminuszero/domain';
import { fetchLaunchDetailVersion } from '@/lib/api/queries';
import { useToast } from '@/components/ToastProvider';

type LaunchDetailRefreshButtonProps = {
  tier: ViewerTier;
  launchId: string;
  lastUpdated?: string | null;
  initialVersion?: string | null;
  className?: string;
};

export function LaunchDetailRefreshButton({
  tier,
  launchId,
  lastUpdated,
  initialVersion,
  className
}: LaunchDetailRefreshButtonProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [checking, setChecking] = useState(false);
  const [isPending, startTransition] = useTransition();
  const scope = tierToMode(tier);
  const fallbackRefreshIntervalSeconds =
    tier === 'premium' ? PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS : getTierRefreshSeconds(tier);
  const currentVersion = useMemo(
    () => initialVersion ?? buildDetailVersionToken(launchId, scope, lastUpdated ?? null),
    [initialVersion, launchId, lastUpdated, scope]
  );
  const busy = checking || isPending;

  const handleRefresh = async () => {
    if (!launchId || busy) {
      return;
    }

    setChecking(true);
    try {
      const payload = await fetchLaunchDetailVersion(queryClient, launchId, { scope });
      const recommendedIntervalSeconds = getRecommendedLaunchRefreshIntervalSeconds(
        payload.recommendedIntervalSeconds,
        fallbackRefreshIntervalSeconds
      );
      const nextVersion =
        typeof payload.version === 'string'
          ? payload.version
          : buildDetailVersionToken(launchId, scope, payload.updatedAt ?? null);

      if (!hasVersionChanged(currentVersion, nextVersion)) {
        pushToast({
          message:
            scope === 'live'
              ? `Launch detail is up to date. Next live check around ${formatRefreshTime(
                  getNextAdaptiveLaunchRefreshMs({
                    nowMs: Date.now(),
                    intervalSeconds: recommendedIntervalSeconds,
                    cadenceAnchorNet: typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null
                  }),
                  tier === 'premium' && recommendedIntervalSeconds < 60
                )}.`
              : `Launch detail is up to date. Next public refresh around ${formatRefreshTime(
                  getNextAdaptiveLaunchRefreshMs({
                    nowMs: Date.now(),
                    intervalSeconds: recommendedIntervalSeconds,
                    cadenceAnchorNet: typeof payload.cadenceAnchorNet === 'string' ? payload.cadenceAnchorNet : null
                  }),
                  false
                )}.`
        });
        return;
      }

      startTransition(() => {
        router.refresh();
      });
      pushToast({ message: 'Launch detail updated.', tone: 'success' });
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? Number((error as { status?: number }).status)
        : null;
      if (status === 401 || status === 402) {
        pushToast({ message: 'Live detail refresh requires Premium.' });
        return;
      }
      pushToast({
        message: error instanceof Error ? error.message : 'Unable to refresh this launch detail.'
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleRefresh();
      }}
      className={clsx(
        'btn-secondary flex h-11 w-11 items-center justify-center rounded-lg border border-stroke text-text2 hover:border-primary disabled:cursor-wait disabled:opacity-70',
        className
      )}
      title={busy ? 'Checking launch detail updates' : 'Refresh launch detail'}
      aria-label="Refresh launch detail"
      disabled={busy}
    >
      <RefreshIcon className={clsx('h-4 w-4', busy && 'animate-spin')} />
    </button>
  );
}

function formatRefreshTime(value: number, includeSeconds: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'the next scheduled refresh';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined
  }).format(date);
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M20 5v5h-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 19v-5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 7.5A7 7 0 0 1 19 10M5 14a7 7 0 0 0 11.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
