import type { FaqCanonicalEntry, FaqSurfaceId, FaqTopic, FaqVerificationSource } from '@/lib/content/faq/types';

export const FAQ_AUDIT_DATE = '2026-02-16';
const FAQ_OWNER = 'content-platform';

function internal(ref: string, note?: string): FaqVerificationSource {
  return { kind: 'internal', ref, note };
}

function external(ref: string, note?: string): FaqVerificationSource {
  return { kind: 'external', ref, note };
}

function faqEntry(entry: Omit<FaqCanonicalEntry, 'lastVerifiedAt' | 'owner'>): FaqCanonicalEntry {
  return {
    ...entry,
    lastVerifiedAt: FAQ_AUDIT_DATE,
    owner: FAQ_OWNER
  };
}

export const FAQ_SURFACES: readonly FaqSurfaceId[] = [
  'docs-faq',
  'home',
  'artemis-program',
  'artemis-mission',
  'artemis-workbench-artemis-i',
  'artemis-workbench-artemis-iii',
  'artemis-i-page',
  'artemis-iii-page',
  'starship-program',
  'starship-flight',
  'contracts-canonical-index',
  'contracts-canonical-detail'
] as const;

export const FAQ_REGISTRY: readonly FaqCanonicalEntry[] = [
  faqEntry({
    id: 'docs-refresh-cadence',
    order: 100,
    topic: 'refresh-cadence',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['docs-faq'],
    question: 'How often is the data refreshed?',
    answer:
      'Public visitors refresh every 2 hours (aligned to local clock boundaries such as 12:00am, 2:00am, and 4:00am). Signed-in free accounts refresh every 15 minutes (:00, :15, :30, :45). Premium checks for updates every 15 seconds and refreshes when source data changes.',
    verificationSources: [
      internal('lib/tiers.ts', 'Defines tier refresh intervals and alignment math.'),
      internal('components/LaunchDetailAutoRefresh.tsx', 'Implements polling behavior per tier.'),
      internal('components/SocialReferrerDisclaimer.tsx', 'Public copy mirrors 2h/15m/15s cadence.')
    ]
  }),
  faqEntry({
    id: 'docs-data-sources',
    order: 110,
    topic: 'data-sources',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['docs-faq'],
    question: 'Where does the data come from?',
    answer:
      'Primary launch schedule and metadata come from Launch Library 2 (The Space Devs). News metadata comes from Spaceflight News API. Weather uses NWS (api.weather.gov) and, when available, 45th Weather Squadron forecasts. Feature-specific views may also use FAA, CelesTrak, NASA, NAVCEN, and SpaceX sources. See /legal/data for the full inventory.',
    verificationSources: [
      internal('app/legal/data/page.tsx'),
      internal('lib/constants/dataAttribution.ts'),
      external('https://thespacedevs.com/llapi'),
      external('https://api.spaceflightnewsapi.net/v4/docs')
    ]
  }),
  faqEntry({
    id: 'docs-location-coverage',
    order: 120,
    topic: 'location-coverage',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['docs-faq'],
    question: 'Which locations are covered?',
    answer:
      'The default feed focuses on US pads. Signed-in users can switch region filters to include all locations when available. The homepage feed itself remains US-scoped by default.',
    verificationSources: [
      internal('lib/server/homeLaunchFeed.ts', 'Homepage feed uses FEED_REGION=us.'),
      internal('components/LaunchFeed.tsx', 'Region filter UI defaults to us with all/non-us options.'),
      internal('app/api/filters/route.ts', 'Supports us, non-us, and all region modes.')
    ]
  }),
  faqEntry({
    id: 'docs-net-time-tbd',
    order: 130,
    topic: 'net-time-precision',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['docs-faq'],
    question: 'What does NET mean and why is the time sometimes TBD?',
    answer:
      'NET means "No Earlier Than" and marks the earliest possible liftoff. If a provider publishes date-only or low-precision timing, the UI shows Time TBD and countdowns stay hidden until hour/minute precision is available.',
    verificationSources: [internal('lib/time.ts'), internal('components/TimeDisplay.tsx')]
  }),
  faqEntry({
    id: 'docs-timezone',
    order: 140,
    topic: 'timezone-display',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['docs-faq'],
    question: 'What timezone are launch times shown in?',
    answer:
      'Launch times in the web UI render in your local timezone. SMS templates use UTC formatting when SMS is enabled.',
    verificationSources: [
      internal('components/TimeDisplay.tsx'),
      internal('lib/notifications/smsProgram.ts'),
      internal('app/docs/sms-opt-in/page.tsx')
    ]
  }),
  faqEntry({
    id: 'docs-status-changes',
    order: 150,
    topic: 'launch-state-changes',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['docs-faq'],
    question: 'What happens when a launch slips, holds, or scrubs?',
    answer:
      'Timing and status changes appear after the next ingest/refresh cycle. Cards reflect HOLD and SCRUB states, and change events are tracked for alert workflows.',
    verificationSources: [
      internal('components/LaunchCard.tsx'),
      internal('app/api/live/launches/changed/route.ts'),
      internal('supabase/functions/notifications-dispatch/index.ts')
    ]
  }),
  faqEntry({
    id: 'docs-notifications',
    order: 160,
    topic: 'notification-availability',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['docs-faq'],
    question: 'How do notifications work right now?',
    answer:
      'Premium members can enable browser notifications and launch-day email alerts today. SMS alert flows are implemented but currently marked coming soon while US A2P 10DLC registration is completed.',
    verificationSources: [
      internal('app/me/preferences/page.tsx'),
      internal('app/api/me/notifications/preferences/route.ts'),
      internal('lib/notifications/smsAvailability.ts'),
      internal('docs/frontpage-premium-ux-checklist.md')
    ]
  }),
  faqEntry({
    id: 'docs-quiet-hours',
    order: 170,
    topic: 'notification-quiet-hours',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['docs-faq'],
    question: 'Can I mute alerts during quiet hours?',
    answer:
      'Yes. Notification preferences support quiet hours with local start/end times. Dispatch pipelines honor those settings when scheduling sends.',
    verificationSources: [internal('app/me/preferences/page.tsx'), internal('supabase/functions/notifications-dispatch/index.ts')]
  }),
  faqEntry({
    id: 'docs-sms-terms',
    order: 180,
    topic: 'sms-terms',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['docs-faq'],
    question: 'Where can I read the SMS program terms?',
    answer: 'See /legal/terms#sms-alerts and /docs/sms-opt-in.',
    verificationSources: [internal('app/legal/terms/page.tsx'), internal('app/docs/sms-opt-in/page.tsx')]
  }),
  faqEntry({
    id: 'docs-sms-guardrails',
    order: 190,
    topic: 'sms-guardrails',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['docs-faq'],
    question: 'How are SMS costs controlled?',
    answer:
      'Server-side guardrails include daily and monthly caps per user, per-launch caps, minimum gaps between messages, batching windows, and maximum message length controls.',
    verificationSources: [
      internal('supabase/functions/notifications-dispatch/index.ts'),
      internal('docs/twilio-a2p-10dlc-verification-playbook.md'),
      external('https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart')
    ]
  }),
  faqEntry({
    id: 'home-net-definition',
    order: 300,
    topic: 'net-definition',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['home'],
    question: 'What does NET mean for a rocket launch?',
    answer:
      'NET means "No Earlier Than," the earliest time a launch may occur. It can shift due to weather, range availability, or vehicle readiness.',
    verificationSources: [internal('app/page.tsx')]
  }),
  faqEntry({
    id: 'home-launch-time-variability',
    order: 310,
    topic: 'launch-time-variability',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['home'],
    question: 'Why do launch times change?',
    answer:
      'Launch times move for weather, technical, mission, and range-operations reasons. Holds and scrubs are normal in launch operations.',
    verificationSources: [internal('app/page.tsx')]
  }),
  faqEntry({
    id: 'home-refresh-summary',
    order: 320,
    topic: 'refresh-cadence',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['home'],
    question: 'How often is this US launch schedule updated?',
    answer:
      'The schedule is refreshed from Launch Library 2 and related sources. Exact freshness varies by mission data availability, account tier, and whether upstream data changed.',
    verificationSources: [internal('lib/server/homeLaunchFeed.ts'), internal('components/LaunchFeed.tsx'), internal('lib/tiers.ts')]
  }),
  faqEntry({
    id: 'home-watch-links',
    order: 330,
    topic: 'watch-links',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['home'],
    question: 'Where can I watch rocket launches?',
    answer:
      'Open a launch detail page for watch links when published. Many launches also stream on official provider channels and partner outlets.',
    verificationSources: [internal('app/page.tsx'), internal('app/launches/[id]/page.tsx')]
  }),
  faqEntry({
    id: 'home-launch-window',
    order: 340,
    topic: 'launch-window-definition',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['home'],
    question: 'What is a launch window?',
    answer:
      'A launch window is the period when liftoff can occur while still meeting mission constraints. Some missions have very short windows.',
    verificationSources: [internal('app/page.tsx')]
  }),
  faqEntry({
    id: 'home-alerts-access',
    order: 350,
    topic: 'alerts-access',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['home'],
    question: 'How do I get launch alerts?',
    answer:
      'Create an account for filters and launch tracking. Premium adds faster live checks plus browser-notification and launch-day email alert controls. SMS remains marked coming soon.',
    verificationSources: [internal('components/LaunchFeed.tsx'), internal('app/me/preferences/page.tsx'), internal('lib/notifications/smsAvailability.ts')]
  }),
  faqEntry({
    id: 'artemis-program-overview',
    order: 500,
    topic: 'artemis-overview',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-program'],
    question: 'What is Artemis?',
    answer:
      "Artemis is NASA's lunar exploration program. It is a sequence of missions aimed at returning humans to the Moon and building sustained deep-space capability.",
    verificationSources: [internal('lib/server/artemis.ts'), external('https://www.nasa.gov/artemis/')]
  }),
  faqEntry({
    id: 'artemis-program-vs-apollo',
    order: 510,
    topic: 'artemis-vs-apollo',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-program'],
    question: 'How is Artemis different from Apollo?',
    answer:
      'Artemis uses modern systems, broader international participation, and a longer-duration lunar architecture aimed at sustained operations.',
    verificationSources: [internal('lib/server/artemis.ts'), external('https://www.nasa.gov/artemis/')]
  }),
  faqEntry({
    id: 'artemis-program-schedule',
    order: 520,
    topic: 'artemis-schedule-tracking',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-program'],
    question: 'Where can I track the latest Artemis launch schedule?',
    answer:
      'Use the Artemis workbench for program context and the Artemis II mission page for near-term countdown, timing, and status updates.',
    verificationSources: [internal('lib/server/artemis.ts'), internal('app/artemis/page.tsx'), internal('app/artemis-ii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-mission-name-variant',
    order: 600,
    topic: 'artemis-name-variant',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-mission'],
    question: 'Is Artemis II the same as Artemis 2?',
    answer: 'Yes. Artemis II and Artemis 2 refer to the same crewed mission.',
    verificationSources: [internal('lib/server/artemis.ts')]
  }),
  faqEntry({
    id: 'artemis-mission-date',
    order: 610,
    topic: 'artemis-ii-date',
    claimClass: 'time_sensitive',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['artemis-mission'],
    question: 'When is the Artemis II launch date?',
    answer:
      'Artemis II timing can shift with readiness, range, and weather constraints. This page tracks launch date and countdown changes as source data updates.',
    verificationSources: [internal('lib/server/artemis.ts'), internal('app/artemis-ii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-mission-watch',
    order: 620,
    topic: 'artemis-ii-watch',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-mission'],
    question: 'Where can I watch Artemis II live?',
    answer:
      'When official streams are published, this page lists watch links with mission details, status, and launch-window context.',
    verificationSources: [internal('lib/server/artemis.ts'), internal('app/artemis-ii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-mission-crew',
    order: 630,
    topic: 'artemis-ii-crew',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-mission'],
    question: 'Who is on the Artemis II crew?',
    answer: 'Crew highlights appear here when crew data is present in the mission feed payload.',
    verificationSources: [internal('lib/server/artemis.ts'), internal('app/artemis-ii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-i-page-crewed',
    order: 700,
    topic: 'artemis-i-crewed',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-i-page'],
    question: 'Was Artemis I crewed?',
    answer:
      'No. Artemis I was an uncrewed integrated test flight of Orion and SLS, used to validate mission systems before crewed Artemis missions.',
    verificationSources: [internal('app/artemis-i/page.tsx'), external('https://www.nasa.gov/artemis-i/')]
  }),
  faqEntry({
    id: 'artemis-i-page-purpose',
    order: 710,
    topic: 'artemis-i-page-purpose',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-i-page'],
    question: 'Why keep an Artemis I page if the mission is complete?',
    answer:
      'Artemis I remains a core milestone reference. The page provides historical context, tracked entries, and links to active Artemis mission coverage.',
    verificationSources: [internal('app/artemis-i/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-i-page-follow-up',
    order: 720,
    topic: 'artemis-follow-up',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-i-page'],
    question: 'Where should I track upcoming crewed Artemis launches?',
    answer:
      'Use the Artemis II page for current crewed timing and countdown details, and Artemis III coverage for forward planning updates.',
    verificationSources: [internal('app/artemis-i/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-iii-page-overview',
    order: 760,
    topic: 'artemis-iii-overview',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-iii-page'],
    question: 'What is Artemis III?',
    answer:
      "Artemis III is the planned lunar-landing mission in NASA's Artemis sequence, following Artemis I and the crewed Artemis II mission.",
    verificationSources: [internal('app/artemis-iii/page.tsx'), external('https://www.nasa.gov/artemis/')]
  }),
  faqEntry({
    id: 'artemis-iii-page-date',
    order: 770,
    topic: 'artemis-iii-date-certainty',
    claimClass: 'time_sensitive',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['artemis-iii-page'],
    question: 'Is there a confirmed Artemis III launch date?',
    answer:
      'Mission timing can shift as hardware readiness and mission planning evolve. This page tracks schedule signals from the launch feed.',
    verificationSources: [internal('app/artemis-iii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-iii-page-near-term',
    order: 780,
    topic: 'artemis-iii-near-term',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-iii-page'],
    question: 'Where can I track near-term Artemis launch timing?',
    answer:
      'For near-term crewed timing and countdown updates, use the Artemis II page. Artemis III coverage focuses on forward mission planning status.',
    verificationSources: [internal('app/artemis-iii/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-workbench-i-crewed',
    order: 820,
    topic: 'artemis-i-crewed',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-workbench-artemis-i'],
    question: 'Was Artemis I crewed?',
    answer: 'No. Artemis I was an uncrewed integrated mission test flight.',
    verificationSources: [internal('app/artemis/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-workbench-i-baseline',
    order: 830,
    topic: 'artemis-i-page-purpose',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-workbench-artemis-i'],
    question: 'Why track Artemis I in the workbench?',
    answer: 'Artemis I is a baseline milestone used to contextualize Artemis II and Artemis III schedule changes.',
    verificationSources: [internal('app/artemis/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-workbench-iii-role',
    order: 840,
    topic: 'artemis-iii-workbench-role',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['artemis-workbench-artemis-iii'],
    question: 'What does Artemis III represent in the timeline?',
    answer: 'Artemis III is the planned lunar-landing mission in the Artemis sequence.',
    verificationSources: [internal('app/artemis/page.tsx')]
  }),
  faqEntry({
    id: 'artemis-workbench-iii-timing',
    order: 850,
    topic: 'artemis-iii-date-certainty',
    claimClass: 'time_sensitive',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['artemis-workbench-artemis-iii'],
    question: 'Is Artemis III timing final?',
    answer: 'No. Mission windows can shift as readiness, integration, and program planning evolve.',
    verificationSources: [internal('app/artemis/page.tsx')]
  }),
  faqEntry({
    id: 'starship-program-overview',
    order: 900,
    topic: 'starship-program-overview',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['starship-program'],
    question: 'What is the Starship program hub?',
    answer:
      'This page tracks Starship and Super Heavy records from the feed and organizes them into program and per-flight views.',
    verificationSources: [internal('lib/server/starship.ts'), internal('app/starship/page.tsx')]
  }),
  faqEntry({
    id: 'starship-program-route-format',
    order: 910,
    topic: 'starship-route-canonical',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['starship-program'],
    question: 'What does flight-<number> mean?',
    answer: 'Canonical Starship flight routes use /starship/flight-<number>. Legacy aliases like IFT-<number> redirect to that route.',
    verificationSources: [internal('lib/server/starship.ts'), internal('app/starship/[slug]/page.tsx')]
  }),
  faqEntry({
    id: 'starship-program-cadence',
    order: 920,
    topic: 'starship-cadence',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['starship-program'],
    question: 'How often does the Starship workbench update?',
    answer: 'The page revalidates automatically and reflects feed updates as launch timing, status, and links change.',
    verificationSources: [internal('app/starship/page.tsx'), internal('lib/server/starship.ts')]
  }),
  faqEntry({
    id: 'starship-flight-alias',
    order: 950,
    topic: 'starship-flight-alias',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['starship-flight'],
    question: 'Is Starship Flight {{flightNumber}} the same as IFT-{{flightNumber}}?',
    answer: 'Yes. This route treats Starship Flight numbering and IFT naming as equivalent and keeps flight-<number> as canonical.',
    verificationSources: [internal('lib/server/starship.ts'), internal('app/starship/[slug]/page.tsx')]
  }),
  faqEntry({
    id: 'starship-flight-schedule',
    order: 960,
    topic: 'starship-flight-schedule',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['starship-flight'],
    question: 'Where can I find the latest schedule updates for Flight {{flightNumber}}?',
    answer:
      'This page tracks upcoming and recent records for the selected flight number, with links to full launch-detail entries.',
    verificationSources: [internal('lib/server/starship.ts'), internal('app/starship/[slug]/page.tsx')]
  }),
  faqEntry({
    id: 'starship-flight-empty',
    order: 970,
    topic: 'starship-flight-empty-state',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['starship-flight'],
    question: 'Why can a flight page be empty?',
    answer:
      'If the feed has no launch entries tagged with that flight number yet, the page remains live and fills in automatically as data arrives.',
    verificationSources: [internal('lib/server/starship.ts'), internal('app/starship/[slug]/page.tsx')]
  }),
  faqEntry({
    id: 'contracts-index-sources',
    order: 1100,
    topic: 'contracts-data-sources',
    claimClass: 'policy',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'What sources feed the contract data on this site?',
    answer:
      'Contract entities combine USAspending award references with SAM.gov-normalized procurement records (including PIID-linked actions, notices, and spending rows when available).',
    verificationSources: [
      internal('lib/server/contracts.ts'),
      internal('lib/server/usaspendingProgramAwards.ts'),
      internal('lib/server/artemisContracts.ts'),
      external('https://www.usaspending.gov/'),
      external('https://sam.gov/')
    ]
  }),
  faqEntry({
    id: 'contracts-index-canonical-route',
    order: 1110,
    topic: 'contracts-canonical-routing',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'Why is there a canonical /contracts URL when program pages already exist?',
    answer:
      'Program pages keep mission context, while /contracts URLs consolidate duplicate contract entities into one indexable canonical URL so search engines attribute ranking signals to a single record.',
    verificationSources: [
      internal('app/contracts/page.tsx'),
      internal('app/contracts/[contractUid]/page.tsx'),
      internal('app/spacex/contracts/[contractKey]/page.tsx'),
      internal('app/blue-origin/contracts/[contractKey]/page.tsx'),
      internal('app/artemis/contracts/[piid]/page.tsx')
    ]
  }),
  faqEntry({
    id: 'contracts-index-identifier-search',
    order: 1120,
    topic: 'contracts-identifier-search',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'Which identifiers should I search to find a specific government contract?',
    answer:
      'Use any of these identifiers: USAspending Award ID, PIID, contract key, solicitation ID, notice ID, recipient/awardee name, or agency/customer name.',
    verificationSources: [internal('lib/server/contracts.ts'), internal('lib/server/programContractStories.ts'), internal('app/contracts/page.tsx')]
  }),
  faqEntry({
    id: 'contracts-index-cadence',
    order: 1130,
    topic: 'contracts-update-cadence',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'high',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'How often do contract pages update?',
    answer:
      'Contract pages revalidate on a 10-minute cadence, while upstream source data refresh timing depends on ingest jobs and source-side publication timing.',
    verificationSources: [
      internal('app/contracts/page.tsx'),
      internal('app/contracts/[contractUid]/page.tsx'),
      internal('lib/server/contracts.ts')
    ]
  }),
  faqEntry({
    id: 'contracts-index-sam-vs-usaspending',
    order: 1140,
    topic: 'contracts-sam-vs-usaspending',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'What is the difference between SAM.gov and USAspending in these records?',
    answer:
      'USAspending primarily provides award and obligation visibility, while SAM.gov captures procurement lifecycle context such as solicitation notices and related action thread signals.',
    verificationSources: [internal('lib/server/contracts.ts'), external('https://www.usaspending.gov/'), external('https://sam.gov/')]
  }),
  faqEntry({
    id: 'contracts-index-amount-variance',
    order: 1150,
    topic: 'contracts-award-amount-variance',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'Why can the contract amount differ from another source?',
    answer:
      'Amounts can differ across snapshots because some sources report base award value while others include modification deltas, cumulative obligations, or later adjustments.',
    verificationSources: [internal('lib/server/contracts.ts'), internal('lib/server/artemisContracts.ts'), internal('lib/server/usaspendingProgramAwards.ts')]
  }),
  faqEntry({
    id: 'contracts-index-program-overlap',
    order: 1160,
    topic: 'contracts-program-overlap',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-index', 'contracts-canonical-detail'],
    question: 'Can one contract appear in more than one program section?',
    answer:
      'Yes. A contract may appear in multiple program contexts; canonical entities are designed to consolidate those overlaps into a single URL for indexing and discovery.',
    verificationSources: [internal('lib/server/contracts.ts'), internal('lib/server/programContractStories.ts')]
  }),
  faqEntry({
    id: 'contracts-detail-piid',
    order: 1170,
    topic: 'contracts-piid-definition',
    claimClass: 'static_fact',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['contracts-canonical-detail'],
    question: 'What is a PIID on a contract detail page?',
    answer:
      'PIID stands for Procurement Instrument Identifier. It is the contracting identifier used to track related awards, actions, and notices across a procurement thread.',
    verificationSources: [internal('app/contracts/[contractUid]/page.tsx'), internal('lib/server/artemisContracts.ts')]
  }),
  faqEntry({
    id: 'contracts-detail-evidence-links',
    order: 1180,
    topic: 'contracts-evidence-links',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'medium',
    surfaces: ['contracts-canonical-detail'],
    question: 'Where should I verify the official source record for this contract?',
    answer:
      'Use the Source record link on the contract detail page. The page also links back to the program-native detail page and, when available, the Artemis story page for thread context.',
    verificationSources: [internal('app/contracts/[contractUid]/page.tsx'), internal('lib/server/contracts.ts')]
  }),
  faqEntry({
    id: 'contracts-detail-empty-signals',
    order: 1190,
    topic: 'contracts-empty-signals',
    claimClass: 'code_behavior',
    verificationStatus: 'verified',
    risk: 'low',
    surfaces: ['contracts-canonical-detail'],
    question: 'Why are actions, notices, or spending rows sometimes missing?',
    answer:
      'Missing rows usually mean no matched records were returned yet for that identifier set in the current source snapshot, not that the contract entity itself is invalid.',
    verificationSources: [internal('app/contracts/[contractUid]/page.tsx'), internal('lib/server/contracts.ts')]
  })
] as const;

export const FAQ_SURFACE_REQUIREMENTS: Readonly<Record<FaqSurfaceId, readonly FaqTopic[]>> = {
  'docs-faq': [
    'refresh-cadence',
    'data-sources',
    'location-coverage',
    'net-time-precision',
    'notification-availability',
    'sms-terms',
    'sms-guardrails'
  ],
  home: ['net-definition', 'launch-time-variability', 'launch-window-definition', 'alerts-access'],
  'artemis-program': ['artemis-overview', 'artemis-vs-apollo', 'artemis-schedule-tracking'],
  'artemis-mission': ['artemis-name-variant', 'artemis-ii-date', 'artemis-ii-watch', 'artemis-ii-crew'],
  'artemis-workbench-artemis-i': ['artemis-i-crewed', 'artemis-i-page-purpose'],
  'artemis-workbench-artemis-iii': ['artemis-iii-workbench-role', 'artemis-iii-date-certainty'],
  'artemis-i-page': ['artemis-i-crewed', 'artemis-i-page-purpose', 'artemis-follow-up'],
  'artemis-iii-page': ['artemis-iii-overview', 'artemis-iii-date-certainty', 'artemis-iii-near-term'],
  'starship-program': ['starship-program-overview', 'starship-route-canonical', 'starship-cadence'],
  'starship-flight': ['starship-flight-alias', 'starship-flight-schedule', 'starship-flight-empty-state'],
  'contracts-canonical-index': [
    'contracts-data-sources',
    'contracts-canonical-routing',
    'contracts-identifier-search',
    'contracts-update-cadence',
    'contracts-sam-vs-usaspending',
    'contracts-award-amount-variance',
    'contracts-program-overlap'
  ],
  'contracts-canonical-detail': [
    'contracts-data-sources',
    'contracts-canonical-routing',
    'contracts-identifier-search',
    'contracts-piid-definition',
    'contracts-evidence-links',
    'contracts-empty-signals'
  ]
} as const;
