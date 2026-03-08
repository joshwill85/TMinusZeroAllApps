import Stripe from 'stripe';

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'STRIPE_SECRET_PLACEHOLDER';

export const stripe = new Stripe(stripeSecret, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient()
});

export const PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_placeholder';
