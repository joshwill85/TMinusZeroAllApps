import { Text } from 'react-native';
import { buildMobileRoute } from '@tminuszero/navigation';
import type { Href } from 'expo-router';
import { useProfileQuery, useViewerEntitlementsQuery, useViewerSessionQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { SignInPrompt } from '@/src/components/SignInPrompt';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { formatBooleanState, formatRoleLabel } from '@/src/utils/format';

export default function ProfileScreen() {
  const { accessToken, theme } = useMobileBootstrap();
  const sessionQuery = useViewerSessionQuery();
  const entitlementsQuery = useViewerEntitlementsQuery();
  const profileQuery = useProfileQuery();

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Account"
        title="Profile"
        description="Viewer session, entitlement state, and authenticated profile data all come through the shared mobile API client."
      />

      {sessionQuery.isPending ? (
        <LoadingStateCard title="Viewer session" body="Resolving the shared session envelope." />
      ) : sessionQuery.isError ? (
        <ErrorStateCard title="Viewer session unavailable" body={sessionQuery.error.message} />
      ) : (
        <SectionCard title="Viewer session" description="Normalized cookie-or-bearer session contract.">
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
            {sessionQuery.data.email ?? 'Guest viewer'}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
            Role: {formatRoleLabel(sessionQuery.data.role)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
            Auth mode: {sessionQuery.data.authMode}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
            Secure token restored: {formatBooleanState(Boolean(accessToken))}
          </Text>
        </SectionCard>
      )}

      {entitlementsQuery.isPending ? (
        <LoadingStateCard title="Entitlements" body="Reading /api/v1/viewer/entitlements." />
      ) : entitlementsQuery.isError ? (
        <ErrorStateCard title="Entitlements unavailable" body={entitlementsQuery.error.message} />
      ) : (
        <SectionCard title="Entitlements" description="Provider-neutral access state.">
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
            {entitlementsQuery.data.tier.toUpperCase()}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
            {entitlementsQuery.data.status.replace('_', ' ')} via {entitlementsQuery.data.source}
          </Text>
        </SectionCard>
      )}

      {!accessToken ? (
        <SignInPrompt
          body="Authenticated profile data stays behind bearer auth. The read-only guest contract above still confirms that the shell is connected."
          href={buildMobileRoute('authSignIn') as Href}
        />
      ) : profileQuery.isPending ? (
        <LoadingStateCard title="Profile data" body="Fetching /api/v1/me/profile." />
      ) : profileQuery.isError ? (
        <ErrorStateCard title="Profile unavailable" body={profileQuery.error.message} />
      ) : (
        <SectionCard title="Profile data" description="Account information currently exposed to mobile.">
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
            {[profileQuery.data.firstName, profileQuery.data.lastName].filter(Boolean).join(' ') || 'Name not set'}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>{profileQuery.data.email}</Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
            Role: {formatRoleLabel(profileQuery.data.role)}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
            Timezone: {profileQuery.data.timezone ?? 'Not set'}
          </Text>
        </SectionCard>
      )}
    </AppScreen>
  );
}
