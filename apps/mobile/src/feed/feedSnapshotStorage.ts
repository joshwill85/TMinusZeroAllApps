import * as SecureStore from 'expo-secure-store';
import type { FeedLaunchCardData } from '@/src/feed/feedCardData';

const PUBLIC_FEED_SNAPSHOT_KEY = 'tmz.feed.public-snapshot.v1';
const MAX_PUBLIC_FEED_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;
const FEED_SNAPSHOT_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'tmz.feed.snapshot',
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

type StoredPublicFeedSnapshot = {
  requestKey: string;
  savedAt: string;
  launches: FeedLaunchCardData[];
};

type CachedPublicFeedSnapshot = {
  requestKey: string;
  savedAt: string;
  fingerprint: string;
};

let cachedPublicFeedSnapshot: CachedPublicFeedSnapshot | null = null;

function parseStoredSnapshot(value: string | null): StoredPublicFeedSnapshot | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as StoredPublicFeedSnapshot;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.requestKey !== 'string' || typeof parsed.savedAt !== 'string') {
      return null;
    }

    if (!Array.isArray(parsed.launches)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isSnapshotFresh(savedAt: string) {
  const savedAtMs = Date.parse(savedAt);
  if (Number.isNaN(savedAtMs)) {
    return false;
  }

  return Date.now() - savedAtMs <= MAX_PUBLIC_FEED_SNAPSHOT_AGE_MS;
}

function snapshotLaunchesForStorage(launches: FeedLaunchCardData[]) {
  return launches.slice(0, 4);
}

function normalizeForFingerprint(value: unknown): unknown {
  if (value == null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForFingerprint(item));
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const normalized = normalizeForFingerprint((value as Record<string, unknown>)[key]);
      if (normalized !== undefined) {
        acc[key] = normalized;
      }
      return acc;
    }, {});
}

function fingerprintSnapshotLaunches(launches: FeedLaunchCardData[]) {
  return JSON.stringify(normalizeForFingerprint(snapshotLaunchesForStorage(launches)));
}

function rememberStoredSnapshot(snapshot: StoredPublicFeedSnapshot) {
  cachedPublicFeedSnapshot = {
    requestKey: snapshot.requestKey,
    savedAt: snapshot.savedAt,
    fingerprint: fingerprintSnapshotLaunches(snapshot.launches)
  };
}

async function loadCachedSnapshotFromStorage() {
  try {
    const parsed = parseStoredSnapshot(await SecureStore.getItemAsync(PUBLIC_FEED_SNAPSHOT_KEY, FEED_SNAPSHOT_OPTIONS));
    if (!parsed) {
      cachedPublicFeedSnapshot = null;
      return null;
    }

    rememberStoredSnapshot(parsed);
    return cachedPublicFeedSnapshot;
  } catch {
    return null;
  }
}

export async function readPublicFeedSnapshot(requestKey: string): Promise<FeedLaunchCardData[] | null> {
  const parsed = parseStoredSnapshot(await SecureStore.getItemAsync(PUBLIC_FEED_SNAPSHOT_KEY, FEED_SNAPSHOT_OPTIONS));
  if (!parsed || parsed.requestKey !== requestKey || !isSnapshotFresh(parsed.savedAt)) {
    if (parsed) {
      rememberStoredSnapshot(parsed);
    } else {
      cachedPublicFeedSnapshot = null;
    }
    return null;
  }

  rememberStoredSnapshot(parsed);
  return parsed.launches;
}

export async function writePublicFeedSnapshot(requestKey: string, launches: FeedLaunchCardData[]) {
  const launchesToStore = snapshotLaunchesForStorage(launches);
  const fingerprint = fingerprintSnapshotLaunches(launchesToStore);

  if (cachedPublicFeedSnapshot?.requestKey === requestKey && cachedPublicFeedSnapshot.fingerprint === fingerprint) {
    if (isSnapshotFresh(cachedPublicFeedSnapshot.savedAt)) {
      return;
    }
  } else if (!cachedPublicFeedSnapshot) {
    const storedSnapshot = await loadCachedSnapshotFromStorage();
    if (storedSnapshot?.requestKey === requestKey && storedSnapshot.fingerprint === fingerprint && isSnapshotFresh(storedSnapshot.savedAt)) {
      return;
    }
  }

  const snapshot: StoredPublicFeedSnapshot = {
    requestKey,
    savedAt: new Date().toISOString(),
    launches: launchesToStore
  };

  try {
    await SecureStore.setItemAsync(PUBLIC_FEED_SNAPSHOT_KEY, JSON.stringify(snapshot), FEED_SNAPSHOT_OPTIONS);
    rememberStoredSnapshot(snapshot);
  } catch {
    // Ignore snapshot persistence failures so feed rendering never regresses.
  }
}
