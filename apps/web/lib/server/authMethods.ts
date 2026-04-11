import { authMethodsSchemaV1, type AuthMethodV1 } from '@tminuszero/contracts';
import { collectAuthSourceProviders, normalizeAuthSourceProvider } from '@tminuszero/domain';
import type { User, UserIdentity } from '@supabase/supabase-js';
import { getStoredAppleSignInToken, isApplePrivateRelayEmail } from '@/lib/server/appleAuth';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

type SupportedAuthMethodProvider = AuthMethodV1['provider'];

function normalizeSupportedProvider(value: unknown): SupportedAuthMethodProvider | null {
  return normalizeAuthSourceProvider(value);
}

function collectSupportedProviders(user: User | null | undefined) {
  const appMetadata = ((user?.app_metadata || {}) as Record<string, unknown>) ?? {};
  return new Set<SupportedAuthMethodProvider>(
    collectAuthSourceProviders({
      identityProviders: (Array.isArray(user?.identities) ? user.identities : []).map((identity) => identity?.provider),
      primaryProvider: appMetadata.provider,
      appProviders: Array.isArray(appMetadata.providers) ? appMetadata.providers : []
    })
  );
}

function findIdentity(user: User | null | undefined, provider: SupportedAuthMethodProvider) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return (
    identities.find((identity) => normalizeSupportedProvider(identity?.provider) === provider) ?? null
  );
}

function readIdentityEmail(identity: UserIdentity | null) {
  if (!identity?.identity_data || typeof identity.identity_data !== 'object') {
    return null;
  }

  const email = (identity.identity_data as Record<string, unknown>).email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

function readIdentityLinkedAt(identity: UserIdentity | null) {
  if (!identity) {
    return null;
  }

  const createdAt = typeof identity.created_at === 'string' && identity.created_at.trim() ? identity.created_at.trim() : null;
  if (createdAt) {
    return createdAt;
  }

  const updatedAt = typeof identity.updated_at === 'string' && identity.updated_at.trim() ? identity.updated_at.trim() : null;
  if (updatedAt) {
    return updatedAt;
  }

  return null;
}

function hasBackupMethod(
  supportedProviders: Set<SupportedAuthMethodProvider>,
  currentProvider: SupportedAuthMethodProvider
) {
  return [...supportedProviders].some((provider) => provider !== currentProvider);
}

export async function loadAuthMethodsPayload(session: ResolvedViewerSession) {
  if (!session.userId || !session.user) {
    return null;
  }

  const supportedProviders = collectSupportedProviders(session.user);
  const emailIdentity = findIdentity(session.user, 'email_password');
  const googleIdentity = findIdentity(session.user, 'google');
  const appleIdentity = findIdentity(session.user, 'apple');
  const emailLinked = supportedProviders.has('email_password');
  const googleLinked = supportedProviders.has('google');
  const appleLinked = supportedProviders.has('apple');
  const storedAppleToken = appleLinked
    ? isSupabaseAdminConfigured()
      ? await getStoredAppleSignInToken(createSupabaseAdminClient(), session.userId).catch(() => null)
      : null
    : null;
  const googleEmail = readIdentityEmail(googleIdentity) ?? session.email ?? null;
  const appleEmail = readIdentityEmail(appleIdentity) ?? storedAppleToken?.email ?? null;

  const methods: AuthMethodV1[] = [
    {
      provider: 'email_password',
      linked: emailLinked,
      linkedAt: readIdentityLinkedAt(emailIdentity),
      email: session.email,
      canLink: false,
      canUnlink: false,
      unlinkBlockedReason: null
    },
    {
      provider: 'google',
      linked: googleLinked,
      linkedAt: readIdentityLinkedAt(googleIdentity),
      email: googleEmail,
      canLink: !googleLinked,
      canUnlink: googleLinked && hasBackupMethod(supportedProviders, 'google'),
      unlinkBlockedReason: googleLinked && !hasBackupMethod(supportedProviders, 'google') ? 'backup_method_required' : null
    },
    {
      provider: 'apple',
      linked: appleLinked,
      linkedAt: readIdentityLinkedAt(appleIdentity) ?? storedAppleToken?.lastCapturedAt ?? null,
      email: appleEmail,
      emailIsPrivateRelay: isApplePrivateRelayEmail(appleEmail),
      canLink: !appleLinked,
      canUnlink: appleLinked && hasBackupMethod(supportedProviders, 'apple'),
      unlinkBlockedReason: appleLinked && !hasBackupMethod(supportedProviders, 'apple') ? 'backup_method_required' : null
    }
  ];

  return authMethodsSchemaV1.parse({
    viewerId: session.userId,
    email: session.email,
    methods
  });
}
