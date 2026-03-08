import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { getSiteUrl, isStripeConfigured } from '@/lib/server/env';
import { BRAND_NAME } from '@/lib/brand';

const MIN_TIP_CENTS = 100;
const MAX_TIP_CENTS = 50_000;

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 501 });
  }

  let amount = 0;
  try {
    const body = await request.json();
    amount = Math.trunc(Number(body?.amount));
  } catch {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  if (!Number.isFinite(amount)) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 });
  }

  if (amount < MIN_TIP_CENTS || amount > MAX_TIP_CENTS) {
    return NextResponse.json({ error: 'amount_out_of_range' }, { status: 400 });
  }

  const siteUrl = getSiteUrl();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    submit_type: 'donate',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${BRAND_NAME} Tip Jar`,
            description: `Support ${BRAND_NAME}`
          },
          unit_amount: amount
        },
        quantity: 1
      }
    ],
    success_url: `${siteUrl}/?tip=success`,
    cancel_url: `${siteUrl}/?tip=cancel`,
    metadata: {
      source: 'tip_jar'
    }
  });

  if (!session.url) {
    return NextResponse.json({ error: 'session_missing_url' }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}
