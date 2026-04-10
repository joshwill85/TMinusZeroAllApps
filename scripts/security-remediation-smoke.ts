import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import util from 'node:util';
import { createClient } from '@supabase/supabase-js';
import * as adminUsaspendingReviews from '@/lib/server/adminUsaspendingReviews';
import * as premiumClaims from '@/lib/server/premiumClaims';
import * as supabaseServer from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

const { listAdminUsaspendingReviews } = adminUsaspendingReviews as typeof import('@/lib/server/adminUsaspendingReviews');
const {
  attachPremiumClaim,
  loadPremiumClaimEnvelope
} = premiumClaims as typeof import('@/lib/server/premiumClaims');
const { createSupabaseAdminClient } = supabaseServer as typeof import('@/lib/server/supabaseServer');

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type DisposableUser = {
  userId: string;
  email: string;
  session: ResolvedViewerSession;
};

const assertions: string[] = [];

function requireEnv(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function jsonRequest(body: unknown) {
  return new Request('https://tmz.local/api', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function createDisposableAdminUser(admin: AdminClient) {
  const runId = `${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const email = `security-smoke+${runId}@example.com`;
  const password = `Tmz!${randomUUID()}Aa9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error || !data.user?.id) {
    throw error ?? new Error('Failed to create disposable auth user.');
  }

  const userId = data.user.id;
  const now = new Date().toISOString();
  const profileRes = await admin.from('profiles').upsert(
    {
      user_id: userId,
      email,
      role: 'admin',
      updated_at: now
    },
    { onConflict: 'user_id' }
  );
  if (profileRes.error) {
    throw profileRes.error;
  }

  const session: ResolvedViewerSession = {
    authMode: 'bearer',
    role: 'admin',
    user: data.user as ResolvedViewerSession['user'],
    userId,
    email,
    accessToken: null,
    expiresAt: null
  };

  return {
    runId,
    user: {
      userId,
      email,
      session
    } satisfies DisposableUser
  };
}

async function assertAnonApiAccessShape() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const anon = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const publicViewRes = await anon.from('program_usaspending_audited_awards').select('usaspending_award_id').limit(1);
  assert.equal(publicViewRes.error, null, `public audited-awards view should remain readable: ${publicViewRes.error?.message ?? 'ok'}`);

  for (const tableName of ['premium_claims', 'notification_push_destinations_v3', 'notification_rules_v3']) {
    const result = await anon.from(tableName).select('id').limit(1);
    assert.ok(result.error, `${tableName} should not be readable through anon PostgREST`);
  }

  assertions.push('anon API access is blocked for private tables while the public audited awards view remains readable');
}

async function verifyPremiumClaimAttach(admin: AdminClient, user: DisposableUser, runId: string) {
  const providerEventId = `security-smoke:${runId}:claim`;
  const claimInsert = await admin
    .from('premium_claims')
    .insert({
      provider: 'apple_app_store',
      product_key: 'premium_monthly',
      status: 'verified',
      email: user.email,
      return_to: '/account',
      provider_event_id: providerEventId,
      provider_product_id: 'tmz.premium.monthly',
      provider_status: 'active',
      cancel_at_period_end: false,
      current_period_end: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      metadata: {
        source: 'security_remediation_smoke'
      }
    })
    .select('id,claim_token,status,user_id')
    .single();
  if (claimInsert.error) {
    throw claimInsert.error;
  }

  const claimToken = String(claimInsert.data.claim_token);
  const loaded = await loadPremiumClaimEnvelope(claimToken);
  assert.equal(loaded.claim.claimToken, claimToken);
  assert.equal(loaded.claim.status, 'verified');

  const attached = await attachPremiumClaim(user.session, claimToken);
  assert.equal(attached.ok, true);
  assert.equal(attached.claim.status, 'claimed');
  assert.equal(attached.claim.claimToken, claimToken);
  assert.equal(attached.claim.email, user.email);

  const claimRow = await admin
    .from('premium_claims')
    .select('user_id,status')
    .eq('claim_token', claimToken)
    .maybeSingle();
  if (claimRow.error) {
    throw claimRow.error;
  }
  assert.equal(claimRow.data?.user_id, user.userId);
  assert.equal(claimRow.data?.status, 'claimed');

  assertions.push('premium claims remain server-owned and attach correctly after RLS and grant revokes');
}

async function verifyPushAndAlertFlows(admin: AdminClient, user: DisposableUser, runId: string) {
  const {
    createAlertRulePayload,
    deleteAlertRulePayload,
    enqueuePushDeviceTestPayload,
    registerPushDevicePayload,
    removePushDevicePayload
  } = (await import('@/lib/server/v1/mobileApi')) as typeof import('@/lib/server/v1/mobileApi');
  const installationId = `security-smoke-${runId}`;
  const destinationKey = `expo:ios:${installationId}`;

  const registered = await registerPushDevicePayload(
    user.session,
    jsonRequest({
      platform: 'ios',
      installationId,
      token: `ExponentPushToken[${runId}]`,
      appVersion: 'security-smoke',
      deviceName: 'Security Smoke iPhone'
    })
  );

  assert.equal(registered.platform, 'ios');
  assert.equal(registered.installationId, installationId);
  assert.equal(registered.active, true);

  const pushRow = await admin
    .from('notification_push_destinations_v3')
    .select('user_id,installation_id,is_active,delivery_kind,push_provider,destination_key')
    .eq('user_id', user.userId)
    .eq('destination_key', destinationKey)
    .maybeSingle();
  if (pushRow.error) {
    throw pushRow.error;
  }
  assert.equal(pushRow.data?.installation_id, installationId);
  assert.equal(pushRow.data?.is_active, true);
  assert.equal(pushRow.data?.delivery_kind, 'mobile_push');
  assert.equal(pushRow.data?.push_provider, 'expo');

  const queued = await enqueuePushDeviceTestPayload(user.session);
  assert.equal(queued.ok, true);

  const outboxRow = await admin
    .from('mobile_push_outbox_v2')
    .select('id,event_type,user_id')
    .eq('user_id', user.userId)
    .eq('event_type', 'test')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (outboxRow.error) {
    throw outboxRow.error;
  }
  assert.equal(outboxRow.data?.user_id, user.userId);
  assert.equal(outboxRow.data?.event_type, 'test');

  const createdAlert = await createAlertRulePayload(
    user.session,
    jsonRequest({
      kind: 'region_us'
    })
  );
  assert.equal(createdAlert.rule.kind, 'region_us');

  const unifiedAlertRow = await admin
    .from('notification_rules_v3')
    .select('id,owner_key,scope_kind,scope_key,channels,intent')
    .eq('owner_key', `user:${user.userId}`)
    .eq('scope_kind', 'all_us')
    .eq('scope_key', 'us')
    .maybeSingle();
  if (unifiedAlertRow.error) {
    throw unifiedAlertRow.error;
  }
  assert.equal(unifiedAlertRow.data?.intent, 'notifications_only');
  assert.deepEqual(unifiedAlertRow.data?.channels, ['push']);

  await deleteAlertRulePayload(user.session, createdAlert.rule.id);

  const removedAlertRow = await admin
    .from('notification_rules_v3')
    .select('id')
    .eq('owner_key', `user:${user.userId}`)
    .eq('scope_kind', 'all_us')
    .eq('scope_key', 'us')
    .maybeSingle();
  assert.equal(removedAlertRow.error, null);
  assert.equal(removedAlertRow.data, null);

  const removed = await removePushDevicePayload(
    user.session,
    jsonRequest({
      platform: 'ios',
      installationId
    })
  );
  assert.equal(removed.removed, true);

  const deactivatedPushRow = await admin
    .from('notification_push_destinations_v3')
    .select('is_active,last_failure_reason')
    .eq('user_id', user.userId)
    .eq('destination_key', destinationKey)
    .maybeSingle();
  if (deactivatedPushRow.error) {
    throw deactivatedPushRow.error;
  }
  assert.equal(deactivatedPushRow.data?.is_active, false);
  assert.equal(deactivatedPushRow.data?.last_failure_reason, 'device_removed');

  assertions.push('push registration, test enqueue, alert rule creation, and alert cleanup still work through admin-owned notification writes');
}

async function verifyWatchlistFollowSync(admin: AdminClient, user: DisposableUser) {
  const {
    createWatchlistPayload,
    createWatchlistRulePayload,
    deleteWatchlistPayload,
    deleteWatchlistRulePayload
  } = (await import('@/lib/server/v1/mobileApi')) as typeof import('@/lib/server/v1/mobileApi');
  const createdWatchlist = await createWatchlistPayload(
    user.session,
    jsonRequest({
      name: 'Security Smoke Watchlist'
    })
  );
  const watchlistId = createdWatchlist.watchlist.id;
  assert.ok(watchlistId);

  const createdRule = await createWatchlistRulePayload(
    user.session,
    watchlistId,
    jsonRequest({
      ruleType: 'provider',
      ruleValue: 'Security Smoke Provider'
    })
  );

  const unifiedFollowRow = await admin
    .from('notification_rules_v3')
    .select('id,intent,visible_in_following,scope_kind,scope_key,channels')
    .eq('owner_key', `user:${user.userId}`)
    .eq('scope_kind', 'provider')
    .eq('scope_key', 'security smoke provider')
    .maybeSingle();
  if (unifiedFollowRow.error) {
    throw unifiedFollowRow.error;
  }
  assert.equal(unifiedFollowRow.data?.intent, 'follow');
  assert.equal(unifiedFollowRow.data?.visible_in_following, true);
  assert.deepEqual(unifiedFollowRow.data?.channels ?? [], []);

  await deleteWatchlistRulePayload(user.session, watchlistId, createdRule.rule.id);

  const removedUnifiedFollowRow = await admin
    .from('notification_rules_v3')
    .select('id')
    .eq('owner_key', `user:${user.userId}`)
    .eq('scope_kind', 'provider')
    .eq('scope_key', 'security smoke provider')
    .maybeSingle();
  assert.equal(removedUnifiedFollowRow.error, null);
  assert.equal(removedUnifiedFollowRow.data, null);

  await deleteWatchlistPayload(user.session, watchlistId);

  const watchlistRow = await admin.from('watchlists').select('id').eq('id', watchlistId).maybeSingle();
  assert.equal(watchlistRow.error, null);
  assert.equal(watchlistRow.data, null);

  assertions.push('saved-items follow sync still creates and clears unified follow rows through admin-owned notification writes');
}

async function verifyAdminUsaspendingRead(admin: AdminClient) {
  const response = await listAdminUsaspendingReviews(admin, {
    scope: 'blue-origin',
    tier: 'candidate',
    limit: 1,
    offset: 0
  });

  assert.equal(response.scope, 'blue-origin');
  assert.equal(response.tier, 'candidate');
  assert.ok(typeof response.total === 'number');
  assert.ok(typeof response.counts['blue-origin'].candidate === 'number');

  assertions.push('admin USASpending review queries still read through the audited awards view after switching to security_invoker');
}

async function cleanupDisposableUser(admin: AdminClient, user: DisposableUser) {
  const ownerKey = `user:${user.userId}`;

  const watchlists = await admin.from('watchlists').select('id').eq('user_id', user.userId);
  if (watchlists.error) {
    throw watchlists.error;
  }
  const watchlistIds = (watchlists.data ?? []).map((row) => row.id).filter((value): value is string => typeof value === 'string');

  if (watchlistIds.length) {
    const watchlistRuleDelete = await admin.from('watchlist_rules').delete().in('watchlist_id', watchlistIds);
    if (watchlistRuleDelete.error) {
      throw watchlistRuleDelete.error;
    }
  }

  for (const [table, query] of [
    ['mobile_push_outbox_v2', admin.from('mobile_push_outbox_v2').delete().eq('user_id', user.userId)],
    ['notification_alert_rules', admin.from('notification_alert_rules').delete().eq('user_id', user.userId)],
    ['notification_rules_v3', admin.from('notification_rules_v3').delete().eq('owner_key', ownerKey)],
    ['notification_push_destinations_v3', admin.from('notification_push_destinations_v3').delete().eq('owner_key', ownerKey)],
    ['watchlists', admin.from('watchlists').delete().eq('user_id', user.userId)],
    ['purchase_entitlements', admin.from('purchase_entitlements').delete().eq('user_id', user.userId)],
    ['purchase_provider_customers', admin.from('purchase_provider_customers').delete().eq('user_id', user.userId)],
    ['subscriptions', admin.from('subscriptions').delete().eq('user_id', user.userId)],
    ['stripe_customers', admin.from('stripe_customers').delete().eq('user_id', user.userId)],
    ['premium_claims', admin.from('premium_claims').delete().eq('email', user.email)],
    ['profiles', admin.from('profiles').delete().eq('user_id', user.userId)]
  ] as const) {
    const result = await query;
    if (result.error) {
      throw new Error(`cleanup failed for ${table}: ${result.error.message}`);
    }
  }

  const deleteUserRes = await admin.auth.admin.deleteUser(user.userId);
  if (deleteUserRes.error) {
    throw deleteUserRes.error;
  }
}

async function main() {
  const admin = createSupabaseAdminClient();
  const require = createRequire(import.meta.url);
  const react = require('react') as { cache?: <T>(fn: T) => T };
  react.cache ??= <T>(fn: T) => fn;

  console.log('security-remediation-smoke: verify anon api access');
  await assertAnonApiAccessShape();

  const { runId, user } = await createDisposableAdminUser(admin);
  try {
    console.log('security-remediation-smoke: verify premium claims');
    await verifyPremiumClaimAttach(admin, user, runId);
    console.log('security-remediation-smoke: verify push and alert flows');
    await verifyPushAndAlertFlows(admin, user, runId);
    console.log('security-remediation-smoke: verify watchlist follow sync');
    await verifyWatchlistFollowSync(admin, user);
    console.log('security-remediation-smoke: verify admin usaspending read');
    await verifyAdminUsaspendingRead(admin);
  } finally {
    await cleanupDisposableUser(admin, user);
  }

  console.log(`security-remediation-smoke: ok (${assertions.length} checks)`);
}

main().catch((error) => {
  console.error('security-remediation-smoke: FAIL');
  console.error(error instanceof Error ? error.stack || error.message : util.inspect(error, { depth: 8, colors: false }));
  process.exitCode = 1;
});
