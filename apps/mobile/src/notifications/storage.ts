import * as SecureStore from 'expo-secure-store';

const INSTALLATION_ID_KEY = 'tmz.push.installation-id';
const LAST_SYNC_USER_KEY = 'tmz.push.last-sync-user';
const LAST_SYNC_TOKEN_KEY = 'tmz.push.last-sync-token';
const PUSH_SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.push.state',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

export type StoredPushSyncSnapshot = {
  userId: string | null;
  token: string | null;
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
  const [userId, token] = await Promise.all([
    SecureStore.getItemAsync(LAST_SYNC_USER_KEY, PUSH_SECURE_STORE_OPTIONS),
    SecureStore.getItemAsync(LAST_SYNC_TOKEN_KEY, PUSH_SECURE_STORE_OPTIONS)
  ]);

  return {
    userId: userId ?? null,
    token: token ?? null
  };
}

export async function writeStoredPushSyncSnapshot(snapshot: StoredPushSyncSnapshot) {
  const writes: Promise<void>[] = [];

  if (snapshot.userId) {
    writes.push(SecureStore.setItemAsync(LAST_SYNC_USER_KEY, snapshot.userId, PUSH_SECURE_STORE_OPTIONS));
  } else {
    writes.push(SecureStore.deleteItemAsync(LAST_SYNC_USER_KEY, PUSH_SECURE_STORE_OPTIONS));
  }

  if (snapshot.token) {
    writes.push(SecureStore.setItemAsync(LAST_SYNC_TOKEN_KEY, snapshot.token, PUSH_SECURE_STORE_OPTIONS));
  } else {
    writes.push(SecureStore.deleteItemAsync(LAST_SYNC_TOKEN_KEY, PUSH_SECURE_STORE_OPTIONS));
  }

  await Promise.all(writes);
}

export async function clearStoredPushSyncSnapshot() {
  await writeStoredPushSyncSnapshot({
    userId: null,
    token: null
  });
}
