import {
  basicFollowsSchemaV1,
  alertRuleCreateSchemaV1,
  alertRuleEnvelopeSchemaV1,
  alertRulesSchemaV1,
  arTelemetrySessionEventSchemaV1,
  appleAuthCaptureResponseSchemaV1,
  appleAuthCaptureSchemaV1,
  appleBillingSyncRequestSchemaV1,
  authMethodsSchemaV1,
  authContextUpsertSchemaV1,
  billingCatalogSchemaV1,
  adminAccessOverrideSchemaV1,
  adminAccessOverrideUpdateSchemaV1,
  premiumClaimAttachResponseSchemaV1,
  premiumClaimEnvelopeSchemaV1,
  premiumClaimPasswordSignUpResponseSchemaV1,
  premiumClaimPasswordSignUpSchemaV1,
  billingSummarySchemaV1,
  billingSyncResponseSchemaV1,
  blueOriginContractsResponseSchemaV1,
  blueOriginEnginesResponseSchemaV1,
  blueOriginFlightsResponseSchemaV1,
  blueOriginMissionOverviewSchemaV1,
  blueOriginOverviewSchemaV1,
  blueOriginTravelersResponseSchemaV1,
  blueOriginVehiclesResponseSchemaV1,
  spaceXContractsResponseSchemaV1,
  spaceXDroneShipDetailSchemaV1,
  spaceXDroneShipListResponseSchemaV1,
  spaceXEnginesResponseSchemaV1,
  spaceXFlightsResponseSchemaV1,
  spaceXMissionOverviewSchemaV1,
  spaceXOverviewSchemaV1,
  spaceXVehiclesResponseSchemaV1,
  artemisAwardeeDetailSchemaV1,
  artemisAwardeesResponseSchemaV1,
  artemisContentResponseSchemaV1,
  artemisContractDetailSchemaV1,
  artemisContractsResponseSchemaV1,
  artemisMissionOverviewSchemaV1,
  artemisOverviewSchemaV1,
  starshipFlightOverviewSchemaV1,
  starshipOverviewSchemaV1,
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
  launchFaaAirspaceMapSchemaV1,
  launchJepScoreSchemaV1,
  launchDetailVersionSchemaV1,
  launchFilterOptionsSchemaV1,
  launchFeedSchemaV1,
  launchFeedVersionSchemaV1,
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
  mobilePushDeviceRegisterSchemaV1,
  mobilePushDeviceRemoveSchemaV1,
  mobilePushDeviceSchemaV1,
  mobilePushLaunchPreferenceEnvelopeSchemaV1,
  mobilePushRuleEnvelopeSchemaV1,
  mobilePushRulesEnvelopeSchemaV1,
  mobilePushRuleUpsertSchemaV1,
  mobilePushTestRequestSchemaV1,
  mobilePushTestSchemaV1,
  pushDeliveryTestSchemaV1,
  pushDeviceRegistrationSchemaV1,
  pushDeviceRemovalSchemaV1,
  accountExportSchemaV1,
  searchResponseSchemaV1,
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
  newsStreamSchemaV1,
  canonicalContractDetailSchemaV1,
  canonicalContractsResponseSchemaV1,
  satellitesResponseSchemaV1,
  satelliteDetailSchemaV1,
  satelliteOwnerProfileSchemaV1,
  satelliteOwnersResponseSchemaV1,
  contentPageSchemaV1,
  infoHubSchemaV1,
  catalogHubSchemaV1,
  catalogCollectionSchemaV1,
  catalogDetailSchemaV1,
  providerDetailSchemaV1,
  rocketDetailSchemaV1,
  locationDetailSchemaV1,
  padDetailSchemaV1,
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
  type AppleAuthCaptureResponseV1,
  type AppleAuthCaptureSourceV1,
  type AppleAuthCaptureV1,
  type AuthMethodV1,
  type AuthMethodsV1,
  type BasicFollowsV1,
  type AppleBillingSyncRequestV1,
  type AuthContextUpsertV1,
  type BillingCatalogOfferV1,
  type BillingCatalogProductV1,
  type BillingCatalogV1,
  type AdminAccessOverrideV1,
  type AdminAccessOverrideUpdateV1,
  type PremiumClaimAttachResponseV1,
  type PremiumClaimEnvelopeV1,
  type PremiumClaimPasswordSignUpResponseV1,
  type PremiumClaimPasswordSignUpV1,
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
  type SpaceXMissionKeyV1,
  type SpaceXDroneShipDetailV1,
  type SpaceXDroneShipListResponseV1,
  type SpaceXOverviewV1,
  type SpaceXMissionOverviewV1,
  type SpaceXFlightsResponseV1,
  type SpaceXVehiclesResponseV1,
  type SpaceXEnginesResponseV1,
  type SpaceXContractsResponseV1,
  type StarshipFlightOverviewV1,
  type StarshipOverviewV1,
  type ArtemisMissionKeyV1,
  type ArtemisContractsResponseV1,
  type ArtemisContractDetailV1,
  type ArtemisAwardeesResponseV1,
  type ArtemisAwardeeDetailV1,
  type ArtemisContentResponseV1,
  type ArtemisOverviewV1,
  type ArtemisMissionOverviewV1,
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
  type LaunchFaaAirspaceMapV1,
  type LaunchJepScoreV1,
  type LaunchDetailVersionV1,
  type LaunchFilterOptionsV1,
  type LaunchFeedV1,
  type LaunchFeedVersionV1,
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
  type NewsStreamV1,
  type CanonicalContractsResponseV1,
  type CanonicalContractDetailV1,
  type SatellitesResponseV1,
  type SatelliteOwnersResponseV1,
  type SatelliteDetailV1,
  type SatelliteOwnerProfileV1,
  type ContentPageV1,
  type InfoHubV1,
  type CatalogEntityTypeV1,
  type CatalogHubV1,
  type CatalogCollectionV1,
  type CatalogDetailV1,
  type ProviderDetailV1,
  type RocketDetailV1,
  type LocationDetailV1,
  type PadDetailV1,
  type MarketingEmailUpdateV1,
  type MarketingEmailV1,
  type NotificationPreferencesV1,
  type NotificationPreferencesUpdateV1,
  type PrivacyPreferencesV1,
  type PrivacyPreferencesUpdateV1,
  type PremiumClaimV1,
  type ProfileV1,
  type ProfileUpdateV1,
  type MobilePushDeviceRegisterV1,
  type MobilePushDeviceRemoveV1,
  type MobilePushDeviceV1,
  type MobilePushGuestContextV1,
  type MobilePushLaunchPreferenceEnvelopeV1,
  type MobilePushRuleV1,
  type MobilePushRuleEnvelopeV1,
  type MobilePushRulesEnvelopeV1,
  type MobilePushRuleUpsertV1,
  type MobilePushTestRequestV1,
  type MobilePushTestV1,
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
  padId?: number | null;
  region?: 'us' | 'non-us' | 'all';
  provider?: string | null;
  providerId?: number | null;
  rocketId?: number | null;
  sort?: 'soonest' | 'latest' | 'changed';
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type LaunchFeedVersionRequest = {
  scope?: 'public' | 'live';
  range?: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  from?: string | null;
  to?: string | null;
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  padId?: number | null;
  region?: 'us' | 'non-us' | 'all';
  provider?: string | null;
  providerId?: number | null;
  rocketId?: number | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type LaunchDetailVersionRequest = {
  scope?: 'public' | 'live';
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

type LaunchJepRequest = {
  observerLat?: number | null;
  observerLon?: number | null;
};

type BlueOriginMissionFilterRequest = {
  mission?: BlueOriginMissionKeyV1 | 'all' | null;
};

type SpaceXMissionFilterRequest = {
  mission?: SpaceXMissionKeyV1 | 'all' | null;
};

type ArtemisAwardeeIndexRequest = {
  q?: string | null;
  limit?: number | null;
};

type ArtemisContentRequest = {
  mission?: ArtemisMissionKeyV1 | 'program' | 'all' | null;
  kind?: 'article' | 'photo' | 'social' | 'data' | 'all' | null;
  tier?: 'tier1' | 'tier2' | 'all' | null;
  cursor?: string | null;
  limit?: number | null;
};

type NewsStreamRequest = {
  type?: 'all' | 'article' | 'blog' | 'report' | null;
  provider?: string | null;
  cursor?: number | null;
  limit?: number | null;
};

type CanonicalContractsRequest = {
  q?: string | null;
  scope?: 'all' | 'spacex' | 'blue-origin' | 'artemis' | null;
};

type SatellitesRequest = {
  limit?: number | null;
  offset?: number | null;
};

type SatelliteOwnersRequest = {
  limit?: number | null;
  offset?: number | null;
};

type CatalogCollectionRequest = {
  region?: 'all' | 'us' | null;
  q?: string | null;
  limit?: number | null;
  offset?: number | null;
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
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.fetchImpl = fetchImpl.bind(globalThis) as typeof fetch;
  }

  async getViewerSession() {
    return this.request('/api/v1/viewer/session', viewerSessionSchemaV1);
  }

  async getViewerEntitlements() {
    return this.request('/api/v1/viewer/entitlements', entitlementSchemaV1);
  }

  async getAdminAccessOverride() {
    return this.request('/api/v1/me/admin-access-override', adminAccessOverrideSchemaV1);
  }

  async updateAdminAccessOverride(payload: AdminAccessOverrideUpdateV1) {
    return this.request('/api/v1/me/admin-access-override', adminAccessOverrideSchemaV1, {
      method: 'PUT',
      body: adminAccessOverrideUpdateSchemaV1.parse(payload)
    });
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

  async syncAppleBillingClaim(payload: AppleBillingSyncRequestV1) {
    return this.request('/api/v1/billing/claims/apple', premiumClaimEnvelopeSchemaV1, {
      method: 'POST',
      body: appleBillingSyncRequestSchemaV1.parse(payload)
    });
  }

  async syncGoogleBillingClaim(payload: GoogleBillingSyncRequestV1) {
    return this.request('/api/v1/billing/claims/google', premiumClaimEnvelopeSchemaV1, {
      method: 'POST',
      body: googleBillingSyncRequestSchemaV1.parse(payload)
    });
  }

  async getPremiumClaim(claimToken: string) {
    return this.request(`/api/v1/billing/claims/${encodeURIComponent(claimToken)}`, premiumClaimEnvelopeSchemaV1);
  }

  async attachPremiumClaim(claimToken: string) {
    return this.request(`/api/v1/billing/claims/${encodeURIComponent(claimToken)}/attach`, premiumClaimAttachResponseSchemaV1, {
      method: 'POST'
    });
  }

  async createPremiumAccountFromClaim(payload: PremiumClaimPasswordSignUpV1) {
    return this.request('/api/v1/billing/claims/sign-up', premiumClaimPasswordSignUpResponseSchemaV1, {
      method: 'POST',
      body: premiumClaimPasswordSignUpSchemaV1.parse(payload)
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
        padId: options.padId,
        region: options.region,
        provider: options.provider,
        providerId: options.providerId,
        rocketId: options.rocketId,
        sort: options.sort,
        status: options.status
      }),
      launchFeedSchemaV1
    );
  }

  async getLaunchFeedVersion(options: LaunchFeedVersionRequest = {}) {
    return this.request(
      appendQuery('/api/v1/launches/version', {
        scope: options.scope,
        range: options.range,
        from: options.from,
        to: options.to,
        location: options.location,
        state: options.state,
        pad: options.pad,
        padId: options.padId,
        region: options.region,
        provider: options.provider,
        providerId: options.providerId,
        rocketId: options.rocketId,
        status: options.status
      }),
      launchFeedVersionSchemaV1
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

  async getLaunchJep(id: string, options: LaunchJepRequest = {}) {
    return this.request(
      appendQuery(`/api/v1/launches/${encodeURIComponent(id)}/jep`, {
        observer_lat: options.observerLat,
        observer_lon: options.observerLon
      }),
      launchJepScoreSchemaV1
    );
  }

  async getLaunchFaaAirspaceMap(id: string) {
    return this.request(`/api/v1/launches/${encodeURIComponent(id)}/faa-airspace-map`, launchFaaAirspaceMapSchemaV1);
  }

  async getLaunchDetailVersion(id: string, options: LaunchDetailVersionRequest = {}) {
    return this.request(
      appendQuery(`/api/v1/launches/${encodeURIComponent(id)}/version`, {
        scope: options.scope
      }),
      launchDetailVersionSchemaV1
    );
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

  async getSpaceXOverview() {
    return this.request('/api/v1/spacex', spaceXOverviewSchemaV1);
  }

  async getSpaceXMissionOverview(mission: Exclude<SpaceXMissionKeyV1, 'spacex-program'>) {
    return this.request(`/api/v1/spacex/missions/${encodeURIComponent(mission)}`, spaceXMissionOverviewSchemaV1);
  }

  async getSpaceXFlights(options: SpaceXMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/spacex/flights', {
        mission: options.mission ?? 'all'
      }),
      spaceXFlightsResponseSchemaV1
    );
  }

  async getSpaceXVehicles(options: SpaceXMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/spacex/vehicles', {
        mission: options.mission ?? 'all'
      }),
      spaceXVehiclesResponseSchemaV1
    );
  }

  async getSpaceXEngines(options: SpaceXMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/spacex/engines', {
        mission: options.mission ?? 'all'
      }),
      spaceXEnginesResponseSchemaV1
    );
  }

  async getSpaceXContracts(options: SpaceXMissionFilterRequest = {}) {
    return this.request(
      appendQuery('/api/v1/spacex/contracts', {
        mission: options.mission ?? 'all'
      }),
      spaceXContractsResponseSchemaV1
    );
  }

  async getSpaceXDroneShips() {
    return this.request('/api/v1/spacex/drone-ships', spaceXDroneShipListResponseSchemaV1);
  }

  async getSpaceXDroneShipDetail(slug: string) {
    return this.request(`/api/v1/spacex/drone-ships/${encodeURIComponent(slug)}`, spaceXDroneShipDetailSchemaV1);
  }

  async getStarshipOverview() {
    return this.request('/api/v1/starship', starshipOverviewSchemaV1);
  }

  async getStarshipFlightOverview(slug: string) {
    return this.request(`/api/v1/starship/${encodeURIComponent(slug)}`, starshipFlightOverviewSchemaV1);
  }

  async getArtemisOverview() {
    return this.request('/api/v1/artemis', artemisOverviewSchemaV1);
  }

  async getArtemisMissionOverview(mission: ArtemisMissionKeyV1) {
    return this.request(`/api/v1/artemis/missions/${encodeURIComponent(mission)}`, artemisMissionOverviewSchemaV1);
  }

  async getArtemisContracts() {
    return this.request('/api/v1/artemis/contracts', artemisContractsResponseSchemaV1);
  }

  async getArtemisContractDetail(piid: string) {
    return this.request(`/api/v1/artemis/contracts/${encodeURIComponent(piid)}`, artemisContractDetailSchemaV1);
  }

  async getArtemisAwardees(options: ArtemisAwardeeIndexRequest = {}) {
    return this.request(
      appendQuery('/api/v1/artemis/awardees', {
        q: options.q ?? null,
        limit: options.limit ?? null
      }),
      artemisAwardeesResponseSchemaV1
    );
  }

  async getArtemisAwardeeDetail(slug: string) {
    return this.request(`/api/v1/artemis/awardees/${encodeURIComponent(slug)}`, artemisAwardeeDetailSchemaV1);
  }

  async getArtemisContent(options: ArtemisContentRequest = {}) {
    return this.request(
      appendQuery('/api/v1/artemis/content', {
        mission: options.mission ?? 'all',
        kind: options.kind ?? 'all',
        tier: options.tier ?? 'all',
        cursor: options.cursor ?? null,
        limit: options.limit ?? null
      }),
      artemisContentResponseSchemaV1
    );
  }

  async getNewsStream(options: NewsStreamRequest = {}) {
    return this.request(
      appendQuery('/api/v1/news', {
        type: options.type ?? 'all',
        provider: options.provider ?? null,
        cursor: options.cursor ?? null,
        limit: options.limit ?? null
      }),
      newsStreamSchemaV1
    );
  }

  async getCanonicalContracts(options: CanonicalContractsRequest = {}) {
    return this.request(
      appendQuery('/api/v1/contracts', {
        q: options.q ?? null,
        scope: options.scope ?? 'all'
      }),
      canonicalContractsResponseSchemaV1
    );
  }

  async getCanonicalContractDetail(contractUid: string) {
    return this.request(`/api/v1/contracts/${encodeURIComponent(contractUid)}`, canonicalContractDetailSchemaV1);
  }

  async getSatellites(options: SatellitesRequest = {}) {
    return this.request(
      appendQuery('/api/v1/satellites', {
        limit: options.limit ?? null,
        offset: options.offset ?? null
      }),
      satellitesResponseSchemaV1
    );
  }

  async getSatelliteDetail(noradCatId: string | number) {
    return this.request(`/api/v1/satellites/${encodeURIComponent(String(noradCatId))}`, satelliteDetailSchemaV1);
  }

  async getSatelliteOwners(options: SatelliteOwnersRequest = {}) {
    return this.request(
      appendQuery('/api/v1/satellites/owners', {
        limit: options.limit ?? null,
        offset: options.offset ?? null
      }),
      satelliteOwnersResponseSchemaV1
    );
  }

  async getSatelliteOwnerProfile(owner: string) {
    return this.request(`/api/v1/satellites/owners/${encodeURIComponent(owner)}`, satelliteOwnerProfileSchemaV1);
  }

  async getInfoHub() {
    return this.request('/api/v1/info', infoHubSchemaV1);
  }

  async getContentPage(slug: string) {
    return this.request(`/api/v1/content/${encodeURIComponent(slug)}`, contentPageSchemaV1);
  }

  async getCatalogHub() {
    return this.request('/api/v1/catalog', catalogHubSchemaV1);
  }

  async getCatalogCollection(entity: CatalogEntityTypeV1, options: CatalogCollectionRequest = {}) {
    return this.request(
      appendQuery(`/api/v1/catalog/${encodeURIComponent(entity)}`, {
        region: options.region ?? 'all',
        q: options.q ?? null,
        limit: options.limit ?? null,
        offset: options.offset ?? null
      }),
      catalogCollectionSchemaV1
    );
  }

  async getCatalogDetail(entity: CatalogEntityTypeV1, entityId: string) {
    return this.request(`/api/v1/catalog/${encodeURIComponent(entity)}/${encodeURIComponent(entityId)}`, catalogDetailSchemaV1);
  }

  async getProviderDetail(slug: string) {
    return this.request(`/api/v1/providers/${encodeURIComponent(slug)}`, providerDetailSchemaV1);
  }

  async getRocketDetail(id: string) {
    return this.request(`/api/v1/rockets/${encodeURIComponent(id)}`, rocketDetailSchemaV1);
  }

  async getLocationDetail(id: string) {
    return this.request(`/api/v1/locations/${encodeURIComponent(id)}`, locationDetailSchemaV1);
  }

  async getPadDetail(id: string) {
    return this.request(`/api/v1/pads/${encodeURIComponent(id)}`, padDetailSchemaV1);
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

  async getBasicFollows() {
    return this.request('/api/v1/me/basic-follows', basicFollowsSchemaV1);
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

  async captureAppleAuth(payload: AppleAuthCaptureV1) {
    return this.request('/api/v1/me/auth/apple/capture', appleAuthCaptureResponseSchemaV1, {
      method: 'POST',
      body: appleAuthCaptureSchemaV1.parse(payload)
    });
  }

  async getAuthMethods() {
    return this.request('/api/v1/me/auth-methods', authMethodsSchemaV1);
  }

  async clearAppleAuthArtifacts() {
    return this.request('/api/v1/me/auth/apple', successResponseSchemaV1, {
      method: 'DELETE'
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

  async getLaunchNotificationPreference(launchId: string) {
    return this.request(`/api/v1/me/launch-notifications/${encodeURIComponent(launchId)}`, launchNotificationPreferenceEnvelopeSchemaV1);
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

  async registerMobilePushDevice(payload: MobilePushDeviceRegisterV1) {
    return this.request('/api/v1/mobile/push/device', mobilePushDeviceSchemaV1, {
      method: 'POST',
      body: mobilePushDeviceRegisterSchemaV1.parse(payload)
    });
  }

  async removeMobilePushDevice(payload: MobilePushDeviceRemoveV1) {
    return this.request('/api/v1/mobile/push/device', mobilePushDeviceSchemaV1, {
      method: 'DELETE',
      body: mobilePushDeviceRemoveSchemaV1.parse(payload)
    });
  }

  async getMobilePushRules(payload: MobilePushGuestContextV1) {
    return this.request(
      appendQuery('/api/v1/mobile/push/rules', {
        installationId: payload.installationId,
        deviceSecret: payload.deviceSecret ?? null
      }),
      mobilePushRulesEnvelopeSchemaV1
    );
  }

  async upsertMobilePushRule(payload: MobilePushRuleUpsertV1) {
    return this.request('/api/v1/mobile/push/rules', mobilePushRuleEnvelopeSchemaV1, {
      method: 'POST',
      body: mobilePushRuleUpsertSchemaV1.parse(payload)
    });
  }

  async deleteMobilePushRule(id: string, payload: MobilePushGuestContextV1) {
    return this.request(
      appendQuery(`/api/v1/mobile/push/rules/${encodeURIComponent(id)}`, {
        installationId: payload.installationId,
        deviceSecret: payload.deviceSecret ?? null
      }),
      successResponseSchemaV1,
      {
        method: 'DELETE'
      }
    );
  }

  async getMobilePushLaunchPreference(launchId: string, payload: MobilePushGuestContextV1) {
    return this.request(
      appendQuery(`/api/v1/mobile/push/launches/${encodeURIComponent(launchId)}`, {
        installationId: payload.installationId,
        deviceSecret: payload.deviceSecret ?? null
      }),
      mobilePushLaunchPreferenceEnvelopeSchemaV1
    );
  }

  async upsertMobilePushLaunchPreference(launchId: string, payload: MobilePushRuleUpsertV1) {
    return this.request(`/api/v1/mobile/push/launches/${encodeURIComponent(launchId)}`, mobilePushRuleEnvelopeSchemaV1, {
      method: 'POST',
      body: mobilePushRuleUpsertSchemaV1.parse(payload)
    });
  }

  async sendMobilePushTest(payload: MobilePushTestRequestV1) {
    return this.request('/api/v1/mobile/push/test', mobilePushTestSchemaV1, {
      method: 'POST',
      body: mobilePushTestRequestSchemaV1.parse(payload)
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
  BasicFollowsV1,
  AlertRuleCreateV1,
  AlertRuleEnvelopeV1,
  AlertRuleV1,
  AlertRulesV1,
  AppleBillingSyncRequestV1,
  AuthMethodV1,
  AuthMethodsV1,
  AuthContextUpsertV1,
  BillingCatalogOfferV1,
  BillingCatalogProductV1,
  BillingCatalogV1,
  AdminAccessOverrideV1,
  AdminAccessOverrideUpdateV1,
  PremiumClaimAttachResponseV1,
  PremiumClaimEnvelopeV1,
  PremiumClaimPasswordSignUpResponseV1,
  PremiumClaimPasswordSignUpV1,
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
  SpaceXMissionKeyV1,
  SpaceXDroneShipDetailV1,
  SpaceXDroneShipListResponseV1,
  SpaceXOverviewV1,
  SpaceXMissionOverviewV1,
  SpaceXFlightsResponseV1,
  SpaceXVehiclesResponseV1,
  SpaceXEnginesResponseV1,
  SpaceXContractsResponseV1,
  StarshipFlightOverviewV1,
  StarshipOverviewV1,
  ArtemisMissionKeyV1,
  ArtemisContractsResponseV1,
  ArtemisContractDetailV1,
  ArtemisAwardeesResponseV1,
  ArtemisAwardeeDetailV1,
  ArtemisContentResponseV1,
  ArtemisOverviewV1,
  ArtemisMissionOverviewV1,
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
  NewsStreamV1,
  CanonicalContractsResponseV1,
  CanonicalContractDetailV1,
  SatellitesResponseV1,
  SatelliteOwnersResponseV1,
  SatelliteDetailV1,
  SatelliteOwnerProfileV1,
  ContentPageV1,
  InfoHubV1,
  CatalogEntityTypeV1,
  CatalogHubV1,
  CatalogCollectionV1,
  CatalogDetailV1,
  ProviderDetailV1,
  RocketDetailV1,
  LocationDetailV1,
  PadDetailV1,
  LaunchDetailV1,
  LaunchFaaAirspaceMapV1,
  LaunchJepScoreV1,
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
  PremiumClaimV1,
  ProfileV1,
  ProfileUpdateV1,
  MobilePushDeviceRegisterV1,
  MobilePushDeviceRemoveV1,
  MobilePushDeviceV1,
  MobilePushGuestContextV1,
  MobilePushLaunchPreferenceEnvelopeV1,
  MobilePushRuleV1,
  MobilePushRuleEnvelopeV1,
  MobilePushRulesEnvelopeV1,
  MobilePushRuleUpsertV1,
  MobilePushTestRequestV1,
  MobilePushTestV1,
  ArTelemetrySessionEventV1,
  AccountExportV1,
  CalendarTokenV1,
  PushDeliveryTestV1,
  PushDeviceRegistrationV1,
  PushDeviceRemovalV1,
  SearchResponseV1,
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

export type {
  BlueOriginMissionFilterRequest,
  SpaceXMissionFilterRequest,
  ArtemisAwardeeIndexRequest,
  ArtemisContentRequest,
  NewsStreamRequest,
  CanonicalContractsRequest,
  SatellitesRequest,
  SatelliteOwnersRequest,
  CatalogCollectionRequest,
  ChangedLaunchesRequest,
  LaunchJepRequest,
  LaunchDetailVersionRequest,
  LaunchDetailVersionV1,
  LaunchFeedRequest,
  LaunchFeedVersionRequest,
  LaunchFeedVersionV1,
  LaunchFilterOptionsRequest
};
