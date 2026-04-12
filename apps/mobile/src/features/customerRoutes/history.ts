import * as SecureStore from 'expo-secure-store';

export type RecentCustomerRouteKind = 'info' | 'news';

export type RecentCustomerRouteEntry = {
  kind: RecentCustomerRouteKind;
  href: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  imageUrl?: string | null;
  updatedAt: string;
};

const RECENT_CUSTOMER_ROUTE_KEY = 'customer-route-history-v1';
const RECENT_CUSTOMER_ROUTE_LIMIT = 18;
const RECENT_CUSTOMER_ROUTE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
};

function parseStoredEntries(value: string | null) {
  if (!value) return [] as RecentCustomerRouteEntry[];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const candidate = entry as Record<string, unknown>;
        const kind = candidate.kind === 'news' ? 'news' : candidate.kind === 'info' ? 'info' : null;
        const href = String(candidate.href || '').trim();
        const title = String(candidate.title || '').trim();
        const updatedAt = String(candidate.updatedAt || '').trim();
        if (!kind || !href || !title || !updatedAt) {
          return null;
        }
        return {
          kind,
          href,
          title,
          subtitle: typeof candidate.subtitle === 'string' ? candidate.subtitle : null,
          badge: typeof candidate.badge === 'string' ? candidate.badge : null,
          imageUrl: typeof candidate.imageUrl === 'string' ? candidate.imageUrl : null,
          updatedAt
        } satisfies RecentCustomerRouteEntry;
      })
      .filter(Boolean) as RecentCustomerRouteEntry[];
  } catch {
    return [];
  }
}

async function writeEntries(entries: RecentCustomerRouteEntry[]) {
  await SecureStore.setItemAsync(RECENT_CUSTOMER_ROUTE_KEY, JSON.stringify(entries), RECENT_CUSTOMER_ROUTE_OPTIONS);
}

export async function readRecentCustomerRouteEntries(kind?: RecentCustomerRouteKind, limit = 6) {
  const entries = parseStoredEntries(await SecureStore.getItemAsync(RECENT_CUSTOMER_ROUTE_KEY, RECENT_CUSTOMER_ROUTE_OPTIONS));
  const filtered = kind ? entries.filter((entry) => entry.kind === kind) : entries;
  return filtered.slice(0, Math.max(1, limit));
}

export async function recordRecentCustomerRouteEntry(entry: Omit<RecentCustomerRouteEntry, 'updatedAt'>) {
  const nextEntry: RecentCustomerRouteEntry = {
    ...entry,
    updatedAt: new Date().toISOString()
  };
  const existing = parseStoredEntries(await SecureStore.getItemAsync(RECENT_CUSTOMER_ROUTE_KEY, RECENT_CUSTOMER_ROUTE_OPTIONS));
  const deduped = existing.filter((candidate) => !(candidate.kind === nextEntry.kind && candidate.href === nextEntry.href));
  await writeEntries([nextEntry, ...deduped].slice(0, RECENT_CUSTOMER_ROUTE_LIMIT));
}
