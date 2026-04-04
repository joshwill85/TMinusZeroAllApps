import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellBadge, CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';
import { RouteListRow } from './shared';
import {
  ContentPageRouteScreen,
  JELLYFISH_FALLBACK_PAGE,
  buildGenericDocsFallback,
  type CustomerRouteStaticPage
} from './content';

const DOC_LINKS = [
  { title: 'Support', href: '/support', subtitle: 'Customer help, billing guidance, and privacy requests.', badge: 'help' },
  { title: 'Roadmap', href: '/docs/roadmap', subtitle: 'Implementation phases and future work.', badge: 'docs' },
  { title: 'Notifications', href: '/preferences', subtitle: 'Native push setup and alert controls.', badge: 'docs' },
  { title: 'Privacy Notice', href: '/legal/privacy', subtitle: 'Collection, use, and disclosure overview.', badge: 'legal' },
  { title: 'Privacy Choices', href: '/legal/privacy-choices', subtitle: 'Export, privacy, and delete-account controls.', badge: 'legal' },
  { title: 'Data & Attribution', href: '/legal/data', subtitle: 'Source inventory and attribution notes.', badge: 'legal' },
  { title: 'Terms of Service', href: '/legal/terms', subtitle: 'Platform terms and service rules.', badge: 'legal' },
  { title: 'Jellyfish Effect', href: '/jellyfish-effect', subtitle: 'Viewing guide and twilight plume planning.', badge: 'guide' }
] as const;

export function DocsHubScreen() {
  const router = useRouter();

  return (
    <AppScreen testID="docs-screen">
      <CustomerShellHero eyebrow="Docs" title="Documentation & Legal" description="Native support, guides, and policy pages for the mobile app.">
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
  if (normalized === 'about' || normalized === 'faq') {
    return <DocsHubScreen />;
  }
  const fallbackPage = resolveDocsFallbackPage(normalized);

  return <ContentPageRouteScreen testID={`docs-${normalized}-screen`} slug={normalized} fallbackPage={fallbackPage} />;
}

function resolveDocsFallbackPage(slug: string): CustomerRouteStaticPage {
  if (slug === 'roadmap') return ROADMAP_FALLBACK_PAGE;
  if (slug === 'jellyfish-effect') return JELLYFISH_FALLBACK_PAGE;
  return buildGenericDocsFallback(slug);
}

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
        'Docs, support, legal, and guide pages.',
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

function normalizeDocsSlug(value: string) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase() || 'docs';
}
