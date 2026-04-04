import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { normalizeSpaceXMissionParam, SpaceXMissionScreen } from '@/src/features/programHubs/spacexScreens';
import { StarshipHubScreen } from '@/src/features/programHubs/starshipScreens';

export default function SpaceXMissionRoute() {
  const params = useLocalSearchParams<{ mission?: string | string[] }>();
  const mission = normalizeSpaceXMissionParam(params.mission);

  if (!mission) {
    return (
      <AppScreen testID="spacex-mission-invalid-screen">
        <CustomerShellPanel title="Mission unavailable" description="The requested SpaceX mission route is not valid." />
      </AppScreen>
    );
  }

  if (mission === 'starship') {
    return <StarshipHubScreen />;
  }

  return <SpaceXMissionScreen mission={mission} />;
}
