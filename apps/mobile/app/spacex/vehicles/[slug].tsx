import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXVehicleParam, SpaceXVehicleDetailScreen } from '@/src/features/programHubs/spacexDetailScreens';

export default function SpaceXVehicleDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeSpaceXVehicleParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="spacex-vehicle-invalid-screen">
        <CustomerShellPanel title="Vehicle unavailable" description="The requested SpaceX vehicle profile is not valid." />
      </AppScreen>
    );
  }

  return <SpaceXVehicleDetailScreen slug={slug} />;
}
