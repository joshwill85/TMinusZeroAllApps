import { useLocalSearchParams } from 'expo-router';
import { BlueOriginVehicleDetailScreen, normalizeBlueOriginVehicleParam } from '@/src/features/programHubs/blueOriginDetailScreens';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';

export default function BlueOriginVehicleDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeBlueOriginVehicleParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="blue-origin-vehicle-invalid-screen">
        <CustomerShellPanel title="Vehicle unavailable" description="The requested Blue Origin vehicle profile is not valid." />
      </AppScreen>
    );
  }

  return <BlueOriginVehicleDetailScreen slug={slug} />;
}
