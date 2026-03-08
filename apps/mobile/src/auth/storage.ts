import * as SecureStore from 'expo-secure-store';

const ACCESS_TOKEN_KEY = 'tmz.supabase.access-token';
const REFRESH_TOKEN_KEY = 'tmz.supabase.refresh-token';

export type StoredAuthSession = {
  accessToken: string | null;
  refreshToken: string | null;
};

export async function readStoredAuthSession(): Promise<StoredAuthSession> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  ]);

  return {
    accessToken: accessToken ?? null,
    refreshToken: refreshToken ?? null
  };
}

export async function writeStoredAuthSession(session: StoredAuthSession) {
  const writes: Promise<void>[] = [];

  if (session.accessToken) {
    writes.push(SecureStore.setItemAsync(ACCESS_TOKEN_KEY, session.accessToken));
  } else {
    writes.push(SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY));
  }

  if (session.refreshToken) {
    writes.push(SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken));
  } else {
    writes.push(SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY));
  }

  await Promise.all(writes);
}

export async function clearStoredAuthSession() {
  await writeStoredAuthSession({
    accessToken: null,
    refreshToken: null
  });
}
