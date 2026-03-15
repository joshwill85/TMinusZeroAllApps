import { useEffect, useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { type Href, usePathname, useRouter, useSegments } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useProfileQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { getPublicSiteUrl } from '@/src/config/api';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import {
  MOBILE_DOCK_BOTTOM_OFFSET,
  MOBILE_DOCK_HEIGHT,
  MOBILE_DOCK_SIDE_INSET,
  shouldShowCustomerDock
} from '@/src/components/mobileShell';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type NativeManifestItem = {
  key: string;
  title: string;
  description: string;
  testID?: string;
  kind: 'native';
  href: Href;
  badge?: string;
};

type ExternalManifestItem = {
  key: string;
  title: string;
  description: string;
  testID?: string;
  kind: 'external';
  href: string;
  badge?: string;
};

type ManifestItem = NativeManifestItem | ExternalManifestItem;

type ManifestSection = {
  title: string;
  items: ManifestItem[];
};

export function MobileDockingBay() {
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { theme } = useMobileBootstrap();
  const viewerSessionQuery = useViewerSessionQuery();
  const viewerEntitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();
  const [manifestOpen, setManifestOpen] = useState(false);
  const showDock = shouldShowCustomerDock(segments);
  const siteUrl = useMemo(() => getPublicSiteUrl(), []);
  const viewerTier = viewerEntitlementsQuery.data?.tier ?? 'anon';
  const isPremium = viewerTier === 'premium';
  const profileInitials = getProfileInitials({
    firstName: profileQuery.data?.firstName ?? null,
    lastName: profileQuery.data?.lastName ?? null,
    email: profileQuery.data?.email ?? viewerSessionQuery.data?.email ?? null
  });
  const profileHref = viewerSessionQuery.data?.viewerId ? ('/profile' as Href) : ('/sign-in' as Href);
  const profileActive =
    pathname.startsWith('/profile') ||
    pathname.startsWith('/preferences') ||
    pathname.startsWith('/saved') ||
    pathname.startsWith('/account');
  const feedActive = pathname === '/' || pathname.startsWith('/feed');
  const calendarActive = pathname.startsWith('/calendar');
  const searchActive = pathname.startsWith('/search');

  useEffect(() => {
    setManifestOpen(false);
  }, [pathname]);

  const manifestSections = useMemo<ManifestSection[]>(() => {
    const nativeItems: ManifestItem[] = [
      {
        key: 'calendar',
        title: 'Calendar',
        description: 'Browse the signed-in launch calendar and add one launch at a time.',
        kind: 'native',
        href: '/calendar',
        testID: 'manifest-link-calendar'
      },
      {
        key: 'saved',
        title: 'Saved',
        description: 'Premium saved filters, follows, and starred launches.',
        kind: 'native',
        href: '/saved',
        testID: 'tab-saved'
      },
      {
        key: 'settings',
        title: 'Settings',
        description: 'Notifications, push, and device preferences.',
        kind: 'native',
        href: '/preferences',
        testID: 'tab-preferences'
      },
      {
        key: 'profile',
        title: viewerSessionQuery.data?.viewerId ? 'Profile' : 'Sign in',
        description: viewerSessionQuery.data?.viewerId ? 'Account, membership, and billing.' : 'Authenticate and restore your account.',
        kind: 'native',
        href: profileHref,
        testID: 'manifest-link-profile'
      }
    ];

    if (!isPremium) {
      nativeItems.push({
        key: 'upgrade',
        title: viewerSessionQuery.data?.viewerId ? 'Unlock Premium' : 'Create account',
        description: viewerSessionQuery.data?.viewerId ? 'Upgrade for saved items, browser-style integrations, and live tools.' : 'Sign in for filters, calendar access, and basic mobile alerts.',
        kind: 'native',
        href: profileHref,
        badge: viewerSessionQuery.data?.viewerId ? 'Premium' : 'Auth',
        testID: 'manifest-link-upgrade'
      });
    }

    return [
      {
        title: 'Native',
        items: nativeItems
      },
      {
        title: 'Explore',
        items: [
          {
            key: 'news',
            title: 'News',
            description: 'Editorial coverage and mission updates.',
            kind: 'external',
            href: `${siteUrl}/news`,
            testID: 'manifest-link-news'
          },
          {
            key: 'providers',
            title: 'Launch Providers',
            description: 'Browse launch providers and operator hubs.',
            kind: 'external',
            href: `${siteUrl}/launch-providers`,
            testID: 'manifest-link-providers'
          },
          {
            key: 'artemis',
            title: 'Artemis',
            description: 'NASA Artemis program hub.',
            kind: 'external',
            href: `${siteUrl}/artemis`,
            testID: 'manifest-link-artemis'
          },
          {
            key: 'spacex',
            title: 'SpaceX',
            description: 'SpaceX program and mission hub.',
            kind: 'external',
            href: `${siteUrl}/spacex`,
            testID: 'manifest-link-spacex'
          },
          {
            key: 'blue-origin',
            title: 'Blue Origin',
            description: 'Blue Origin launch and mission hub.',
            kind: 'external',
            href: `${siteUrl}/blue-origin`,
            testID: 'manifest-link-blue-origin'
          },
          {
            key: 'about',
            title: 'About',
            description: 'Product positioning and data sources.',
            kind: 'external',
            href: `${siteUrl}/about`,
            testID: 'manifest-link-about'
          },
          {
            key: 'faq',
            title: 'FAQ',
            description: 'Common questions and support docs.',
            kind: 'external',
            href: `${siteUrl}/docs/faq`,
            testID: 'manifest-link-faq'
          }
        ]
      },
      {
        title: 'Legal',
        items: [
          {
            key: 'terms',
            title: 'Terms',
            description: 'Platform terms and user obligations.',
            kind: 'external',
            href: `${siteUrl}/legal/terms`,
            testID: 'manifest-link-terms'
          },
          {
            key: 'privacy',
            title: 'Privacy',
            description: 'Privacy policy and data handling.',
            kind: 'external',
            href: `${siteUrl}/legal/privacy`,
            testID: 'manifest-link-privacy'
          },
          {
            key: 'privacy-choices',
            title: 'Privacy Choices',
            description: 'Consumer privacy preferences and controls.',
            kind: 'external',
            href: `${siteUrl}/legal/privacy-choices`,
            testID: 'manifest-link-privacy-choices'
          }
        ]
      },
      {
        title: 'Support',
        items: [
          {
            key: 'tip-jar',
            title: 'Tip Jar',
            description: 'Open the web tip jar checkout surface.',
            kind: 'external',
            href: `${siteUrl}/?tip=open`,
            testID: 'manifest-link-tip-jar'
          }
        ]
      }
    ];
  }, [isPremium, profileHref, siteUrl, viewerSessionQuery.data?.viewerId]);

  if (!showDock) {
    return null;
  }

  return (
    <>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 60
        }}
      >
        <View
          style={{
            paddingHorizontal: MOBILE_DOCK_SIDE_INSET,
            paddingBottom: insets.bottom + MOBILE_DOCK_BOTTOM_OFFSET
          }}
        >
          <View
            style={{
              borderRadius: 24,
              borderWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: 'rgba(7, 9, 19, 0.82)',
              paddingHorizontal: 12,
              paddingVertical: 9,
              shadowColor: '#000000',
              shadowOpacity: 0.3,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 10 },
              elevation: 10
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <DockButton
                testID="tab-profile"
                label={viewerSessionQuery.data?.viewerId ? 'Profile' : 'Sign in'}
                active={profileActive}
                onPress={() => {
                  router.replace(profileHref);
                }}
              >
                {profileInitials ? <ProfileBadge initials={profileInitials} color={profileActive ? theme.accent : theme.foreground} /> : <UserGlyph color={profileActive ? theme.accent : theme.foreground} />}
              </DockButton>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <DockButton
                  testID="tab-feed"
                  label="Feed"
                  active={feedActive}
                  onPress={() => {
                    router.replace('/feed');
                  }}
                >
                  <HomeGlyph color={feedActive ? theme.accent : theme.foreground} />
                </DockButton>
                <DockButton
                  testID="tab-calendar"
                  label="Calendar"
                  active={calendarActive}
                  onPress={() => {
                    router.replace('/calendar');
                  }}
                >
                  <CalendarGlyph color={calendarActive ? theme.accent : theme.foreground} />
                </DockButton>
                <DockButton
                  testID="tab-search"
                  label="Search"
                  active={searchActive}
                  onPress={() => {
                    router.replace('/search');
                  }}
                >
                  <SearchGlyph color={searchActive ? theme.accent : theme.foreground} />
                </DockButton>
              </View>

              <DockButton
                testID="dock-manifest-toggle"
                label="Manifest"
                active={manifestOpen}
                onPress={() => {
                  setManifestOpen(true);
                }}
              >
                <MenuGlyph color={manifestOpen ? theme.accent : theme.foreground} />
              </DockButton>
            </View>
          </View>
        </View>
      </View>

      <Modal
        visible={manifestOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={() => {
          setManifestOpen(false);
        }}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.4)' }}>
          <Pressable testID="dock-manifest-backdrop" onPress={() => setManifestOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
          <View
            testID="dock-manifest"
            style={{
              maxHeight: '76%',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderTopWidth: 1,
              borderColor: theme.stroke,
              backgroundColor: theme.background,
              paddingTop: 12
            }}
          >
            <View style={{ alignItems: 'center' }}>
              <View
                style={{
                  width: 44,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: 'rgba(255, 255, 255, 0.18)'
                }}
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 }}>
              <View>
                <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>Manifest</Text>
                <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800', marginTop: 4 }}>Customer dock</Text>
              </View>
              <Pressable
                onPress={() => {
                  setManifestOpen(false);
                }}
                hitSlop={8}
              >
                <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Close</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{
                gap: 18,
                paddingHorizontal: 20,
                paddingTop: 8,
                paddingBottom: insets.bottom + 24
              }}
            >
              {manifestSections.map((section) => (
                <View key={section.title} style={{ gap: 10 }}>
                  <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>{section.title}</Text>
                  <View style={{ gap: 10 }}>
                    {section.items.map((item) => (
                      <ManifestRow
                        key={item.key}
                        item={item}
                        theme={theme}
                        onPress={async () => {
                          setManifestOpen(false);
                          if (item.kind === 'native') {
                            router.replace(item.href);
                            return;
                          }
                          await openExternalUrl(item.href);
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function DockButton({
  label,
  active,
  onPress,
  testID,
  children
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        height: MOBILE_DOCK_HEIGHT,
        width: 58,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.32)' : 'rgba(255, 255, 255, 0.04)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.12)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        opacity: pressed ? 0.9 : 1
      })}
    >
      {children}
    </Pressable>
  );
}

function ManifestRow({
  item,
  theme,
  onPress
}: {
  item: ManifestItem;
  theme: { background: string; foreground: string; muted: string; accent: string; stroke: string };
  onPress: () => void | Promise<void>;
}) {
  return (
    <Pressable
      testID={item.testID}
      onPress={() => {
        void onPress();
      }}
      style={({ pressed }) => ({
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 16,
        paddingVertical: 14
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{item.title}</Text>
            {item.badge ? (
              <View
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: 'rgba(34, 211, 238, 0.22)',
                  backgroundColor: 'rgba(34, 211, 238, 0.1)',
                  paddingHorizontal: 8,
                  paddingVertical: 4
                }}
              >
                <Text style={{ color: theme.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{item.badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{item.description}</Text>
        </View>
        <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>{item.kind === 'native' ? '>' : '↗'}</Text>
      </View>
    </Pressable>
  );
}

async function openExternalUrl(url: string) {
  try {
    await WebBrowser.openBrowserAsync(url);
    return;
  } catch {
    // Fall back to the system URL handler if the in-app browser is unavailable.
  }

  await Linking.openURL(url);
}

function getProfileInitials({
  firstName,
  lastName,
  email
}: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}) {
  const firstInitial = String(firstName || '').trim().slice(0, 1);
  const lastInitial = String(lastName || '').trim().slice(0, 1);
  const combined = `${firstInitial}${lastInitial}`.trim().toUpperCase();
  if (combined) {
    return combined;
  }

  return String(email || '').trim().slice(0, 1).toUpperCase();
}

function ProfileBadge({ initials, color }: { initials: string; color: string }) {
  return (
    <View
      style={{
        height: 30,
        width: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        borderWidth: 1.4,
        borderColor: color
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{initials}</Text>
    </View>
  );
}

function HomeGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18 }}>
      <View
        style={{
          position: 'absolute',
          left: 3,
          top: 2,
          height: 11,
          width: 11,
          transform: [{ rotate: '45deg' }],
          borderLeftWidth: 1.6,
          borderTopWidth: 1.6,
          borderColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 4,
          bottom: 1,
          height: 8,
          width: 10,
          borderWidth: 1.6,
          borderTopWidth: 0,
          borderColor: color
        }}
      />
    </View>
  );
}

function SearchGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18 }}>
      <View
        style={{
          position: 'absolute',
          left: 2,
          top: 2,
          height: 10,
          width: 10,
          borderWidth: 1.6,
          borderColor: color,
          borderRadius: 999
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 1,
          bottom: 3,
          width: 7,
          height: 1.8,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }]
        }}
      />
    </View>
  );
}

function CalendarGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 6,
        borderWidth: 1.6,
        borderColor: color,
        position: 'relative'
      }}
    >
      <View style={{ position: 'absolute', left: 3, right: 3, top: 5, height: 1.6, backgroundColor: color, borderRadius: 999 }} />
      <View style={{ position: 'absolute', left: 6, top: -2, width: 2, height: 6, borderRadius: 999, backgroundColor: color }} />
      <View style={{ position: 'absolute', right: 6, top: -2, width: 2, height: 6, borderRadius: 999, backgroundColor: color }} />
    </View>
  );
}

function UserGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18 }}>
      <View
        style={{
          position: 'absolute',
          top: 1,
          left: 5.5,
          height: 6,
          width: 6,
          borderWidth: 1.6,
          borderColor: color,
          borderRadius: 999
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 2,
          bottom: 1,
          height: 8,
          width: 14,
          borderWidth: 1.6,
          borderBottomWidth: 0,
          borderColor: color,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8
        }}
      />
    </View>
  );
}

function MenuGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18, justifyContent: 'center', gap: 3 }}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{
            height: 1.8,
            borderRadius: 999,
            backgroundColor: color
          }}
        />
      ))}
    </View>
  );
}
