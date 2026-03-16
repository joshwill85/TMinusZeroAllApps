import { Platform } from 'react-native';
import type { MobileAuthAttestationProviderV1, MobileAuthAttestationV1 } from '@tminuszero/contracts';

function createNonce() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `tmz-auth-nonce-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPlaceholderProvider(): MobileAuthAttestationProviderV1 {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return 'dev_bypass';
  }

  if (Platform.OS === 'ios' || Platform.OS === 'android') {
    return 'none';
  }

  return 'dev_bypass';
}

export async function collectMobileAuthAttestation(): Promise<MobileAuthAttestationV1> {
  // Native platform attestation will plug into this shape later without changing the auth callers.
  return {
    provider: readPlaceholderProvider(),
    token: null,
    nonce: createNonce(),
    keyId: null
  };
}
