import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';

const APPLE_AUTH_USER_ID_KEY = 'tmz.auth.apple-user-id';
const APPLE_AUTH_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.auth.apple-auth',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

export type NativeAppleSignInCredential = {
  appleUserId: string;
  authorizationCode: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  identityToken: string;
  nonce: string;
};

export type StoredAppleCredentialState = {
  appleUserId: string;
  state:
    | 'authorized'
    | 'revoked'
    | 'not_found'
    | 'transferred'
    | 'unknown';
};

function readBooleanFlag(value: string | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isMobileAppleAuthEnabled() {
  if (Platform.OS !== 'ios') {
    return false;
  }

  return readBooleanFlag(process.env.EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED) && Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export async function isNativeAppleSignInAvailable() {
  if (!isMobileAppleAuthEnabled()) {
    return false;
  }

  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

function toDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null | undefined) {
  if (!fullName) {
    return null;
  }

  const formatted = AppleAuthentication.formatFullName(fullName, 'default').trim();
  return formatted || null;
}

function normalizeNativeAppleCredential(
  credential: AppleAuthentication.AppleAuthenticationCredential,
  nonce: string
): NativeAppleSignInCredential {
  if (!credential.identityToken) {
    throw new Error('Apple sign-in did not return an identity token.');
  }

  return {
    appleUserId: credential.user,
    authorizationCode: credential.authorizationCode,
    email: credential.email,
    firstName: credential.fullName?.givenName?.trim() || null,
    lastName: credential.fullName?.familyName?.trim() || null,
    displayName: toDisplayName(credential.fullName),
    identityToken: credential.identityToken,
    nonce
  };
}

async function createNoncePair() {
  if (!(await isNativeAppleSignInAvailable())) {
    throw new Error('Sign in with Apple is not available in this build.');
  }

  const nonce = Crypto.randomUUID();
  // Apple should receive the SHA-256 nonce, while Supabase validates against the raw nonce.
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  return {
    nonce,
    hashedNonce
  };
}

export async function requestNativeAppleSignIn(): Promise<NativeAppleSignInCredential> {
  const { nonce, hashedNonce } = await createNoncePair();

  try {
    const credential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL
      ]
    });
    return normalizeNativeAppleCredential(credential, nonce);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Authentication was cancelled before it completed.');
    }

    throw error;
  }
}

export async function refreshStoredNativeAppleCredential(appleUserId: string): Promise<NativeAppleSignInCredential> {
  if (!(await isNativeAppleSignInAvailable())) {
    throw new Error('Sign in with Apple is not available in this build.');
  }

  const normalizedUserId = String(appleUserId || '').trim();
  if (!normalizedUserId) {
    throw new Error('Apple account refresh requires a stored Apple user identifier.');
  }

  try {
    const credential = await AppleAuthentication.refreshAsync({
      user: normalizedUserId,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL
      ]
    });
    return normalizeNativeAppleCredential(credential, '');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Authentication was cancelled before it completed.');
    }

    throw error;
  }
}

export async function persistStoredAppleAuthUserId(appleUserId: string) {
  const normalized = String(appleUserId || '').trim();
  if (!normalized) {
    return;
  }

  await SecureStore.setItemAsync(APPLE_AUTH_USER_ID_KEY, normalized, APPLE_AUTH_SECURE_STORE_OPTIONS);
}

export async function readStoredAppleAuthUserId() {
  const value = await SecureStore.getItemAsync(APPLE_AUTH_USER_ID_KEY, APPLE_AUTH_SECURE_STORE_OPTIONS);
  return value?.trim() || null;
}

export async function clearStoredAppleAuthIdentity() {
  await SecureStore.deleteItemAsync(APPLE_AUTH_USER_ID_KEY, APPLE_AUTH_SECURE_STORE_OPTIONS);
}

export function addAppleCredentialRevokedListener(listener: () => void) {
  if (Platform.OS !== 'ios') {
    return null;
  }

  try {
    return AppleAuthentication.addRevokeListener(listener);
  } catch {
    return null;
  }
}

export async function getStoredAppleCredentialState(): Promise<StoredAppleCredentialState | null> {
  if (!(await isNativeAppleSignInAvailable())) {
    return null;
  }

  const appleUserId = await readStoredAppleAuthUserId();
  if (!appleUserId) {
    return null;
  }

  const credentialState = await AppleAuthentication.getCredentialStateAsync(appleUserId);
  let state: StoredAppleCredentialState['state'] = 'unknown';
  if (credentialState === AppleAuthentication.AppleAuthenticationCredentialState.AUTHORIZED) {
    state = 'authorized';
  } else if (credentialState === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED) {
    state = 'revoked';
  } else if (credentialState === AppleAuthentication.AppleAuthenticationCredentialState.NOT_FOUND) {
    state = 'not_found';
  } else if (credentialState === AppleAuthentication.AppleAuthenticationCredentialState.TRANSFERRED) {
    state = 'transferred';
  }

  return {
    appleUserId,
    state
  };
}
