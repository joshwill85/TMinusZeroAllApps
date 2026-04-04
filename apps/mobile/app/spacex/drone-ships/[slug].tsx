import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXDroneShipParam } from '@/src/features/programHubs/spacexRoutes';
import { SpaceXDroneShipDetailScreen } from '@/src/features/programHubs/spacexDroneShipScreens';

export default function SpaceXDroneShipRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeSpaceXDroneShipParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="spacex-drone-ship-invalid-screen">
        <CustomerShellPanel title="Recovery asset unavailable" description="The requested drone-ship route is not valid." />
      </AppScreen>
    );
  }

  return <SpaceXDroneShipDetailScreen slug={slug} />;
}
