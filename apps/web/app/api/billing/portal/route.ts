import { NextResponse } from 'next/server';
import { BillingStripeRouteError, createStripePortalSession } from '@/lib/server/billingStripe';
import { resolveViewerSession } from '@/lib/server/viewerSession';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await createStripePortalSession(session);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BillingStripeRouteError) {
      const code = error.code === 'failed_to_init_billing' ? 'failed_to_load_billing' : error.code;
      return NextResponse.json({ error: code }, { status: error.status });
    }
    console.error('billing portal route error', error);
    return NextResponse.json({ error: 'failed_to_load_billing' }, { status: 500 });
  }
}
