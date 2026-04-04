import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeStarshipFlightParam } from '@/src/features/programHubs/spacexRoutes';
import { StarshipFlightScreen } from '@/src/features/programHubs/starshipScreens';

export default function StarshipFlightRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeStarshipFlightParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="starship-flight-invalid-screen">
        <CustomerShellPanel title="Flight unavailable" description="The requested Starship flight route is not valid." />
      </AppScreen>
    );
  }

  return <StarshipFlightScreen slug={slug} />;
}
