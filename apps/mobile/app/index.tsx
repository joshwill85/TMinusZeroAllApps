import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildMobileRoute } from '@tminuszero/navigation';
import { Card, MetaRow, ScreenShell } from '@/src/components/ScreenShell';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';

const quickLinks = [
  { label: 'Feed', href: buildMobileRoute('launchFeed') },
  { label: 'Search', href: buildMobileRoute('search') },
  { label: 'Saved', href: buildMobileRoute('saved') },
  { label: 'Preferences', href: buildMobileRoute('preferences') },
  { label: 'Profile', href: buildMobileRoute('profile') },
  { label: 'Sign in', href: buildMobileRoute('authSignIn') }
];

export default function HomeScreen() {
  const { accessToken } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();

  return (
    <ScreenShell
      eyebrow="Three-platform shell"
      title="Native core routes are wired."
      subtitle="This mobile workspace now speaks to the shared /api/v1 layer through the shared API client and query policy."
    >
      <Card title="Bootstrap status">
        <MetaRow label="Access token" value={accessToken ? 'restored' : 'guest'} />
        <MetaRow label="Viewer role" value={sessionQuery.data?.role || 'guest'} />
        <MetaRow label="Entitlement tier" value={entitlementsQuery.data?.tier || 'anon'} />
      </Card>

      <View style={styles.grid}>
        {quickLinks.map((link) => (
          <Link key={link.label} href={link.href} asChild>
            <Pressable style={styles.linkCard}>
              <Text style={styles.linkLabel}>{link.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12
  },
  linkCard: {
    minWidth: '47%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: mobileColorTokens.surface,
    paddingHorizontal: 16,
    paddingVertical: 18
  },
  linkLabel: {
    color: mobileColorTokens.foreground,
    fontSize: 15,
    fontWeight: '700'
  }
});
