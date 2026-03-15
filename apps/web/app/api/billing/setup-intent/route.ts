import { NextResponse } from 'next/server';
import { BillingStripeRouteError, createStripeSetupIntent } from '@/lib/server/billingStripe';
import { resolveViewerSession } from '@/lib/server/viewerSession';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await createStripeSetupIntent(session);
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BillingStripeRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('billing setup intent route error', error);
    return NextResponse.json({ error: 'failed_to_init_billing' }, { status: 500 });
  }
}
