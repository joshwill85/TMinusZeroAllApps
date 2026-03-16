import {
  alertRuleCreateSchemaV1,
  alertRuleEnvelopeSchemaV1,
  alertRulesSchemaV1,
  arTelemetrySessionEventSchemaV1,
  appleBillingSyncRequestSchemaV1,
  authContextUpsertSchemaV1,
  billingCatalogSchemaV1,
  billingSummarySchemaV1,
  billingSyncResponseSchemaV1,
  blueOriginContractsResponseSchemaV1,
  blueOriginEnginesResponseSchemaV1,
  blueOriginFlightsResponseSchemaV1,
  blueOriginMissionOverviewSchemaV1,
  blueOriginOverviewSchemaV1,
  blueOriginTravelersResponseSchemaV1,
  blueOriginVehiclesResponseSchemaV1,
  calendarTokenSchemaV1,
  calendarFeedCreateSchemaV1,
  calendarFeedEnvelopeSchemaV1,
  calendarFeedsSchemaV1,
  calendarFeedUpdateSchemaV1,
  changedLaunchesSchemaV1,
  entitlementSchemaV1,
  embedWidgetCreateSchemaV1,
  embedWidgetEnvelopeSchemaV1,
  embedWidgetsSchemaV1,
  embedWidgetUpdateSchemaV1,
  filterPresetCreateSchemaV1,
  filterPresetEnvelopeSchemaV1,
  filterPresetsSchemaV1,
  filterPresetUpdateSchemaV1,
  launchDetailSchemaV1,
  launchFilterOptionsSchemaV1,
  launchFeedSchemaV1,
  launchNotificationPreferenceEnvelopeSchemaV1,
  launchNotificationPreferenceUpdateSchemaV1,
  marketingEmailSchemaV1,
  marketingEmailUpdateSchemaV1,
  notificationPreferencesSchemaV1,
  notificationPreferencesUpdateSchemaV1,
  privacyPreferencesSchemaV1,
  privacyPreferencesUpdateSchemaV1,
  profileSchemaV1,
  profileUpdateSchemaV1,
  pushDeliveryTestSchemaV1,
  pushDeviceRegistrationSchemaV1,
  pushDeviceRemovalSchemaV1,
  accountExportSchemaV1,
  searchResponseSchemaV1,
  smsVerificationCheckSchemaV1,
  smsVerificationRequestSchemaV1,
  smsVerificationStatusSchemaV1,
  successResponseSchemaV1,
  trajectoryPublicV2ResponseSchemaV1,
  viewerSessionSchemaV1,
  googleBillingSyncRequestSchemaV1,
  mobileAuthChallengeCompleteSchemaV1,
  mobileAuthChallengeResultSchemaV1,
  mobileAuthPasswordRecoverSchemaV1,
  mobileAuthPasswordResendSchemaV1,
  mobileAuthPasswordSignInResponseSchemaV1,
  mobileAuthPasswordSignInSchemaV1,
  mobileAuthPasswordSignUpResponseSchemaV1,
  mobileAuthPasswordSignUpSchemaV1,
  mobileAuthRiskDecisionSchemaV1,
  mobileAuthRiskStartSchemaV1,
  rssFeedCreateSchemaV1,
  rssFeedEnvelopeSchemaV1,
  rssFeedsSchemaV1,
  rssFeedUpdateSchemaV1,
  watchlistCreateSchemaV1,
  watchlistEnvelopeSchemaV1,
  watchlistRuleCreateSchemaV1,
  watchlistRuleEnvelopeSchemaV1,
  watchlistUpdateSchemaV1,
  watchlistsSchemaV1,
  type AppleBillingSyncRequestV1,
  type AuthContextUpsertV1,
  type BillingCatalogProductV1,
  type BillingCatalogV1,
  type BillingPlatformV1,
  type BillingSummaryV1,
  type BillingSyncResponseV1,
  type BlueOriginContractsResponseV1,
  type BlueOriginEnginesResponseV1,
  type BlueOriginFlightsResponseV1,
  type BlueOriginMissionKeyV1,
  type BlueOriginMissionOverviewV1,
  type BlueOriginOverviewV1,
  type BlueOriginTravelersResponseV1,
  type BlueOriginVehiclesResponseV1,
  type CalendarTokenV1,
  type CalendarFeedCreateV1,
  type CalendarFeedV1,
  type CalendarFeedEnvelopeV1,
  type CalendarFeedsV1,
  type CalendarFeedUpdateV1,
  type ChangedLaunchesV1,
  type EmbedWidgetCreateV1,
  type EmbedWidgetV1,
  type EmbedWidgetEnvelopeV1,
  type EmbedWidgetsV1,
  type EmbedWidgetUpdateV1,
  type EntitlementsV1,
  type FilterPresetV1,
  type FilterPresetCreateV1,
  type FilterPresetEnvelopeV1,
  type FilterPresetsV1,
  type FilterPresetUpdateV1,
  type LaunchDetailV1,
  type LaunchFilterOptionsV1,
  type LaunchFeedV1,
  type TrajectoryPublicV2ResponseV1,
  type LaunchNotificationPreferenceEnvelopeV1,
  type LaunchNotificationPreferenceUpdateV1,
  type GoogleBillingSyncRequestV1,
  type MobileAuthChallengeCompleteV1,
  type MobileAuthChallengeResultV1,
  type MobileAuthPasswordRecoverV1,
  type MobileAuthPasswordResendV1,
  type MobileAuthPasswordSignInResponseV1,
  type MobileAuthPasswordSignInV1,
  type MobileAuthPasswordSignUpResponseV1,
  type MobileAuthPasswordSignUpV1,
  type MobileAuthRiskDecisionV1,
  type MobileAuthRiskStartV1,
  type MarketingEmailUpdateV1,
  type MarketingEmailV1,
  type NotificationPreferencesV1,
  type NotificationPreferencesUpdateV1,
  type PrivacyPreferencesV1,
  type PrivacyPreferencesUpdateV1,
  type ProfileV1,
  type ProfileUpdateV1,
  type PushDeliveryTestV1,
  type PushDeviceRegistrationV1,
  type PushDeviceRemovalV1,
  type AccountExportV1,
  type AlertRuleCreateV1,
  type AlertRuleEnvelopeV1,
  type AlertRuleV1,
  type AlertRulesV1,
  type ArTelemetrySessionEventV1,
  type SearchResponseV1,
  type SmsVerificationCheckV1,
  type SmsVerificationRequestV1,
  type SmsVerificationStatusV1,
  type SuccessResponseV1,
  type ViewerSessionV1,
  type RssFeedCreateV1,
  type RssFeedV1,
  type RssFeedEnvelopeV1,
  type RssFeedsV1,
  type RssFeedUpdateV1,
  type WatchlistCreateV1,
  type WatchlistEnvelopeV1,
  type WatchlistRuleCreateV1,
  type WatchlistRuleV1,
  type WatchlistRuleEnvelopeV1,
  type WatchlistV1,
  type WatchlistUpdateV1,
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
  scope?: 'public' | 'live' | 'watchlist';
  watchlistId?: string | null;
  limit?: number;
  offset?: number;
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  region?: 'us' | 'non-us' | 'all';
  provider?: string | null;
  sort?: 'soonest' | 'latest' | 'changed';
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type LaunchFilterOptionsRequest = {
  mode?: 'public' | 'live';
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  region?: 'us' | 'non-us' | 'all';
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type SearchRequest = {
  limit?: number;
  offset?: number;
  types?: string[];
};

type ChangedLaunchesRequest = {
  hours?: number;
  region?: 'us' | 'non-us' | 'all';
};

type BlueOriginMissionFilterRequest = {
  mission?: BlueOriginMissionKeyV1 | 'all' | null;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly path: string;
  readonly detail: string | null;

  constructor(path: string, status: number, code: string | null, detail: string | null = null) {
    super(detail || (code ? `API request failed for ${path} (${status}: ${code})` : `API request failed for ${path} (${status})`));
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.path = path;
    this.detail = detail;
  }
}

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

  async getBillingSummary() {
    return this.request('/api/v1/me/billing/summary', billingSummarySchemaV1);
  }

  async getBillingCatalog(platform: BillingPlatformV1) {
    return this.request(appendQuery('/api/v1/me/billing/catalog', { platform }), billingCatalogSchemaV1);
  }

  async syncAppleBilling(payload: AppleBillingSyncRequestV1) {
    return this.request('/api/v1/me/billing/apple/sync', billingSyncResponseSchemaV1, {
      method: 'POST',
      body: appleBillingSyncRequestSchemaV1.parse(payload)
    });
  }

  async syncGoogleBilling(payload: GoogleBillingSyncRequestV1) {
    return this.request('/api/v1/me/billing/google/sync', billingSyncResponseSchemaV1, {
      method: 'POST',
      body: googleBillingSyncRequestSchemaV1.parse(payload)
    });
  }

  async getLaunchFeed(options: LaunchFeedRequest = {}) {
    return this.request(
      appendQuery('/api/v1/launches', {
        scope: options.scope,
        watchlistId: options.watchlistId,
        limit: options.limit,
        offset: options.offset,
        range: options.range,
        from: options.from,
        to: options.to,
        location: options.location,
        state: options.state,
        pad: options.pad,
        region: options.region,
        provider: options.provider,
        sort: options.sort,
        status: options.status
      }),
      launchFeedSchemaV1
    );
  }

  async getLaunchFilterOptions(options: LaunchFilterOptionsRequest = {}) {
    return this.request(
      appendQuery('/api/v1/launches/filter-options', {
        mode: options.mode,
        range: options.range,
        from: options.from,
        to: options.to,
        location: options.location,
        state: options.state,
        pad: options.pad,
        region: options.region,
        provider: options.provider,
        status: options.status
      }),
      launchFilterOptionsSchemaV1
    );
  }

  async getChangedLaunches(options: ChangedLaunchesRequest = {}) {
    return this.request(
      appendQuery('/api/v1/launches/changed', {
        hours: options.hours,
        region: options.region
      }),
      changedLaunchesSchemaV1
    );
  }

  async getLaunchDetail(id: string) {
    return this.request(`/api/v1/launches/${encodeURIComponent(id)}`, launchDetailSchemaV1);
  }

  async getLaunchTrajectory(id: string) {
    return this.request(`/api/v1/launches/${encodeURIComponent(id)}/trajectory`, trajectoryPublicV2ResponseSchemaV1);
  }

  async getBlueOriginOverview() {
    return this.request('/api/v1/blue-origin', blueOriginOverviewSchemaV1);
  }

  async getBlueOriginMissionOverview(mission: Exclude<BlueOriginMissionKeyV1, 'blue-origin-program'>) {
    return this.request(`/api/v1/blue-origin/missions/${encodeURIComponent(mission)}`, blueOriginMissionOverviewSchemaV1);
  }

  async getBlueOriginFlights(options: BlueOriginMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/blue-origin/flights', {
        mission: options.mission ?? 'all'
      }),
      blueOriginFlightsResponseSchemaV1
    );
  }

  async getBlueOriginTravelers() {
    return this.request('/api/v1/blue-origin/travelers', blueOriginTravelersResponseSchemaV1);
  }

  async getBlueOriginVehicles(options: BlueOriginMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/blue-origin/vehicles', {
        mission: options.mission ?? 'all'
      }),
      blueOriginVehiclesResponseSchemaV1
    );
  }

  async getBlueOriginEngines(options: BlueOriginMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/blue-origin/engines', {
        mission: options.mission ?? 'all'
      }),
      blueOriginEnginesResponseSchemaV1
    );
  }

  async getBlueOriginContracts(options: BlueOriginMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/blue-origin/contracts', {
        mission: options.mission ?? 'all'
      }),
      blueOriginContractsResponseSchemaV1
    );
  }

  async postArTelemetrySession(payload: ArTelemetrySessionEventV1) {
    return this.request('/api/v1/ar/telemetry/session', successResponseSchemaV1, {
      method: 'POST',
      body: arTelemetrySessionEventSchemaV1.parse(payload)
    });
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

  async updateNotificationPreferences(payload: NotificationPreferencesUpdateV1) {
    return this.request('/api/v1/me/notification-preferences', notificationPreferencesSchemaV1, {
      method: 'POST',
      body: notificationPreferencesUpdateSchemaV1.parse(payload)
    });
  }

  async getAlertRules() {
    return this.request('/api/v1/me/alert-rules', alertRulesSchemaV1);
  }

  async createAlertRule(payload: AlertRuleCreateV1) {
    return this.request('/api/v1/me/alert-rules', alertRuleEnvelopeSchemaV1, {
      method: 'POST',
      body: alertRuleCreateSchemaV1.parse(payload)
    });
  }

  async deleteAlertRule(id: string) {
    return this.request(`/api/v1/me/alert-rules/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async getPrivacyPreferences() {
    return this.request('/api/v1/me/privacy/preferences', privacyPreferencesSchemaV1);
  }

  async updatePrivacyPreferences(payload: PrivacyPreferencesUpdateV1) {
    return this.request('/api/v1/me/privacy/preferences', privacyPreferencesSchemaV1, {
      method: 'PATCH',
      body: privacyPreferencesUpdateSchemaV1.parse(payload)
    });
  }

  async getProfile() {
    return this.request('/api/v1/me/profile', profileSchemaV1);
  }

  async updateProfile(payload: ProfileUpdateV1) {
    return this.request('/api/v1/me/profile', profileSchemaV1, {
      method: 'PATCH',
      body: profileUpdateSchemaV1.parse(payload)
    });
  }

  async recordAuthContext(payload: AuthContextUpsertV1) {
    return this.request('/api/v1/me/auth/context', successResponseSchemaV1, {
      method: 'POST',
      body: authContextUpsertSchemaV1.parse(payload)
    });
  }

  async startMobileAuthRisk(payload: MobileAuthRiskStartV1) {
    return this.request('/api/v1/mobile-auth/risk/start', mobileAuthRiskDecisionSchemaV1, {
      method: 'POST',
      body: mobileAuthRiskStartSchemaV1.parse(payload)
    });
  }

  async completeMobileAuthChallenge(payload: MobileAuthChallengeCompleteV1) {
    return this.request('/api/v1/mobile-auth/challenge/complete', mobileAuthChallengeResultSchemaV1, {
      method: 'POST',
      body: mobileAuthChallengeCompleteSchemaV1.parse(payload)
    });
  }

  async mobilePasswordSignIn(payload: MobileAuthPasswordSignInV1) {
    return this.request('/api/v1/mobile-auth/sign-in', mobileAuthPasswordSignInResponseSchemaV1, {
      method: 'POST',
      body: mobileAuthPasswordSignInSchemaV1.parse(payload)
    });
  }

  async mobilePasswordSignUp(payload: MobileAuthPasswordSignUpV1) {
    return this.request('/api/v1/mobile-auth/sign-up', mobileAuthPasswordSignUpResponseSchemaV1, {
      method: 'POST',
      body: mobileAuthPasswordSignUpSchemaV1.parse(payload)
    });
  }

  async mobilePasswordResend(payload: MobileAuthPasswordResendV1) {
    return this.request('/api/v1/mobile-auth/resend', successResponseSchemaV1, {
      method: 'POST',
      body: mobileAuthPasswordResendSchemaV1.parse(payload)
    });
  }

  async mobilePasswordRecover(payload: MobileAuthPasswordRecoverV1) {
    return this.request('/api/v1/mobile-auth/recover', successResponseSchemaV1, {
      method: 'POST',
      body: mobileAuthPasswordRecoverSchemaV1.parse(payload)
    });
  }

  async getMarketingEmail() {
    return this.request('/api/v1/me/marketing-email', marketingEmailSchemaV1);
  }

  async updateMarketingEmail(payload: MarketingEmailUpdateV1) {
    return this.request('/api/v1/me/marketing-email', marketingEmailSchemaV1, {
      method: 'PATCH',
      body: marketingEmailUpdateSchemaV1.parse(payload)
    });
  }

  async getAccountExport() {
    return this.request('/api/v1/me/export', accountExportSchemaV1);
  }

  async getCalendarToken() {
    return this.request('/api/v1/me/calendar-token', calendarTokenSchemaV1);
  }

  async startSmsVerification(payload: SmsVerificationRequestV1) {
    return this.request('/api/v1/me/notification-preferences/sms/verify', smsVerificationStatusSchemaV1, {
      method: 'POST',
      body: smsVerificationRequestSchemaV1.parse(payload)
    });
  }

  async completeSmsVerification(payload: SmsVerificationCheckV1) {
    return this.request('/api/v1/me/notification-preferences/sms/verify/check', smsVerificationStatusSchemaV1, {
      method: 'POST',
      body: smsVerificationCheckSchemaV1.parse(payload)
    });
  }

  async deleteAccount(confirm: string) {
    return this.request('/api/v1/me/account/delete', successResponseSchemaV1, {
      method: 'POST',
      body: { confirm }
    });
  }

  async getWatchlists() {
    return this.request('/api/v1/me/watchlists', watchlistsSchemaV1);
  }

  async createWatchlist(payload: WatchlistCreateV1) {
    return this.request('/api/v1/me/watchlists', watchlistEnvelopeSchemaV1, {
      method: 'POST',
      body: watchlistCreateSchemaV1.parse(payload)
    });
  }

  async updateWatchlist(id: string, payload: WatchlistUpdateV1) {
    return this.request(`/api/v1/me/watchlists/${encodeURIComponent(id)}`, watchlistEnvelopeSchemaV1, {
      method: 'PATCH',
      body: watchlistUpdateSchemaV1.parse(payload)
    });
  }

  async deleteWatchlist(id: string) {
    return this.request(`/api/v1/me/watchlists/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async getFilterPresets() {
    return this.request('/api/v1/me/filter-presets', filterPresetsSchemaV1);
  }

  async createFilterPreset(payload: FilterPresetCreateV1) {
    return this.request('/api/v1/me/filter-presets', filterPresetEnvelopeSchemaV1, {
      method: 'POST',
      body: filterPresetCreateSchemaV1.parse(payload)
    });
  }

  async updateFilterPreset(id: string, payload: FilterPresetUpdateV1) {
    return this.request(`/api/v1/me/filter-presets/${encodeURIComponent(id)}`, filterPresetEnvelopeSchemaV1, {
      method: 'PATCH',
      body: filterPresetUpdateSchemaV1.parse(payload)
    });
  }

  async deleteFilterPreset(id: string) {
    return this.request(`/api/v1/me/filter-presets/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async getCalendarFeeds() {
    return this.request('/api/v1/me/calendar-feeds', calendarFeedsSchemaV1);
  }

  async createCalendarFeed(payload: CalendarFeedCreateV1) {
    return this.request('/api/v1/me/calendar-feeds', calendarFeedEnvelopeSchemaV1, {
      method: 'POST',
      body: calendarFeedCreateSchemaV1.parse(payload)
    });
  }

  async updateCalendarFeed(id: string, payload: CalendarFeedUpdateV1) {
    return this.request(`/api/v1/me/calendar-feeds/${encodeURIComponent(id)}`, calendarFeedEnvelopeSchemaV1, {
      method: 'PATCH',
      body: calendarFeedUpdateSchemaV1.parse(payload)
    });
  }

  async deleteCalendarFeed(id: string) {
    return this.request(`/api/v1/me/calendar-feeds/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async rotateCalendarFeed(id: string) {
    return this.request(`/api/v1/me/calendar-feeds/${encodeURIComponent(id)}/rotate`, calendarFeedEnvelopeSchemaV1, {
      method: 'POST'
    });
  }

  async getRssFeeds() {
    return this.request('/api/v1/me/rss-feeds', rssFeedsSchemaV1);
  }

  async createRssFeed(payload: RssFeedCreateV1) {
    return this.request('/api/v1/me/rss-feeds', rssFeedEnvelopeSchemaV1, {
      method: 'POST',
      body: rssFeedCreateSchemaV1.parse(payload)
    });
  }

  async updateRssFeed(id: string, payload: RssFeedUpdateV1) {
    return this.request(`/api/v1/me/rss-feeds/${encodeURIComponent(id)}`, rssFeedEnvelopeSchemaV1, {
      method: 'PATCH',
      body: rssFeedUpdateSchemaV1.parse(payload)
    });
  }

  async deleteRssFeed(id: string) {
    return this.request(`/api/v1/me/rss-feeds/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async rotateRssFeed(id: string) {
    return this.request(`/api/v1/me/rss-feeds/${encodeURIComponent(id)}/rotate`, rssFeedEnvelopeSchemaV1, {
      method: 'POST'
    });
  }

  async getEmbedWidgets() {
    return this.request('/api/v1/me/embed-widgets', embedWidgetsSchemaV1);
  }

  async createEmbedWidget(payload: EmbedWidgetCreateV1) {
    return this.request('/api/v1/me/embed-widgets', embedWidgetEnvelopeSchemaV1, {
      method: 'POST',
      body: embedWidgetCreateSchemaV1.parse(payload)
    });
  }

  async updateEmbedWidget(id: string, payload: EmbedWidgetUpdateV1) {
    return this.request(`/api/v1/me/embed-widgets/${encodeURIComponent(id)}`, embedWidgetEnvelopeSchemaV1, {
      method: 'PATCH',
      body: embedWidgetUpdateSchemaV1.parse(payload)
    });
  }

  async deleteEmbedWidget(id: string) {
    return this.request(`/api/v1/me/embed-widgets/${encodeURIComponent(id)}`, successResponseSchemaV1, {
      method: 'DELETE'
    });
  }

  async rotateEmbedWidget(id: string) {
    return this.request(`/api/v1/me/embed-widgets/${encodeURIComponent(id)}/rotate`, embedWidgetEnvelopeSchemaV1, {
      method: 'POST'
    });
  }

  async getLaunchNotificationPreference(launchId: string, channel: 'sms' | 'push' = 'push') {
    return this.request(
      appendQuery(`/api/v1/me/launch-notifications/${encodeURIComponent(launchId)}`, {
        channel
      }),
      launchNotificationPreferenceEnvelopeSchemaV1
    );
  }

  async updateLaunchNotificationPreference(launchId: string, payload: LaunchNotificationPreferenceUpdateV1) {
    return this.request(`/api/v1/me/launch-notifications/${encodeURIComponent(launchId)}`, launchNotificationPreferenceEnvelopeSchemaV1, {
      method: 'POST',
      body: launchNotificationPreferenceUpdateSchemaV1.parse(payload)
    });
  }

  async createWatchlistRule(watchlistId: string, payload: WatchlistRuleCreateV1) {
    return this.request(`/api/v1/me/watchlists/${encodeURIComponent(watchlistId)}/rules`, watchlistRuleEnvelopeSchemaV1, {
      method: 'POST',
      body: watchlistRuleCreateSchemaV1.parse(payload)
    });
  }

  async deleteWatchlistRule(watchlistId: string, ruleId: string) {
    return this.request(
      `/api/v1/me/watchlists/${encodeURIComponent(watchlistId)}/rules/${encodeURIComponent(ruleId)}`,
      successResponseSchemaV1,
      {
        method: 'DELETE'
      }
    );
  }

  async registerPushDevice(payload: PushDeviceRegistrationV1) {
    return this.request('/api/v1/me/push-devices', pushDeviceRegistrationSchemaV1, {
      method: 'POST',
      body: payload
    });
  }

  async removePushDevice(payload: Omit<PushDeviceRemovalV1, 'removed' | 'removedAt'>) {
    return this.request('/api/v1/me/push-devices', pushDeviceRemovalSchemaV1, {
      method: 'DELETE',
      body: payload
    });
  }

  async sendPushTest() {
    return this.request('/api/v1/me/push-devices/test', pushDeliveryTestSchemaV1, {
      method: 'POST'
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

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const code = json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : null;
      const detail = json && typeof json === 'object' && typeof (json as { message?: unknown }).message === 'string'
        ? (json as { message: string }).message
        : null;
      throw new ApiClientError(path, response.status, code, detail);
    }

    return schema.parse(json);
  }
}

export function createApiClient(options?: ApiClientOptions) {
  return new ApiClient(options);
}

export type {
  AlertRuleCreateV1,
  AlertRuleEnvelopeV1,
  AlertRuleV1,
  AlertRulesV1,
  AppleBillingSyncRequestV1,
  AuthContextUpsertV1,
  BillingCatalogProductV1,
  BillingCatalogV1,
  BillingPlatformV1,
  BillingSummaryV1,
  BillingSyncResponseV1,
  BlueOriginContractsResponseV1,
  BlueOriginEnginesResponseV1,
  BlueOriginFlightsResponseV1,
  BlueOriginMissionKeyV1,
  BlueOriginMissionOverviewV1,
  BlueOriginOverviewV1,
  BlueOriginTravelersResponseV1,
  BlueOriginVehiclesResponseV1,
  CalendarFeedCreateV1,
  CalendarFeedV1,
  CalendarFeedEnvelopeV1,
  CalendarFeedsV1,
  CalendarFeedUpdateV1,
  EmbedWidgetCreateV1,
  EmbedWidgetV1,
  EmbedWidgetEnvelopeV1,
  EmbedWidgetsV1,
  EmbedWidgetUpdateV1,
  EntitlementsV1,
  FilterPresetV1,
  FilterPresetCreateV1,
  FilterPresetEnvelopeV1,
  FilterPresetsV1,
  FilterPresetUpdateV1,
  GoogleBillingSyncRequestV1,
  MobileAuthChallengeCompleteV1,
  MobileAuthChallengeResultV1,
  MobileAuthPasswordRecoverV1,
  MobileAuthPasswordResendV1,
  MobileAuthPasswordSignInResponseV1,
  MobileAuthPasswordSignInV1,
  MobileAuthPasswordSignUpResponseV1,
  MobileAuthPasswordSignUpV1,
  MobileAuthRiskDecisionV1,
  MobileAuthRiskStartV1,
  LaunchDetailV1,
  LaunchFilterOptionsV1,
  LaunchFeedV1,
  ChangedLaunchesV1,
  LaunchNotificationPreferenceEnvelopeV1,
  LaunchNotificationPreferenceUpdateV1,
  MarketingEmailUpdateV1,
  MarketingEmailV1,
  NotificationPreferencesV1,
  NotificationPreferencesUpdateV1,
  PrivacyPreferencesV1,
  PrivacyPreferencesUpdateV1,
  ProfileV1,
  ProfileUpdateV1,
  ArTelemetrySessionEventV1,
  AccountExportV1,
  CalendarTokenV1,
  PushDeliveryTestV1,
  PushDeviceRegistrationV1,
  PushDeviceRemovalV1,
  SearchResponseV1,
  SmsVerificationCheckV1,
  SmsVerificationRequestV1,
  SmsVerificationStatusV1,
  SuccessResponseV1,
  TrajectoryPublicV2ResponseV1,
  ViewerSessionV1,
  RssFeedCreateV1,
  RssFeedV1,
  RssFeedEnvelopeV1,
  RssFeedsV1,
  RssFeedUpdateV1,
  WatchlistCreateV1,
  WatchlistEnvelopeV1,
  WatchlistRuleCreateV1,
  WatchlistRuleV1,
  WatchlistRuleEnvelopeV1,
  WatchlistV1,
  WatchlistUpdateV1,
  WatchlistsV1
};

export type { BlueOriginMissionFilterRequest, ChangedLaunchesRequest, LaunchFeedRequest, LaunchFilterOptionsRequest };
