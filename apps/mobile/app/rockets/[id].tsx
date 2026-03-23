import { useLocalSearchParams } from 'expo-router';
import { RocketDetailRouteScreen } from '@/src/features/entityRoutes/EntityDetailScreen';
import { readRouteParam } from '@/src/features/entityRoutes/utils';

export default function RocketScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = readRouteParam(params.id);
  return <RocketDetailRouteScreen routeId={id} testID="rocket-screen" />;
}
