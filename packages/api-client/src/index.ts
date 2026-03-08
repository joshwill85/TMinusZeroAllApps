import {
  entitlementSchemaV1,
  filterPresetsSchemaV1,
  launchDetailSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  notificationPreferencesSchemaV1,
  profileSchemaV1,
  pushDeviceRegistrationSchemaV1,
  searchResponseSchemaV1,
  viewerSessionSchemaV1,
  watchlistsSchemaV1,
  type EntitlementsV1,
  type FilterPresetsV1,
  type LaunchDetailV1,
  type LaunchFeedV1,
  type LaunchNotificationPreferenceEnvelopeV1,
  type NotificationPreferencesV1,
  type ProfileV1,
  type PushDeviceRegistrationV1,
  type SearchResponseV1,
  type ViewerSessionV1,
  type WatchlistsV1
} from '@tminuszero/contracts';

type AuthConfig =
  | { mode: 'cookie' }
  | { mode: 'bearer'; accessToken: string }
  | { mode: 'guest' };

export type ApiClientOptions = {
  baseUrl?: string;
  auth?: AuthConfig;
  fetchImpl?: typeof fetch;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

type LaunchFeedRequest = {
  limit?: number;
  offset?: number;
  region?: 'us' | 'non-us' | 'all';
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type SearchRequest = {
  limit?: number;
  offset?: number;
  types?: string[];
};

function appendQuery(path: string, params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly auth: AuthConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.auth = options.auth ?? { mode: 'guest' };
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getViewerSession() {
    return this.request('/api/v1/viewer/session', viewerSessionSchemaV1);
  }

  async getViewerEntitlements() {
    return this.request('/api/v1/viewer/entitlements', entitlementSchemaV1);
  }

  async getLaunchFeed(options: LaunchFeedRequest = {}) {
    return this.request(
      appendQuery('/api/v1/launches', {
        limit: options.limit,
        offset: options.offset,
        region: options.region,
        provider: options.provider,
        status: options.status
      }),
      launchFeedSchemaV1
    );
  }

  async getLaunchDetail(id: string) {
    return this.request(`/api/v1/launches/${encodeURIComponent(id)}`, launchDetailSchemaV1);
  }

  async search(query: string, options: SearchRequest = {}) {
    return this.request(
      appendQuery('/api/v1/search', {
        q: query,
        limit: options.limit,
        offset: options.offset,
        types: options.types?.join(',') ?? null
      }),
      searchResponseSchemaV1
    );
  }

  async getNotificationPreferences() {
    return this.request('/api/v1/me/notification-preferences', notificationPreferencesSchemaV1);
  }

  async getProfile() {
    return this.request('/api/v1/me/profile', profileSchemaV1);
  }

  async getWatchlists() {
    return this.request('/api/v1/me/watchlists', watchlistsSchemaV1);
  }

  async getFilterPresets() {
    return this.request('/api/v1/me/filter-presets', filterPresetsSchemaV1);
  }

  async getLaunchNotificationPreference(launchId: string, channel: 'sms' | 'push' = 'push') {
    return this.request(
      appendQuery(`/api/v1/me/launch-notifications/${encodeURIComponent(launchId)}`, {
        channel
      }),
      launchNotificationPreferenceEnvelopeSchemaV1
    );
  }

  async registerPushDevice(payload: PushDeviceRegistrationV1) {
    return this.request('/api/v1/me/push-devices', pushDeviceRegistrationSchemaV1, {
      method: 'POST',
      body: payload
    });
  }

  private async request<T>(
    path: string,
    schema: { parse: (value: unknown) => T },
    options: RequestOptions = {}
  ): Promise<T> {
    const headers = new Headers(options.headers ?? {});
    headers.set('Accept', 'application/json');
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (this.auth.mode === 'bearer') {
      headers.set('Authorization', `Bearer ${this.auth.accessToken}`);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      credentials: this.auth.mode === 'cookie' ? 'include' : 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });

    if (!response.ok) {
      throw new Error(`API request failed for ${path} (${response.status})`);
    }

    const json = await response.json();
    return schema.parse(json);
  }
}

export function createApiClient(options?: ApiClientOptions) {
  return new ApiClient(options);
}

export type {
  EntitlementsV1,
  FilterPresetsV1,
  LaunchDetailV1,
  LaunchFeedV1,
  LaunchNotificationPreferenceEnvelopeV1,
  NotificationPreferencesV1,
  ProfileV1,
  PushDeviceRegistrationV1,
  SearchResponseV1,
  ViewerSessionV1,
  WatchlistsV1
};
