import type { Metadata } from 'next';
import { PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS } from '@tminuszero/domain';
import { getSiteUrl, isSupabaseConfigured } from '@/lib/server/env';
import type { Launch } from '@/lib/types/launch';
import { EmbeddedNextLaunchCard } from '@/components/embed/EmbeddedNextLaunchCard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Next launch card embed',
  robots: { index: false, follow: false }
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function EmbedNextLaunchPage({ searchParams }: { searchParams?: SearchParams }) {
  const token = resolveToken(searchParams);
  if (!token) {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">Missing embed token.</div>
      </div>
    );
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Embeds are unavailable.
        </div>
      </div>
    );
  }

  if (!isUuidToken(token)) {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Invalid embed link.
        </div>
      </div>
    );
  }

  const nowMs = Date.now();
  const initialPayload = await loadInitialPayload(token);
  if (initialPayload === 'invalid') {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Invalid embed link.
        </div>
      </div>
    );
  }

  if (initialPayload === 'error') {
    return (
      <div className="mx-auto w-full max-w-lg p-4">
        <div className="rounded-2xl border border-stroke bg-surface-1 p-4 text-sm text-text2">
          Unable to load next launch.
        </div>
      </div>
    );
  }

  return (
    <EmbeddedNextLaunchCard
      token={token}
      initialLaunch={initialPayload.launch}
      initialRecommendedIntervalSeconds={initialPayload.recommendedIntervalSeconds}
      initialCadenceAnchorNet={initialPayload.cadenceAnchorNet}
      initialNowMs={nowMs}
    />
  );
}

function resolveToken(searchParams?: SearchParams) {
  const raw = searchParams?.token;
  const token = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
}

function isUuidToken(token: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
}

async function loadInitialPayload(
  token: string
): Promise<
  | {
      launch: Launch | null;
      recommendedIntervalSeconds: number;
      cadenceAnchorNet: string | null;
    }
  | 'invalid'
  | 'error'
> {
  try {
    const url = `${getSiteUrl()}/api/embed/next-launch?token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 401 || res.status === 404) return 'invalid';
    if (!res.ok) return 'error';
    const json = (await res.json().catch(() => null)) as {
      launch?: Launch | null;
      recommendedIntervalSeconds?: number;
      cadenceAnchorNet?: string | null;
    } | null;
    return {
      launch: json?.launch ?? null,
      recommendedIntervalSeconds:
        typeof json?.recommendedIntervalSeconds === 'number' && Number.isFinite(json.recommendedIntervalSeconds)
          ? Math.max(1, Math.trunc(json.recommendedIntervalSeconds))
          : PREMIUM_LAUNCH_DEFAULT_REFRESH_SECONDS,
      cadenceAnchorNet: typeof json?.cadenceAnchorNet === 'string' ? json.cadenceAnchorNet : null
    };
  } catch (err) {
    console.error('embed next launch initial load error', err);
    return 'error';
  }
}
