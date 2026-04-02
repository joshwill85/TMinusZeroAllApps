import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BillingStripeRouteError, createStripeCheckoutSession } from '@/lib/server/billingStripe';
import { BillingApiRouteError } from '@/lib/server/billingCore';
import { createGuestPremiumCheckoutSession, PremiumClaimRouteError } from '@/lib/server/premiumClaims';
import { resolveViewerSession } from '@/lib/server/viewerSession';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    returnTo: z.string().optional(),
    promotionCode: z.string().trim().min(1).optional()
  })
  .passthrough()
  .optional();

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const session = await resolveViewerSession(request);
    const payload = session.userId
      ? await createStripeCheckoutSession(session, {
          returnTo: parsed.data?.returnTo,
          promotionCode: parsed.data?.promotionCode
        })
      : await createGuestPremiumCheckoutSession({
          returnTo: parsed.data?.returnTo,
          promotionCode: parsed.data?.promotionCode
        });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof BillingStripeRouteError || error instanceof PremiumClaimRouteError || error instanceof BillingApiRouteError) {
      const code = error.code === 'stripe_lookup_failed' ? 'failed_to_init_billing' : error.code;
      const details =
        error instanceof BillingStripeRouteError && 'details' in error
          ? (error.details ?? {})
          : {};
      return NextResponse.json(
        {
          error: code,
          ...details
        },
        { status: error.status }
      );
    }
    console.error('billing checkout route error', error);
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}
