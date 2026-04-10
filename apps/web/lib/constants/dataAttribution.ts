export type SourceMode = 'active' | 'dormant';
export type SourceScope = 'core' | 'feature';
export type AttributionRequirement = 'required' | 'recommended' | 'optional' | 'unknown';
export type ComplianceStatus = 'compliant' | 'missing' | 'over_attributed' | 'unclear';

export type DataSourcePolicyReference = {
  label: string;
  url: string;
  note: string;
};

export type DataSourceRecord = {
  key: string;
  providerName: string;
  sourceLabel: string;
  mode: SourceMode;
  scope: SourceScope;
  endpointDomains: string[];
  dataClasses: string[];
  ingestionPath: string[];
  storageTables: string[];
  userFacingSurfaces: string[];
  publicClaimSurfaces: string[];
  attributionRequirement: AttributionRequirement;
  complianceStatus: ComplianceStatus;
  policyReferences: DataSourcePolicyReference[];
  rationale: string;
  remediationAction: string;
  remediationPriority: 'P0' | 'P1' | 'P2' | 'none';
};

export type DataAttributionClaimRecord = {
  key: string;
  sourceKey: string;
  file: string;
  claim: string;
};

export type PublicDataAttributionEntry = {
  key: string;
  section: 'Core feed sources' | 'Feature-specific sources';
  sourceLabel: string;
  usage: string;
  sourceUrl: string;
  attributionNote: string;
};

export const DATA_ATTRIBUTION_AUDIT_DATE = '2026-03-05';

export const DATA_SOURCE_REGISTRY: DataSourceRecord[] = [
  {
    key: 'll2_launch_library',
    providerName: 'The Space Devs',
    sourceLabel: 'Launch Library 2 (LL2)',
    mode: 'active',
    scope: 'core',
    endpointDomains: ['ll.thespacedevs.com'],
    dataClasses: ['launch schedule', 'provider metadata', 'vehicle metadata', 'pad metadata', 'image metadata'],
    ingestionPath: [
      'supabase/functions/ingestion-cycle/index.ts',
      'supabase/functions/ll2-backfill/index.ts',
      'supabase/functions/ll2-catalog/index.ts'
    ],
    storageTables: ['public.launches', 'public.launches_public_cache', 'public.ll2_*'],
    userFacingSurfaces: ['app/page.tsx', 'app/launches/[id]/page.tsx', 'app/catalog/page.tsx'],
    publicClaimSurfaces: [
      'app/legal/data/page.tsx',
      'app/docs/faq/page.tsx',
      'components/Footer.tsx',
      'components/TipJarFooter.tsx',
      'components/DockingBay.tsx'
    ],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'LL2 landing page',
        url: 'https://thespacedevs.com/llapi',
        note: 'Public page documents API usage and rate limits; explicit attribution language is not published there.'
      }
    ],
    rationale: 'Primary launch feed source; product policy is to credit LL2 throughout launch surfaces.',
    remediationAction: 'Keep LL2 listed as the primary launch schedule source.',
    remediationPriority: 'none'
  },
  {
    key: 'snapi_news',
    providerName: 'The Space Devs',
    sourceLabel: 'Spaceflight News API (SNAPI)',
    mode: 'active',
    scope: 'core',
    endpointDomains: ['api.spaceflightnewsapi.net', 'spaceflightnewsapi.net'],
    dataClasses: ['news metadata', 'publisher links', 'related launch/event joins'],
    ingestionPath: ['supabase/functions/ingestion-cycle/index.ts', 'supabase/functions/_shared/snapi.ts'],
    storageTables: ['public.snapi_items', 'public.snapi_item_launches', 'public.snapi_item_events'],
    userFacingSurfaces: ['app/news/page.tsx', 'app/providers/[slug]/page.tsx', 'app/launches/[id]/page.tsx'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'app/docs/faq/page.tsx', 'app/news/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'SNAPI homepage',
        url: 'https://spaceflightnewsapi.net/',
        note: 'Public docs do not currently publish a standalone data license/attribution clause; app policy keeps visible source credit.'
      },
      {
        label: 'SNAPI docs',
        url: 'https://api.spaceflightnewsapi.net/v4/docs',
        note: 'Operational API documentation; no explicit attribution requirement located in docs.'
      }
    ],
    rationale: 'SNAPI data is actively ingested and displayed on multiple pages.',
    remediationAction: 'Keep SNAPI attribution on legal page and news surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'nws_weather',
    providerName: 'National Weather Service / NOAA',
    sourceLabel: 'NWS API (api.weather.gov)',
    mode: 'active',
    scope: 'core',
    endpointDomains: ['api.weather.gov', 'weather.gov'],
    dataClasses: ['forecast periods', 'weather icons', 'launch weather summaries'],
    ingestionPath: ['supabase/functions/nws-refresh/index.ts'],
    storageTables: ['public.nws_points', 'public.launch_weather'],
    userFacingSurfaces: ['app/launches/[id]/page.tsx', 'components/LaunchFeed.tsx', 'components/NwsForecastPanel.tsx'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'components/NwsForecastPanel.tsx', 'app/launches/[id]/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'NWS API documentation',
        url: 'https://www.weather.gov/documentation/services-web-api',
        note: 'Data is published as open U.S. Government data and requests should include a contactable User-Agent.'
      }
    ],
    rationale: 'NWS is a first-class weather source and already disclosed in legal and launch surfaces.',
    remediationAction: 'Keep NWS listed and retain no-endorsement language.',
    remediationPriority: 'none'
  },
  {
    key: 'ws45_forecast',
    providerName: '45th Weather Squadron / U.S. Space Force',
    sourceLabel: '45th Weather Squadron forecast PDFs',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['45thweathersquadron.nebula.spaceforce.mil'],
    dataClasses: ['launch weather constraints', 'probability of violation'],
    ingestionPath: ['supabase/functions/ws45-forecast-ingest/index.ts'],
    storageTables: ['public.ws45_launch_forecasts'],
    userFacingSurfaces: ['app/launches/[id]/page.tsx', 'components/Ws45ForecastPanel.tsx'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'components/Ws45ForecastPanel.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: '45 WS launch forecast support portal',
        url: 'https://45thweathersquadron.nebula.spaceforce.mil/pages/launchForecastSupport.html',
        note: 'Source portal is used for forecast document ingestion; explicit attribution clause not found in repo-reviewed material.'
      }
    ],
    rationale: 'WS45 source is disclosed on both launch weather surfaces and the legal data attribution page.',
    remediationAction: 'Keep WS45 attribution on legal data and forecast panels.',
    remediationPriority: 'none'
  },
  {
    key: 'open_meteo_weather',
    providerName: 'Open-Meteo',
    sourceLabel: 'Open-Meteo Forecast API',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['api.open-meteo.com', 'open-meteo.com'],
    dataClasses: ['cloud cover forecasts', 'launch visibility weather inputs'],
    ingestionPath: ['supabase/functions/jep-score-refresh/index.ts'],
    storageTables: ['public.launch_jep_scores'],
    userFacingSurfaces: ['app/launches/[id]/page.tsx', 'components/JepScorePanel.tsx', 'app/api/public/launches/[id]/jep/route.ts'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'components/JepScorePanel.tsx'],
    attributionRequirement: 'required',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'Open-Meteo terms',
        url: 'https://open-meteo.com/en/terms',
        note: 'Terms request source attribution for free usage; app surfaces now identify Open-Meteo in the visibility panel and legal source list.'
      }
    ],
    rationale: 'Open-Meteo is the primary weather input for JEP scoring and appears on launch detail surfaces.',
    remediationAction: 'Keep Open-Meteo listed in legal data attributions and on JEP user-facing surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'faa_tfr_notam',
    providerName: 'Federal Aviation Administration (FAA)',
    sourceLabel: 'FAA TFR/NOTAM feeds',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['tfr.faa.gov', 'faa.gov'],
    dataClasses: ['TFR records', 'NOTAM details', 'matched launch airspace advisories'],
    ingestionPath: [
      'supabase/functions/faa-tfr-ingest/index.ts',
      'supabase/functions/faa-notam-detail-ingest/index.ts',
      'supabase/functions/faa-launch-match/index.ts'
    ],
    storageTables: ['public.faa_tfr_records', 'public.faa_tfr_shapes', 'public.faa_notam_details', 'public.faa_launch_matches'],
    userFacingSurfaces: ['app/launches/[id]/page.tsx', 'app/api/public/launches/[id]/faa-airspace/route.ts'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'app/launches/[id]/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'FAA TFR API endpoint',
        url: 'https://tfr.faa.gov/tfrapi/getTfrList',
        note: 'Operational source endpoint used by ingest jobs.'
      },
      {
        label: 'USA.gov copyright policy overview',
        url: 'https://www.usa.gov/government-works',
        note: 'U.S. government works are generally public domain, with non-endorsement still required by policy.'
      }
    ],
    rationale: 'Feature surface already labels FAA source and links to original advisories.',
    remediationAction: 'Keep FAA labels in launch airspace panels.',
    remediationPriority: 'none'
  },
  {
    key: 'navcen_bnm',
    providerName: 'U.S. Coast Guard Navigation Center',
    sourceLabel: 'NAVCEN BNM hazard feed',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['public.govdelivery.com', 'navcen.uscg.gov'],
    dataClasses: ['hazard bulletin metadata', 'hazard area geometry'],
    ingestionPath: ['supabase/functions/navcen-bnm-ingest/index.ts'],
    storageTables: ['public.navcen_bnm_messages', 'public.navcen_bnm_hazard_areas', 'public.launch_trajectory_constraints'],
    userFacingSurfaces: ['app/api/admin/summary/route.ts', 'trajectory constraint products'],
    publicClaimSurfaces: ['app/legal/data/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'NAVCEN BNM source endpoint',
        url: 'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message',
        note: 'Source feed is ingested for hazard-area constraints used in trajectory products.'
      }
    ],
    rationale: 'Trajectory constraints sourced from NAVCEN BNM are disclosed on the legal data attribution page.',
    remediationAction: 'Keep NAVCEN BNM attribution on legal data surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'celestrak_orbit_satcat',
    providerName: 'CelesTrak',
    sourceLabel: 'CelesTrak GP/SATCAT datasets',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['celestrak.org'],
    dataClasses: ['orbital elements', 'satellite catalog metadata', 'group memberships'],
    ingestionPath: [
      'supabase/functions/celestrak-ingest/index.ts',
      'supabase/functions/celestrak-gp-ingest/index.ts',
      'supabase/functions/celestrak-satcat-ingest/index.ts'
    ],
    storageTables: ['public.orbit_elements', 'public.satellites', 'public.satellite_group_memberships'],
    userFacingSurfaces: ['app/satellites/[norad]/page.tsx', 'app/launches/[id]/page.tsx'],
    publicClaimSurfaces: ['app/legal/data/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'CelesTrak GP data documentation',
        url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
        note: 'Documentation emphasizes usage limits and responsible polling cadence.'
      }
    ],
    rationale: 'CelesTrak-powered satellite/orbit datasets are listed on the legal data attribution page.',
    remediationAction: 'Keep CelesTrak attribution current on legal data surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'artemis_nasa_public_data',
    providerName: 'NASA and U.S. public-sector data sources',
    sourceLabel: 'NASA Artemis feeds + oversight/procurement sources',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['nasa.gov', 'images-api.nasa.gov', 'oig.nasa.gov', 'gao.gov', 'api.usaspending.gov', 'api.sam.gov'],
    dataClasses: ['program timeline', 'media assets', 'budget/procurement evidence'],
    ingestionPath: [
      'supabase/functions/artemis-content-ingest/index.ts',
      'supabase/functions/artemis-nasa-ingest/index.ts',
      'supabase/functions/artemis-budget-ingest/index.ts',
      'supabase/functions/artemis-procurement-ingest/index.ts',
      'supabase/functions/artemis-contracts-ingest/index.ts'
    ],
    storageTables: [
      'public.artemis_content_items',
      'public.artemis_source_registry',
      'public.artemis_source_documents',
      'public.artemis_budget_lines',
      'public.artemis_procurement_awards',
      'public.artemis_contracts',
      'public.artemis_contract_actions',
      'public.artemis_opportunity_notices',
      'public.artemis_contract_budget_map',
      'public.artemis_spending_timeseries'
    ],
    userFacingSurfaces: ['app/artemis/page.tsx', 'app/artemis-ii/page.tsx'],
    publicClaimSurfaces: ['app/legal/data/page.tsx', 'app/artemis/page.tsx'],
    attributionRequirement: 'required',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'NASA images and media guidance',
        url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
        note: 'NASA guidance states NASA should be acknowledged as the source and use must avoid implied endorsement.'
      }
    ],
    rationale: 'Artemis program sources are disclosed on legal data surfaces with NASA source acknowledgment.',
    remediationAction: 'Keep NASA/public-sector Artemis attribution language current across legal and Artemis surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'blue_origin_official_channels',
    providerName: 'Blue Origin',
    sourceLabel: 'Blue Origin official mission/news/media channels',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['blueorigin.com', 'x.com', 'youtube.com'],
    dataClasses: ['mission status updates', 'program milestones', 'official media links', 'vehicle and engine reference data'],
    ingestionPath: [
      'supabase/functions/_shared/blueOriginSources.ts',
      'lib/server/blueOriginContent.ts',
      'lib/server/blueOriginProgramMedia.ts',
      'lib/server/blueOriginUi.ts'
    ],
    storageTables: ['public.blue_origin_*', 'public.launches_public_cache', 'public.blue_origin_source_documents'],
    userFacingSurfaces: [
      'app/blue-origin/page.tsx',
      'app/blue-origin/missions/[mission]/page.tsx',
      'app/blue-origin/flights/[slug]/page.tsx',
      'app/blue-origin/travelers/[slug]/page.tsx'
    ],
    publicClaimSurfaces: ['app/blue-origin/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'Blue Origin mission/news index',
        url: 'https://www.blueorigin.com/news',
        note: 'Primary official-source channel for Blue Origin mission updates and program statements.'
      },
      {
        label: 'Blue Origin New Shepard pause update',
        url: 'https://www.blueorigin.com/news/new-shepard-to-pause-flights',
        note: 'Official status reference used for New Shepard launch posture.'
      }
    ],
    rationale: 'Blue Origin pages and media channels are first-party inputs for mission status, timelines, and media archive evidence.',
    remediationAction: 'Keep Blue Origin official channel attribution visible on Blue Origin program hub surfaces.',
    remediationPriority: 'none'
  },
  {
    key: 'blue_origin_wayback_archive',
    providerName: 'Internet Archive',
    sourceLabel: 'Wayback Machine (Blue Origin mission-page captures)',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['web.archive.org'],
    dataClasses: ['historical mission roster captures', 'archived official-page evidence'],
    ingestionPath: ['lib/server/blueOriginTravelerIngest.ts'],
    storageTables: ['public.blue_origin_passengers', 'public.blue_origin_traveler_profiles', 'public.blue_origin_traveler_sources'],
    userFacingSurfaces: ['app/blue-origin/travelers/page.tsx', 'app/blue-origin/travelers/[slug]/page.tsx', 'app/blue-origin/page.tsx'],
    publicClaimSurfaces: [],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'Internet Archive Terms of Use',
        url: 'https://archive.org/about/terms.php',
        note: 'Wayback captures are used as historical references for mission roster reconciliation.'
      }
    ],
    rationale: 'Wayback snapshots fill coverage gaps where current official mission pages no longer expose legacy crew/passenger details.',
    remediationAction: 'Keep Wayback Machine sourcing documented in internal attribution inventory for Blue Origin traveler reconciliation.',
    remediationPriority: 'none'
  },
  {
    key: 'wikipedia_blue_origin_travelers',
    providerName: 'Wikimedia Foundation',
    sourceLabel: 'Wikipedia API (Blue Origin traveler enrichment)',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['en.wikipedia.org', 'wikipedia.org'],
    dataClasses: ['traveler profile metadata', 'biographical excerpts', 'reference links'],
    ingestionPath: ['lib/server/blueOriginTravelerIngest.ts'],
    storageTables: ['public.blue_origin_passengers', 'public.blue_origin_traveler_profiles', 'public.blue_origin_traveler_sources'],
    userFacingSurfaces: ['app/blue-origin/travelers/page.tsx', 'app/blue-origin/travelers/[slug]/page.tsx'],
    publicClaimSurfaces: [],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'Wikipedia API endpoint',
        url: 'https://en.wikipedia.org/w/api.php',
        note: 'Used for mission-category metadata and profile enrichment signals.'
      },
      {
        label: 'Wikimedia Foundation Terms of Use',
        url: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
        note: 'Reference policy baseline for attribution and re-use expectations.'
      }
    ],
    rationale: 'Wikipedia-derived profile enrichment improves passenger identity resolution and traveler context where first-party data is sparse.',
    remediationAction: 'Retain internal-source disclosure for Wikipedia-derived traveler enrichment.',
    remediationPriority: 'none'
  },
  {
    key: 'spacex_website_content',
    providerName: 'SpaceX',
    sourceLabel: 'SpaceX launch website content API',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['content.spacex.com', 'spacex.com'],
    dataClasses: ['mission bundle metadata', 'mission infographic URLs', 'launch-day media/resource metadata'],
    ingestionPath: ['supabase/functions/spacex-infographics-ingest/index.ts', 'lib/ingestion/spacexWebsite.ts'],
    storageTables: ['public.launch_external_resources', 'public.launch_trajectory_constraints'],
    userFacingSurfaces: ['app/launches/[id]/page.tsx'],
    publicClaimSurfaces: ['app/launches/[id]/page.tsx'],
    attributionRequirement: 'unknown',
    complianceStatus: 'unclear',
    policyReferences: [
      {
        label: 'SpaceX terms page',
        url: 'https://www.spacex.com/legal/terms/',
        note: 'Public terms identify SpaceX site content protections; attribution alone may not grant reuse rights.'
      }
    ],
    rationale: 'Launch-detail media bundles and outbound SpaceX resource links are surfaced from SpaceX-hosted URLs; rights requirements remain unclear and are tracked internally.',
    remediationAction: 'Keep linked source labeling on launch detail pages and track SpaceX rights clarification in the internal risk register (non-blocking).',
    remediationPriority: 'P1'
  },
  {
    key: 'wikimedia_wikidata_drone_ships',
    providerName: 'Wikimedia Foundation',
    sourceLabel: 'Wikidata + Wikimedia Commons',
    mode: 'active',
    scope: 'feature',
    endpointDomains: ['wikidata.org', 'commons.wikimedia.org', 'wikipedia.org'],
    dataClasses: ['ship profile facts', 'ship image URLs', 'image license and attribution metadata'],
    ingestionPath: [
      'supabase/functions/spacex-drone-ship-ingest/index.ts',
      'supabase/functions/spacex-drone-ship-wiki-sync/index.ts'
    ],
    storageTables: ['public.spacex_drone_ships'],
    userFacingSurfaces: ['app/spacex/drone-ships/page.tsx', 'app/spacex/drone-ships/[slug]/page.tsx'],
    publicClaimSurfaces: ['app/spacex/drone-ships/page.tsx', 'app/spacex/drone-ships/[slug]/page.tsx'],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'Wikidata API',
        url: 'https://www.wikidata.org/w/api.php',
        note: 'Used for structured drone-ship facts and entity references.'
      },
      {
        label: 'Wikimedia Commons API',
        url: 'https://commons.wikimedia.org/w/api.php',
        note: 'Used for ship photo URLs and license/credit metadata.'
      }
    ],
    rationale: 'Drone-ship profile pages enrich operational launch data with openly available ship facts and image metadata.',
    remediationAction: 'Retain visible image/license attribution on drone-ship pages.',
    remediationPriority: 'none'
  },
  {
    key: 'celestrak_supgp_optional',
    providerName: 'CelesTrak',
    sourceLabel: 'CelesTrak SupGP supplemental feed',
    mode: 'dormant',
    scope: 'feature',
    endpointDomains: ['celestrak.org'],
    dataClasses: ['supplemental orbital elements'],
    ingestionPath: ['supabase/functions/celestrak-supgp-ingest/index.ts'],
    storageTables: ['public.orbit_elements'],
    userFacingSurfaces: [],
    publicClaimSurfaces: [],
    attributionRequirement: 'recommended',
    complianceStatus: 'compliant',
    policyReferences: [
      {
        label: 'CelesTrak GP data documentation',
        url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
        note: 'Feed is currently optional and can be enabled via system_settings.'
      }
    ],
    rationale: 'Configured integration exists but is disabled by default in current migrations/settings.',
    remediationAction: 'No public attribution required while dormant; re-audit if enabled.',
    remediationPriority: 'none'
  }
];

export const DATA_ATTRIBUTION_CLAIMS: DataAttributionClaimRecord[] = [
  {
    key: 'legal_data_ll2',
    sourceKey: 'll2_launch_library',
    file: 'app/legal/data/page.tsx',
    claim: 'Launch data provided by The Space Devs (Launch Library 2).'
  },
  {
    key: 'legal_data_snapi',
    sourceKey: 'snapi_news',
    file: 'app/legal/data/page.tsx',
    claim: 'News metadata powered by Spaceflight News API (The Space Devs).'
  },
  {
    key: 'legal_data_nws',
    sourceKey: 'nws_weather',
    file: 'app/legal/data/page.tsx',
    claim: 'Weather forecasts (US-only): National Weather Service (NWS) API.'
  },
  {
    key: 'legal_data_ws45',
    sourceKey: 'ws45_forecast',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes 45th Weather Squadron forecast documents.'
  },
  {
    key: 'legal_data_open_meteo',
    sourceKey: 'open_meteo_weather',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes Open-Meteo forecast API for visibility scoring.'
  },
  {
    key: 'legal_data_faa',
    sourceKey: 'faa_tfr_notam',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes FAA TFR/NOTAM feeds.'
  },
  {
    key: 'legal_data_celestrak',
    sourceKey: 'celestrak_orbit_satcat',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes CelesTrak satellite/orbit datasets.'
  },
  {
    key: 'legal_data_navcen',
    sourceKey: 'navcen_bnm',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes U.S. Coast Guard NAVCEN BNM feed.'
  },
  {
    key: 'legal_data_artemis',
    sourceKey: 'artemis_nasa_public_data',
    file: 'app/legal/data/page.tsx',
    claim: 'Feature-specific sources list includes NASA Artemis + U.S. public-sector program data.'
  },
  {
    key: 'faq_source_ll2_snapi',
    sourceKey: 'll2_launch_library',
    file: 'app/docs/faq/page.tsx',
    claim: 'Launch schedule and metadata come from LL2; news from SNAPI.'
  },
  {
    key: 'news_page_snapi',
    sourceKey: 'snapi_news',
    file: 'app/news/page.tsx',
    claim: 'Incoming coverage packets pulled from Spaceflight News API.'
  },
  {
    key: 'provider_page_snapi',
    sourceKey: 'snapi_news',
    file: 'app/providers/[slug]/page.tsx',
    claim: 'Latest coverage tied to provider launches from Spaceflight News API.'
  },
  {
    key: 'launch_page_snapi',
    sourceKey: 'snapi_news',
    file: 'app/launches/[id]/page.tsx',
    claim: 'Related coverage linked via Spaceflight News API.'
  },
  {
    key: 'launch_page_nws',
    sourceKey: 'nws_weather',
    file: 'app/launches/[id]/page.tsx',
    claim: 'NWS forecast for the pad location at T-0 (api.weather.gov).'
  },
  {
    key: 'launch_page_faa',
    sourceKey: 'faa_tfr_notam',
    file: 'app/launches/[id]/page.tsx',
    claim: 'FAA airspace advisories section with source links.'
  },
  {
    key: 'launch_page_spacex',
    sourceKey: 'spacex_website_content',
    file: 'app/launches/[id]/page.tsx',
    claim: 'Mission resources section labels SpaceX-sourced media and links users to official launch and media pages.'
  },
  {
    key: 'ws45_panel_source',
    sourceKey: 'ws45_forecast',
    file: 'components/Ws45ForecastPanel.tsx',
    claim: 'Forecast panel labels source as 45th Weather Squadron PDFs.'
  },
  {
    key: 'jep_panel_open_meteo_source',
    sourceKey: 'open_meteo_weather',
    file: 'components/JepScorePanel.tsx',
    claim: 'JEP panel labels weather input as Open-Meteo with NWS fallback.'
  },
  {
    key: 'blue_origin_program_status_source',
    sourceKey: 'blue_origin_official_channels',
    file: 'app/blue-origin/page.tsx',
    claim: 'New Shepard snapshot status links to Blue Origin official pause-flights update.'
  },
  {
    key: 'footer_ll2',
    sourceKey: 'll2_launch_library',
    file: 'components/Footer.tsx',
    claim: 'Footer includes LL2 attribution line.'
  }
];

export const PUBLIC_DATA_ATTRIBUTIONS: PublicDataAttributionEntry[] = [
  {
    key: 'll2_launch_library',
    section: 'Core feed sources',
    sourceLabel: 'Launch Library 2 (The Space Devs)',
    usage: 'Primary launch schedule, mission, provider, and pad metadata.',
    sourceUrl: 'https://thespacedevs.com/llapi',
    attributionNote: 'Primary launch feed source.'
  },
  {
    key: 'snapi_news',
    section: 'Core feed sources',
    sourceLabel: 'Spaceflight News API (The Space Devs)',
    usage: 'News/article metadata linked to launches and providers.',
    sourceUrl: 'https://api.spaceflightnewsapi.net/v4/docs',
    attributionNote: 'Headlines and summaries link to original publishers.'
  },
  {
    key: 'nws_weather',
    section: 'Core feed sources',
    sourceLabel: 'National Weather Service (api.weather.gov)',
    usage: 'Pad-location weather forecasts and weather icons for launch timing.',
    sourceUrl: 'https://www.weather.gov/documentation/services-web-api',
    attributionNote: 'NOAA/NWS data is used as-is; no endorsement is implied.'
  },
  {
    key: 'ws45_forecast',
    section: 'Feature-specific sources',
    sourceLabel: '45th Weather Squadron forecast documents',
    usage: 'Launch weather risk signals on select launch detail views.',
    sourceUrl: 'https://45thweathersquadron.nebula.spaceforce.mil/pages/launchForecastSupport.html',
    attributionNote: 'Displayed on weather panels where available.'
  },
  {
    key: 'open_meteo_weather',
    section: 'Feature-specific sources',
    sourceLabel: 'Open-Meteo Forecast API',
    usage: 'Cloud-cover forecast inputs for Jellyfish Exposure Potential scoring.',
    sourceUrl: 'https://open-meteo.com/',
    attributionNote: 'Displayed on the launch visibility panel with NWS fallback context.'
  },
  {
    key: 'faa_tfr_notam',
    section: 'Feature-specific sources',
    sourceLabel: 'FAA TFR/NOTAM feeds',
    usage: 'Launch airspace advisories and temporary flight restriction overlays.',
    sourceUrl: 'https://tfr.faa.gov/tfrapi/getTfrList',
    attributionNote: 'Airspace views link back to FAA source pages where available.'
  },
  {
    key: 'celestrak_orbit_satcat',
    section: 'Feature-specific sources',
    sourceLabel: 'CelesTrak',
    usage: 'Satellite catalog and orbital element data for satellite and trajectory features.',
    sourceUrl: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
    attributionNote: 'Used on satellite and trajectory-related surfaces.'
  },
  {
    key: 'navcen_bnm',
    section: 'Feature-specific sources',
    sourceLabel: 'U.S. Coast Guard NAVCEN BNM feed',
    usage: 'Hazard-area intelligence used in trajectory constraint models.',
    sourceUrl: 'https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message',
    attributionNote: 'Used for trajectory products; source coverage depends on published notices.'
  },
  {
    key: 'artemis_nasa_public_data',
    section: 'Feature-specific sources',
    sourceLabel: 'NASA Artemis + U.S. public-sector program data',
    usage: 'Artemis timelines, program evidence, imagery, and oversight/procurement context.',
    sourceUrl: 'https://www.nasa.gov/humans-in-space/artemis/',
    attributionNote: 'NASA content is used with source acknowledgment and no implied endorsement.'
  }
];
