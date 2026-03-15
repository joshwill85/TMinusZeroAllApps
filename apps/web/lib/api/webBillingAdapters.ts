'use client';

import { z } from 'zod';

const checkoutSuccessSchema = z.object({
  url: z.string()
});

const billingPortalSchema = z.object({
  url: z.string()
});

const setupIntentSchema = z.object({
  clientSecret: z.string()
});

const successSchema = z.object({
  ok: z.literal(true)
});

const billingSubscriptionMutationSchema = z.object({
  status: z.string().nullable().optional(),
  currentPeriodEnd: z.string().nullable().optional()
});

const checkoutErrorSchema = z.object({
  error: z.string(),
  status: z.string().nullable().optional(),
  returnTo: z.string().optional()
});

export class WebBillingAdapterError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly returnTo: string | null;

  constructor(path: string, status: number, code: string | null, returnTo: string | null) {
    super(code ? `Web route failed for ${path} (${status}: ${code})` : `Web route failed for ${path} (${status})`);
    this.name = 'WebBillingAdapterError';
    this.status = status;
    this.code = code;
    this.returnTo = returnTo;
  }
}

export async function startBillingCheckout(returnTo: string) {
  const path = '/api/billing/checkout';
  return requestWebBilling(path, checkoutSuccessSchema, {
    method: 'POST',
    body: JSON.stringify({ returnTo })
  });
}

export async function openBillingPortal() {
  return requestWebBilling('/api/billing/portal', billingPortalSchema, {
    method: 'POST'
  });
}

export async function startBillingSetupIntent() {
  return requestWebBilling('/api/billing/setup-intent', setupIntentSchema, {
    method: 'POST'
  });
}

export async function updateDefaultPaymentMethod(paymentMethod: string) {
  return requestWebBilling('/api/billing/default-payment-method', successSchema, {
    method: 'POST',
    body: JSON.stringify({ paymentMethod })
  });
}

export async function cancelBillingSubscription() {
  return requestWebBilling('/api/billing/cancel', billingSubscriptionMutationSchema, {
    method: 'POST'
  });
}

export async function resumeBillingSubscription() {
  return requestWebBilling('/api/billing/resume', billingSubscriptionMutationSchema, {
    method: 'POST'
  });
}

async function requestWebBilling<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit
) {
  const response = await fetch(path, {
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = checkoutErrorSchema.safeParse(json);
    throw new WebBillingAdapterError(path, response.status, parsed.success ? parsed.data.error : null, parsed.success ? parsed.data.returnTo ?? null : null);
  }

  return schema.parse(json);
}
