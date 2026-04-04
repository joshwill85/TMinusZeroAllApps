import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useLaunchFaaAirspaceMapQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { EmptyStateCard, ErrorStateCard, LoadingStateCard } from '@/src/components/SectionCard';
import { NativeLaunchMapViewport } from '@/src/components/launch/NativeLaunchMapCard';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { buildPlatformPadMapUrl } from '@/src/utils/mapLinks';

function getLaunchId(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function LaunchFaaMapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const launchId = getLaunchId(params.id);
  const { theme } = useMobileBootstrap();
  const mapQuery = useLaunchFaaAirspaceMapQuery(launchId, { enabled: Boolean(launchId) });

  const mapData = mapQuery.data ?? null;
  const padMapUrl = buildPlatformPadMapUrl(
    {
      latitude: mapData?.pad.latitude,
      longitude: mapData?.pad.longitude,
      label: mapData?.pad.shortCode || mapData?.pad.label || 'Launch pad'
    },
    Platform.OS
  );

  let content: JSX.Element;
  if (!launchId) {
    content = <EmptyStateCard title="Missing launch id" body="A launch FAA map route was opened without an id parameter." />;
  } else if (mapQuery.isPending) {
    content = <LoadingStateCard title="Loading FAA map" body={`Fetching /api/v1/launches/${launchId}/faa-airspace-map.`} />;
  } else if (mapQuery.isError) {
    content = <ErrorStateCard title="FAA map unavailable" body="The launch-day FAA map could not be loaded right now." />;
  } else if (!mapData) {
    content = <EmptyStateCard title="FAA map unavailable" body="No FAA launch map data was returned for this launch." />;
  } else {
    content = (
      <View style={{ gap: 16 }}>
        <View
          style={{
            borderRadius: 20,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            overflow: 'hidden'
          }}
        >
          <NativeLaunchMapViewport
            advisoriesJson={JSON.stringify(mapData.advisories)}
            boundsJson={mapData.bounds ? JSON.stringify(mapData.bounds) : null}
            padJson={JSON.stringify(mapData.pad)}
            height={420}
            interactive
            renderMode="faa"
          />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {padMapUrl ? (
            <ActionButton
              themeAccent={theme.accent}
              borderColor={theme.accent}
              label="Open pad in Maps"
              onPress={() => {
                void Linking.openURL(padMapUrl);
              }}
            />
          ) : null}
          <ActionButton
            themeAccent={theme.foreground}
            borderColor={theme.stroke}
            label="Back to launch"
            onPress={() => router.back()}
          />
        </View>

        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.stroke,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            padding: 14,
            gap: 10
          }}
        >
          <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Launch-day FAA advisories</Text>
          {mapData.advisories.map((advisory) => (
            <View
              key={advisory.matchId}
              style={{
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                padding: 12,
                gap: 4
              }}
            >
              <Text style={{ color: theme.foreground, fontSize: 14, fontWeight: '700' }}>{advisory.title}</Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {[advisory.notamId, advisory.facility, advisory.type].filter(Boolean).join(' • ')}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {advisory.polygons.length} polygon{advisory.polygons.length === 1 ? '' : 's'}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <AppScreen scroll={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32 }}
      >
        <View style={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <View>
              <Text style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>FAA zone map</Text>
              <Text style={{ color: theme.foreground, fontSize: 24, fontWeight: '800', marginTop: 4 }}>Launch-day geometry</Text>
            </View>
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Text style={{ color: theme.accent, fontSize: 13, fontWeight: '700' }}>Close</Text>
            </Pressable>
          </View>

          {content}
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function ActionButton({
  label,
  onPress,
  borderColor,
  themeAccent
}: {
  label: string;
  onPress: () => void;
  borderColor: string;
  themeAccent: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor,
        paddingHorizontal: 14,
        paddingVertical: 9
      }}
    >
      <Text style={{ color: themeAccent, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
    </Pressable>
  );
}
