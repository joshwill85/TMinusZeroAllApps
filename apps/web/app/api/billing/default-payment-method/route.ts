import { NextResponse } from 'next/server';
import { BillingStripeRouteError, setStripeDefaultPaymentMethod } from '@/lib/server/billingStripe';
import { resolveViewerSession } from '@/lib/server/viewerSession';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let paymentMethod = '';
  try {
    const body = await request.json();
    paymentMethod = String(body?.paymentMethod || '').trim();
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (!paymentMethod) {
    return NextResponse.json({ error: 'invalid_payment_method' }, { status: 400 });
  }

  try {
    const session = await resolveViewerSession(request);
    const payload = await setStripeDefaultPaymentMethod(session, { paymentMethod });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BillingStripeRouteError) {
      const code = error.code === 'failed_to_init_billing' ? 'failed_to_load' : error.code;
      return NextResponse.json({ error: code }, { status: error.status });
    }
    console.error('billing default payment method route error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
