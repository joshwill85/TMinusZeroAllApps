import { useLocalSearchParams } from 'expo-router';
import { PadDetailRouteScreen } from '@/src/features/entityRoutes/EntityDetailScreen';
import { readRouteParam } from '@/src/features/entityRoutes/utils';

export default function PadScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = readRouteParam(params.id);
  return <PadDetailRouteScreen routeId={id} testID="pad-screen" />;
}
