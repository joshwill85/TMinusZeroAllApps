import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { ContentPageV1, InfoHubV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { RouteListRow, formatRouteDateTime, openExternalCustomerUrl } from './shared';
import { useContentPageQuery, useInfoHubQuery } from './queries';

export type CustomerRouteContentSection = {
  title: string;
  body: string;
  bullets?: string[];
};

export type CustomerRouteContentAction = {
  label: string;
  href: string;
  external?: boolean;
  variant?: 'primary' | 'secondary';
};

export type CustomerRouteStaticPage = {
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: CustomerRouteContentSection[];
  actions?: CustomerRouteContentAction[];
};

type NormalizedContentAction = {
  label: string;
  href: string;
  external?: boolean;
  variant?: 'primary' | 'secondary';
};

export function ContentPageScreen({
  testID,
  page
}: {
  testID: string;
  page: CustomerRouteStaticPage | ContentPageV1;
}) {
  const router = useRouter();
  const isStaticPage = !('slug' in page);
  const sections = page.sections.map((section) => ({
    title: section.title,
    body: section.body,
    bullets: section.bullets ?? []
  }));
  const actions: NormalizedContentAction[] = ('actions' in page ? page.actions ?? [] : []).map((action) => ({
    label: action.label,
    href: action.href,
    external: 'external' in action ? Boolean(action.external) : false,
    variant: 'variant' in action ? action.variant : undefined
  }));

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero
        eyebrow={page.eyebrow}
        title={page.title}
        description={page.description}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={isStaticPage ? 'Native content' : 'API content'} tone="accent" />
          <CustomerShellBadge label={isStaticPage ? page.lastUpdated : formatRouteDateTime(page.lastUpdated)} />
        </View>
      </CustomerShellHero>

      {actions.length ? (
        <CustomerShellPanel title="Related actions" description="Open connected customer surfaces.">
          <View style={{ gap: 10 }}>
            {actions.map((action) => (
              <CustomerShellActionButton
                key={`${action.label}:${action.href}`}
                label={action.label}
                variant={'variant' in action ? action.variant ?? 'primary' : 'primary'}
                onPress={() => {
                  if (action.external) {
                    void openExternalCustomerUrl(action.href);
                    return;
                  }
                  router.push(action.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {sections.map((section) => (
        <CustomerShellPanel key={section.title} title={section.title} description={section.body}>
          {section.bullets?.length ? (
            <View style={{ gap: 8 }}>
              {section.bullets.map((bullet) => (
                <Text key={bullet} style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
                  • {bullet}
                </Text>
              ))}
            </View>
          ) : null}
        </CustomerShellPanel>
      ))}
    </AppScreen>
  );
}

export function ContentPageRouteScreen({
  testID,
  slug,
  fallbackPage
}: {
  testID: string;
  slug: string;
  fallbackPage: CustomerRouteStaticPage;
}) {
  const query = useContentPageQuery(slug);
  const page = query.data ?? fallbackPage;

  return <ContentPageScreen testID={testID} page={page} />;
}

export function InfoHubRouteScreen({ testID }: { testID: string }) {
  const query = useInfoHubQuery();
  const info = query.data ?? null;

  return info ? <InfoHubScreen testID={testID} info={info} /> : <InfoHubFallbackScreen testID={testID} />;
}

export function InfoHubScreen({
  testID,
  info
}: {
  testID: string;
  info: InfoHubV1;
}) {
  const router = useRouter();

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow="Info" title={info.title} description={info.description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native hub" tone="accent" />
          <CustomerShellBadge label={formatHubCount(info.cards.length)} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Browse" description="Native destinations for the current information hub.">
        <View style={{ gap: 10 }}>
          {info.cards.map((card) => (
            <RouteListRow
              key={`${card.title}:${card.href}`}
              title={card.title}
              subtitle={card.description}
              badge={card.badge}
              onPress={() => {
                if (/^https?:\/\//i.test(card.href)) {
                  void openExternalCustomerUrl(card.href);
                  return;
                }
                router.push(card.href as Href);
              }}
            />
          ))}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function InfoHubFallbackScreen({ testID }: { testID: string }) {
  const router = useRouter();

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow="Info" title="The Command Deck" description="Native information hub for browse-heavy launch reference content.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native hub" tone="accent" />
          <CustomerShellBadge label="Offline fallback" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Browse" description="Open the main reference surfaces available on mobile.">
        <View style={{ gap: 10 }}>
          <RouteListRow title="Catalog" subtitle="Launch Library 2 browse hub." onPress={() => router.push('/catalog' as Href)} />
          <RouteListRow title="News" subtitle="Mission coverage and launch-linked articles." onPress={() => router.push('/news' as Href)} />
          <RouteListRow title="Contracts" subtitle="Canonical government contract intelligence." onPress={() => router.push('/contracts' as Href)} />
          <RouteListRow title="Satellites" subtitle="NORAD catalog and owner hubs." onPress={() => router.push('/satellites' as Href)} />
          <RouteListRow title="Docs" subtitle="FAQ, roadmap, and notification guidance." onPress={() => router.push('/docs' as Href)} />
          <RouteListRow title="Legal" subtitle="Privacy, data, and notification policy." onPress={() => router.push('/legal/privacy' as Href)} />
          <RouteListRow title="Jellyfish Effect" subtitle="Guide to rocket jellyfish viewing." onPress={() => router.push('/jellyfish-effect' as Href)} />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function formatHubCount(count: number) {
  return `${count} card${count === 1 ? '' : 's'}`;
}

export const ABOUT_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'About',
  title: 'Hi, I am Josh.',
  description: 'The story behind T-Minus Zero and the launch-watching habit that turned into a product.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'Where it started',
      body: 'Launches were part of life growing up in Central Florida, especially when sonic booms rolled inland from the coast.',
      bullets: [
        'A launch could feel distant until the house shook.',
        'Some landings and return-to-land profiles made the sky feel close.',
        'The goal was always to catch the moment in time, not later in a news recap.'
      ]
    },
    {
      title: 'Why the product exists',
      body: 'The site is designed to make launches easier to follow, easier to remember, and easier to share.',
      bullets: [
        'See what is launching and when.',
        'Get reminders so you actually look up.',
        'Keep the most relevant updates in one place.'
      ]
    }
  ]
};

export const JELLYFISH_FALLBACK_PAGE: CustomerRouteStaticPage = {
  eyebrow: 'Guide',
  title: 'The Jellyfish Effect',
  description: 'What the rocket jellyfish effect is, why it happens, and how to plan a strong viewing setup.',
  lastUpdated: 'Jan 20, 2026',
  sections: [
    {
      title: 'Quick answer',
      body: 'The jellyfish effect is the luminous plume pattern you see when a launch occurs in twilight conditions and the exhaust is still illuminated after liftoff.',
      bullets: [
        'It usually shows up around sunset or sunrise.',
        'The plume can remain visible far from the launch site.',
        'Viewing quality depends on light, clouds, and plume altitude.'
      ]
    },
    {
      title: 'Planning tips',
      body: 'Treat it like a timing problem first and a visibility problem second.',
      bullets: [
        'Arrive early enough to be ready when the pad clears.',
        'Watch the forecast and cloud layers.',
        'Look for flights that naturally align with twilight conditions.'
      ]
    }
  ]
};

export function buildGenericDocsFallback(slug: string): CustomerRouteStaticPage {
  const cleanSlug = String(slug || '').trim().toLowerCase() || 'docs';
  if (cleanSlug === 'about') return ABOUT_FALLBACK_PAGE;
  if (cleanSlug === 'jellyfish-effect') return JELLYFISH_FALLBACK_PAGE;

  return {
    eyebrow: 'Docs',
    title: formatSlugTitle(cleanSlug),
    description: 'Native documentation and evergreen reference content.',
    lastUpdated: 'Jan 20, 2026',
    sections: [
      {
        title: 'Overview',
        body: 'This page is available in the native app as part of the customer documentation surface.',
        bullets: [
          'Open the related info hub for broader browse surfaces.',
          'Use the account screens for privacy and subscription controls.',
          'Launch links stay inside the native app when a native destination exists.'
        ]
      }
    ]
  };
}

function formatSlugTitle(value: string) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
