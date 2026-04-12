import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { ContentPageV1, InfoHubV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { formatRouteDateTime, openExternalCustomerUrl } from './shared';
import { readRecentCustomerRouteEntries, recordRecentCustomerRouteEntry, type RecentCustomerRouteEntry } from './history';
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

export type CustomerRouteContentPresentation = NonNullable<ContentPageV1['presentation']>;

export type CustomerRouteStaticPage = {
  slug?: string;
  source?: 'native-fallback';
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: CustomerRouteContentSection[];
  actions?: CustomerRouteContentAction[];
  presentation?: CustomerRouteContentPresentation;
};

type NormalizedContentAction = {
  label: string;
  href: string;
  external?: boolean;
  variant?: 'primary' | 'secondary';
};

type NormalizedContentPage = {
  slug: string | null;
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: CustomerRouteContentSection[];
  actions: NormalizedContentAction[];
  presentation: CustomerRouteContentPresentation | null;
  source: 'native-fallback' | 'api';
};

type InfoHubSection = InfoHubV1['sections'][number];

export function ContentPageScreen({
  testID,
  page
}: {
  testID: string;
  page: CustomerRouteStaticPage | ContentPageV1;
}) {
  const router = useRouter();
  const normalizedPage = normalizeContentPage(page);
  const presentation = normalizedPage.presentation;
  const [faqQuery, setFaqQuery] = useState('');
  const [expandedFaq, setExpandedFaq] = useState<Record<string, boolean>>({});
  const pageHref = resolveInfoPageHref(normalizedPage.slug);
  const filteredFaqSections = useMemo(() => {
    if (presentation?.style !== 'faq') return normalizedPage.sections;
    const search = faqQuery.trim().toLowerCase();
    if (!search) return normalizedPage.sections;
    return normalizedPage.sections.filter((section) => {
      const haystack = `${section.title}\n${section.body}\n${(section.bullets || []).join('\n')}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [faqQuery, presentation?.style, normalizedPage.sections]);

  useEffect(() => {
    if (!pageHref) return;
    void recordRecentCustomerRouteEntry({
      kind: 'info',
      href: pageHref,
      title: normalizedPage.title,
      subtitle: normalizedPage.description,
      badge: normalizedPage.eyebrow
    });
  }, [normalizedPage.description, normalizedPage.eyebrow, normalizedPage.title, pageHref]);

  const renderActions = normalizedPage.actions.length ? (
    <CustomerShellPanel title="Related actions" description="Open connected customer surfaces without leaving the native experience.">
      <View style={{ gap: 10 }}>
        {normalizedPage.actions.map((action) => (
          <CustomerShellActionButton
            key={`${action.label}:${action.href}`}
            label={action.label}
            variant={action.variant ?? 'primary'}
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
  ) : null;

  return (
    <AppScreen testID={testID} keyboardShouldPersistTaps="handled">
      <CustomerShellHero eyebrow={normalizedPage.eyebrow} title={normalizedPage.title} description={normalizedPage.description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={normalizedPage.source === 'api' ? 'API content' : 'Native fallback'} tone="accent" />
          <CustomerShellBadge label={formatRouteDateTime(normalizedPage.lastUpdated)} />
          {(presentation?.chips ?? []).slice(0, 3).map((chip) => (
            <CustomerShellBadge key={chip} label={chip} />
          ))}
        </View>
      </CustomerShellHero>

      {(presentation?.highlights ?? []).length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {(presentation?.highlights ?? []).map((item) => (
            <CustomerShellMetric key={`${item.label}:${item.value}`} label={item.label} value={item.value} caption={item.detail ?? undefined} />
          ))}
        </View>
      ) : null}

      {renderActions}

      {presentation?.style === 'faq' ? (
        <>
          <CustomerShellPanel title="Search FAQ" description="Filter questions instantly on device.">
            <View
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: 'rgba(234, 240, 255, 0.1)',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 14,
                paddingVertical: 12
              }}
            >
              <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
                Search questions
              </Text>
              <TextInput
                value={faqQuery}
                onChangeText={setFaqQuery}
                placeholder={presentation?.searchPlaceholder ?? 'Search questions'}
                placeholderTextColor="#8c9cad"
                autoCapitalize="none"
                autoCorrect={false}
                style={{ color: '#eaf0ff', fontSize: 16, marginTop: 8, paddingVertical: 0 }}
              />
            </View>
          </CustomerShellPanel>

          <CustomerShellPanel
            title="Questions"
            description={`${filteredFaqSections.length} answer${filteredFaqSections.length === 1 ? '' : 's'} in view.`}
          >
            <View style={{ gap: 10 }}>
              {filteredFaqSections.length ? (
                filteredFaqSections.map((section) => {
                  const key = section.title;
                  const open = expandedFaq[key] ?? faqQuery.trim().length > 0;
                  return (
                    <Pressable
                      key={key}
                      onPress={() =>
                        setExpandedFaq((current) => ({
                          ...current,
                          [key]: !open
                        }))
                      }
                      style={({ pressed }) => ({
                        gap: 10,
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: 'rgba(234, 240, 255, 0.1)',
                        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                        paddingHorizontal: 16,
                        paddingVertical: 16
                      })}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <Text style={{ color: '#eaf0ff', fontSize: 16, fontWeight: '700', flex: 1 }}>{section.title}</Text>
                        <Text style={{ color: '#6fe8ff', fontSize: 12, fontWeight: '700' }}>{open ? 'Hide' : 'Show'}</Text>
                      </View>
                      {open ? (
                        <View style={{ gap: 8 }}>
                          <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>{section.body}</Text>
                          {(section.bullets ?? []).map((bullet) => (
                            <Text key={bullet} style={{ color: '#aebecd', fontSize: 13, lineHeight: 20 }}>
                              • {bullet}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })
              ) : (
                <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No FAQ entries matched “{faqQuery.trim()}”.</Text>
              )}
            </View>
          </CustomerShellPanel>
        </>
      ) : presentation?.style === 'timeline' ? (
        <>
          <CustomerShellPanel title="Phases" description="Current sequence for public roadmap delivery.">
            <View style={{ gap: 12 }}>
              {((presentation?.timeline ?? []).length ? presentation?.timeline ?? [] : buildTimelineFromSections(normalizedPage.sections)).map((item) => (
                <View
                  key={item.title}
                  style={{
                    gap: 8,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: timelineTone(item.status).borderColor,
                    backgroundColor: timelineTone(item.status).backgroundColor,
                    paddingHorizontal: 16,
                    paddingVertical: 16
                  }}
                >
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: '#eaf0ff', fontSize: 16, fontWeight: '700', flex: 1 }}>{item.title}</Text>
                    {item.status ? <CustomerShellBadge label={formatTimelineStatus(item.status)} tone={timelineTone(item.status).badgeTone} /> : null}
                  </View>
                  <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>{item.body}</Text>
                </View>
              ))}
            </View>
          </CustomerShellPanel>

          {normalizedPage.sections.map((section) => (
            <CustomerShellPanel key={section.title} title={section.title} description={section.body}>
              {(section.bullets ?? []).length ? (
                <View style={{ gap: 8 }}>
                  {(section.bullets ?? []).map((bullet) => (
                    <Text key={bullet} style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
                      • {bullet}
                    </Text>
                  ))}
                </View>
              ) : null}
            </CustomerShellPanel>
          ))}
        </>
      ) : (
        normalizedPage.sections.map((section, index) => (
          <CustomerShellPanel
            key={section.title}
            title={section.title}
            description={section.body}
          >
            {(section.bullets ?? []).length ? (
              <View style={{ gap: 8 }}>
                {(section.bullets ?? []).map((bullet) => (
                  <Text key={bullet} style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
                    • {bullet}
                  </Text>
                ))}
              </View>
            ) : index === 0 && presentation?.style === 'story' ? (
              <StoryAccent />
            ) : null}
          </CustomerShellPanel>
        ))
      )}
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
  const { theme } = useMobileBootstrap();
  const [recentItems, setRecentItems] = useState<RecentCustomerRouteEntry[]>([]);
  const sections = info.sections.length ? info.sections : buildInfoSectionsFromCards(info.cards);

  useEffect(() => {
    void readRecentCustomerRouteEntries('info', 6).then(setRecentItems);
  }, []);

  const openCard = (href: string) => {
    if (/^https?:\/\//i.test(href)) {
      void openExternalCustomerUrl(href);
      return;
    }
    router.push(href as Href);
  };

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow="Info" title={info.title} description={info.description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Command deck" tone="accent" />
          <CustomerShellBadge label={`${sections.length} sectors`} />
          <CustomerShellBadge label={`${info.cards.length} destinations`} />
        </View>
      </CustomerShellHero>

      {recentItems.length ? (
        <CustomerShellPanel title="Recent" description="Pick up where you left off.">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 4 }}>
            {recentItems.map((item) => (
              <Pressable
                key={`${item.kind}:${item.href}`}
                onPress={() => openCard(item.href)}
                style={({ pressed }) => ({
                  width: 220,
                  gap: 10,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: theme.stroke,
                  backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                  paddingHorizontal: 16,
                  paddingVertical: 16
                })}
              >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {item.badge ? <CustomerShellBadge label={item.badge} tone="accent" /> : null}
                  <CustomerShellBadge label={formatRouteDateTime(item.updatedAt)} />
                </View>
                <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{item.title}</Text>
                {item.subtitle ? <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{item.subtitle}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </CustomerShellPanel>
      ) : null}

      {sections.map((section) => (
        <CustomerShellPanel key={section.key} title={section.title} description={section.description ?? undefined}>
          {section.key === 'featured' ? (
            <View style={{ gap: 12 }}>
              {section.items.map((card) => (
                <Pressable
                  key={`${card.title}:${card.href}`}
                  onPress={() => openCard(card.href)}
                  style={({ pressed }) => ({
                    overflow: 'hidden',
                    borderRadius: 24,
                    borderWidth: 1,
                    borderColor: 'rgba(34, 211, 238, 0.18)',
                    backgroundColor: pressed ? 'rgba(34, 211, 238, 0.12)' : 'rgba(34, 211, 238, 0.08)',
                    paddingHorizontal: 18,
                    paddingVertical: 18
                  })}
                >
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: -24,
                      right: -12,
                      height: 120,
                      width: 120,
                      borderRadius: 60,
                      backgroundColor: 'rgba(34, 211, 238, 0.14)'
                    }}
                  />
                  <View style={{ gap: 10 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                      {card.eyebrow ? <CustomerShellBadge label={card.eyebrow} tone="accent" /> : null}
                      {card.badge ? <CustomerShellBadge label={card.badge} /> : null}
                    </View>
                    <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800', lineHeight: 28 }}>{card.title}</Text>
                    <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>{card.description}</Text>
                    <Text style={{ color: theme.accent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>Open in app</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {section.items.map((card) => (
                <Pressable
                  key={`${card.title}:${card.href}`}
                  onPress={() => openCard(card.href)}
                  style={({ pressed }) => ({
                    minWidth: '47%',
                    flexGrow: 1,
                    gap: 10,
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: theme.stroke,
                    backgroundColor: pressed ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.03)',
                    paddingHorizontal: 14,
                    paddingVertical: 14
                  })}
                >
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {card.eyebrow ? <CustomerShellBadge label={card.eyebrow} /> : null}
                    {card.badge ? <CustomerShellBadge label={card.badge} tone="accent" /> : null}
                  </View>
                  <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>{card.title}</Text>
                  <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>{card.description}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </CustomerShellPanel>
      ))}
    </AppScreen>
  );
}

export function InfoHubFallbackScreen({ testID }: { testID: string }) {
  return <InfoHubScreen testID={testID} info={INFO_HUB_FALLBACK} />;
}

const INFO_HUB_FALLBACK: InfoHubV1 = {
  generatedAt: new Date(0).toISOString(),
  title: 'The Command Deck',
  description: 'Native information hub for browse-heavy launch reference content.',
  cards: [
    { title: 'News', description: 'Mission coverage and launch-linked articles.', href: '/news', badge: 'Feed', kind: 'hero', eyebrow: 'Featured' },
    { title: 'About', description: 'Product story and mission context.', href: '/about', badge: 'Story', kind: 'hero', eyebrow: 'Featured' },
    { title: 'Catalog', description: 'Launch Library 2 browse hub.', href: '/catalog', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' },
    { title: 'Contracts', description: 'Canonical government contract intelligence.', href: '/contracts', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' },
    { title: 'Satellites', description: 'NORAD catalog and owner hubs.', href: '/satellites', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' },
    { title: 'FAQ', description: 'Common product and launch-data questions.', href: '/docs/faq', badge: 'Docs', kind: 'utility', eyebrow: 'Docs' },
    { title: 'Roadmap', description: 'Current implementation phases.', href: '/docs/roadmap', badge: 'Docs', kind: 'utility', eyebrow: 'Docs' },
    { title: 'Jellyfish Effect', description: 'Guide to rocket jellyfish viewing.', href: '/jellyfish-effect', badge: 'Guide', kind: 'utility', eyebrow: 'Guides' },
    { title: 'Support', description: 'Customer help and privacy requests.', href: '/support', badge: 'Help', kind: 'utility', eyebrow: 'Legal / Support' },
    { title: 'Privacy', description: 'Collection, use, and disclosure overview.', href: '/legal/privacy', badge: 'Legal', kind: 'utility', eyebrow: 'Legal / Support' }
  ],
  sections: [
    {
      key: 'featured',
      title: 'Featured',
      description: 'Start with the strongest native-first surfaces.',
      items: [
        { title: 'News', description: 'Mission coverage and launch-linked articles.', href: '/news', badge: 'Feed', kind: 'hero', eyebrow: 'Featured' },
        { title: 'About', description: 'Product story and mission context.', href: '/about', badge: 'Story', kind: 'hero', eyebrow: 'Featured' }
      ]
    },
    {
      key: 'browse',
      title: 'Browse',
      description: 'Reference hubs and discovery surfaces.',
      items: [
        { title: 'Catalog', description: 'Launch Library 2 browse hub.', href: '/catalog', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' },
        { title: 'Contracts', description: 'Canonical government contract intelligence.', href: '/contracts', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' },
        { title: 'Satellites', description: 'NORAD catalog and owner hubs.', href: '/satellites', badge: 'Browse', kind: 'utility', eyebrow: 'Browse' }
      ]
    },
    {
      key: 'docs',
      title: 'Docs',
      description: 'Native evergreen product pages.',
      items: [
        { title: 'FAQ', description: 'Common product and launch-data questions.', href: '/docs/faq', badge: 'Docs', kind: 'utility', eyebrow: 'Docs' },
        { title: 'Roadmap', description: 'Current implementation phases.', href: '/docs/roadmap', badge: 'Docs', kind: 'utility', eyebrow: 'Docs' }
      ]
    },
    {
      key: 'guides',
      title: 'Guides',
      description: 'Field guides and explainers.',
      items: [{ title: 'Jellyfish Effect', description: 'Guide to rocket jellyfish viewing.', href: '/jellyfish-effect', badge: 'Guide', kind: 'utility', eyebrow: 'Guides' }]
    },
    {
      key: 'legal-support',
      title: 'Legal/Support',
      description: 'Policy and customer help.',
      items: [
        { title: 'Support', description: 'Customer help and privacy requests.', href: '/support', badge: 'Help', kind: 'utility', eyebrow: 'Legal / Support' },
        { title: 'Privacy', description: 'Collection, use, and disclosure overview.', href: '/legal/privacy', badge: 'Legal', kind: 'utility', eyebrow: 'Legal / Support' }
      ]
    }
  ]
};

function normalizeContentPage(page: CustomerRouteStaticPage | ContentPageV1): NormalizedContentPage {
  const actions: NormalizedContentAction[] = (page.actions ?? []).map((action) => ({
    label: action.label,
    href: action.href,
    external: 'external' in action ? Boolean(action.external) : false,
    variant: 'variant' in action ? action.variant : undefined
  }));

  return {
    slug: 'slug' in page && typeof page.slug === 'string' ? page.slug : null,
    eyebrow: page.eyebrow,
    title: page.title,
    description: page.description,
    lastUpdated: page.lastUpdated,
    sections: page.sections.map((section) => ({
      title: section.title,
      body: section.body,
      bullets: [...(section.bullets ?? [])]
    })),
    actions,
    presentation: 'presentation' in page ? page.presentation ?? null : null,
    source: 'source' in page && page.source === 'native-fallback' ? 'native-fallback' : 'api'
  };
}

function buildInfoSectionsFromCards(cards: InfoHubV1['cards']): InfoHubSection[] {
  const grouped = new Map<string, InfoHubV1['cards']>();
  for (const card of cards) {
    const key = normalizeSectionKey(card.eyebrow || card.badge || 'browse');
    const current = grouped.get(key) ?? [];
    grouped.set(key, [...current, card]);
  }

  const sections: InfoHubSection[] = [...grouped.entries()].map(([key, items]) => ({
    key,
    title: formatSlugTitle(key),
    description: null,
    items
  }));

  const featured = cards.filter((card) => card.kind === 'hero');
  if (featured.length) {
    sections.unshift({
      key: 'featured',
      title: 'Featured',
      description: 'Start with the strongest native surfaces.',
      items: featured
    });
  }

  return dedupeInfoSections(sections);
}

function dedupeInfoSections(sections: InfoHubSection[]) {
  const seen = new Set<string>();
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        const key = `${section.key}:${item.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    }))
    .filter((section) => section.items.length > 0);
}

function resolveInfoPageHref(slug: string | null) {
  if (!slug) return null;
  if (slug === 'about') return '/about';
  if (slug === 'faq' || slug === 'docs/faq') return '/docs/faq';
  if (slug === 'roadmap' || slug === 'docs/roadmap') return '/docs/roadmap';
  if (slug === 'jellyfish-effect') return '/jellyfish-effect';
  if (slug.startsWith('legal/')) return `/${slug}`;
  return `/docs/${slug.replace(/^docs\//, '')}`;
}

function buildTimelineFromSections(sections: CustomerRouteContentSection[]) {
  return sections.map((section, index) => ({
    title: section.title,
    body: section.body,
    status: (index === 0 ? 'complete' : index === 1 ? 'active' : 'up-next') as 'complete' | 'active' | 'up-next'
  }));
}

function normalizeSectionKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') || 'browse';
}

function timelineTone(status: 'complete' | 'active' | 'up-next' | null | undefined) {
  if (status === 'complete') {
    return {
      borderColor: 'rgba(52, 211, 153, 0.18)',
      backgroundColor: 'rgba(52, 211, 153, 0.08)',
      badgeTone: 'success' as const
    };
  }
  if (status === 'active') {
    return {
      borderColor: 'rgba(34, 211, 238, 0.18)',
      backgroundColor: 'rgba(34, 211, 238, 0.08)',
      badgeTone: 'accent' as const
    };
  }
  return {
    borderColor: 'rgba(251, 191, 36, 0.18)',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    badgeTone: 'warning' as const
  };
}

function formatTimelineStatus(status: 'complete' | 'active' | 'up-next') {
  if (status === 'complete') return 'Complete';
  if (status === 'active') return 'Active';
  return 'Up next';
}

function StoryAccent() {
  return (
    <View
      style={{
        height: 96,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(34, 211, 238, 0.18)',
        backgroundColor: 'rgba(34, 211, 238, 0.06)',
        overflow: 'hidden'
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -26,
          left: -14,
          width: 100,
          height: 100,
          borderRadius: 50,
          backgroundColor: 'rgba(34, 211, 238, 0.18)'
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          right: -12,
          bottom: -26,
          width: 120,
          height: 120,
          borderRadius: 60,
          backgroundColor: 'rgba(251, 191, 36, 0.1)'
        }}
      />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 16 }}>
        <Text style={{ color: '#d4e0eb', fontSize: 13, lineHeight: 20 }}>
          Native-first layout, shared content truth, and customer routes that stay inside the app whenever a native destination exists.
        </Text>
      </View>
    </View>
  );
}

export const ABOUT_FALLBACK_PAGE: CustomerRouteStaticPage = {
  slug: 'about',
  source: 'native-fallback',
  eyebrow: 'About',
  title: 'About T-Minus Zero',
  description: 'What the product is, why it exists, and how the launch reference experience is organized.',
  lastUpdated: '2026-04-11T00:00:00.000Z',
  presentation: {
    style: 'story',
    chips: ['Independent', 'Launch-native', 'Cross-platform'],
    highlights: [
      { label: 'Surfaces', value: '3', detail: 'Web, iOS, Android' },
      { label: 'Signal', value: 'Fast', detail: 'Launch truth with context and handoff' },
      { label: 'Model', value: 'Typed API', detail: 'Shared contracts power every screen' }
    ],
    timeline: [],
    searchPlaceholder: null,
    heroImageUrl: null,
    heroCaption: null
  },
  actions: [
    { label: 'Open FAQ', href: '/docs/faq', variant: 'primary' },
    { label: 'Open roadmap', href: '/docs/roadmap', variant: 'secondary' }
  ],
  sections: [
    {
      title: 'Mission',
      body: 'T-Minus Zero is built for launch fans and operators who want a fast, trustworthy signal on what is happening across launches, programs, and related reference data.'
    },
    {
      title: 'Product model',
      body: 'The public web surface remains the reference implementation, while shared contracts, query policy, and native route truth make the handheld experience first class.'
    }
  ]
};

export const FAQ_FALLBACK_PAGE: CustomerRouteStaticPage = {
  slug: 'docs/faq',
  source: 'native-fallback',
  eyebrow: 'Docs',
  title: 'FAQ',
  description: 'Answers to common questions about launch tracking, alerts, and public data.',
  lastUpdated: '2026-04-11T00:00:00.000Z',
  presentation: {
    style: 'faq',
    chips: ['Searchable', 'Launch data', 'Account help'],
    highlights: [],
    timeline: [],
    searchPlaceholder: 'Search launch, billing, privacy, or alerts questions',
    heroImageUrl: null,
    heroCaption: null
  },
  actions: [
    { label: 'Privacy choices', href: '/legal/privacy-choices', variant: 'primary' },
    { label: 'About T-Minus Zero', href: '/about', variant: 'secondary' }
  ],
  sections: [
    {
      title: 'How fresh is launch data?',
      body: 'Launch surfaces are designed for quick refresh and typed summaries, but launch timing can still move quickly when providers update their schedules.'
    },
    {
      title: 'Does the app host full news articles?',
      body: 'The app owns discovery and article detail, while full publisher-body reading still hands off through the source browser.'
    },
    {
      title: 'How do alerts work on mobile?',
      body: 'Alerts are push-first on native mobile. Manage notification permissions, device registration, and launch follows from the app.'
    }
  ]
};

const ROADMAP_FALLBACK_PAGE: CustomerRouteStaticPage = {
  slug: 'docs/roadmap',
  source: 'native-fallback',
  eyebrow: 'Docs',
  title: 'Implementation Phases',
  description: 'Native mobile rollout phases for shared customer surfaces and supporting infrastructure.',
  lastUpdated: '2026-04-11T00:00:00.000Z',
  presentation: {
    style: 'timeline',
    chips: ['Foundation', 'Parity', 'Hardening'],
    highlights: [],
    timeline: [
      { title: 'Phase 1 - Surface parity', body: 'Finish customer-facing browse surfaces and first-party internal linking across the remaining mobile gaps.', status: 'complete' },
      { title: 'Phase 2 - Native excellence', body: 'Upgrade news and info into premium handheld-first product surfaces.', status: 'active' },
      { title: 'Phase 3 - Operational completeness', body: 'Close the remaining account, privacy, and integration management flows.', status: 'up-next' }
    ],
    searchPlaceholder: null,
    heroImageUrl: null,
    heroCaption: null
  },
  sections: [
    {
      title: 'Phase 1 - Surface parity',
      body: 'Finish the customer-facing browse surfaces and internal linking across the remaining mobile gaps.',
      bullets: ['News, contracts, satellites, and catalog browsing.', 'Docs, support, legal, and guide pages.', 'Native resolution for first-party customer links.']
    },
    {
      title: 'Phase 2 - Operational completeness',
      body: 'Close the remaining account, privacy, and integration management flows.',
      bullets: ['Privacy choices and export flows.', 'Recurring calendar, RSS, and embed management.', 'Account profile and notification preference parity.']
    }
  ]
};

export const JELLYFISH_FALLBACK_PAGE: CustomerRouteStaticPage = {
  slug: 'jellyfish-effect',
  source: 'native-fallback',
  eyebrow: 'Guide',
  title: 'The Jellyfish Effect',
  description: 'What the rocket jellyfish effect is, why it happens, and how to plan a strong viewing setup.',
  lastUpdated: '2026-04-11T00:00:00.000Z',
  presentation: {
    style: 'guide',
    chips: ['Twilight', 'Visibility', 'Planning'],
    highlights: [
      { label: 'Best window', value: 'Sunrise/Sunset', detail: 'Twilight launches create the effect' },
      { label: 'Key factor', value: 'Lighting geometry', detail: 'Sunlit plume against a darkening sky' }
    ],
    timeline: [],
    searchPlaceholder: null,
    heroImageUrl: null,
    heroCaption: null
  },
  actions: [
    { label: 'Open News', href: '/news', variant: 'primary' },
    { label: 'Open FAQ', href: '/docs/faq', variant: 'secondary' }
  ],
  sections: [
    {
      title: 'Quick answer',
      body: 'The jellyfish effect is the luminous plume pattern you see when a launch occurs in twilight conditions and the exhaust is still illuminated after liftoff.',
      bullets: ['It usually shows up around sunset or sunrise.', 'The plume can remain visible far from the launch site.', 'Viewing quality depends on light, clouds, and plume altitude.']
    },
    {
      title: 'Planning tips',
      body: 'Treat it like a timing problem first and a visibility problem second.',
      bullets: ['Arrive early enough to be ready when the pad clears.', 'Watch the forecast and cloud layers.', 'Look for flights that naturally align with twilight conditions.']
    }
  ]
};

export function buildGenericDocsFallback(slug: string): CustomerRouteStaticPage {
  const cleanSlug = String(slug || '').trim().toLowerCase() || 'docs';
  if (cleanSlug === 'about') return ABOUT_FALLBACK_PAGE;
  if (cleanSlug === 'faq') return FAQ_FALLBACK_PAGE;
  if (cleanSlug === 'roadmap') return ROADMAP_FALLBACK_PAGE;
  if (cleanSlug === 'jellyfish-effect') return JELLYFISH_FALLBACK_PAGE;

  return {
    slug: cleanSlug,
    source: 'native-fallback',
    eyebrow: cleanSlug.startsWith('legal/') ? 'Legal' : 'Docs',
    title: formatSlugTitle(cleanSlug),
    description: 'Native documentation and evergreen reference content.',
    lastUpdated: '2026-04-11T00:00:00.000Z',
    presentation: {
      style: cleanSlug.startsWith('legal/') ? 'legal' : 'story',
      chips: cleanSlug.startsWith('legal/') ? ['Policy', 'Account', 'Reference'] : ['Docs', 'Reference'],
      highlights: [],
      timeline: [],
      searchPlaceholder: null,
      heroImageUrl: null,
      heroCaption: null
    },
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
    .replace(/[-_/]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
