import { useLocalSearchParams } from 'expo-router';
import { BlueOriginTravelerDetailScreen, normalizeBlueOriginTravelerParam } from '@/src/features/programHubs/blueOriginDetailScreens';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';

export default function BlueOriginTravelerDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeBlueOriginTravelerParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="blue-origin-traveler-invalid-screen">
        <CustomerShellPanel title="Traveler unavailable" description="The requested Blue Origin traveler profile is not valid." />
      </AppScreen>
    );
  }

  return <BlueOriginTravelerDetailScreen slug={slug} />;
}
