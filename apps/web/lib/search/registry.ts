import type { SearchResultType } from '@tminuszero/domain';

export type StaticSearchDocument = {
  docId: string;
  type: Extract<SearchResultType, 'hub' | 'guide' | 'page'>;
  title: string;
  subtitle: string | null;
  summary: string;
  url: string;
  aliases: string[];
  keywords: string[];
  badge: string;
  boost: number;
};

export const STATIC_SEARCH_DOCS: readonly StaticSearchDocument[] = [
  {
    docId: 'page:home',
    type: 'page',
    title: 'US Rocket Launch Schedule',
    subtitle: 'Launch schedule',
    summary: 'Track upcoming US rocket launches with countdowns, launch windows, pad locations, and live coverage links.',
    url: '/',
    aliases: ['launch schedule', 'launch calendar', 'upcoming launches', 'countdown'],
    keywords: ['launches', 'schedule', 'countdown', 'rocket launches'],
    badge: 'Page',
    boost: 90
  },
  {
    docId: 'page:news',
    type: 'page',
    title: 'Space News',
    subtitle: 'News stream',
    summary: 'Browse the live space news stream with launch reporting, provider updates, and mission coverage.',
    url: '/news',
    aliases: ['space news', 'articles', 'reports'],
    keywords: ['news', 'launch news', 'spaceflight news'],
    badge: 'Page',
    boost: 70
  },
  {
    docId: 'page:info',
    type: 'page',
    title: 'Info Deck',
    subtitle: 'Site info',
    summary: 'Explore platform guides, command deck shortcuts, and public data navigation help.',
    url: '/info',
    aliases: ['information', 'help', 'command deck'],
    keywords: ['info', 'help', 'guide'],
    badge: 'Page',
    boost: 66
  },
  {
    docId: 'page:about',
    type: 'page',
    title: 'About T-Minus Zero',
    subtitle: 'About',
    summary: 'Learn about the site, mission, and editorial approach behind the launch and program coverage.',
    url: '/about',
    aliases: ['about', 'site mission'],
    keywords: ['about', 'site'],
    badge: 'Page',
    boost: 45
  },
  {
    docId: 'page:providers',
    type: 'page',
    title: 'Launch Providers',
    subtitle: 'Provider index',
    summary: 'Browse launch providers, agencies, and related provider pages.',
    url: '/launch-providers',
    aliases: ['providers', 'agencies', 'companies'],
    keywords: ['launch providers', 'agencies'],
    badge: 'Page',
    boost: 58
  },
  {
    docId: 'page:catalog',
    type: 'page',
    title: 'Launch Library Catalog',
    subtitle: 'Catalog',
    summary: 'Browse searchable catalog entities including agencies, astronauts, pads, locations, and launch vehicles.',
    url: '/catalog',
    aliases: ['ll2 catalog', 'catalog'],
    keywords: ['catalog', 'agencies', 'astronauts', 'pads'],
    badge: 'Page',
    boost: 62
  },
  {
    docId: 'page:satellites',
    type: 'page',
    title: 'Satellite Directory',
    subtitle: 'Satellites',
    summary: 'Search NORAD satellite records, owner profiles, and launch associations.',
    url: '/satellites',
    aliases: ['satellite owners', 'norad'],
    keywords: ['satellites', 'norad', 'owners'],
    badge: 'Page',
    boost: 58
  },
  {
    docId: 'page:docs-faq',
    type: 'page',
    title: 'FAQ',
    subtitle: 'Docs',
    summary: 'Read frequently asked questions about the site, launch tracking, alerts, and public data.',
    url: '/docs/faq',
    aliases: ['faq', 'questions', 'help'],
    keywords: ['faq', 'questions'],
    badge: 'Page',
    boost: 50
  },
  {
    docId: 'page:docs-roadmap',
    type: 'page',
    title: 'Roadmap',
    subtitle: 'Docs',
    summary: 'Review the published roadmap and planned product improvements.',
    url: '/docs/roadmap',
    aliases: ['roadmap', 'planned features'],
    keywords: ['roadmap', 'features'],
    badge: 'Page',
    boost: 36
  },
  {
    docId: 'page:support',
    type: 'page',
    title: 'Support',
    subtitle: 'Help',
    summary: 'Customer support, billing help, privacy requests, and contact information.',
    url: '/support',
    aliases: ['support', 'help', 'contact support'],
    keywords: ['support', 'help', 'contact', 'billing', 'privacy'],
    badge: 'Page',
    boost: 28
  },
  {
    docId: 'page:privacy',
    type: 'page',
    title: 'Privacy Policy',
    subtitle: 'Legal',
    summary: 'Read the privacy policy and privacy choices documentation.',
    url: '/legal/privacy',
    aliases: ['privacy', 'data policy'],
    keywords: ['privacy', 'legal'],
    badge: 'Page',
    boost: 24
  },
  {
    docId: 'page:terms',
    type: 'page',
    title: 'Terms of Service',
    subtitle: 'Legal',
    summary: 'Read the terms governing site access and paid features.',
    url: '/legal/terms',
    aliases: ['terms', 'legal terms'],
    keywords: ['terms', 'legal'],
    badge: 'Page',
    boost: 24
  },
  {
    docId: 'hub:spacex',
    type: 'hub',
    title: 'SpaceX Program Hub',
    subtitle: 'Program hub',
    summary: 'SpaceX program hub with mission families, flights, crew, payload, contracts, and recovery tracking.',
    url: '/spacex',
    aliases: ['spacex', 'space x', 'program hub'],
    keywords: ['falcon', 'dragon', 'starship', 'spacex'],
    badge: 'Hub',
    boost: 88
  },
  {
    docId: 'hub:starship',
    type: 'hub',
    title: 'Starship Program Workbench',
    subtitle: 'Program hub',
    summary: 'Track Starship flights, launch systems, timeline, and evidence from the dedicated Starship workbench.',
    url: '/starship',
    aliases: ['starship', 'super heavy'],
    keywords: ['starship', 'super heavy'],
    badge: 'Hub',
    boost: 86
  },
  {
    docId: 'hub:falcon9',
    type: 'hub',
    title: 'Falcon 9 Mission Hub',
    subtitle: 'Mission hub',
    summary: 'Falcon 9 mission hub covering schedule, flights, payloads, crew, and cadence tracking.',
    url: '/spacex/missions/falcon-9',
    aliases: ['falcon 9', 'f9'],
    keywords: ['falcon 9', 'f9'],
    badge: 'Hub',
    boost: 80
  },
  {
    docId: 'hub:falcon-heavy',
    type: 'hub',
    title: 'Falcon Heavy Mission Hub',
    subtitle: 'Mission hub',
    summary: 'Falcon Heavy mission hub with payload history and mission coverage.',
    url: '/spacex/missions/falcon-heavy',
    aliases: ['falcon heavy', 'fh'],
    keywords: ['falcon heavy'],
    badge: 'Hub',
    boost: 74
  },
  {
    docId: 'hub:dragon',
    type: 'hub',
    title: 'Dragon Mission Hub',
    subtitle: 'Mission hub',
    summary: 'Dragon mission hub for crew and cargo operations.',
    url: '/spacex/missions/dragon',
    aliases: ['dragon', 'crew dragon', 'cargo dragon'],
    keywords: ['dragon', 'crew dragon'],
    badge: 'Hub',
    boost: 72
  },
  {
    docId: 'hub:drone-ships',
    type: 'hub',
    title: 'SpaceX Drone Ships Hub',
    subtitle: 'Recovery hub',
    summary: 'Browse drone ships, recovery assignments, and landing platform history.',
    url: '/spacex/drone-ships',
    aliases: ['drone ship', 'remote landing pad', 'landing barge'],
    keywords: ['recovery', 'ocisly', 'asog', 'jrti'],
    badge: 'Hub',
    boost: 68
  },
  {
    docId: 'hub:blue-origin',
    type: 'hub',
    title: 'Blue Origin Program Hub',
    subtitle: 'Program hub',
    summary: 'Blue Origin program hub with missions, crew, payloads, contracts, and program coverage.',
    url: '/blue-origin',
    aliases: ['blue origin', 'program hub'],
    keywords: ['new shepard', 'new glenn', 'blue moon', 'blue ring'],
    badge: 'Hub',
    boost: 84
  },
  {
    docId: 'hub:blue-origin-missions',
    type: 'hub',
    title: 'Blue Origin Mission Hubs',
    subtitle: 'Mission hub',
    summary: 'Browse mission hubs for New Shepard, New Glenn, Blue Moon, Blue Ring, and BE-4.',
    url: '/blue-origin/missions',
    aliases: ['new shepard', 'new glenn', 'blue moon', 'blue ring', 'be-4'],
    keywords: ['missions', 'blue origin'],
    badge: 'Hub',
    boost: 76
  },
  {
    docId: 'hub:blue-origin-travelers',
    type: 'hub',
    title: 'Blue Origin Crew',
    subtitle: 'Directory',
    summary: 'Browse Blue Origin crew profiles and flight history.',
    url: '/blue-origin/travelers',
    aliases: ['travelers', 'passengers', 'crew'],
    keywords: ['crew', 'travelers', 'passengers', 'blue origin'],
    badge: 'Hub',
    boost: 68
  },
  {
    docId: 'hub:blue-origin-contracts',
    type: 'hub',
    title: 'Blue Origin Contracts',
    subtitle: 'Contracts hub',
    summary: 'Browse Blue Origin contracts and linked public records.',
    url: '/blue-origin/contracts',
    aliases: ['blue origin contracts'],
    keywords: ['contracts', 'procurement'],
    badge: 'Hub',
    boost: 60
  },
  {
    docId: 'hub:artemis',
    type: 'hub',
    title: 'Artemis Program Hub',
    subtitle: 'Program hub',
    summary: 'Artemis program hub with missions, evidence, program intel, and contract coverage.',
    url: '/artemis',
    aliases: ['artemis', 'nasa artemis', 'moon to mars'],
    keywords: ['artemis', 'moon to mars'],
    badge: 'Hub',
    boost: 86
  },
  {
    docId: 'hub:artemis-contracts',
    type: 'hub',
    title: 'Artemis Contracts Hub',
    subtitle: 'Contracts hub',
    summary: 'Track Artemis contracts, PIIDs, notices, and spending history.',
    url: '/artemis/contracts',
    aliases: ['artemis contracts', 'piid', 'sam.gov', 'usaspending'],
    keywords: ['contracts', 'piid', 'award id'],
    badge: 'Hub',
    boost: 72
  },
  {
    docId: 'hub:contracts',
    type: 'hub',
    title: 'Cross-Program Contracts Hub',
    subtitle: 'Contracts hub',
    summary: 'Browse canonical contracts across SpaceX, Blue Origin, and Artemis.',
    url: '/contracts',
    aliases: ['contracts', 'procurement', 'award id', 'sam.gov', 'usaspending'],
    keywords: ['contracts', 'procurement'],
    badge: 'Hub',
    boost: 72
  },
  {
    docId: 'guide:jellyfish',
    type: 'guide',
    title: 'Jellyfish Effect Guide',
    subtitle: 'Guide',
    summary: 'Learn what causes the rocket jellyfish effect, where to see it, and how T-Minus Zero tracks JEP conditions.',
    url: '/jellyfish-effect',
    aliases: ['jellyfish', 'jelly fish', 'rocket jellyfish', 'jellyfish effect', 'jep'],
    keywords: ['twilight plume', 'rocket plume', 'jep'],
    badge: 'Guide',
    boost: 92
  },
  {
    docId: 'page:starship',
    type: 'page',
    title: 'Starship Overview',
    subtitle: 'Program page',
    summary: 'Review Starship timeline and evidence coverage outside the mission hub.',
    url: '/starship',
    aliases: ['starship overview'],
    keywords: ['starship'],
    badge: 'Page',
    boost: 54
  },
  {
    docId: 'page:artemis-ii',
    type: 'page',
    title: 'Artemis II',
    subtitle: 'Mission page',
    summary: 'Editorial mission page for Artemis II, the first planned crewed Artemis flight.',
    url: '/artemis-ii',
    aliases: ['artemis 2', 'artemis ii'],
    keywords: ['artemis ii', 'artemis 2'],
    badge: 'Page',
    boost: 64
  },
  {
    docId: 'page:artemis-iii',
    type: 'page',
    title: 'Artemis III',
    subtitle: 'Mission page',
    summary: 'Editorial mission page for Artemis III and lunar return planning.',
    url: '/artemis-iii',
    aliases: ['artemis 3', 'artemis iii'],
    keywords: ['artemis iii', 'artemis 3'],
    badge: 'Page',
    boost: 62
  }
] as const;
