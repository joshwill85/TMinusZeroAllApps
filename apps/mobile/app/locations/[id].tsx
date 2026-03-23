import { useLocalSearchParams } from 'expo-router';
import { LocationDetailRouteScreen } from '@/src/features/entityRoutes/EntityDetailScreen';
import { readRouteParam } from '@/src/features/entityRoutes/utils';

export default function LocationScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = readRouteParam(params.id);
  return <LocationDetailRouteScreen routeId={id} testID="location-screen" />;
}
