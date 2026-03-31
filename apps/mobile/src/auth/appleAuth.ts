import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/src/config/api';

type AppleAuthRevocationPlaceholderContext = {
  email: string | null;
  userId: string | null;
};

export type NativeAppleSignInCredential = {
  appleUserId: string;
  authorizationCode: string | null;
  email: string | null;
  identityToken: string;
  nonce: string;
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

export async function requestNativeAppleSignIn(): Promise<NativeAppleSignInCredential> {
  if (!(await isNativeAppleSignInAvailable())) {
    throw new Error('Sign in with Apple is not available in this build.');
  }

  const nonce = Crypto.randomUUID();
  // Apple should receive the SHA-256 nonce, while Supabase validates against the raw nonce.
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);

  try {
    const credential = await AppleAuthentication.signInAsync({
      nonce: hashedNonce,
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL
      ]
    });

    if (!credential.identityToken) {
      throw new Error('Apple sign-in did not return an identity token.');
    }

    return {
      appleUserId: credential.user,
      authorizationCode: credential.authorizationCode,
      email: credential.email,
      identityToken: credential.identityToken,
      nonce
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') {
      throw new Error('Authentication was cancelled before it completed.');
    }

    throw error;
  }
}

export async function captureAppleAuthRevocationPlaceholder(context: AppleAuthRevocationPlaceholderContext) {
  void context;

  // Placeholder boundary for future Apple token capture and deletion-time revocation.
  return {
    attempted: false as const,
    reason: 'apple_revocation_not_configured' as const
  };
}
