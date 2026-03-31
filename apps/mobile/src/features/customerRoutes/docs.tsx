import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellBadge, CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';
import { RouteListRow } from './shared';
import {
  ABOUT_FALLBACK_PAGE,
  ContentPageRouteScreen,
  JELLYFISH_FALLBACK_PAGE,
  buildGenericDocsFallback,
  type CustomerRouteStaticPage
} from './content';

const DOC_LINKS = [
  { title: 'About', href: '/about', subtitle: 'Origin story and product mission.', badge: 'docs' },
  { title: 'FAQ', href: '/docs/faq', subtitle: 'Common questions about the native app.', badge: 'docs' },
  { title: 'Roadmap', href: '/docs/roadmap', subtitle: 'Implementation phases and future work.', badge: 'docs' },
  { title: 'Notifications', href: '/preferences', subtitle: 'Native push setup and alert controls.', badge: 'docs' },
  { title: 'Privacy Notice', href: '/legal/privacy', subtitle: 'Collection, use, and disclosure overview.', badge: 'legal' },
  { title: 'Privacy Choices', href: '/legal/privacy-choices', subtitle: 'Export, privacy, and delete-account controls.', badge: 'legal' },
  { title: 'Data & Attribution', href: '/legal/data', subtitle: 'Source inventory and attribution notes.', badge: 'legal' },
  { title: 'Notification Policy', href: '/legal/sms', subtitle: 'Native push disclosure and device guidance.', badge: 'legal' },
  { title: 'Terms of Service', href: '/legal/terms', subtitle: 'Platform terms and service rules.', badge: 'legal' },
  { title: 'Jellyfish Effect', href: '/jellyfish-effect', subtitle: 'Viewing guide and twilight plume planning.', badge: 'guide' }
] as const;

export function DocsHubScreen() {
  const router = useRouter();

  return (
    <AppScreen testID="docs-screen">
      <CustomerShellHero eyebrow="Docs" title="Documentation & Legal" description="Native docs, guides, and policy pages for the mobile app.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native docs" tone="accent" />
          <CustomerShellBadge label={`${DOC_LINKS.length} entries`} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Browse" description="Open a customer-facing docs or legal page without leaving the app.">
        <View style={{ gap: 10 }}>
          {DOC_LINKS.map((item) => (
            <RouteListRow
              key={item.href}
              title={item.title}
              subtitle={item.subtitle}
              badge={item.badge}
              onPress={() => {
                router.push(item.href as Href);
              }}
            />
          ))}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function DocsPageRouteScreen({ slug }: { slug: string }) {
  const normalized = normalizeDocsSlug(slug);
  const fallbackPage = resolveDocsFallbackPage(normalized);

  return <ContentPageRouteScreen testID={`docs-${normalized}-screen`} slug={normalized} fallbackPage={fallbackPage} />;
}

function resolveDocsFallbackPage(slug: string): CustomerRouteStaticPage {
  if (slug === 'about') return ABOUT_FALLBACK_PAGE;
  if (slug === 'faq') return FAQ_FALLBACK_PAGE;
  if (slug === 'roadmap') return ROADMAP_FALLBACK_PAGE;
  if (slug === 'sms-opt-in') return NOTIFICATION_SETTINGS_FALLBACK_PAGE;
  if (slug === 'jellyfish-effect') return JELLYFISH_FALLBACK_PAGE;
  return buildGenericDocsFallback(slug);
}

const FAQ_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'Docs',
  title: 'FAQ',
  description: 'Answers to common questions about the mobile app, refresh cadence, and alerts.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'How updates work',
      body: 'Mobile uses the shared API and refreshes the current view when you return to it or change the filter state.',
      bullets: [
        'Launch and detail screens stay native.',
        'Reference pages render from the mobile content hooks when available.',
        'Unsupported customer routes should stay hidden rather than opening a browser.'
      ]
    },
    {
      title: 'What stays native',
      body: 'Search, launch details, saved items, account settings, docs, and the supported reference surfaces are all designed to stay in app.',
      bullets: [
        'News, contracts, satellites, and catalog browsing are native.',
        'Account, privacy, and legal content are native.',
        'External source records still open outside the app.'
      ]
    }
  ],
  actions: [
    { label: 'Privacy choices', href: '/legal/privacy-choices' },
    { label: 'Roadmap', href: '/docs/roadmap', variant: 'secondary' }
  ]
};

const ROADMAP_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'Docs',
  title: 'Implementation Phases',
  description: 'Native mobile rollout phases for shared customer surfaces and supporting infrastructure.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'Phase 1 - Surface parity',
      body: 'Finish the customer-facing browse surfaces and internal linking across the remaining mobile gaps.',
      bullets: [
        'News, contracts, satellites, and catalog browsing.',
        'Docs, legal, about, and guide pages.',
        'Native resolution for first-party customer links.'
      ]
    },
    {
      title: 'Phase 2 - Operational completeness',
      body: 'Close the remaining account, privacy, and integration management flows.',
      bullets: [
        'Privacy choices and export flows.',
        'Recurring calendar/RSS/embed management.',
        'Account profile and notification preference parity.'
      ]
    }
  ]
};

const NOTIFICATION_SETTINGS_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'Docs',
  title: 'Notifications',
  description: 'How native push alerts work and where to manage them in the mobile app.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'Push setup',
      body: 'Users sign in, open notification settings, and register a device for push delivery.',
      bullets: [
        'Push is optional and managed in the app.',
        'Device registration happens in the mobile client.',
        'Alert scopes stay tied to the signed-in account.'
      ]
    },
    {
      title: 'Disable alerts',
      body: 'A user must be able to stop alerts at any time with a clear in-app control path.',
      bullets: [
        'Turn off push from notification settings.',
        'Disable the device registration if you no longer want alerts.',
        'Contact support if the app state does not match your device settings.'
      ]
    }
  ],
  actions: [
    { label: 'Notification policy', href: '/legal/sms' },
    { label: 'Privacy notice', href: '/legal/privacy', variant: 'secondary' }
  ]
};

function normalizeDocsSlug(value: string) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase() || 'docs';
}
