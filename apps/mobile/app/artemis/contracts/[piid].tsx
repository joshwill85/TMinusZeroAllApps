import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { ArtemisContractDetailScreen, normalizeArtemisContractPiidParam } from '@/src/features/programHubs/artemisExtendedScreens';

export default function ArtemisContractDetailRoute() {
  const params = useLocalSearchParams<{ piid?: string | string[] }>();
  const piid = normalizeArtemisContractPiidParam(params.piid);

  if (!piid) {
    return (
      <AppScreen testID="artemis-contract-invalid-screen">
        <CustomerShellPanel title="Contract unavailable" description="The requested Artemis contract family is not valid." />
      </AppScreen>
    );
  }

  return <ArtemisContractDetailScreen piid={piid} />;
}
