import { useLocalSearchParams } from 'expo-router';
import { BlueOriginFlightRouteScreen, normalizeBlueOriginFlightParam } from '@/src/features/programHubs/blueOriginDetailScreens';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';

export default function BlueOriginFlightRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeBlueOriginFlightParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="blue-origin-flight-route-invalid-screen">
        <CustomerShellPanel title="Flight unavailable" description="The requested Blue Origin flight route is not valid." />
      </AppScreen>
    );
  }

  return <BlueOriginFlightRouteScreen slug={slug} />;
}
