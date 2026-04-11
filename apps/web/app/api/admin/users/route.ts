import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { getSiteUrl, isStripeConfigured } from '@/lib/server/env';
import { isSubscriptionActive } from '@/lib/server/subscription';
import { stripe } from '@/lib/api/stripe';
import { recordBillingEvent } from '@/lib/server/billingEvents';
import { requireAdminRequest } from '../_lib/auth';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['user', 'admin'])
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    userId: z.string().min(1),
    action: z.literal('reset_password')
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('suspend'),
    banDuration: z.string().min(1)
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('unsuspend')
  }),
  z.object({
    userId: z.string().min(1),
    action: z.literal('delete'),
    confirm: z.string().min(1)
  })
]);

const requestSchema = z.union([updateSchema, actionSchema]);

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(160).default(''),
  provider: z.string().trim().max(40).default(''),
  platform: z.string().trim().max(20).default('')
});

type AdminAuthUser = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

type AdminUserSummary = {
  user_id: string;
  email: string | null;
  first_name?: string | null;
  last_name?: string | null;
  role: 'user' | 'admin';
  status: string;
  is_paid: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  providers: string[];
  primary_provider: string | null;
  platforms: string[];
  last_sign_in_platform: string | null;
  last_mobile_sign_in_at: string | null;
  avatar_url: string | null;
  identity_display_name: string | null;
  email_is_private_relay: boolean;
  billing: {
    provider: 'stripe' | 'apple_app_store' | 'google_play' | null;
    status: string | null;
    provider_product_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    source: 'provider_entitlement' | 'legacy_subscription' | 'none';
  };
  recent_auth_events: Array<{
    provider: string;
    platform: string;
    event_type: string;
    created_at: string | null;
  }>;
};

function mapProfileRoleToAuthRole(role: 'user' | 'admin') {
  return role === 'admin' ? 'admin' : 'member';
}

function isMissingRelationError(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase();
  return message.includes('relation') && message.includes('does not exist');
}

function normalizeProviderLabel(value: unknown) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  if (normalized === 'email' || normalized === 'email_password') return 'email_password';
  return normalized;
}

function extractProviders(user: AdminAuthUser) {
  const appMeta = ((user as { app_metadata?: Record<string, unknown> }).app_metadata || {}) as Record<string, unknown>;
  const providerCandidates = [
    normalizeProviderLabel(appMeta.provider),
    ...(Array.isArray(appMeta.providers) ? appMeta.providers.map(normalizeProviderLabel) : [])
  ].filter((value): value is string => Boolean(value));

  if (providerCandidates.length === 0 && user.email) {
    providerCandidates.push('email_password');
  }

  const providers = Array.from(new Set(providerCandidates));
  return {
    providers,
    primaryProvider: providers[0] ?? null
  };
}

function extractIdentityDisplayName(user: AdminAuthUser, profile?: { first_name?: string | null; last_name?: string | null }) {
  const meta = ((user as { user_metadata?: Record<string, unknown> }).user_metadata || {}) as Record<string, unknown>;
  const profileName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  const metadataName = [meta.full_name, meta.name].find((value) => typeof value === 'string' && value.trim().length > 0);
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName.trim();
  return profileName || null;
}

function extractAvatarUrl(user: AdminAuthUser) {
  const meta = ((user as { user_metadata?: Record<string, unknown> }).user_metadata || {}) as Record<string, unknown>;
  const avatar = [meta.avatar_url, meta.picture].find((value) => typeof value === 'string' && value.trim().length > 0);
  return typeof avatar === 'string' ? avatar.trim() : null;
}

function extractPlatforms(summary?: {
  ever_used_web?: boolean | null;
  ever_used_ios?: boolean | null;
  ever_used_android?: boolean | null;
  last_sign_in_platform?: string | null;
}) {
  const platforms: string[] = [];
  if (summary?.ever_used_web) platforms.push('web');
  if (summary?.ever_used_ios) platforms.push('ios');
  if (summary?.ever_used_android) platforms.push('android');
  if (summary?.last_sign_in_platform && !platforms.includes(summary.last_sign_in_platform)) {
    platforms.push(summary.last_sign_in_platform);
  }
  return platforms;
}

function matchesQueryFilter(user: AdminUserSummary, filters: z.infer<typeof querySchema>) {
  if (filters.provider && !user.providers.includes(filters.provider)) {
    return false;
  }

  if (filters.platform && !user.platforms.includes(filters.platform) && user.last_sign_in_platform !== filters.platform) {
    return false;
  }

  if (!filters.q) {
    return true;
  }

  const query = filters.q.toLowerCase();
  const haystack = [
    user.user_id,
    user.email,
    user.first_name,
    user.last_name,
    user.identity_display_name,
    user.status,
    user.role,
    ...user.providers,
    ...user.platforms,
    user.billing.provider,
    user.billing.status,
    user.billing.provider_product_id
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

async function loadAdminUserBatch(admin: ReturnType<typeof createSupabaseAdminClient>, authUsers: AdminAuthUser[]) {
  if (authUsers.length === 0) {
    return [] as AdminUserSummary[];
  }

  const userIds = authUsers.map((user) => user.id);
  const [
    { data: profiles, error: profilesError },
    { data: subscriptions, error: subscriptionsError },
    providerEntitlementsRes,
    { data: summaries, error: summariesError },
    { data: recentEvents, error: recentEventsError }
  ] =
    await Promise.all([
      admin.from('profiles').select('user_id, role, email, created_at, first_name, last_name').in('user_id', userIds),
      admin.from('subscriptions').select('user_id, status, current_period_end').in('user_id', userIds),
      admin
        .from('purchase_entitlements')
        .select('user_id, provider, status, is_active, cancel_at_period_end, current_period_end, provider_product_id')
        .in('user_id', userIds),
      admin
        .from('user_surface_summary')
        .select('user_id, last_sign_in_platform, last_mobile_sign_in_at, ever_used_web, ever_used_ios, ever_used_android')
        .in('user_id', userIds),
      admin
        .from('user_sign_in_events')
        .select('user_id, provider, platform, event_type, created_at')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
    ]);

  if (profilesError) {
    console.error('admin profiles fetch error', profilesError);
  }
  if (subscriptionsError) {
    console.error('admin subscriptions fetch error', subscriptionsError);
  }
  if (providerEntitlementsRes.error && !isMissingRelationError(providerEntitlementsRes.error)) {
    console.error('admin purchase entitlements fetch error', providerEntitlementsRes.error);
  }
  if (summariesError) {
    console.error('admin user surface summary fetch error', summariesError);
  }
  if (recentEventsError) {
    console.error('admin sign-in events fetch error', recentEventsError);
  }

  const profileMap = new Map<
    string,
    {
      role?: string;
      email?: string | null;
      created_at?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    }
  >();
  (profiles || []).forEach((profile) => {
    profileMap.set(profile.user_id, {
      role: profile.role ?? 'user',
      email: profile.email ?? null,
      created_at: profile.created_at ?? null,
      first_name: profile.first_name ?? null,
      last_name: profile.last_name ?? null
    });
  });

  const subscriptionMap = new Map<string, { status?: string | null; current_period_end?: string | null }>();
  (subscriptions || []).forEach((subscription) => {
    subscriptionMap.set(subscription.user_id, {
      status: subscription.status ?? null,
      current_period_end: subscription.current_period_end ?? null
    });
  });

  const providerEntitlementMap = new Map<
    string,
    {
      provider: 'stripe' | 'apple_app_store' | 'google_play';
      status: string | null;
      is_active: boolean;
      cancel_at_period_end: boolean;
      current_period_end: string | null;
      provider_product_id: string | null;
    }
  >();
  (providerEntitlementsRes.data || []).forEach((entitlement) => {
    const provider =
      entitlement.provider === 'apple_app_store' || entitlement.provider === 'google_play' ? entitlement.provider : 'stripe';
    providerEntitlementMap.set(entitlement.user_id, {
      provider,
      status: entitlement.status ?? null,
      is_active: Boolean(entitlement.is_active),
      cancel_at_period_end: Boolean(entitlement.cancel_at_period_end),
      current_period_end: entitlement.current_period_end ?? null,
      provider_product_id: entitlement.provider_product_id ?? null
    });
  });

  const summaryMap = new Map<
    string,
    {
      last_sign_in_platform?: string | null;
      last_mobile_sign_in_at?: string | null;
      ever_used_web?: boolean | null;
      ever_used_ios?: boolean | null;
      ever_used_android?: boolean | null;
    }
  >();
  (summaries || []).forEach((summary) => {
    summaryMap.set(summary.user_id, {
      last_sign_in_platform: summary.last_sign_in_platform ?? null,
      last_mobile_sign_in_at: summary.last_mobile_sign_in_at ?? null,
      ever_used_web: summary.ever_used_web ?? false,
      ever_used_ios: summary.ever_used_ios ?? false,
      ever_used_android: summary.ever_used_android ?? false
    });
  });

  const recentEventMap = new Map<string, AdminUserSummary['recent_auth_events']>();
  (recentEvents || []).forEach((event) => {
    const entries = recentEventMap.get(event.user_id) ?? [];
    if (entries.length >= 3) return;
    entries.push({
      provider: String(event.provider || 'unknown'),
      platform: String(event.platform || 'unknown'),
      event_type: String(event.event_type || 'unknown'),
      created_at: event.created_at ?? null
    });
    recentEventMap.set(event.user_id, entries);
  });

  return authUsers.map((user) => {
    const profile = profileMap.get(user.id);
    const subscription = subscriptionMap.get(user.id);
    const providerEntitlement = providerEntitlementMap.get(user.id);
    const summary = summaryMap.get(user.id);
    const isPaid = typeof providerEntitlement?.is_active === 'boolean' ? providerEntitlement.is_active : isSubscriptionActive(subscription);
    const { providers, primaryProvider } = extractProviders(user);
    const userMeta = (user.user_metadata || {}) as Record<string, unknown>;
    const role: AdminUserSummary['role'] = profile?.role === 'admin' ? 'admin' : 'user';
    const status = role === 'admin' ? 'admin' : isPaid ? 'paid' : 'anon';
    const email = profile?.email ?? user.email ?? null;
    const firstName = profile?.first_name ?? (typeof userMeta.first_name === 'string' ? userMeta.first_name : null);
    const lastName = profile?.last_name ?? (typeof userMeta.last_name === 'string' ? userMeta.last_name : null);
    const billingProvider = providerEntitlement?.provider ?? (subscription ? 'stripe' : null);
    const billingStatus = providerEntitlement?.status ?? subscription?.status ?? null;
    const billingSource: AdminUserSummary['billing']['source'] = providerEntitlement
      ? 'provider_entitlement'
      : subscription
        ? 'legacy_subscription'
        : 'none';

    return {
      user_id: user.id,
      email,
      role,
      created_at: profile?.created_at ?? user.created_at ?? null,
      last_sign_in_at: user.last_sign_in_at ?? null,
      banned_until: user.banned_until ?? null,
      first_name: firstName,
      last_name: lastName,
      is_paid: isPaid,
      status,
      providers,
      primary_provider: primaryProvider,
      platforms: extractPlatforms(summary),
      last_sign_in_platform: summary?.last_sign_in_platform ?? null,
      last_mobile_sign_in_at: summary?.last_mobile_sign_in_at ?? null,
      avatar_url: extractAvatarUrl(user),
      identity_display_name: extractIdentityDisplayName(user, { first_name: firstName, last_name: lastName }),
      email_is_private_relay: typeof email === 'string' && email.toLowerCase().endsWith('privaterelay.appleid.com'),
      billing: {
        provider: billingProvider,
        status: billingStatus,
        provider_product_id: providerEntitlement?.provider_product_id ?? null,
        current_period_end: providerEntitlement?.current_period_end ?? subscription?.current_period_end ?? null,
        cancel_at_period_end: providerEntitlement?.cancel_at_period_end ?? false,
        source: billingSource
      },
      recent_auth_events: recentEventMap.get(user.id) ?? []
    };
  });
}

export async function GET(request: Request) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsedQuery = querySchema.safeParse(params);
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'invalid_query', detail: parsedQuery.error.flatten() }, { status: 400 });
  }

  const filters = parsedQuery.data;
  const admin = gate.context.admin;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  const matchedUsers: AdminUserSummary[] = [];
  const scanPerPage = Math.max(filters.perPage, 50);
  const requiredMatches = filters.page * filters.perPage;
  let scanPage = 1;
  let hasSourceMore = true;

  while (hasSourceMore && matchedUsers.length < requiredMatches) {
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ perPage: scanPerPage, page: scanPage });
    if (usersError || !usersData) {
      console.error('admin users list error', usersError);
      return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
    }

    const batchUsers = await loadAdminUserBatch(admin, usersData.users as AdminAuthUser[]);
    matchedUsers.push(...batchUsers.filter((candidate) => matchesQueryFilter(candidate, filters)));

    hasSourceMore = usersData.users.length === scanPerPage;
    scanPage += 1;

    if (scanPage > 25) {
      break;
    }
  }

  const startIndex = (filters.page - 1) * filters.perPage;
  const users = matchedUsers.slice(startIndex, startIndex + filters.perPage);
  const hasMore = matchedUsers.length > startIndex + filters.perPage || hasSourceMore;

  return NextResponse.json(
    {
      users,
      page: filters.page,
      perPage: filters.perPage,
      hasMore
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: Request) {
  const gate = await requireAdminRequest({ requireServiceRole: true });
  if (!gate.ok) return gate.response;

  const json = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });

  const admin = gate.context.admin;
  if (!admin) return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  if ('action' in parsed.data) {
    if (parsed.data.action === 'reset_password') {
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
      if (userError || !userData?.user) {
        console.error('admin get user error', userError);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }
      const email = userData.user.email ?? null;
      if (!email) {
        return NextResponse.json({ error: 'missing_email' }, { status: 409 });
      }
      const redirectTo = `${getSiteUrl()}/auth/reset-password`;
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        console.error('admin reset password error', error);
        return NextResponse.json({ error: 'failed_to_send_reset' }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    }

    if (parsed.data.action === 'suspend') {
      const { data: userData, error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
        ban_duration: parsed.data.banDuration
      });
      if (error) {
        console.error('admin suspend error', error);
        return NextResponse.json({ error: 'failed_to_suspend' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, banned_until: (userData?.user as { banned_until?: string | null })?.banned_until ?? null });
    }

    if (parsed.data.action === 'unsuspend') {
      const { data: userData, error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
        ban_duration: 'none'
      });
      if (error) {
        console.error('admin unsuspend error', error);
        return NextResponse.json({ error: 'failed_to_unsuspend' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, banned_until: (userData?.user as { banned_until?: string | null })?.banned_until ?? null });
    }

    if (parsed.data.action === 'delete') {
      if (parsed.data.confirm.trim().toUpperCase() !== 'DELETE') {
        return NextResponse.json({ error: 'confirm_required' }, { status: 400 });
      }

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
      if (userError || !userData?.user) {
        console.error('admin get user error', userError);
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }

      const { data: subscription, error: subError } = await admin
        .from('subscriptions')
        .select('status, stripe_subscription_id')
        .eq('user_id', parsed.data.userId)
        .maybeSingle();

      if (subError) {
        console.error('admin delete subscription check error', subError);
        return NextResponse.json({ error: 'failed_to_check_subscription' }, { status: 500 });
      }

      if (isSubscriptionActive(subscription)) {
        if (!isStripeConfigured() || !subscription?.stripe_subscription_id) {
          return NextResponse.json({ error: 'active_subscription' }, { status: 409 });
        }

        try {
          const updated = await stripe.subscriptions.update(subscription.stripe_subscription_id, { cancel_at_period_end: true });
          const currentPeriodEnd = updated.current_period_end ? new Date(updated.current_period_end * 1000).toISOString() : null;
          await recordBillingEvent({
            admin,
            userId: parsed.data.userId,
            email: userData.user.email ?? null,
            eventType: 'subscription_cancel_requested',
            source: 'account_delete',
            stripeSubscriptionId: updated.id,
            status: updated.status || 'unknown',
            cancelAtPeriodEnd: Boolean(updated.cancel_at_period_end),
            currentPeriodEnd,
            sendEmail: false
          });
        } catch (err: any) {
          console.error('admin delete stripe cancel error', err);
          return NextResponse.json({ error: 'failed_to_cancel_subscription' }, { status: 502 });
        }
      }

      const { error: deleteError } = await admin.auth.admin.deleteUser(parsed.data.userId);
      if (deleteError) {
        console.error('admin delete user error', deleteError);
        return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'unsupported_action' }, { status: 400 });
  }

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(parsed.data.userId);
  if (userError || !userData?.user) {
    console.error('admin get user error', userError);
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  const email = userData?.user?.email ?? null;
  const { error } = await admin
    .from('profiles')
    .upsert(
      { user_id: parsed.data.userId, email, role: parsed.data.role, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('admin role update error', error);
    return NextResponse.json({ error: 'failed_to_update' }, { status: 500 });
  }

  // Keep auth metadata aligned so viewer-session fallback still recognizes admins if profile reads fail.
  const currentAppMetadata =
    userData.user.app_metadata && typeof userData.user.app_metadata === 'object'
      ? (userData.user.app_metadata as Record<string, unknown>)
      : {};
  const { error: authMetadataError } = await admin.auth.admin.updateUserById(parsed.data.userId, {
    app_metadata: {
      ...currentAppMetadata,
      role: mapProfileRoleToAuthRole(parsed.data.role)
    }
  });

  if (authMetadataError) {
    console.error('admin auth metadata role sync error', authMetadataError);
    return NextResponse.json({ error: 'failed_to_update_auth_metadata' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
