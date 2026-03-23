import * as SecureStore from 'expo-secure-store';

const INSTALLATION_ID_KEY = 'tmz.push.installation-id';
const LAST_SYNC_OWNER_KEY = 'tmz.push.last-sync-owner';
const LAST_SYNC_TOKEN_KEY = 'tmz.push.last-sync-token';
const DEVICE_SECRET_KEY = 'tmz.push.device-secret';
const PUSH_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.push.state',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

export type StoredPushSyncSnapshot = {
  ownerKey: string | null;
  token: string | null;
  deviceSecret: string | null;
};

function createInstallationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `tmz-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function readOrCreateInstallationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY, PUSH_SECURE_STORE_OPTIONS);
  if (existing) {
    return existing;
  }

  const created = createInstallationId();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, created, PUSH_SECURE_STORE_OPTIONS);
  return created;
}

export async function readStoredPushSyncSnapshot(): Promise<StoredPushSyncSnapshot> {
  const [ownerKey, token, deviceSecret] = await Promise.all([
    SecureStore.getItemAsync(LAST_SYNC_OWNER_KEY, PUSH_SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(LAST_SYNC_TOKEN_KEY, PUSH_SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(DEVICE_SECRET_KEY, PUSH_SECURE_STORE_OPTIONS)
  ]);

  return {
    ownerKey: ownerKey ?? null,
    token: token ?? null,
    deviceSecret: deviceSecret ?? null
  };
}

export async function writeStoredPushSyncSnapshot(snapshot: StoredPushSyncSnapshot) {
  const writes: Promise<void>[] = [];

  if (snapshot.ownerKey) {
    writes.push(SecureStore.setItemAsync(LAST_SYNC_OWNER_KEY, snapshot.ownerKey, PUSH_SECURE_STORE_OPTIONS));
  } else {
    writes.push(SecureStore.deleteItemAsync(LAST_SYNC_OWNER_KEY, PUSH_SECURE_STORE_OPTIONS));
  }

  if (snapshot.token) {
    writes.push(SecureStore.setItemAsync(LAST_SYNC_TOKEN_KEY, snapshot.token, PUSH_SECURE_STORE_OPTIONS));
  } else {
    writes.push(SecureStore.deleteItemAsync(LAST_SYNC_TOKEN_KEY, PUSH_SECURE_STORE_OPTIONS));
  }

  if (snapshot.deviceSecret) {
    writes.push(SecureStore.setItemAsync(DEVICE_SECRET_KEY, snapshot.deviceSecret, PUSH_SECURE_STORE_OPTIONS));
  } else {
    writes.push(SecureStore.deleteItemAsync(DEVICE_SECRET_KEY, PUSH_SECURE_STORE_OPTIONS));
  }

  await Promise.all(writes);
}

export async function clearStoredPushSyncSnapshot() {
  await writeStoredPushSyncSnapshot({
    ownerKey: null,
    token: null,
    deviceSecret: null
  });
}

export async function writeStoredDeviceSecret(deviceSecret: string | null) {
  if (deviceSecret) {
    await SecureStore.setItemAsync(DEVICE_SECRET_KEY, deviceSecret, PUSH_SECURE_STORE_OPTIONS);
    return;
  }
  await SecureStore.deleteItemAsync(DEVICE_SECRET_KEY, PUSH_SECURE_STORE_OPTIONS);
}
