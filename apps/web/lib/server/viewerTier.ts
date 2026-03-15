import { getViewerEntitlement } from '@/lib/server/entitlements';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import type { ViewerCapabilities, ViewerLimits, ViewerTier, ViewerMode } from '@tminuszero/domain';

export type ViewerTierInfo = {
  tier: ViewerTier;
  mode: ViewerMode;
  isAuthed: boolean;
  isPaid: boolean;
  isAdmin: boolean;
  userId: string | null;
  refreshIntervalSeconds: number;
  capabilities: ViewerCapabilities;
  limits: ViewerLimits;
};

export async function getViewerTier(options: {
  request?: Request;
  session?: ResolvedViewerSession;
  reconcileStripe?: boolean;
} = {}): Promise<ViewerTierInfo> {
  const { entitlement } = await getViewerEntitlement(options);
  return {
    tier: entitlement.tier,
    mode: entitlement.mode,
    isAuthed: entitlement.isAuthed,
    isPaid: entitlement.isPaid,
    isAdmin: entitlement.isAdmin,
    userId: entitlement.userId,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits
  };
}
