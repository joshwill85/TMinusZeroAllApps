import type { SpaceXMissionKey } from '@/lib/types/spacexProgram';

type SitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

type LandingBreadcrumb = {
  label: string;
  href?: string;
};

type LandingRelatedLink = {
  href: string;
  label: string;
  detail: string;
};

type LandingSource =
  | {
      kind: 'provider';
      providerSlug: string;
      providerNameFallback: string;
      entityName: string;
    }
  | {
      kind: 'mission';
      missionKey: SpaceXMissionKey;
      entityName: string;
      entityDescription: string;
      officialHref: string;
    }
  | {
      kind: 'location';
      entityName: string;
      locationPatterns: string[];
    }
  | {
      kind: 'state';
      entityName: string;
      stateCode: string;
    }
  | {
      kind: 'today';
    }
  | {
      kind: 'next-provider-launch';
      providerSlug: string;
      providerNameFallback: string;
      entityName: string;
    };

export type LaunchIntentLandingKey =
  | 'spacex-launch-schedule'
  | 'falcon-9-launch-schedule'
  | 'starship-launch-schedule'
  | 'blue-origin-launch-schedule'
  | 'ula-launch-schedule'
  | 'nasa-launch-schedule'
  | 'florida-rocket-launch-schedule'
  | 'cape-canaveral-launch-schedule'
  | 'vandenberg-launch-schedule'
  | 'starbase-launch-schedule'
  | 'rocket-launches-today'
  | 'next-spacex-launch';

export type LaunchIntentLandingConfig = {
  key: LaunchIntentLandingKey;
  path: `/${LaunchIntentLandingKey}`;
  title: string;
  description: string;
  intro: string;
  eyebrow: string;
  featureTitle: string;
  featureEmptyLabel: string;
  upcomingTitle: string;
  recentTitle: string;
  breadcrumbs: LandingBreadcrumb[];
  relatedLinks: LandingRelatedLink[];
  source: LandingSource;
  sitemap: {
    changeFrequency: SitemapChangeFrequency;
    priority: number;
  };
  indexing: {
    index: true;
    follow: true;
    includeInSitemap: true;
  };
};

const INDEXABLE = {
  index: true,
  follow: true,
  includeInSitemap: true
} as const;

export const LAUNCH_INTENT_LANDING_CONFIG: Record<
  LaunchIntentLandingKey,
  LaunchIntentLandingConfig
> = {
  'spacex-launch-schedule': {
    key: 'spacex-launch-schedule',
    path: '/spacex-launch-schedule',
    title: 'SpaceX Launch Schedule',
    description:
      'Upcoming SpaceX launches, next NET windows, and recent mission history from US launch sites.',
    intro:
      'Track the next SpaceX launch window across Florida, California, and Starbase, then jump straight into mission pages, launch details, and related vehicle schedules without leaving the live feed.',
    eyebrow: 'Provider landing',
    featureTitle: 'Next SpaceX launch',
    featureEmptyLabel: 'No SpaceX launch window is published right now.',
    upcomingTitle: 'Upcoming SpaceX launches',
    recentTitle: 'Recent SpaceX launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Providers', href: '/launch-providers' },
      { label: 'SpaceX Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/next-spacex-launch',
        label: 'Next SpaceX Launch',
        detail: 'Jump to the current SpaceX mission window.'
      },
      {
        href: '/falcon-9-launch-schedule',
        label: 'Falcon 9 Launch Schedule',
        detail: 'Filter the SpaceX manifest to Falcon 9 missions.'
      },
      {
        href: '/starship-launch-schedule',
        label: 'Starship Launch Schedule',
        detail: 'Follow upcoming Starship flight-test windows.'
      },
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Track SpaceX and partner missions from Florida.'
      }
    ],
    source: {
      kind: 'provider',
      providerSlug: 'spacex',
      providerNameFallback: 'SpaceX',
      entityName: 'SpaceX'
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.86 },
    indexing: INDEXABLE
  },
  'falcon-9-launch-schedule': {
    key: 'falcon-9-launch-schedule',
    path: '/falcon-9-launch-schedule',
    title: 'Falcon 9 Launch Schedule',
    description:
      'Upcoming Falcon 9 launches, current NET windows, and recent mission history on the reusable SpaceX workhorse.',
    intro:
      'Use this Falcon 9 schedule page to stay on top of Starlink batches, NASA missions, commercial rideshares, and other flights that continue to set the cadence for the US orbital manifest.',
    eyebrow: 'Rocket landing',
    featureTitle: 'Next Falcon 9 mission',
    featureEmptyLabel: 'No Falcon 9 launch window is published right now.',
    upcomingTitle: 'Upcoming Falcon 9 launches',
    recentTitle: 'Recent Falcon 9 launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      {
        label: 'Launch Vehicles',
        href: '/catalog/launcher_configurations'
      },
      { label: 'Falcon 9 Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Zoom back out to the full SpaceX manifest.'
      },
      {
        href: '/next-spacex-launch',
        label: 'Next SpaceX Launch',
        detail: 'Open the current SpaceX mission window.'
      },
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Watch Florida missions commonly flown by Falcon 9.'
      },
      {
        href: '/vandenberg-launch-schedule',
        label: 'Vandenberg Launch Schedule',
        detail: 'Track west-coast Falcon 9 launch activity.'
      }
    ],
    source: {
      kind: 'mission',
      missionKey: 'falcon-9',
      entityName: 'Falcon 9',
      entityDescription:
        'Reusable medium-lift launch vehicle flown by SpaceX across commercial, NASA, and national security missions.',
      officialHref: 'https://www.spacex.com/vehicles/falcon-9/'
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.83 },
    indexing: INDEXABLE
  },
  'starship-launch-schedule': {
    key: 'starship-launch-schedule',
    path: '/starship-launch-schedule',
    title: 'Starship Launch Schedule',
    description:
      'Upcoming Starship launch windows, the current flight test target, and recent mission history from Starbase.',
    intro:
      'Follow the latest Starship flight-test target, recent integrated flight history, and the related Starbase schedule context in one focused landing page built for high-intent launch searches.',
    eyebrow: 'Rocket landing',
    featureTitle: 'Next Starship flight',
    featureEmptyLabel: 'No Starship launch window is published right now.',
    upcomingTitle: 'Upcoming Starship launches',
    recentTitle: 'Recent Starship launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      {
        label: 'Launch Vehicles',
        href: '/catalog/launcher_configurations'
      },
      { label: 'Starship Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/starbase-launch-schedule',
        label: 'Starbase Launch Schedule',
        detail: 'Track the launch site most closely tied to Starship.'
      },
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'See Starship inside the broader SpaceX manifest.'
      },
      {
        href: '/next-spacex-launch',
        label: 'Next SpaceX Launch',
        detail: 'Check whether the next SpaceX mission is a Starship flight.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: "Compare Starship timing with the rest of today's schedule."
      }
    ],
    source: {
      kind: 'mission',
      missionKey: 'starship',
      entityName: 'Starship',
      entityDescription:
        'Fully reusable heavy-lift launch system under active flight-test development by SpaceX.',
      officialHref: 'https://www.spacex.com/vehicles/starship/'
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.84 },
    indexing: INDEXABLE
  },
  'blue-origin-launch-schedule': {
    key: 'blue-origin-launch-schedule',
    path: '/blue-origin-launch-schedule',
    title: 'Blue Origin Launch Schedule',
    description:
      'Upcoming Blue Origin launches, next NET windows, and recent mission history across New Shepard and New Glenn.',
    intro:
      'Check the current Blue Origin launch schedule for New Shepard and New Glenn activity, then branch into the latest mission pages, Florida launch coverage, and same-day schedule updates.',
    eyebrow: 'Provider landing',
    featureTitle: 'Next Blue Origin launch',
    featureEmptyLabel: 'No Blue Origin launch window is published right now.',
    upcomingTitle: 'Upcoming Blue Origin launches',
    recentTitle: 'Recent Blue Origin launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Providers', href: '/launch-providers' },
      { label: 'Blue Origin Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/blue-origin',
        label: 'Blue Origin Program Hub',
        detail: 'Open the deeper program and flight coverage hub.'
      },
      {
        href: '/florida-rocket-launch-schedule',
        label: 'Florida Rocket Launch Schedule',
        detail: 'See Blue Origin alongside Florida launch activity.'
      },
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Track nearby Florida launch windows.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: "Compare Blue Origin timing with today's schedule."
      }
    ],
    source: {
      kind: 'provider',
      providerSlug: 'blue-origin',
      providerNameFallback: 'Blue Origin',
      entityName: 'Blue Origin'
    },
    sitemap: { changeFrequency: 'daily', priority: 0.8 },
    indexing: INDEXABLE
  },
  'ula-launch-schedule': {
    key: 'ula-launch-schedule',
    path: '/ula-launch-schedule',
    title: 'ULA Launch Schedule',
    description:
      'Upcoming ULA launches, current NET windows, and recent Atlas V and Vulcan mission history from US pads.',
    intro:
      'Use this ULA schedule page to follow Atlas V closeouts, Vulcan flights, and the launch-site context that matters most when United Launch Alliance windows move in Florida or California.',
    eyebrow: 'Provider landing',
    featureTitle: 'Next ULA launch',
    featureEmptyLabel: 'No ULA launch window is published right now.',
    upcomingTitle: 'Upcoming ULA launches',
    recentTitle: 'Recent ULA launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Providers', href: '/launch-providers' },
      { label: 'ULA Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/vandenberg-launch-schedule',
        label: 'Vandenberg Launch Schedule',
        detail: 'Track west-coast ULA launch activity.'
      },
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Watch Florida missions flown by ULA.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: "Compare ULA timing with the rest of today's feed."
      },
      {
        href: '/nasa-launch-schedule',
        label: 'NASA Launch Schedule',
        detail: 'See civil-space missions that can ride on ULA vehicles.'
      }
    ],
    source: {
      kind: 'provider',
      providerSlug: 'united-launch-alliance-ula',
      providerNameFallback: 'United Launch Alliance (ULA)',
      entityName: 'United Launch Alliance (ULA)'
    },
    sitemap: { changeFrequency: 'daily', priority: 0.79 },
    indexing: INDEXABLE
  },
  'nasa-launch-schedule': {
    key: 'nasa-launch-schedule',
    path: '/nasa-launch-schedule',
    title: 'NASA Launch Schedule',
    description:
      'Upcoming NASA launches, next NET windows, and recent mission history across crew, science, and exploration campaigns.',
    intro:
      'Keep NASA missions in one place, from crew rotations and planetary science launches to Artemis-related schedule movement that often spans multiple US providers and launch sites.',
    eyebrow: 'Provider landing',
    featureTitle: 'Next NASA launch',
    featureEmptyLabel: 'No NASA launch window is published right now.',
    upcomingTitle: 'Upcoming NASA launches',
    recentTitle: 'Recent NASA launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Providers', href: '/launch-providers' },
      { label: 'NASA Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/artemis',
        label: 'Artemis Program Hub',
        detail: "Open NASA's long-range lunar program coverage."
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: "See whether a NASA mission is on today's schedule."
      },
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Track NASA-heavy launch activity from Florida.'
      },
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Watch NASA missions flown on SpaceX vehicles.'
      }
    ],
    source: {
      kind: 'provider',
      providerSlug: 'nasa',
      providerNameFallback: 'NASA',
      entityName: 'NASA'
    },
    sitemap: { changeFrequency: 'daily', priority: 0.78 },
    indexing: INDEXABLE
  },
  'florida-rocket-launch-schedule': {
    key: 'florida-rocket-launch-schedule',
    path: '/florida-rocket-launch-schedule',
    title: 'Florida Rocket Launch Schedule',
    description:
      'Upcoming Florida rocket launches, next NET windows, and recent mission history from Cape Canaveral and nearby pads.',
    intro:
      'Follow Florida rocket launches from Cape Canaveral and the broader Space Coast, with quick access to provider pages, related launch sites, and the missions that dominate the eastern range.',
    eyebrow: 'Location landing',
    featureTitle: 'Next Florida launch',
    featureEmptyLabel: 'No Florida launch window is published right now.',
    upcomingTitle: 'Upcoming Florida launches',
    recentTitle: 'Recent Florida launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Locations', href: '/catalog/locations' },
      { label: 'Florida Rocket Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/cape-canaveral-launch-schedule',
        label: 'Cape Canaveral Launch Schedule',
        detail: 'Open the highest-intent Florida launch-site page.'
      },
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Track the provider most active on the Space Coast.'
      },
      {
        href: '/blue-origin-launch-schedule',
        label: 'Blue Origin Launch Schedule',
        detail: 'Watch Florida launch activity tied to Blue Origin.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: 'Compare Florida activity with the live daily feed.'
      }
    ],
    source: {
      kind: 'state',
      entityName: 'Florida',
      stateCode: 'FL'
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.82 },
    indexing: INDEXABLE
  },
  'cape-canaveral-launch-schedule': {
    key: 'cape-canaveral-launch-schedule',
    path: '/cape-canaveral-launch-schedule',
    title: 'Cape Canaveral Launch Schedule',
    description:
      'Upcoming Cape Canaveral launches, next NET windows, and recent mission history from one of the busiest US ranges.',
    intro:
      'Use the Cape Canaveral schedule page to monitor eastern-range launch windows, recent missions, and the provider pages most often tied to Florida orbital activity.',
    eyebrow: 'Location landing',
    featureTitle: 'Next Cape Canaveral launch',
    featureEmptyLabel: 'No Cape Canaveral launch window is published right now.',
    upcomingTitle: 'Upcoming Cape Canaveral launches',
    recentTitle: 'Recent Cape Canaveral launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Locations', href: '/catalog/locations' },
      { label: 'Cape Canaveral Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/florida-rocket-launch-schedule',
        label: 'Florida Rocket Launch Schedule',
        detail: 'Step back to the broader Space Coast manifest.'
      },
      {
        href: '/next-spacex-launch',
        label: 'Next SpaceX Launch',
        detail: 'Check the next SpaceX mission commonly staged nearby.'
      },
      {
        href: '/ula-launch-schedule',
        label: 'ULA Launch Schedule',
        detail: 'Track Atlas V and Vulcan flights tied to the Cape.'
      },
      {
        href: '/nasa-launch-schedule',
        label: 'NASA Launch Schedule',
        detail: 'Follow civil-space missions frequently launched from Florida.'
      }
    ],
    source: {
      kind: 'location',
      entityName: 'Cape Canaveral',
      locationPatterns: ['Cape Canaveral']
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.81 },
    indexing: INDEXABLE
  },
  'vandenberg-launch-schedule': {
    key: 'vandenberg-launch-schedule',
    path: '/vandenberg-launch-schedule',
    title: 'Vandenberg Launch Schedule',
    description:
      'Upcoming Vandenberg launches, current NET windows, and recent mission history from the west-coast range.',
    intro:
      'Track west-coast launch timing from Vandenberg, where polar and sun-synchronous missions often shift independently from the Florida manifest and deserve their own landing page.',
    eyebrow: 'Location landing',
    featureTitle: 'Next Vandenberg launch',
    featureEmptyLabel: 'No Vandenberg launch window is published right now.',
    upcomingTitle: 'Upcoming Vandenberg launches',
    recentTitle: 'Recent Vandenberg launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Locations', href: '/catalog/locations' },
      { label: 'Vandenberg Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: 'Compare Vandenberg timing with the live daily feed.'
      },
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Follow the provider most active at Vandenberg.'
      },
      {
        href: '/ula-launch-schedule',
        label: 'ULA Launch Schedule',
        detail: 'Track west-coast missions tied to ULA.'
      },
      {
        href: '/falcon-9-launch-schedule',
        label: 'Falcon 9 Launch Schedule',
        detail: 'Focus on the vehicle often flown from Vandenberg.'
      }
    ],
    source: {
      kind: 'location',
      entityName: 'Vandenberg',
      locationPatterns: ['Vandenberg']
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.79 },
    indexing: INDEXABLE
  },
  'starbase-launch-schedule': {
    key: 'starbase-launch-schedule',
    path: '/starbase-launch-schedule',
    title: 'Starbase Launch Schedule',
    description:
      'Upcoming Starbase launches, current NET windows, and recent mission history from the SpaceX Gulf Coast site.',
    intro:
      'Use this Starbase schedule page to follow launch windows from the Texas site most closely associated with Starship testing, plus the related SpaceX and same-day launch routes worth checking next.',
    eyebrow: 'Location landing',
    featureTitle: 'Next Starbase launch',
    featureEmptyLabel: 'No Starbase launch window is published right now.',
    upcomingTitle: 'Upcoming Starbase launches',
    recentTitle: 'Recent Starbase launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Locations', href: '/catalog/locations' },
      { label: 'Starbase Launch Schedule' }
    ],
    relatedLinks: [
      {
        href: '/starship-launch-schedule',
        label: 'Starship Launch Schedule',
        detail: 'Open the vehicle-specific landing page tied to Starbase.'
      },
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'See Starbase inside the full SpaceX manifest.'
      },
      {
        href: '/next-spacex-launch',
        label: 'Next SpaceX Launch',
        detail: 'Check whether the next SpaceX mission lifts off from Starbase.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: 'Compare Starbase timing with the live daily feed.'
      }
    ],
    source: {
      kind: 'location',
      entityName: 'Starbase',
      locationPatterns: ['Starbase', 'Boca Chica']
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.8 },
    indexing: INDEXABLE
  },
  'rocket-launches-today': {
    key: 'rocket-launches-today',
    path: '/rocket-launches-today',
    title: 'Rocket Launches Today',
    description:
      "Today's US rocket launches with current launch windows, near-term countdown context, and direct mission links.",
    intro:
      'This page is built for day-of search intent: open it when you want the current live window, the launches still ahead on the schedule, and the fastest path into detailed mission pages.',
    eyebrow: 'Daily landing',
    featureTitle: 'Next launch in the feed',
    featureEmptyLabel: "No launches are listed in today's live feed window.",
    upcomingTitle: "Launches in today's window",
    recentTitle: 'Recently updated launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Schedule', href: '/' },
      { label: 'Rocket Launches Today' }
    ],
    relatedLinks: [
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Check the busiest current provider schedule.'
      },
      {
        href: '/blue-origin-launch-schedule',
        label: 'Blue Origin Launch Schedule',
        detail: "Compare provider-specific activity against today's feed."
      },
      {
        href: '/nasa-launch-schedule',
        label: 'NASA Launch Schedule',
        detail: 'Follow civil-space missions on the current schedule.'
      },
      {
        href: '/florida-rocket-launch-schedule',
        label: 'Florida Rocket Launch Schedule',
        detail: 'View the busiest US launch state in a dedicated landing page.'
      }
    ],
    source: { kind: 'today' },
    sitemap: { changeFrequency: 'hourly', priority: 0.88 },
    indexing: INDEXABLE
  },
  'next-spacex-launch': {
    key: 'next-spacex-launch',
    path: '/next-spacex-launch',
    title: 'Next SpaceX Launch',
    description:
      'The next scheduled SpaceX launch, its current NET window, launch site, and links to related mission pages.',
    intro:
      'Open this route when you only care about the next SpaceX mission: it keeps the current launch window at the top while still linking back to the broader provider, vehicle, and site schedules.',
    eyebrow: 'Query landing',
    featureTitle: 'Current SpaceX mission window',
    featureEmptyLabel: 'No upcoming SpaceX launch is published right now.',
    upcomingTitle: 'More upcoming SpaceX launches',
    recentTitle: 'Recent SpaceX launches',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Launch Providers', href: '/launch-providers' },
      { label: 'Next SpaceX Launch' }
    ],
    relatedLinks: [
      {
        href: '/spacex-launch-schedule',
        label: 'SpaceX Launch Schedule',
        detail: 'Return to the full provider landing page.'
      },
      {
        href: '/starship-launch-schedule',
        label: 'Starship Launch Schedule',
        detail: 'Check whether the next SpaceX mission is a Starship flight.'
      },
      {
        href: '/falcon-9-launch-schedule',
        label: 'Falcon 9 Launch Schedule',
        detail: 'Focus on the vehicle most often tied to the next launch.'
      },
      {
        href: '/rocket-launches-today',
        label: 'Rocket Launches Today',
        detail: "Compare the next SpaceX mission with the rest of today's feed."
      }
    ],
    source: {
      kind: 'next-provider-launch',
      providerSlug: 'spacex',
      providerNameFallback: 'SpaceX',
      entityName: 'SpaceX'
    },
    sitemap: { changeFrequency: 'hourly', priority: 0.89 },
    indexing: INDEXABLE
  }
};

export const LAUNCH_INTENT_LANDING_KEYS = Object.keys(
  LAUNCH_INTENT_LANDING_CONFIG
) as LaunchIntentLandingKey[];

export const LAUNCH_INTENT_SITEMAP_ENTRIES = LAUNCH_INTENT_LANDING_KEYS.map(
  (key) => {
    const config = LAUNCH_INTENT_LANDING_CONFIG[key];
    return {
      path: config.path,
      changeFrequency: config.sitemap.changeFrequency,
      priority: config.sitemap.priority
    };
  }
);

export function getLaunchIntentLandingConfig(key: LaunchIntentLandingKey) {
  return LAUNCH_INTENT_LANDING_CONFIG[key];
}
