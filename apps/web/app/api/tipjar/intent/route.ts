import { NextResponse } from 'next/server';
import { stripe } from '@/lib/api/stripe';
import { isStripeConfigured } from '@/lib/server/env';

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

  const intent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: {
      source: 'tip_jar'
    }
  });

  if (!intent.client_secret) {
    return NextResponse.json({ error: 'client_secret_missing' }, { status: 500 });
  }

  return NextResponse.json({ clientSecret: intent.client_secret });
}
