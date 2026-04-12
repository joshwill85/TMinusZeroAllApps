import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

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
  - derived shared entitlements snapshot
  - purchase provider customers
  - purchase entitlements
  - purchase events
  - matching webhook events when provider_event_id values are present
`;

type PurchaseProvider = 'stripe' | 'apple_app_store' | 'google_play';

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

type ProviderCustomerRow = {
  user_id: string;
  provider: PurchaseProvider;
  provider_customer_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type PurchaseEntitlementRow = {
  user_id: string;
  entitlement_key: string;
  provider: PurchaseProvider;
  provider_subscription_id: string | null;
  provider_product_id: string | null;
  status: string | null;
  is_active: boolean | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

type PurchaseEventRow = {
  provider_event_id: string | null;
} & Record<string, unknown>;

type SubscriptionRow = {
  stripe_subscription_id: string;
  stripe_price_id: string;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type ProfileRow = {
  role: string | null;
  email: string | null;
};

function normalizeStatus(status: string | null | undefined) {
  return String(status || '')
    .trim()
    .toLowerCase();
}

function isPaidSubscriptionStatus(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  return normalized === 'active' || normalized === 'trialing';
}

function mapEntitlementSource(provider: PurchaseProvider, source: string | null | undefined) {
  const normalized = normalizeStatus(source);
  if (normalized === 'manual') return 'manual';
  if (provider === 'apple_app_store') return 'apple';
  if (provider === 'google_play') return 'google';
  return 'stripe';
}

function buildBillingSummary({
  providerEntitlement,
  legacySubscription
}: {
  providerEntitlement: PurchaseEntitlementRow | null;
  legacySubscription: SubscriptionRow | null;
}) {
  if (providerEntitlement) {
    const provider = providerEntitlement.provider;
    const status = normalizeStatus(providerEntitlement.status) || 'none';
    const isPaid = typeof providerEntitlement.is_active === 'boolean' ? providerEntitlement.is_active : isPaidSubscriptionStatus(status);
    return {
      provider,
      status,
      productKey: providerEntitlement.provider_product_id ? 'premium_monthly' : null,
      isPaid,
      currentPeriodEnd: providerEntitlement.current_period_end,
      cancelAtPeriodEnd: Boolean(providerEntitlement.cancel_at_period_end),
      managementMode:
        provider === 'stripe'
          ? 'stripe_portal'
          : provider === 'apple_app_store'
            ? 'app_store_external'
            : 'google_play_external',
      providerMessage:
        provider === 'stripe'
          ? null
          : provider === 'apple_app_store'
            ? 'Managed in the App Store.'
            : 'Managed in Google Play.'
    };
  }

  if (legacySubscription) {
    const status = normalizeStatus(legacySubscription.status) || 'none';
    return {
      provider: 'stripe',
      status,
      productKey: legacySubscription.stripe_price_id ? 'premium_monthly' : null,
      isPaid: isPaidSubscriptionStatus(status),
      currentPeriodEnd: legacySubscription.current_period_end,
      cancelAtPeriodEnd: Boolean(legacySubscription.cancel_at_period_end),
      managementMode: 'stripe_portal',
      providerMessage: null
    };
  }

  return {
    provider: 'none',
    status: 'none',
    productKey: null,
    isPaid: false,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    managementMode: 'none',
    providerMessage: null
  };
}

function buildEntitlementSnapshot({
  userId,
  role,
  providerEntitlement,
  legacySubscription
}: {
  userId: string;
  role: string | null;
  providerEntitlement: PurchaseEntitlementRow | null;
  legacySubscription: SubscriptionRow | null;
}) {
  const isAdmin = role === 'admin';
  const sourceEntitlement = providerEntitlement;
  const status = normalizeStatus(sourceEntitlement?.status ?? legacySubscription?.status) || 'none';
  const isPaid =
    typeof sourceEntitlement?.is_active === 'boolean'
      ? sourceEntitlement.is_active
      : isPaidSubscriptionStatus(sourceEntitlement?.status ?? legacySubscription?.status);
  const tier = isAdmin || isPaid ? 'premium' : 'anon';
  return {
    tier,
    status,
    source: sourceEntitlement ? mapEntitlementSource(sourceEntitlement.provider, sourceEntitlement.source) : legacySubscription ? 'stripe' : 'db',
    isPaid,
    isAdmin,
    isAuthed: true,
    mode: tier === 'premium' ? 'live' : 'public',
    refreshIntervalSeconds: tier === 'premium' ? 15 : 900,
    capabilities: {
      canUseSavedItems: tier === 'premium',
      canUseLaunchFilters: true,
      canUseLaunchCalendar: true,
      canUseOneOffCalendar: true,
      canUseLiveFeed: tier === 'premium',
      canUseChangeLog: tier === 'premium',
      canUseInstantAlerts: tier === 'premium',
      canManageFilterPresets: tier === 'premium',
      canManageFollows: tier === 'premium',
      canUseBasicAlertRules: true,
      canUseAdvancedAlertRules: tier === 'premium',
      canUseBrowserLaunchAlerts: false,
      canUseSingleLaunchFollow: true,
      canUseAllUsLaunchAlerts: true,
      canUseStateLaunchAlerts: tier === 'premium',
      canUseRecurringCalendarFeeds: tier === 'premium',
      canUseRssFeeds: tier === 'premium',
      canUseEmbedWidgets: tier === 'premium',
      canUseArTrajectory: tier === 'premium',
      canUseEnhancedForecastInsights: tier === 'premium',
      canUseLaunchDayEmail: false
    },
    limits: {
      presetLimit: tier === 'premium' ? 50 : 0,
      filterPresetLimit: tier === 'premium' ? 50 : 0,
      watchlistLimit: tier === 'premium' ? 50 : 0,
      watchlistRuleLimit: tier === 'premium' ? 500 : 0,
      singleLaunchFollowLimit: tier === 'premium' ? 0 : 1
    },
    cancelAtPeriodEnd: Boolean(sourceEntitlement?.cancel_at_period_end ?? legacySubscription?.cancel_at_period_end),
    currentPeriodEnd: sourceEntitlement?.current_period_end ?? legacySubscription?.current_period_end ?? null,
    stripePriceId:
      sourceEntitlement?.provider === 'stripe'
        ? sourceEntitlement.provider_product_id
        : legacySubscription?.stripe_price_id ?? null,
    reconciled: false,
    reconcileThrottled: false,
    userId
  };
}

function readSupabaseEnv() {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return {
    supabaseUrl,
    serviceRoleKey
  };
}

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

  const { supabaseUrl, serviceRoleKey } = readSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) {
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const [profileResult, providerCustomersResult, purchaseEntitlementsResult, purchaseEventsResult, subscriptionResult] =
    await Promise.all([
      admin.from('profiles').select('role,email').eq('user_id', userId).maybeSingle<ProfileRow>(),
      admin.from('purchase_provider_customers').select('*').eq('user_id', userId).order('provider', { ascending: true }),
      admin
        .from('purchase_entitlements')
        .select('*')
        .eq('user_id', userId)
        .eq('entitlement_key', 'premium')
        .order('updated_at', { ascending: false }),
      admin.from('purchase_events').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
      admin.from('subscriptions').select('*').eq('user_id', userId).maybeSingle<SubscriptionRow>()
    ]);

  if (profileResult.error) throw profileResult.error;
  if (providerCustomersResult.error) throw providerCustomersResult.error;
  if (purchaseEntitlementsResult.error) throw purchaseEntitlementsResult.error;
  if (purchaseEventsResult.error) throw purchaseEventsResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;

  const providerCustomers = (providerCustomersResult.data ?? []) as ProviderCustomerRow[];
  const purchaseEntitlements = (purchaseEntitlementsResult.data ?? []) as PurchaseEntitlementRow[];
  const purchaseEvents = (purchaseEventsResult.data ?? []) as PurchaseEventRow[];
  const providerEntitlement = purchaseEntitlements[0] ?? null;
  const legacySubscription = subscriptionResult.data ?? null;

  const providerEventIds = new Set(
    purchaseEvents
      .map((row) => (typeof row.provider_event_id === 'string' ? row.provider_event_id.trim() : ''))
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
    billingSummary: buildBillingSummary({
      providerEntitlement,
      legacySubscription
    }),
    entitlements: buildEntitlementSnapshot({
      userId,
      role: profileResult.data?.role ?? null,
      providerEntitlement,
      legacySubscription
    }),
    providerCustomers,
    purchaseEntitlements,
    purchaseEvents,
    webhookEvents
  });

  writeArtifact(artifact);
}

async function loadWebhookEvents(
  admin: ReturnType<typeof createClient>,
  providerEventIds: string[]
) {
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
