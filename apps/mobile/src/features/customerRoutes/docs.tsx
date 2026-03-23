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
  { title: 'SMS Opt-In', href: '/docs/sms-opt-in', subtitle: 'Required disclosures and consent flow.', badge: 'docs' },
  { title: 'Privacy Notice', href: '/legal/privacy', subtitle: 'Collection, use, and disclosure overview.', badge: 'legal' },
  { title: 'Privacy Choices', href: '/legal/privacy-choices', subtitle: 'Export, privacy, and delete-account controls.', badge: 'legal' },
  { title: 'Data & Attribution', href: '/legal/data', subtitle: 'Source inventory and attribution notes.', badge: 'legal' },
  { title: 'SMS Terms', href: '/legal/sms', subtitle: 'SMS disclosures and alert policy.', badge: 'legal' },
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
  if (slug === 'sms-opt-in') return SMS_OPT_IN_FALLBACK_PAGE;
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

const SMS_OPT_IN_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'Docs',
  title: 'SMS Opt-In',
  description: 'How to opt in to SMS launch alerts and what disclosures need to appear at consent time.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'Consent flow',
      body: 'Users sign in, review the disclosure, verify a US phone number, and then enable SMS alerts from the notifications screen.',
      bullets: [
        'Consent must be explicit and unchecked by default.',
        'SMS is optional and not tied to purchase.',
        'Verification should happen before the account is marked opted in.'
      ]
    },
    {
      title: 'Opt out',
      body: 'A user must be able to stop alerts at any time with a clear opt-out path.',
      bullets: [
        'Reply STOP to cancel.',
        'Reply START to re-subscribe.',
        'Reply HELP or contact support for assistance.'
      ]
    }
  ],
  actions: [
    { label: 'Terms', href: '/legal/terms' },
    { label: 'Privacy notice', href: '/legal/privacy', variant: 'secondary' }
  ]
};

function normalizeDocsSlug(value: string) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase() || 'docs';
}
