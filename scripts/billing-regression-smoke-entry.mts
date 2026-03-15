import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { JWT } from 'google-auth-library';
import webBillingAdapters from '@/lib/api/webBillingAdapters';
import billingShared from '@/lib/billing/shared';
import billingCore from '@/lib/server/billingCore';
import webhookEvents from '@/lib/server/webhookEvents';

const {
  WebBillingAdapterError,
  cancelBillingSubscription,
  openBillingPortal,
  resumeBillingSubscription,
  startBillingCheckout,
  startBillingSetupIntent,
  updateDefaultPaymentMethod
} = webBillingAdapters as typeof import('@/lib/api/webBillingAdapters');

const {
  isBillableSubscriptionStatus,
  isPaidSubscriptionStatus,
  normalizeSubscriptionStatus,
  sanitizeReturnToPath
} = billingShared as typeof import('@/lib/billing/shared');

const {
  BillingApiRouteError,
  processAppleBillingNotification,
  processGoogleBillingNotification,
  syncAppleBilling,
  syncGoogleBilling,
  verifyAppleBillingNotification,
  verifyGoogleBillingNotificationRequest
} = billingCore as typeof import('@/lib/server/billingCore');

const {
  createOrGetWebhookEventRecord,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  wasWebhookEventProcessed
} = webhookEvents as typeof import('@/lib/server/webhookEvents');

const { values } = parseArgs({
  options: {
    out: { type: 'string' }
  }
});

type LoggedBillingRequest = {
  path: string;
  method: string;
  body: unknown;
};

type WebhookEventRow = {
  id: number;
  source: string;
  event_id: string | null;
  payload_hash: string;
  processed: boolean;
  error: string | null;
};

type BillingRegressionReport = {
  generatedAt: string;
  assertions: string[];
};

const assertions: string[] = [];
const authedSession = {
  authMode: 'bearer' as const,
  role: 'member' as const,
  user: null,
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'viewer@example.com',
  accessToken: 'access-token',
  expiresAt: null
};

async function main() {
  verifyBillingShared();
  await verifyWebBillingAdapters();
  await verifyProviderFailureSafety();
  await verifyWebhookReplayGuard();
  writeReport();
  console.log('billing-regression-smoke: ok');
}

function verifyBillingShared() {
  assert.equal(normalizeSubscriptionStatus(' Active '), 'active');
  assert.equal(isPaidSubscriptionStatus('trialing'), true);
  assert.equal(isPaidSubscriptionStatus('past_due'), false);
  assert.equal(isBillableSubscriptionStatus('past_due'), true);
  assert.equal(isBillableSubscriptionStatus('canceled'), false);
  assert.equal(sanitizeReturnToPath('/account?tab=billing'), '/account?tab=billing');
  assert.equal(sanitizeReturnToPath('/upgrade', '/account'), '/account');
  assert.equal(sanitizeReturnToPath('https://evil.example/path', '/account'), '/account');
  assertions.push('billing shared helpers preserve web status normalization and return-to sanitization');
}

async function verifyWebBillingAdapters() {
  const originalFetch = globalThis.fetch;
  const requests: LoggedBillingRequest[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, 'https://tmz.local').pathname;
    const method = String(init?.method || 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      body = JSON.parse(init.body);
    }

    requests.push({ path, method, body });

    if (path === '/api/billing/checkout') {
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/session' }), { status: 200 });
    }
    if (path === '/api/billing/portal') {
      return new Response(JSON.stringify({ url: 'https://billing.stripe.com/session' }), { status: 200 });
    }
    if (path === '/api/billing/setup-intent') {
      return new Response(JSON.stringify({ clientSecret: 'seti_secret_123' }), { status: 200 });
    }
    if (path === '/api/billing/default-payment-method') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (path === '/api/billing/cancel') {
      return new Response(JSON.stringify({ status: 'active', currentPeriodEnd: '2026-03-31T00:00:00.000Z' }), { status: 200 });
    }
    if (path === '/api/billing/resume') {
      return new Response(JSON.stringify({ status: 'active', currentPeriodEnd: '2026-04-30T00:00:00.000Z' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }) as typeof fetch;

  try {
    const checkout = await startBillingCheckout('/account');
    assert.equal(checkout.url.includes('checkout.stripe.com'), true);

    const portal = await openBillingPortal();
    assert.equal(portal.url.includes('billing.stripe.com'), true);

    const setupIntent = await startBillingSetupIntent();
    assert.equal(setupIntent.clientSecret, 'seti_secret_123');

    const defaultPayment = await updateDefaultPaymentMethod('pm_123');
    assert.equal(defaultPayment.ok, true);

    const canceled = await cancelBillingSubscription();
    assert.equal(canceled.status, 'active');

    const resumed = await resumeBillingSubscription();
    assert.equal(resumed.status, 'active');

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url, 'https://tmz.local').pathname;
      requests.push({
        path,
        method: String(init?.method || 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
      });

      return new Response(JSON.stringify({ error: 'already_subscribed', returnTo: '/account' }), { status: 409 });
    }) as typeof fetch;

    let adapterError: WebBillingAdapterError | null = null;
    try {
      await startBillingCheckout('/account');
    } catch (error) {
      adapterError = error as WebBillingAdapterError;
    }

    assert.ok(adapterError instanceof WebBillingAdapterError);
    assert.equal(adapterError?.code, 'already_subscribed');
    assert.equal(adapterError?.returnTo, '/account');

    assert.deepEqual(requests.map((entry) => `${entry.method} ${entry.path}`), [
      'POST /api/billing/checkout',
      'POST /api/billing/portal',
      'POST /api/billing/setup-intent',
      'POST /api/billing/default-payment-method',
      'POST /api/billing/cancel',
      'POST /api/billing/resume',
      'POST /api/billing/checkout'
    ]);
    assert.deepEqual(requests[0]?.body, { returnTo: '/account' });
    assert.deepEqual(requests[3]?.body, { paymentMethod: 'pm_123' });
    assertions.push('web billing adapters preserve checkout, portal, setup-intent, cancel, resume, and payment-method route shapes');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyProviderFailureSafety() {
  await withBillingEnv(async () => {
    const invalidAppleError = await captureAsyncError(() => verifyAppleBillingNotification('not-a-valid-apple-jws'));
    assert.ok(invalidAppleError instanceof BillingApiRouteError);
    assert.ok(['invalid_provider_payload', 'apple_verification_failed'].includes(invalidAppleError.code));

    const googleMissingAuth = await captureAsyncError(() =>
      verifyGoogleBillingNotificationRequest(new Request('https://tmz.local/api/webhooks/google-play', { method: 'POST' }))
    );
    assert.ok(googleMissingAuth instanceof BillingApiRouteError);
    assert.equal(googleMissingAuth.code, 'invalid_push_auth');

    const appleTest = await processAppleBillingNotification({
      environment: 'sandbox',
      notification: {
        notificationType: 'TEST'
      } as never,
      providerEventId: 'apple:test'
    });
    assert.deepEqual(appleTest, {
      outcome: 'ignored',
      reason: 'test_notification'
    });

    const appleMissingTransaction = await processAppleBillingNotification({
      environment: 'sandbox',
      notification: {
        notificationType: 'DID_RENEW',
        data: {}
      } as never,
      providerEventId: 'apple:missing-transaction'
    });
    assert.deepEqual(appleMissingTransaction, {
      outcome: 'ignored',
      reason: 'missing_transaction_info'
    });

    const googleTest = await processGoogleBillingNotification({
      notification: {
        testNotification: {}
      },
      providerEventId: 'google:test'
    });
    assert.deepEqual(googleTest, {
      outcome: 'ignored',
      reason: 'test_notification'
    });

    const googleMissingPayload = await processGoogleBillingNotification({
      notification: {
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME,
        subscriptionNotification: {}
      },
      providerEventId: 'google:missing-payload'
    });
    assert.deepEqual(googleMissingPayload, {
      outcome: 'ignored',
      reason: 'missing_subscription_payload'
    });

    const invalidAppleProduct = await captureAsyncError(() =>
      syncAppleBilling(authedSession as never, {
        transactionId: '2000000123456789',
        productId: 'wrong.product',
        originalTransactionId: null,
        appAccountToken: authedSession.userId,
        environment: 'sandbox'
      })
    );
    assert.ok(invalidAppleProduct instanceof BillingApiRouteError);
    assert.equal(invalidAppleProduct.code, 'invalid_product');

    const invalidGoogleProduct = await captureAsyncError(() =>
      syncGoogleBilling(authedSession as never, {
        productId: 'wrong.product',
        purchaseToken: 'purchase-token-1',
        packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.tminuszero.app',
        basePlanId: null,
        obfuscatedAccountId: authedSession.userId
      })
    );
    assert.ok(invalidGoogleProduct instanceof BillingApiRouteError);
    assert.equal(invalidGoogleProduct.code, 'invalid_product');

    await withMockedGoogleVerification(async () => {
      const accountMismatch = await captureAsyncError(() =>
        syncGoogleBilling(authedSession as never, {
          productId: process.env.GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID || 'tmz.premium.monthly',
          purchaseToken: 'purchase-token-2',
          packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.tminuszero.app',
          basePlanId: null,
          obfuscatedAccountId: '22222222-2222-4222-8222-222222222222'
        })
      );
      assert.ok(accountMismatch instanceof BillingApiRouteError);
      assert.equal(accountMismatch.code, 'billing_account_mismatch');
    });

    assertions.push('provider-specific invalid payloads, invalid push auth, unsupported products, and account mismatches are rejected before entitlement mutation');
  });
}

async function verifyWebhookReplayGuard() {
  const admin = createFakeWebhookAdmin();
  const first = await createOrGetWebhookEventRecord(admin as never, {
    source: 'apple_app_store',
    eventId: 'apple:1',
    payloadHash: 'hash-1'
  });

  assert.equal(first.supportsEventId, true);
  assert.equal(first.id, 1);
  assert.equal(await wasWebhookEventProcessed(admin as never, { source: 'apple_app_store', eventId: 'apple:1' }), false);

  await markWebhookEventProcessed(admin as never, { id: 1 });
  assert.equal(await wasWebhookEventProcessed(admin as never, { source: 'apple_app_store', eventId: 'apple:1' }), true);

  const duplicate = await createOrGetWebhookEventRecord(admin as never, {
    source: 'apple_app_store',
    eventId: 'apple:1',
    payloadHash: 'hash-1'
  });
  assert.equal(duplicate.id, 1);

  await markWebhookEventFailed(admin as never, { id: 1, error: 'simulated_failure' });
  assert.equal(await wasWebhookEventProcessed(admin as never, { source: 'apple_app_store', eventId: 'apple:1' }), false);
  assert.equal(admin.rows[0]?.error, 'simulated_failure');
  assertions.push('webhook replay bookkeeping remains idempotent and failures reopen events safely');
}

async function captureAsyncError(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (error) {
    return error as Error;
  }
}

async function withBillingEnv(fn: () => Promise<void>) {
  const previous = new Map<string, string | undefined>();
  const nextEntries: Record<string, string> = {
    APPLE_APP_STORE_ISSUER_ID: 'apple-issuer-id',
    APPLE_APP_STORE_KEY_ID: 'apple-key-id',
    APPLE_APP_STORE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----',
    APPLE_APP_STORE_BUNDLE_ID: 'com.tminuszero.mobile',
    APPLE_APP_STORE_APP_ID: '123456789',
    APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID: 'tmz.premium.monthly.ios',
    GOOGLE_PLAY_PACKAGE_NAME: 'com.tminuszero.mobile',
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: 'play-service@example.iam.gserviceaccount.com',
    GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----',
    GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID: 'tmz.premium.monthly.android',
    GOOGLE_PLAY_RTDN_PUSH_AUDIENCE: 'https://tmz.local/api/webhooks/google-play',
    GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL: 'pubsub-push@example.iam.gserviceaccount.com'
  };

  for (const [key, value] of Object.entries(nextEntries)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMockedGoogleVerification(fn: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const originalAuthorize = JWT.prototype.authorize;

  JWT.prototype.authorize = async function authorize() {
    return { access_token: 'google-access-token' } as never;
  };

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
        acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
        latestOrderId: 'GPA.1234-5678-9012-34567',
        lineItems: [
          {
            productId: process.env.GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID,
            expiryTime: '2026-04-01T00:00:00.000Z',
            autoRenewingPlan: {
              autoRenewEnabled: true
            },
            offerDetails: {
              basePlanId: 'base-plan'
            }
          }
        ],
        externalAccountIdentifiers: {
          obfuscatedExternalAccountId: authedSession.userId
        }
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }
    )) as typeof fetch;

  try {
    await fn();
  } finally {
    JWT.prototype.authorize = originalAuthorize;
    globalThis.fetch = originalFetch;
  }
}

function writeReport() {
  const out = typeof values.out === 'string' ? values.out.trim() : '';
  if (!out) {
    return;
  }

  const absolutePath = path.isAbsolute(out) ? out : path.join(process.cwd(), out);
  const report: BillingRegressionReport = {
    generatedAt: new Date().toISOString(),
    assertions
  };
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function createFakeWebhookAdmin() {
  const rows: WebhookEventRow[] = [];

  return {
    rows,
    from() {
      return new FakeWebhookEventsTable(rows);
    }
  };
}

class FakeWebhookEventsTable {
  private readonly rows: WebhookEventRow[];
  private filters: Array<{ field: keyof WebhookEventRow; value: unknown }> = [];
  private pendingSelectColumns: string | null = null;
  private pendingInsert: Partial<WebhookEventRow> | null = null;
  private pendingUpdate: Partial<WebhookEventRow> | null = null;

  constructor(rows: WebhookEventRow[]) {
    this.rows = rows;
  }

  insert(payload: Partial<WebhookEventRow>) {
    this.pendingInsert = payload;
    return this;
  }

  update(payload: Partial<WebhookEventRow>) {
    this.pendingUpdate = payload;
    return this;
  }

  select(columns: string) {
    this.pendingSelectColumns = columns;
    return this;
  }

  eq(field: keyof WebhookEventRow, value: unknown) {
    this.filters.push({ field, value });
    return this;
  }

  async maybeSingle() {
    if (this.pendingInsert) {
      const duplicate = this.rows.find(
        (row) => row.source === this.pendingInsert?.source && row.event_id === (this.pendingInsert.event_id ?? null)
      );

      if (duplicate && this.pendingInsert.event_id) {
        return {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint'
          }
        };
      }

      const nextRow: WebhookEventRow = {
        id: this.rows.length + 1,
        source: String(this.pendingInsert.source || ''),
        event_id: this.pendingInsert.event_id ?? null,
        payload_hash: String(this.pendingInsert.payload_hash || ''),
        processed: Boolean(this.pendingInsert.processed),
        error: typeof this.pendingInsert.error === 'string' ? this.pendingInsert.error : null
      };
      this.rows.push(nextRow);
      return {
        data: this.project(nextRow),
        error: null
      };
    }

    const row = this.rows.find((candidate) => this.filters.every((filter) => candidate[filter.field] === filter.value)) ?? null;
    return {
      data: row ? this.project(row) : null,
      error: null
    };
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: null; error: null | { code?: string; message?: string } }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const matchingRows = this.rows.filter((candidate) => this.filters.every((filter) => candidate[filter.field] === filter.value));
    for (const row of matchingRows) {
      Object.assign(row, this.pendingUpdate ?? {});
    }

    return {
      data: null,
      error: null
    };
  }

  private project(row: WebhookEventRow) {
    if (this.pendingSelectColumns === 'id') {
      return { id: row.id };
    }
    if (this.pendingSelectColumns === 'processed') {
      return { processed: row.processed };
    }
    return row;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
