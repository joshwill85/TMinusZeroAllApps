import { NextResponse } from 'next/server';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { getViewerEntitlement } from '@/lib/server/entitlements';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { entitlement, loadError } = await getViewerEntitlement({ request, reconcileStripe: false });

  if (loadError && isSupabaseAdminConfigured() && entitlement.isAuthed) {
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json({
    status: entitlement.status,
    isPaid: entitlement.isPaid,
    isAdmin: entitlement.isAdmin,
    isAuthed: entitlement.isAuthed,
    tier: entitlement.tier,
    mode: entitlement.mode,
    refreshIntervalSeconds: entitlement.refreshIntervalSeconds,
    capabilities: entitlement.capabilities,
    limits: entitlement.limits,
    cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
    currentPeriodEnd: entitlement.currentPeriodEnd,
    stripePriceId: entitlement.stripePriceId,
    reconciled: entitlement.reconciled,
    reconcileThrottled: entitlement.reconcileThrottled,
    source: entitlement.source
  });
}
