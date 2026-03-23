import { useLocalSearchParams } from 'expo-router';
import { SatelliteOwnerDetailScreen } from '@/src/features/customerRoutes/satellites';

export default function SatelliteOwnerDetailRouteScreen() {
  const params = useLocalSearchParams<{ owner?: string | string[] }>();
  const owner = Array.isArray(params.owner) ? params.owner[0] ?? '' : params.owner ?? '';

  return <SatelliteOwnerDetailScreen owner={owner} />;
}
