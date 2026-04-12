import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, Text, View } from 'react-native';
import { type Href, usePathname, useRouter, useSegments } from 'expo-router';
import { useProfileQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import {
  buildMobilePremiumCheckoutReturnTo,
  buildMobilePremiumLegalHref,
  buildMobilePremiumUpgradeAuthHref
} from '@/src/auth/premiumOnboarding';
import { buildClaimAuthHref } from '@/src/billing/nativeBillingUi';
import { useNativeBilling } from '@/src/billing/useNativeBilling';
import { getProgramHubEntryOrCoreHref } from '@/src/features/programHubs/rollout';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { MOBILE_BRAND_FACEBOOK_URL, MOBILE_BRAND_X_URL } from '@/src/features/account/constants';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { CustomerShellActionButton, CustomerShellBadge } from '@/src/components/CustomerShell';
import {
  MOBILE_DOCK_BOTTOM_OFFSET,
  MOBILE_DOCK_HEIGHT,
  MOBILE_DOCK_SIDE_INSET,
  shouldShowCustomerDock
} from '@/src/components/mobileShell';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ManifestItem = {
  key: string;
  title: string;
  description: string;
  testID?: string;
  href?: Href;
  externalUrl?: string;
  badge?: string;
};

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
  const viewerTier = viewerEntitlementsQuery.data?.tier ?? 'anon';
  const isAuthed = Boolean(viewerSessionQuery.data?.viewerId);
  const isPremium = viewerTier === 'premium';
  const manifestSheetTranslateY = useRef(new Animated.Value(0)).current;
  const profileInitials = getProfileInitials({
    firstName: profileQuery.data?.firstName ?? null,
    lastName: profileQuery.data?.lastName ?? null,
    email: profileQuery.data?.email ?? viewerSessionQuery.data?.email ?? null
  });
  const profileHref = '/profile' as Href;
  const profileActive =
    pathname.startsWith('/profile') ||
    pathname.startsWith('/preferences') ||
    pathname.startsWith('/saved') ||
    pathname.startsWith('/account') ||
    pathname.startsWith('/legal/');
  const profileRootActive = pathname.startsWith('/profile') || pathname.startsWith('/account');
  const feedActive = pathname === '/' || pathname.startsWith('/feed');
  const calendarActive = pathname.startsWith('/calendar');
  const searchActive = pathname.startsWith('/search');
  const feedHref = '/feed' as Href;

  useEffect(() => {
    setManifestOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!manifestOpen) {
      manifestSheetTranslateY.stopAnimation();
      manifestSheetTranslateY.setValue(0);
    }
  }, [manifestOpen, manifestSheetTranslateY]);

  const closeManifest = useCallback(() => {
    manifestSheetTranslateY.stopAnimation();
    manifestSheetTranslateY.setValue(0);
    setManifestOpen(false);
  }, [manifestSheetTranslateY]);

  const replaceDockRoute = useCallback(
    (href: Href) => {
      closeManifest();
      router.replace(href);
    },
    [closeManifest, router]
  );

  const toggleDockRoute = useCallback(
    (isActive: boolean, href: Href) => {
      replaceDockRoute(isActive ? feedHref : href);
    },
    [feedHref, replaceDockRoute]
  );

  const manifestHeaderPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          gestureState.dy > 8 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          manifestSheetTranslateY.setValue(Math.max(0, gestureState.dy));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 72 || gestureState.vy > 0.9) {
            Animated.timing(manifestSheetTranslateY, {
              toValue: 160,
              duration: 140,
              useNativeDriver: true
            }).start(() => {
              closeManifest();
            });
            return;
          }

          Animated.spring(manifestSheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 20
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(manifestSheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 20
          }).start();
        }
      }),
    [closeManifest, manifestSheetTranslateY]
  );

  const manifestSections = useMemo<ManifestSection[]>(() => {
    const artemisHref = getProgramHubEntryOrCoreHref(viewerSessionQuery.data, 'artemis');
    const spacexHref = getProgramHubEntryOrCoreHref(viewerSessionQuery.data, 'spacex');
    const blueOriginHref = getProgramHubEntryOrCoreHref(viewerSessionQuery.data, 'blueOrigin');

    const nativeItems: ManifestItem[] = [
      {
        key: 'calendar',
        title: 'Calendar',
        description: 'Browse the launch calendar and add one launch at a time.',
        href: '/calendar',
        testID: 'manifest-link-calendar'
      },
      {
        key: 'saved',
        title: 'Saved',
        description: 'Saved filters, follows, and starred launches.',
        href: '/saved',
        testID: 'tab-saved'
      },
      {
        key: 'settings',
        title: 'Alerts',
        description: 'Notifications, push, and device alert preferences.',
        href: '/preferences',
        testID: 'tab-preferences'
      },
      {
        key: 'profile',
        title: 'Account',
        description: viewerSessionQuery.data?.viewerId ? 'Account, membership, and billing.' : 'Account, membership, and purchase restore.',
        href: profileHref,
        testID: 'manifest-link-profile'
      }
    ];

    const exploreItems: ManifestItem[] = [
      {
        key: 'news',
        title: 'News',
        description: 'SNAPI-powered article, blog, and report stream with linked launch context.',
        href: '/news' as Href,
        testID: 'manifest-link-news'
      },
      {
        key: 'contracts',
        title: 'Contracts',
        description: 'Canonical government contract stories across SpaceX, Blue Origin, and Artemis.',
        href: '/contracts' as Href,
        testID: 'manifest-link-contracts'
      },
      {
        key: 'satellites',
        title: 'Satellites',
        description: 'NORAD catalog browse, owner profiles, and related launch links.',
        href: '/satellites' as Href,
        testID: 'manifest-link-satellites'
      },
      {
        key: 'reference',
        title: 'Reference',
        description: 'Agencies, astronauts, hardware, pads, and other LL2 catalog entities.',
        href: '/catalog' as Href,
        testID: 'manifest-link-reference'
      },
      {
        key: 'info',
        title: 'Info',
        description: 'Guides, product context, and first-party reference resources.',
        href: '/info' as Href,
        testID: 'manifest-link-info'
      },
      {
        key: 'integrations',
        title: 'Integrations',
        description: 'Recurring calendar feeds, RSS feeds, and embed widgets.',
        href: '/account/integrations' as Href,
        badge: 'Premium',
        testID: 'manifest-link-integrations'
      },
      {
        key: 'providers',
        title: 'Launch Providers',
        description: 'Browse launch providers and operator hubs.',
        href: '/launch-providers',
        testID: 'manifest-link-providers'
      }
    ];

    if (artemisHref) {
      exploreItems.push({
        key: 'artemis',
        title: 'Artemis',
        description: 'NASA Artemis program hub.',
        href: artemisHref as Href,
        testID: 'manifest-link-artemis'
      });
    }

    if (spacexHref) {
      exploreItems.push({
        key: 'spacex',
        title: 'SpaceX',
        description: 'SpaceX program and mission hub.',
        href: spacexHref as Href,
        testID: 'manifest-link-spacex'
      });
    }

    if (blueOriginHref) {
      exploreItems.push({
        key: 'blue-origin',
        title: 'Blue Origin',
        description: 'Blue Origin launch and mission hub.',
        href: blueOriginHref as Href,
        testID: 'manifest-link-blue-origin'
      });
    }

    return [
      {
        title: 'Native',
        items: nativeItems
      },
      {
        title: 'Explore',
        items: exploreItems
      },
      {
        title: 'Info',
        items: [
          {
            key: 'support',
            title: 'Support',
            description: 'Customer help, billing guidance, and privacy requests.',
            href: '/support' as Href,
            testID: 'manifest-link-support'
          },
          {
            key: 'about',
            title: 'About',
            description: 'Why T-Minus Zero exists and how the customer product is framed.',
            href: '/about' as Href,
            testID: 'manifest-link-about'
          },
          {
            key: 'faq',
            title: 'FAQ',
            description: 'Answers to the common product and launch-data questions.',
            href: '/docs/faq' as Href,
            testID: 'manifest-link-faq'
          },
          {
            key: 'roadmap',
            title: 'Roadmap',
            description: 'Current implementation phases and planned product work.',
            href: '/docs/roadmap' as Href,
            testID: 'manifest-link-roadmap'
          },
          {
            key: 'jellyfish-effect',
            title: 'Jellyfish Effect',
            description: 'First-party guide to twilight launch plume visibility.',
            href: '/jellyfish-effect' as Href,
            testID: 'manifest-link-jellyfish'
          },
          {
            key: 'data',
            title: 'Data & Attribution',
            description: 'Public source inventory and attribution notes.',
            href: '/legal/data' as Href,
            testID: 'manifest-link-data'
          },
          {
            key: 'notifications',
            title: 'Notifications',
            description: 'Push-only alert guidance and settings.',
            href: '/preferences' as Href,
            testID: 'manifest-link-notifications'
          }
        ]
      },
      {
        title: 'Follow',
        items: [
          {
            key: 'x',
            title: 'X',
            description: 'Launch updates and product signals on X.',
            externalUrl: MOBILE_BRAND_X_URL,
            testID: 'manifest-link-x'
          },
          {
            key: 'facebook',
            title: 'Facebook',
            description: 'Launch updates and product signals on Facebook.',
            externalUrl: MOBILE_BRAND_FACEBOOK_URL,
            testID: 'manifest-link-facebook'
          }
        ]
      },
      {
        title: 'Legal',
        items: [
          {
            key: 'privacy-choices',
            title: 'Privacy Choices',
            description: 'Consumer privacy preferences and controls.',
            href: '/legal/privacy-choices' as Href,
            testID: 'manifest-link-privacy-choices'
          },
          {
            key: 'terms',
            title: 'Terms',
            description: 'Platform terms and user obligations.',
            href: '/legal/terms' as Href,
            testID: 'manifest-link-terms'
          },
          {
            key: 'privacy',
            title: 'Privacy',
            description: 'Privacy policy and data handling.',
            href: '/legal/privacy' as Href,
            testID: 'manifest-link-privacy'
          }
        ]
      }
    ];
  }, [profileHref, viewerSessionQuery.data]);
  const manifestDockClearance = insets.bottom + MOBILE_DOCK_HEIGHT + MOBILE_DOCK_BOTTOM_OFFSET + 8;

  if (!showDock) {
    return null;
  }

  return (
    <>
      {manifestOpen ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 55
          }}
        >
          <Pressable
            testID="dock-manifest-backdrop"
            onPress={closeManifest}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.4)'
            }}
          />
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              justifyContent: 'flex-end',
              paddingBottom: manifestDockClearance
            }}
          >
            <Animated.View
              testID="dock-manifest"
              style={{
                maxHeight: '76%',
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderTopWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: theme.background,
                paddingTop: 12,
                shadowColor: '#000000',
                shadowOpacity: 0.28,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: -8 },
                elevation: 9,
                transform: [{ translateY: manifestSheetTranslateY }]
              }}
            >
              <View {...manifestHeaderPanResponder.panHandlers}>
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

                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 16 }}>
                  <View
                    style={{
                      flex: 1
                    }}
                  >
                    <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>Manifest</Text>
                    <Text style={{ color: theme.foreground, fontSize: 22, fontWeight: '800', marginTop: 4 }}>Customer dock</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 14, paddingTop: 2 }}>
                    {!isAuthed ? (
                      <HeaderActionLink
                        label="Sign in"
                        theme={theme}
                        testID="manifest-header-sign-in"
                        onPress={() => {
                          closeManifest();
                          router.push('/sign-in');
                        }}
                      />
                    ) : null}
                  </View>
                </View>
              </View>

              <ScrollView
                contentContainerStyle={{
                  gap: 18,
                  paddingHorizontal: 20,
                  paddingTop: 8,
                  paddingBottom: insets.bottom + 24
                }}
              >
                {!isPremium ? (
                  <ManifestPremiumCard
                    viewerId={viewerSessionQuery.data?.viewerId ?? null}
                    isAuthed={isAuthed}
                    theme={theme}
                    onClose={closeManifest}
                  />
                ) : null}
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
                            closeManifest();
                            if (item.externalUrl) {
                              await openExternalCustomerUrl(item.externalUrl);
                              return;
                            }
                            if (item.href) {
                              router.replace(item.href);
                            }
                          }}
                        />
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            </Animated.View>
          </View>
        </View>
      ) : null}

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
                testID="tab-feed"
                label="Feed"
                active={feedActive}
                onPress={() => {
                  replaceDockRoute(feedHref);
                }}
              >
                <HomeGlyph color={feedActive ? theme.accent : theme.foreground} />
              </DockButton>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <DockButton
                  testID="tab-calendar"
                  label="Calendar"
                  active={calendarActive}
                  onPress={() => {
                    toggleDockRoute(calendarActive, '/calendar');
                  }}
                >
                  <CalendarGlyph color={calendarActive ? theme.accent : theme.foreground} />
                </DockButton>
                <DockButton
                  testID="tab-search"
                  label="Search"
                  active={searchActive}
                  onPress={() => {
                    toggleDockRoute(searchActive, '/search');
                  }}
                >
                  <SearchGlyph color={searchActive ? theme.accent : theme.foreground} />
                </DockButton>
                <DockButton
                  testID="tab-profile"
                  label="Account"
                  active={profileActive}
                  onPress={() => {
                    toggleDockRoute(profileRootActive, profileHref);
                  }}
                >
                  {profileInitials ? (
                    <ProfileBadge initials={profileInitials} color={profileActive ? theme.accent : theme.foreground} />
                  ) : (
                    <UserGlyph color={profileActive ? theme.accent : theme.foreground} />
                  )}
                </DockButton>
              </View>

              <DockButton
                testID="dock-manifest-toggle"
                label="Manifest"
                active={manifestOpen}
                onPress={() => {
                  if (manifestOpen) {
                    closeManifest();
                    return;
                  }
                  manifestSheetTranslateY.stopAnimation();
                  manifestSheetTranslateY.setValue(0);
                  setManifestOpen(true);
                }}
              >
                <MenuGlyph color={manifestOpen ? theme.accent : theme.foreground} />
              </DockButton>
            </View>
          </View>
        </View>
      </View>
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
  children: ReactNode;
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
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={item.testID}
      onPress={onPress}
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
        <Text style={{ color: theme.muted, fontSize: 18, fontWeight: '700' }}>{'>'}</Text>
      </View>
    </Pressable>
  );
}

function ManifestPremiumCard({
  viewerId,
  isAuthed,
  theme,
  onClose
}: {
  viewerId: string | null;
  isAuthed: boolean;
  theme: { background: string; foreground: string; muted: string; accent: string; stroke: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const billing = useNativeBilling(viewerId);
  const premiumCheckoutReturnTo = useMemo(() => buildMobilePremiumCheckoutReturnTo('/account/membership'), []);
  const premiumUpgradeSignInHref = useMemo(
    () =>
      buildMobilePremiumUpgradeAuthHref('sign-in', {
        returnTo: buildMobilePremiumLegalHref({
          returnTo: premiumCheckoutReturnTo
        })
      }),
    [premiumCheckoutReturnTo]
  );

  return (
    <View
      testID="manifest-premium-card"
      style={{
        gap: 12,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: 'rgba(34, 211, 238, 0.22)',
        backgroundColor: 'rgba(12, 28, 40, 0.92)',
        paddingHorizontal: 16,
        paddingVertical: 16
      }}
    >
      <View style={{ gap: 8 }}>
        <CustomerShellBadge label="Premium" tone="accent" />
        <Text style={{ color: theme.foreground, fontSize: 19, fontWeight: '800' }}>Go Premium</Text>
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
          Unlock follows, saved views, recurring feeds, widgets, and advanced launch alerts from one place.
        </Text>
      </View>

      {billing.actionMessage ? <Text style={{ color: theme.accent, fontSize: 13, lineHeight: 19 }}>{billing.actionMessage}</Text> : null}
      {billing.actionError ? <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{billing.actionError}</Text> : null}

      <View style={{ gap: 10 }}>
        {billing.claim ? (
          <>
            <CustomerShellActionButton
              testID="manifest-premium-claim-sign-in"
              label="Sign in to claim Premium"
              onPress={() => {
                onClose();
                router.push(buildClaimAuthHref('/sign-in', billing.claim?.claimToken, billing.claim?.returnTo));
              }}
            />
            <CustomerShellActionButton
              testID="manifest-premium-claim-sign-up"
              label="Create account to claim Premium"
              variant="secondary"
              onPress={() => {
                onClose();
                router.push(buildClaimAuthHref('/sign-up', billing.claim?.claimToken, billing.claim?.returnTo));
              }}
            />
          </>
        ) : (
          <>
            <CustomerShellActionButton
              testID="manifest-premium-purchase"
              label={billing.isProcessingPurchase ? 'Working…' : 'Start Premium'}
              disabled={billing.isProcessingPurchase}
              onPress={() => {
                onClose();
                router.push(premiumCheckoutReturnTo as Href);
              }}
            />
            <CustomerShellActionButton
              testID="manifest-premium-sign-in"
              label="Sign in to existing account"
              variant="secondary"
              onPress={() => {
                onClose();
                router.push(premiumUpgradeSignInHref as Href);
              }}
            />
            {isAuthed ? (
              <CustomerShellActionButton
                testID="manifest-premium-restore"
                label="Restore purchases"
                variant="secondary"
                disabled={billing.isProcessingPurchase}
                onPress={() => {
                  onClose();
                  router.push('/account/membership' as Href);
                }}
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function HeaderActionLink({
  label,
  theme,
  onPress,
  testID,
  icon
}: {
  label: string;
  theme: { background: string; foreground: string; muted: string; accent: string; stroke: string };
  onPress: () => void;
  testID?: string;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.72 : 1
      })}
    >
      {icon}
      <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
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
          bottom: 1,
          width: 6,
          height: 1.6,
          borderRadius: 999,
          backgroundColor: color,
          transform: [{ rotate: '45deg' }]
        }}
      />
    </View>
  );
}

function CalendarGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18 }}>
      <View
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          right: 2,
          bottom: 2,
          borderWidth: 1.6,
          borderColor: color,
          borderRadius: 4
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          right: 2,
          height: 4,
          borderTopLeftRadius: 4,
          borderTopRightRadius: 4,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0.75,
          left: 5,
          width: 1.8,
          height: 4,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0.75,
          right: 5,
          width: 1.8,
          height: 4,
          borderRadius: 999,
          backgroundColor: color
        }}
      />
      {[
        [5, 8],
        [10, 8],
        [5, 11.5],
        [10, 11.5]
      ].map(([left, top], index) => (
        <View
          key={index}
          style={{
            position: 'absolute',
            left,
            top,
            width: 2.2,
            height: 2.2,
            borderRadius: 0.8,
            backgroundColor: color
          }}
        />
      ))}
    </View>
  );
}

function MenuGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18, justifyContent: 'center', gap: 3 }}>
      {[0, 1, 2].map((line) => (
        <View key={line} style={{ height: 1.8, borderRadius: 999, backgroundColor: color }} />
      ))}
    </View>
  );
}

function UserGlyph({ color }: { color: string }) {
  return (
    <View style={{ height: 18, width: 18, alignItems: 'center' }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          borderWidth: 1.6,
          borderColor: color
        }}
      />
      <View
        style={{
          marginTop: 2,
          width: 12,
          height: 7,
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          borderWidth: 1.6,
          borderBottomWidth: 0,
          borderColor: color
        }}
      />
    </View>
  );
}
