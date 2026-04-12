import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as ExpoLinking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { createClient, type Session, type UserIdentity } from '@supabase/supabase-js';
import type { AuthProviderV1 } from '@tminuszero/contracts';
import { normalizeAuthSourceProvider, PREMIUM_PRIVACY_VERSION, PREMIUM_TERMS_VERSION } from '@tminuszero/domain';
import {
  createApiClient,
  type MobileAuthPasswordSignUpResponseV1,
  type MobileAuthRiskDecisionV1
} from '@tminuszero/api-client';
import {
  clearStoredAppleAuthIdentity,
  isMobileAppleAuthEnabled,
  persistStoredAppleAuthUserId,
  readStoredAppleAuthUserId,
  refreshStoredNativeAppleCredential,
  requestNativeAppleSignIn
} from '@/src/auth/appleAuth';
import { getApiBaseUrl, getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';
import { collectMobileAuthAttestation } from '@/src/auth/attestation';
import { getMobileAuthPlatform } from '@/src/auth/authContext';
import { readOrCreateAuthInstallationId } from '@/src/auth/riskStorage';

type MobileAuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  expiresAt: string | null;
  userId: string | null;
  email: string | null;
};

type SupabaseAuthError = Error & {
  status?: number;
};

type MobileAuthUser = {
  userId: string | null;
  email: string | null;
};

type MobileOAuthProvider = Extract<AuthProviderV1, 'apple' | 'google'>;

type CompleteMobileAuthResult = {
  provider: AuthProviderV1;
  session: MobileAuthSession;
  displayName?: string | null;
  emailIsPrivateRelay?: boolean;
};

type MobilePasswordAuthResult = {
  session: MobileAuthSession;
  riskSessionId: string;
};

type MobilePasswordSignUpResult = {
  session: MobileAuthSession | null;
  user: MobileAuthUser;
  requiresVerification: boolean;
  riskSessionId: string;
};

type MobilePasswordChallengeResult = {
  riskSessionId: string;
  challengeCode: string;
};

type PremiumOnboardingAuthOptions = {
  intent?: 'upgrade' | null;
  returnTo?: string | null;
  claimToken?: string | null;
  expectedEmail?: string | null;
};

const AUTH_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.auth.session',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};
const MOBILE_SUPABASE_AUTH_STORAGE_KEY = 'tmz.supabase.mobile-auth';

const secureStoreStorage = {
  getItem(key: string) {
    return SecureStore.getItemAsync(key, AUTH_SECURE_STORE_OPTIONS);
  },
  setItem(key: string, value: string) {
    return SecureStore.setItemAsync(key, value, AUTH_SECURE_STORE_OPTIONS);
  },
  removeItem(key: string) {
    return SecureStore.deleteItemAsync(key, AUTH_SECURE_STORE_OPTIONS);
  }
};

let mobileSupabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseAuthConfig() {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error('Supabase auth is not configured for mobile. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return { url, anonKey };
}

function getMobileSupabaseClient() {
  if (mobileSupabaseClient) {
    return mobileSupabaseClient;
  }

  const { url, anonKey } = getSupabaseAuthConfig();
  mobileSupabaseClient = createClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
      storage: secureStoreStorage,
      storageKey: MOBILE_SUPABASE_AUTH_STORAGE_KEY
    }
  });

  return mobileSupabaseClient;
}

function createGuestMobileAuthClient() {
  return createApiClient({
    baseUrl: getApiBaseUrl(),
    auth: { mode: 'guest' }
  });
}

function createBearerMobileAuthClient(accessToken: string) {
  return createApiClient({
    baseUrl: getApiBaseUrl(),
    auth: { mode: 'bearer', accessToken }
  });
}

function isApplePrivateRelayEmail(email: string | null | undefined) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .endsWith('privaterelay.appleid.com');
}

async function maybeHydrateAppleProfile(accessToken: string, firstName: string | null, lastName: string | null) {
  if (!firstName && !lastName) {
    return;
  }

  const client = createBearerMobileAuthClient(accessToken);
  const currentProfile = await client.getProfile().catch(() => null);
  const updates: { firstName?: string; lastName?: string } = {};

  if (firstName && !currentProfile?.firstName?.trim()) {
    updates.firstName = firstName;
  }
  if (lastName && !currentProfile?.lastName?.trim()) {
    updates.lastName = lastName;
  }

  if (Object.keys(updates).length === 0) {
    return;
  }

  await client.updateProfile(updates).catch(() => undefined);
}

async function captureNativeAppleCredential(
  accessToken: string,
  {
    authorizationCode,
    appleUserId,
    email,
    fallbackEmail,
    firstName,
    lastName
  }: {
    authorizationCode: string | null;
    appleUserId: string;
    email: string | null;
    fallbackEmail?: string | null;
    firstName: string | null;
    lastName: string | null;
  }
) {
  const normalizedCode = String(authorizationCode || '').trim();
  if (!normalizedCode) {
    throw new Error('Apple sign-in did not return a revocable authorization code. Please try again.');
  }

  const normalizedEmail = String(email || fallbackEmail || '').trim() || null;
  const client = createBearerMobileAuthClient(accessToken);
  return client.captureAppleAuth({
    source: 'ios_native_code',
    authorizationCode: normalizedCode,
    appleUserId,
    email: normalizedEmail,
    emailIsPrivateRelay: isApplePrivateRelayEmail(normalizedEmail),
    firstName,
    lastName
  });
}

export async function refreshAndCaptureStoredAppleCredential(accessToken: string) {
  const appleUserId = await readStoredAppleAuthUserId();
  if (!appleUserId) {
    return null;
  }

  const credential = await refreshStoredNativeAppleCredential(appleUserId);
  await captureNativeAppleCredential(accessToken, credential);
  await persistStoredAppleAuthUserId(credential.appleUserId).catch(() => undefined);
  return credential;
}

function readBuildProfile() {
  const extra = Constants.expoConfig?.extra;
  if (extra && typeof extra === 'object' && typeof (extra as { buildProfile?: unknown }).buildProfile === 'string') {
    const value = (extra as { buildProfile: string }).buildProfile.trim();
    return value || null;
  }
  return null;
}

function toMobileAuthSession(session: MobileAuthSession): MobileAuthSession {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: session.expiresIn,
    expiresAt: session.expiresAt,
    userId: session.userId,
    email: session.email
  };
}

function toMobileAuthUser(user: MobileAuthUser): MobileAuthUser {
  return {
    userId: user.userId,
    email: user.email
  };
}

function getChallengeRedirectUrl() {
  return ExpoLinking.createURL('/auth/challenge', {
    scheme: 'tminuszero'
  });
}

function formatRiskDecisionMessage(decision: MobileAuthRiskDecisionV1) {
  if (decision.reasonCode === 'rate_limited' && decision.retryAfterSeconds) {
    return `Too many attempts. Try again in ${decision.retryAfterSeconds} seconds.`;
  }

  if (decision.reasonCode === 'challenge_failed') {
    return 'The verification challenge could not be completed.';
  }

  return 'This request needs additional verification before it can continue.';
}

async function completeMobilePasswordChallenge(email: string, flow: 'sign_in' | 'sign_up' | 'resend' | 'recover') {
  const client = createGuestMobileAuthClient();
  const installationId = await readOrCreateAuthInstallationId();
  const decision = await client.startMobileAuthRisk({
    flow,
    email,
    installationId,
    platform: getMobileAuthPlatform(),
    appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
    buildProfile: readBuildProfile(),
    attestation: await collectMobileAuthAttestation()
  });

  if (decision.disposition === 'deny') {
    throw new Error(formatRiskDecisionMessage(decision));
  }
  if (!decision.challengeUrl) {
    throw new Error('The mobile auth challenge is not configured for this request.');
  }

  const redirectTo = getChallengeRedirectUrl();

  try {
    const result = await WebBrowser.openAuthSessionAsync(decision.challengeUrl, redirectTo);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Authentication was cancelled before it completed.');
    }
    if (result.type !== 'success' || !('url' in result) || typeof result.url !== 'string') {
      throw new Error('Authentication did not complete successfully.');
    }

    const params = buildParamMap(result.url);
    const errorDescription = params.get('error_description') ?? params.get('error') ?? '';
    if (errorDescription) {
      throw new Error(errorDescription);
    }

    const riskSessionId = params.get('risk_session')?.trim() ?? '';
    const challengeCode = params.get('challenge_code')?.trim() ?? '';
    if (!riskSessionId || !challengeCode) {
      throw new Error('The mobile auth challenge did not return a valid completion payload.');
    }
    if (riskSessionId !== decision.riskSessionId) {
      throw new Error('The mobile auth challenge completed for an unexpected session.');
    }

    return {
      riskSessionId,
      challengeCode
    } satisfies MobilePasswordChallengeResult;
  } finally {
    if (Platform.OS === 'android') {
      void WebBrowser.coolDownAsync().catch(() => {});
    }
  }
}

async function authRequest(pathname: string, init: RequestInit = {}) {
  const { url, anonKey } = getSupabaseAuthConfig();
  const headers = new Headers(init.headers ?? {});
  headers.set('apikey', anonKey);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${url}${pathname}`, {
    ...init,
    headers
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof json?.msg === 'string'
        ? json.msg
        : typeof json?.error_description === 'string'
          ? json.error_description
          : typeof json?.message === 'string'
            ? json.message
            : `Supabase auth request failed (${response.status})`;
    const error = new Error(message) as SupabaseAuthError;
    error.status = response.status;
    throw error;
  }

  return json;
}

function parseSupabaseSession(session: Session): MobileAuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token ?? null,
    expiresIn: Number.isFinite(session.expires_in) ? Number(session.expires_in) : null,
    expiresAt:
      typeof session.expires_at === 'number' && Number.isFinite(session.expires_at)
        ? new Date(session.expires_at * 1000).toISOString()
        : parseAccessTokenExpiry(session.access_token, Number.isFinite(session.expires_in) ? Number(session.expires_in) : null),
    userId: typeof session.user?.id === 'string' ? session.user.id : null,
    email: typeof session.user?.email === 'string' ? session.user.email : null
  };
}

function parseAuthSession(payload: unknown): MobileAuthSession {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const user = data?.user && typeof data.user === 'object' ? (data.user as Record<string, unknown>) : null;
  const accessToken = String(data?.access_token || '').trim();
  const expiresInRaw = data?.expires_in;
  if (!accessToken) {
    throw new Error('Supabase auth response did not include an access token.');
  }

  return {
    accessToken,
    refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : null,
    expiresIn: Number.isFinite(expiresInRaw) ? Number(expiresInRaw) : null,
    expiresAt: parseAccessTokenExpiry(accessToken, Number.isFinite(expiresInRaw) ? Number(expiresInRaw) : null),
    userId: typeof user?.id === 'string' ? user.id : null,
    email: typeof user?.email === 'string' ? user.email : null
  };
}

function readFirstString(value: unknown) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
}

function normalizeOAuthProvider(value: string): MobileOAuthProvider | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'apple' || normalized === 'google') {
    return normalized;
  }
  return null;
}

function normalizeAuthProvider(value: string): AuthProviderV1 {
  const oauthProvider = normalizeOAuthProvider(value);
  if (oauthProvider) {
    return oauthProvider;
  }
  if (value.trim().toLowerCase() === 'email') {
    return 'email_password';
  }
  return 'unknown';
}

function getOAuthRedirectUrl(provider: MobileOAuthProvider) {
  return ExpoLinking.createURL('/auth/callback', {
    scheme: 'tminuszero',
    queryParams: { provider }
  });
}

function getPremiumOnboardingPlatform() {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function normalizeOptionalEmail(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || null;
}

function buildGoogleAuthStartUrl({
  intent,
  returnTo,
  claimToken
}: PremiumOnboardingAuthOptions) {
  const url = new URL('/api/auth/google/start', getApiBaseUrl());
  url.searchParams.set('platform', getPremiumOnboardingPlatform());
  url.searchParams.set('return_to', returnTo?.trim() || '/profile');
  if (intent === 'upgrade') {
    url.searchParams.set('intent', intent);
  }
  if (claimToken?.trim()) {
    url.searchParams.set('claim_token', claimToken.trim());
  }
  return url.toString();
}

function buildParamMap(callbackUrl: string) {
  const parsed = ExpoLinking.parse(callbackUrl);
  const params = new Map<string, string>();

  Object.entries(parsed.queryParams ?? {}).forEach(([key, value]) => {
    const normalized = readFirstString(value).trim();
    if (normalized) {
      params.set(key, normalized);
    }
  });

  const hashIndex = callbackUrl.indexOf('#');
  if (hashIndex >= 0) {
    const hashParams = new URLSearchParams(callbackUrl.slice(hashIndex + 1));
    hashParams.forEach((value, key) => {
      if (value.trim()) {
        params.set(key, value.trim());
      }
    });
  }

  return params;
}

async function exchangeAuthCode(code: string) {
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('Supabase auth callback did not return a session.');
  }
  return parseSupabaseSession(data.session);
}

async function setAuthSession(accessToken: string, refreshToken: string) {
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('Supabase auth callback did not return a session.');
  }
  return parseSupabaseSession(data.session);
}

function findIdentityByProvider(
  identities: UserIdentity[] | null | undefined,
  provider: 'apple' | 'google' | 'email_password'
) {
  return (identities ?? []).find((identity) => normalizeAuthSourceProvider(identity?.provider) === provider) ?? null;
}

async function primeIdentityMutationSession(accessToken: string, refreshToken: string | null | undefined) {
  const normalizedAccessToken = String(accessToken || '').trim();
  const normalizedRefreshToken = String(refreshToken || '').trim();
  if (!normalizedAccessToken || !normalizedRefreshToken) {
    throw new Error('Please sign in again before changing login methods.');
  }

  return setAuthSession(normalizedAccessToken, normalizedRefreshToken);
}

async function getCurrentUserIdentities() {
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) {
    throw error;
  }

  return data.identities ?? [];
}

async function clearLinkedAppleArtifacts(accessToken: string) {
  await createBearerMobileAuthClient(accessToken).clearAppleAuthArtifacts().catch(() => undefined);
  await clearStoredAppleAuthIdentity().catch(() => undefined);
}

async function unlinkCurrentIdentity(options: {
  provider: 'apple' | 'google';
  cleanupAccessToken: string;
  requireBackupMethod: boolean;
}) {
  const identities = await getCurrentUserIdentities();
  const linkedIdentity = findIdentityByProvider(identities, options.provider);
  if (!linkedIdentity) {
    if (options.provider === 'apple') {
      await clearLinkedAppleArtifacts(options.cleanupAccessToken);
    }
    return false;
  }

  if (options.requireBackupMethod) {
    const hasBackupMethod = identities.some((identity) => {
      const normalized = normalizeAuthSourceProvider(identity?.provider);
      return Boolean(normalized && normalized !== options.provider);
    });
    if (!hasBackupMethod) {
      throw new Error(`Add another sign-in method before removing ${options.provider === 'google' ? 'Google' : 'Sign in with Apple'}.`);
    }
  }

  const supabase = getMobileSupabaseClient();
  const { error } = await supabase.auth.unlinkIdentity(linkedIdentity);
  if (error) {
    throw error;
  }

  if (options.provider === 'apple') {
    await clearLinkedAppleArtifacts(options.cleanupAccessToken);
  }
  return true;
}

async function preflightAppleProviderCreate({
  email,
  claimToken
}: {
  email: string | null;
  claimToken?: string | null;
}) {
  const normalizedEmail = normalizeOptionalEmail(email);
  if (!normalizedEmail) {
    return;
  }

  const preflight = await createGuestMobileAuthClient().preflightPremiumOnboardingProvider({
    intentId: null,
    claimToken: claimToken?.trim() || null,
    provider: 'apple',
    email: normalizedEmail
  });

  if (preflight.mode === 'create' && !preflight.createAllowed) {
    throw new Error('Complete Premium purchase verification before creating a new Apple account.');
  }
}

async function completeAppleSignIn(options: PremiumOnboardingAuthOptions = {}): Promise<CompleteMobileAuthResult> {
  if (!isMobileAppleAuthEnabled()) {
    throw new Error('Sign in with Apple is not enabled for this build.');
  }

  const nativeCredential = await requestNativeAppleSignIn();
  await preflightAppleProviderCreate({
    email: nativeCredential.email || options.expectedEmail || null,
    claimToken: options.claimToken
  });
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: nativeCredential.identityToken,
    nonce: nativeCredential.nonce
  });

  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('Supabase auth callback did not return a session.');
  }

  const completed: CompleteMobileAuthResult = {
    provider: 'apple',
    session: parseSupabaseSession(data.session),
    displayName: nativeCredential.displayName,
    emailIsPrivateRelay: isApplePrivateRelayEmail(nativeCredential.email)
  };

  await maybeHydrateAppleProfile(
    completed.session.accessToken,
    nativeCredential.firstName,
    nativeCredential.lastName
  ).catch(() => undefined);
  try {
    await captureNativeAppleCredential(completed.session.accessToken, {
      ...nativeCredential,
      fallbackEmail: completed.session.email
    });
    await persistStoredAppleAuthUserId(nativeCredential.appleUserId).catch(() => undefined);
  } catch (error) {
    await supabase.auth.signOut().catch(() => undefined);
    throw error;
  }

  return completed;
}

export async function continueWithAppleSignIn(options: PremiumOnboardingAuthOptions = {}): Promise<CompleteMobileAuthResult> {
  return completeAppleSignIn(options);
}

async function continueWithAppleSignInForContext(options: PremiumOnboardingAuthOptions = {}): Promise<CompleteMobileAuthResult> {
  return completeAppleSignIn(options);
}

export async function linkAppleIdentityToCurrentSession({
  accessToken,
  refreshToken
}: {
  accessToken: string;
  refreshToken: string | null;
}): Promise<CompleteMobileAuthResult> {
  if (!isMobileAppleAuthEnabled()) {
    throw new Error('Sign in with Apple is not enabled for this build.');
  }

  const baseSession = await primeIdentityMutationSession(accessToken, refreshToken);
  const currentIdentities = await getCurrentUserIdentities();
  if (findIdentityByProvider(currentIdentities, 'apple')) {
    throw new Error('Sign in with Apple is already linked to this account.');
  }

  const nativeCredential = await requestNativeAppleSignIn();
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'apple',
    token: nativeCredential.identityToken,
    nonce: nativeCredential.nonce
  });

  if (error) {
    throw error;
  }

  const linkedSession = data.session ? parseSupabaseSession(data.session) : baseSession;

  await maybeHydrateAppleProfile(linkedSession.accessToken, nativeCredential.firstName, nativeCredential.lastName).catch(() => undefined);
  try {
    await captureNativeAppleCredential(linkedSession.accessToken, {
      ...nativeCredential,
      fallbackEmail: linkedSession.email
    });
    await persistStoredAppleAuthUserId(nativeCredential.appleUserId).catch(() => undefined);
  } catch (error) {
    await unlinkCurrentIdentity({
      provider: 'apple',
      cleanupAccessToken: linkedSession.accessToken,
      requireBackupMethod: false
    }).catch(() => undefined);
    throw error;
  }

  return {
    provider: 'apple',
    session: linkedSession,
    displayName: nativeCredential.displayName,
    emailIsPrivateRelay: isApplePrivateRelayEmail(nativeCredential.email ?? linkedSession.email)
  };
}

export async function unlinkAppleIdentityFromCurrentSession({
  accessToken,
  refreshToken
}: {
  accessToken: string;
  refreshToken: string | null;
}) {
  const activeSession = await primeIdentityMutationSession(accessToken, refreshToken);
  await unlinkCurrentIdentity({
    provider: 'apple',
    cleanupAccessToken: activeSession.accessToken,
    requireBackupMethod: true
  });
  return activeSession;
}

function parseAccessTokenExpiry(accessToken: string, expiresIn: number | null) {
  const payload = accessToken.split('.')[1];
  const atobImpl = typeof globalThis.atob === 'function' ? globalThis.atob.bind(globalThis) : null;
  if (payload && atobImpl) {
    try {
      const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      const decoded = atobImpl(padded);
      const parsed = JSON.parse(decoded) as { exp?: unknown };
      const expSeconds = typeof parsed.exp === 'number' ? parsed.exp : Number.NaN;
      if (Number.isFinite(expSeconds)) {
        return new Date(expSeconds * 1000).toISOString();
      }
    } catch {
      // Fall back to expires_in if the JWT payload is unavailable or malformed.
    }
  }

  if (expiresIn && Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  return null;
}

export function isAccessTokenExpiringSoon(accessToken: string | null, thresholdMs = 60_000) {
  const normalized = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!normalized) {
    return true;
  }

  const expiresAt = parseAccessTokenExpiry(normalized, null);
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - Date.now() <= thresholdMs;
}

export function isSupabaseMobileAuthConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getAvailableOAuthProviders(): MobileOAuthProvider[] {
  const providers: MobileOAuthProvider[] = [];
  if (isSupabaseMobileAuthConfigured()) {
    providers.push('google');
  }
  if (isMobileAppleAuthEnabled()) {
    providers.push('apple');
  }
  return providers;
}

async function linkOAuthIdentityToCurrentSession(
  provider: MobileOAuthProvider,
  {
    accessToken,
    refreshToken
  }: {
    accessToken: string;
    refreshToken: string | null;
  }
): Promise<CompleteMobileAuthResult> {
  const baseSession = await primeIdentityMutationSession(accessToken, refreshToken);
  const currentIdentities = await getCurrentUserIdentities();
  if (findIdentityByProvider(currentIdentities, provider)) {
    throw new Error(`${provider === 'google' ? 'Google' : 'Sign in with Apple'} is already linked to this account.`);
  }

  const redirectTo = getOAuthRedirectUrl(provider);
  const supabase = getMobileSupabaseClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true
    }
  });

  if (error) {
    throw error;
  }
  if (!data.url) {
    throw new Error(`Supabase did not return a ${provider === 'google' ? 'Google' : 'Apple'} linking URL.`);
  }

  try {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Authentication was cancelled before it completed.');
    }

    if (result.type !== 'success' || !('url' in result) || typeof result.url !== 'string') {
      throw new Error('Authentication did not complete successfully.');
    }

    const linked = await completeMobileAuthCallbackUrl(result.url);
    return {
      ...linked,
      session: linked.session ?? baseSession
    };
  } finally {
    if (Platform.OS === 'android') {
      void WebBrowser.coolDownAsync().catch(() => {});
    }
  }
}

export async function linkGoogleIdentityToCurrentSession({
  accessToken,
  refreshToken
}: {
  accessToken: string;
  refreshToken: string | null;
}) {
  return linkOAuthIdentityToCurrentSession('google', {
    accessToken,
    refreshToken
  });
}

export async function unlinkGoogleIdentityFromCurrentSession({
  accessToken,
  refreshToken
}: {
  accessToken: string;
  refreshToken: string | null;
}) {
  const activeSession = await primeIdentityMutationSession(accessToken, refreshToken);
  await unlinkCurrentIdentity({
    provider: 'google',
    cleanupAccessToken: activeSession.accessToken,
    requireBackupMethod: true
  });
  return activeSession;
}

export async function completeMobileAuthCallbackUrl(callbackUrl: string): Promise<CompleteMobileAuthResult> {
  const params = buildParamMap(callbackUrl);
  const errorDescription = params.get('error_description') ?? params.get('error') ?? '';
  if (errorDescription) {
    throw new Error(errorDescription);
  }

  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const provider = normalizeAuthProvider(params.get('provider') ?? '');

  if (code) {
    return {
      provider,
      session: await exchangeAuthCode(code)
    };
  }

  if (accessToken && refreshToken) {
    return {
      provider,
      session: await setAuthSession(accessToken, refreshToken)
    };
  }

  if (tokenHash && type) {
    return {
      provider: provider === 'unknown' ? 'email_link' : provider,
      session: await verifyOtpTokenHash(tokenHash, type)
    };
  }

  throw new Error('The callback did not include a valid auth payload.');
}

export async function continueWithOAuthProvider(provider: MobileOAuthProvider, options?: PremiumOnboardingAuthOptions): Promise<CompleteMobileAuthResult> {
  if (provider === 'apple' && !isMobileAppleAuthEnabled()) {
    throw new Error('Sign in with Apple is not enabled for this build.');
  }
  if (provider === 'apple') {
    return continueWithAppleSignInForContext(options ?? {});
  }

  const redirectTo = getOAuthRedirectUrl('google');
  const startUrl = buildGoogleAuthStartUrl(options ?? {});

  try {
    const result = await WebBrowser.openAuthSessionAsync(startUrl, redirectTo);

    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Authentication was cancelled before it completed.');
    }

    if (result.type !== 'success' || !('url' in result) || typeof result.url !== 'string') {
      throw new Error('Authentication did not complete successfully.');
    }

    const completed = await completeMobileAuthCallbackUrl(result.url);

    return completed;
  } finally {
    if (Platform.OS === 'android') {
      void WebBrowser.coolDownAsync().catch(() => {});
    }
  }
}

export async function signInWithPassword(email: string, password: string): Promise<MobilePasswordAuthResult> {
  const challenge = await completeMobilePasswordChallenge(email, 'sign_in');
  const client = createGuestMobileAuthClient();
  const payload = await client.mobilePasswordSignIn({
    email,
    password,
    riskSessionId: challenge.riskSessionId,
    challengeCode: challenge.challengeCode
  });

  await clearStoredAppleAuthIdentity().catch(() => undefined);

  return {
    session: toMobileAuthSession(payload.session),
    riskSessionId: challenge.riskSessionId
  };
}

export async function attachPremiumClaimToSession(accessToken: string, claimToken: string) {
  const normalizedAccessToken = accessToken.trim();
  const normalizedClaimToken = claimToken.trim();
  if (!normalizedAccessToken) {
    throw new Error('A signed-in session is required before Premium can be attached.');
  }
  if (!normalizedClaimToken) {
    throw new Error('Premium claim token is missing.');
  }

  const client = createBearerMobileAuthClient(normalizedAccessToken);
  return client.attachPremiumClaim(normalizedClaimToken);
}

export async function createPremiumAccountFromClaim(claimToken: string, email: string, password: string) {
  const normalizedClaimToken = claimToken.trim();
  if (!normalizedClaimToken) {
    throw new Error('Premium claim token is missing.');
  }

  const client = createGuestMobileAuthClient();
  const payload = await client.createPremiumAccountFromClaim({
    claimToken: normalizedClaimToken,
    email,
    password
  });

  await clearStoredAppleAuthIdentity().catch(() => undefined);
  return payload;
}

export async function createOrResumePremiumOnboardingIntent({
  accessToken,
  intentId,
  returnTo
}: {
  accessToken?: string | null;
  intentId?: string | null;
  returnTo?: string | null;
}) {
  const client = accessToken?.trim() ? createBearerMobileAuthClient(accessToken.trim()) : createGuestMobileAuthClient();
  return client.createOrResumePremiumOnboardingIntent({
    intentId: intentId?.trim() || undefined,
    platform: getPremiumOnboardingPlatform(),
    returnTo: returnTo?.trim() || undefined
  });
}

export async function createPremiumOnboardingEmailAccount(intentId: string, email: string, password: string) {
  const client = createGuestMobileAuthClient();
  const payload = await client.createPremiumOnboardingEmailAccount({
    intentId: intentId.trim(),
    email,
    password
  });
  await clearStoredAppleAuthIdentity().catch(() => undefined);
  return payload;
}

export async function recordPremiumOnboardingLegalAcceptance({
  accessToken,
  intentId,
  returnTo
}: {
  accessToken: string;
  intentId?: string | null;
  returnTo?: string | null;
}) {
  const client = createBearerMobileAuthClient(accessToken);
  return client.recordPremiumOnboardingLegalAcceptance({
    intentId: intentId?.trim() || undefined,
    platform: getPremiumOnboardingPlatform(),
    flow: 'premium_onboarding',
    termsVersion: PREMIUM_TERMS_VERSION,
    privacyVersion: PREMIUM_PRIVACY_VERSION,
    returnTo: returnTo?.trim() || undefined
  });
}

export async function signUpWithPassword(email: string, password: string, emailRedirectTo: string): Promise<MobilePasswordSignUpResult> {
  const challenge = await completeMobilePasswordChallenge(email, 'sign_up');
  const client = createGuestMobileAuthClient();
  const payload: MobileAuthPasswordSignUpResponseV1 = await client.mobilePasswordSignUp({
    email,
    password,
    emailRedirectTo,
    riskSessionId: challenge.riskSessionId,
    challengeCode: challenge.challengeCode
  });

  if (payload.session) {
    await clearStoredAppleAuthIdentity().catch(() => undefined);
  }

  return {
    session: payload.session ? toMobileAuthSession(payload.session) : null,
    user: toMobileAuthUser(payload.user),
    requiresVerification: payload.requiresVerification,
    riskSessionId: challenge.riskSessionId
  };
}

export async function refreshSession(refreshToken: string) {
  const payload = await authRequest('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({
      refresh_token: refreshToken
    })
  });

  return parseAuthSession(payload);
}

export async function resendSignupVerification(email: string, emailRedirectTo: string) {
  const challenge = await completeMobilePasswordChallenge(email, 'resend');
  const client = createGuestMobileAuthClient();
  await client.mobilePasswordResend({
    email,
    emailRedirectTo,
    riskSessionId: challenge.riskSessionId,
    challengeCode: challenge.challengeCode
  });
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const challenge = await completeMobilePasswordChallenge(email, 'recover');
  const client = createGuestMobileAuthClient();
  await client.mobilePasswordRecover({
    email,
    redirectTo,
    riskSessionId: challenge.riskSessionId,
    challengeCode: challenge.challengeCode
  });
}

export async function verifyOtpTokenHash(tokenHash: string, type: string) {
  const payload = await authRequest('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({
      token_hash: tokenHash,
      type
    })
  });

  return parseAuthSession(payload);
}

export async function updatePassword(accessToken: string, password: string) {
  const payload = await authRequest('/auth/v1/user', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      password
    })
  });

  return {
    userId: typeof payload?.id === 'string' ? payload.id : null,
    email: typeof payload?.email === 'string' ? payload.email : null
  };
}

export async function signOut(accessToken: string | null) {
  try {
    if (accessToken) {
      await authRequest('/auth/v1/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
    }
  } catch {
    // Best effort. Local token removal is the source of truth for the mobile shell.
  } finally {
    await clearStoredAppleAuthIdentity().catch(() => undefined);
  }
}
