import * as SecureStore from 'expo-secure-store';

const AUTH_INSTALLATION_ID_KEY = 'tmz.auth.installation-id';
const AUTH_RISK_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.auth.risk',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

function createInstallationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `tmz-auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function readOrCreateAuthInstallationId() {
  const existing = await SecureStore.getItemAsync(AUTH_INSTALLATION_ID_KEY, AUTH_RISK_SECURE_STORE_OPTIONS);
  if (existing) {
    return existing;
  }

  const created = createInstallationId();
  await SecureStore.setItemAsync(AUTH_INSTALLATION_ID_KEY, created, AUTH_RISK_SECURE_STORE_OPTIONS);
  return created;
}
