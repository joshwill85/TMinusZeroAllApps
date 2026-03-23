import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXFlightParam, SpaceXFlightRouteScreen } from '@/src/features/programHubs/spacexDetailScreens';

export default function SpaceXFlightRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeSpaceXFlightParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="spacex-flight-route-invalid-screen">
        <CustomerShellPanel title="Flight unavailable" description="The requested SpaceX flight route is not valid." />
      </AppScreen>
    );
  }

  return <SpaceXFlightRouteScreen slug={slug} />;
}
