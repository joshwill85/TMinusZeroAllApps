import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { useLaunchDetailQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { formatTimestamp, formatSearchResultLabel } from '@/src/utils/format';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchDetailScreen() {
  const { theme } = useMobileBootstrap();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const launchDetailQuery = useLaunchDetailQuery(launchId);
  const title = launchDetailQuery.data?.launch.name ?? 'Launch detail';

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.foreground,
          headerShadowVisible: false
        }}
      />
      <AppScreen>
        {!launchId ? (
          <EmptyStateCard title="Missing launch id" body="A launch detail route was opened without an id parameter." />
        ) : launchDetailQuery.isPending ? (
          <LoadingStateCard title="Loading launch detail" body={`Fetching /api/v1/launches/${launchId}.`} />
        ) : launchDetailQuery.isError ? (
          <ErrorStateCard title="Launch detail unavailable" body={launchDetailQuery.error.message} />
        ) : (
          <>
            <ScreenHeader
              eyebrow="Launch detail"
              title={launchDetailQuery.data.launch.name}
              description={launchDetailQuery.data.launch.mission ?? 'Mission details are still lightweight in the shared contract.'}
            />

            <SectionCard title="Overview">
              <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700' }}>
                {launchDetailQuery.data.launch.provider ?? 'Provider pending'}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
                Status: {launchDetailQuery.data.launch.status ?? 'Status pending'}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
                NET: {formatTimestamp(launchDetailQuery.data.launch.net)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
                Window: {formatTimestamp(launchDetailQuery.data.launch.windowStart)} to {formatTimestamp(launchDetailQuery.data.launch.windowEnd)}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, marginTop: 4 }}>
                Pad: {launchDetailQuery.data.launch.padName ?? 'Pad pending'}
              </Text>
            </SectionCard>

            <SectionCard title="Status and weather">
              <Text style={{ color: theme.foreground, fontSize: 15, lineHeight: 24 }}>
                {launchDetailQuery.data.launch.launchStatusDescription ?? 'No extended status description yet.'}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 22, marginTop: 8 }}>
                Weather: {launchDetailQuery.data.launch.weatherSummary ?? 'No weather summary available.'}
              </Text>
            </SectionCard>

            <SectionCard title="Access">
              <Text style={{ color: theme.foreground, fontSize: 15, lineHeight: 24 }}>
                {launchDetailQuery.data.entitlements.tier.toUpperCase()} · {launchDetailQuery.data.entitlements.status.replace('_', ' ')}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 14, marginTop: 6 }}>
                Source: {launchDetailQuery.data.entitlements.source}
              </Text>
            </SectionCard>

            {launchDetailQuery.data.related.length === 0 ? (
              <EmptyStateCard title="No related items" body="The shared detail contract did not include related links for this launch." />
            ) : (
              <SectionCard title="Related">
                {launchDetailQuery.data.related.map((item) => (
                  <SectionCard key={`${item.type}:${item.id}`} title={item.title} compact>
                    <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
                      {item.subtitle ?? formatSearchResultLabel(item.type)}
                    </Text>
                  </SectionCard>
                ))}
              </SectionCard>
            )}
          </>
        )}
      </AppScreen>
    </>
  );
}
