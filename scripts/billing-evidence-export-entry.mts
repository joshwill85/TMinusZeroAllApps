import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

const { values } = parseArgs({
  options: {
    userId: { type: 'string' },
    'user-id': { type: 'string' },
    out: { type: 'string' },
    'skip-when-unavailable': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' }
  }
});

const usage = `Usage:
  npm run export:billing-evidence -- --user-id=<uuid> [--out=docs/evidence/three-platform/billing-user.json] [--skip-when-unavailable]

Exports:
  - billing summary
  - shared entitlements
  - purchase provider customers
  - purchase entitlements
  - purchase events
  - matching webhook events when provider_event_id values are present
`;

type BillingEvidenceArtifact = {
  generatedAt: string;
  status: 'ok' | 'skipped' | 'error';
  reason: string | null;
  userId: string | null;
  billingSummary: unknown | null;
  entitlements: unknown | null;
  providerCustomers: unknown[];
  purchaseEntitlements: unknown[];
  purchaseEvents: unknown[];
  webhookEvents: unknown[];
};

async function main() {
  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  const userId = String(values.userId || values['user-id'] || '').trim();
  const allowSkip = values['skip-when-unavailable'] === true;
  if (!userId) {
    if (allowSkip) {
      return writeArtifact(
        buildArtifact({
          status: 'skipped',
          reason: 'missing_user_id',
          userId: null
        })
      );
    }
    throw new Error('Missing --user-id');
  }

  const envModule = (await import('@/lib/server/env')) as typeof import('@/lib/server/env');
  const { isSupabaseAdminConfigured, isSupabaseConfigured } = envModule;

  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    if (allowSkip) {
      return writeArtifact(
        buildArtifact({
          status: 'skipped',
          reason: 'supabase_admin_not_configured',
          userId
        })
      );
    }
    throw new Error('Supabase service role configuration is required.');
  }

  const entitlementsModule = (await import('@/lib/server/entitlements')) as typeof import('@/lib/server/entitlements');
  const billingCore = (await import('@/lib/server/billingCore')) as typeof import('@/lib/server/billingCore');
  const supabaseServer = (await import('@/lib/server/supabaseServer')) as typeof import('@/lib/server/supabaseServer');
  const { getViewerEntitlement } = entitlementsModule;
  const { loadBillingSummary } = billingCore;
  const { createSupabaseAdminClient } = supabaseServer;

  const session: ResolvedViewerSession = {
    authMode: 'cookie',
    role: 'member',
    user: null,
    userId,
    email: null,
    accessToken: null,
    expiresAt: null
  };

  const admin = createSupabaseAdminClient();

  const [billingSummary, entitlementResult, providerCustomersResult, purchaseEntitlementsResult, purchaseEventsResult] = await Promise.all([
    loadBillingSummary(session),
    getViewerEntitlement({
      session,
      request: undefined,
      reconcileStripe: true
    }),
    admin.from('purchase_provider_customers').select('*').eq('user_id', userId).order('provider', { ascending: true }),
    admin.from('purchase_entitlements').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('purchase_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50)
  ]);

  if (providerCustomersResult.error) throw providerCustomersResult.error;
  if (purchaseEntitlementsResult.error) throw purchaseEntitlementsResult.error;
  if (purchaseEventsResult.error) throw purchaseEventsResult.error;

  const providerEventIds = new Set(
    (purchaseEventsResult.data ?? [])
      .map((row) => (typeof row?.provider_event_id === 'string' ? row.provider_event_id.trim() : ''))
      .filter(Boolean)
  );

  const webhookEvents =
    providerEventIds.size > 0
      ? await loadWebhookEvents(admin, [...providerEventIds])
      : [];

  const artifact = buildArtifact({
    status: 'ok',
    reason: null,
    userId,
    billingSummary,
    entitlements: entitlementResult.entitlement,
    providerCustomers: providerCustomersResult.data ?? [],
    purchaseEntitlements: purchaseEntitlementsResult.data ?? [],
    purchaseEvents: purchaseEventsResult.data ?? [],
    webhookEvents
  });

  writeArtifact(artifact);
}

async function loadWebhookEvents(admin: ReturnType<typeof createSupabaseAdminClient>, providerEventIds: string[]) {
  const result = await admin
    .from('webhook_events')
    .select('*')
    .in('event_id', providerEventIds)
    .order('id', { ascending: false })
    .limit(50);

  if (result.error) {
    throw result.error;
  }

  return result.data ?? [];
}

function buildArtifact({
  status,
  reason,
  userId,
  billingSummary = null,
  entitlements = null,
  providerCustomers = [],
  purchaseEntitlements = [],
  purchaseEvents = [],
  webhookEvents = []
}: Partial<BillingEvidenceArtifact> & Pick<BillingEvidenceArtifact, 'status' | 'reason' | 'userId'>): BillingEvidenceArtifact {
  return {
    generatedAt: new Date().toISOString(),
    status,
    reason,
    userId,
    billingSummary,
    entitlements,
    providerCustomers,
    purchaseEntitlements,
    purchaseEvents,
    webhookEvents
  };
}

function writeArtifact(artifact: BillingEvidenceArtifact) {
  const output = JSON.stringify(artifact, null, 2);
  const outPath = String(values.out || '').trim();
  if (!outPath) {
    console.log(output);
    return;
  }

  const absolutePath = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${output}\n`);
  console.log(`billing-evidence-export: wrote ${path.relative(process.cwd(), absolutePath)}`);
}

main().catch((error) => {
  if (values['skip-when-unavailable'] === true) {
    writeArtifact(
      buildArtifact({
        status: 'error',
        reason: error instanceof Error ? error.message : 'unknown_error',
        userId:
          typeof values.userId === 'string' && values.userId.trim()
            ? values.userId.trim()
            : typeof values['user-id'] === 'string' && values['user-id'].trim()
              ? values['user-id'].trim()
              : null
      })
    );
    return;
  }

  console.error(error);
  console.error(usage);
  process.exitCode = 1;
});
