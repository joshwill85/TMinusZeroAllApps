import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  WebBillingAdapterError,
  cancelBillingSubscription,
  openBillingPortal,
  resumeBillingSubscription,
  startBillingCheckout,
  startBillingSetupIntent,
  updateDefaultPaymentMethod
} from '@/lib/api/webBillingAdapters';
import {
  isBillableSubscriptionStatus,
  isPaidSubscriptionStatus,
  normalizeSubscriptionStatus,
  sanitizeReturnToPath
} from '@/lib/billing/shared';
import {
  createOrGetWebhookEventRecord,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  wasWebhookEventProcessed
} from '@/lib/server/webhookEvents';

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

async function main() {
  verifyBillingShared();
  await verifyWebBillingAdapters();
  verifyProviderFailureSafetyGuards();
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

function verifyProviderFailureSafetyGuards() {
  const billingCoreSource = fs.readFileSync(path.join(process.cwd(), 'apps/web/lib/server/billingCore.ts'), 'utf8');

  assert.ok(
    billingCoreSource.includes("throw new BillingApiRouteError(401, 'invalid_push_auth')"),
    'google push auth must reject invalid bearer pushes'
  );
  assert.ok(
    billingCoreSource.includes("throw new BillingApiRouteError(400, 'invalid_product')"),
    'provider sync must reject unsupported billing products'
  );
  assert.ok(
    billingCoreSource.includes("throw new BillingApiRouteError(403, 'billing_account_mismatch')"),
    'provider sync must reject account mismatches'
  );
  assert.ok(
    billingCoreSource.includes("reason: 'test_notification'"),
    'provider notifications must ignore test events safely'
  );
  assert.ok(
    billingCoreSource.includes("reason: 'missing_transaction_info'"),
    'apple notifications must ignore missing transaction payloads safely'
  );
  assert.ok(
    billingCoreSource.includes("reason: 'missing_subscription_payload'"),
    'google notifications must ignore missing subscription payloads safely'
  );
  assert.ok(
    billingCoreSource.includes("reason: 'unsupported_product'"),
    'provider notifications must surface unsupported products as ignored outcomes'
  );

  assertGuardOrder(
    billingCoreSource,
    "if (!config.appleProductId || payload.productId !== config.appleProductId)",
    'const transaction = await fetchAppleTransaction(',
    'apple sync must reject unsupported products before provider verification'
  );
  assertGuardOrder(
    billingCoreSource,
    "if (!config.googleProductId || payload.productId !== config.googleProductId)",
    'const purchase = await fetchGoogleSubscriptionPurchase(',
    'google sync must reject unsupported products before provider verification'
  );
  assertGuardOrder(
    billingCoreSource,
    "if (payload.appAccountToken && payload.appAccountToken !== session.userId)",
    'const transaction = await fetchAppleTransaction(',
    'apple sync must reject app-account mismatches before entitlement writes'
  );
  assertGuardOrder(
    billingCoreSource,
    "if (payload.obfuscatedAccountId && payload.obfuscatedAccountId !== session.userId)",
    'await persistGoogleEntitlement({',
    'google sync must reject obfuscated-account mismatches before entitlement writes'
  );

  assertions.push('provider-specific failure paths are guarded in source before provider fetch or entitlement mutation boundaries');
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

function assertGuardOrder(source: string, before: string, after: string, message: string) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.ok(beforeIndex >= 0, `${message}: missing guard token`);
  assert.ok(afterIndex >= 0, `${message}: missing downstream token`);
  assert.ok(beforeIndex < afterIndex, message);
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
