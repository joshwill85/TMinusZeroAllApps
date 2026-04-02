import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';

type LaunchFeedScope = 'public' | 'live' | 'watchlist';
type LaunchDetailScope = 'public' | 'live';

const FEED_PAYLOAD_LIMITS: Record<LaunchFeedScope, { limit: number; windowSeconds: number }> = {
  public: { limit: 120, windowSeconds: 900 },
  live: { limit: 60, windowSeconds: 900 },
  watchlist: { limit: 60, windowSeconds: 900 }
};

const FEED_VERSION_LIMITS: Record<Exclude<LaunchFeedScope, 'watchlist'>, { limit: number; windowSeconds: number }> = {
  public: { limit: 60, windowSeconds: 900 },
  live: { limit: 120, windowSeconds: 900 }
};

const DETAIL_PAYLOAD_LIMITS: Record<LaunchDetailScope, { limit: number; windowSeconds: number }> = {
  public: { limit: 60, windowSeconds: 900 },
  live: { limit: 90, windowSeconds: 900 }
};

const DETAIL_VERSION_LIMITS: Record<LaunchDetailScope, { limit: number; windowSeconds: number }> = {
  public: { limit: 60, windowSeconds: 900 },
  live: { limit: 120, windowSeconds: 900 }
};

const LEGACY_PUBLIC_FEED_LIMIT = { limit: 120, windowSeconds: 900 };

export function resolveLaunchFeedScopeFromRequest(request: Request): LaunchFeedScope {
  const scopeToken = String(new URL(request.url).searchParams.get('scope') || 'public').trim().toLowerCase();
  if (scopeToken === 'live' || scopeToken === 'watchlist') {
    return scopeToken;
  }
  return 'public';
}

export async function enforceLaunchFeedPayloadRateLimit(
  request: Request,
  { scope, viewerId = null }: { scope: LaunchFeedScope; viewerId?: string | null }
) {
  const config = FEED_PAYLOAD_LIMITS[scope];
  return enforceDurableRateLimit(request, {
    scope: `launch_feed_${scope}_payload_v1`,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    clientId: viewerId
  });
}

export async function enforceLaunchFeedVersionRateLimit(
  request: Request,
  { scope, viewerId = null }: { scope: Exclude<LaunchFeedScope, 'watchlist'>; viewerId?: string | null }
) {
  const config = FEED_VERSION_LIMITS[scope];
  return enforceDurableRateLimit(request, {
    scope: `launch_feed_${scope}_version_v1`,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    clientId: viewerId
  });
}

export async function enforceLaunchDetailPayloadRateLimit(
  request: Request,
  { scope, viewerId = null }: { scope: LaunchDetailScope; viewerId?: string | null }
) {
  const config = DETAIL_PAYLOAD_LIMITS[scope];
  return enforceDurableRateLimit(request, {
    scope: `launch_detail_${scope}_payload_v1`,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    clientId: viewerId
  });
}

export async function enforceLaunchDetailVersionRateLimit(
  request: Request,
  { scope, viewerId = null }: { scope: LaunchDetailScope; viewerId?: string | null }
) {
  const config = DETAIL_VERSION_LIMITS[scope];
  return enforceDurableRateLimit(request, {
    scope: `launch_detail_${scope}_version_v1`,
    limit: config.limit,
    windowSeconds: config.windowSeconds,
    clientId: viewerId
  });
}

export async function enforceLegacyPublicLaunchFeedRateLimit(request: Request) {
  return enforceDurableRateLimit(request, {
    scope: 'launch_feed_public_payload_legacy',
    limit: LEGACY_PUBLIC_FEED_LIMIT.limit,
    windowSeconds: LEGACY_PUBLIC_FEED_LIMIT.windowSeconds
  });
}
