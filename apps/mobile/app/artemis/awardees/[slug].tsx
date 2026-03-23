import { useLocalSearchParams } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellPanel } from '@/src/components/CustomerShell';
import { ArtemisAwardeeDetailScreen, normalizeArtemisAwardeeSlugParam } from '@/src/features/programHubs/artemisExtendedScreens';

export default function ArtemisAwardeeDetailRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[] }>();
  const slug = normalizeArtemisAwardeeSlugParam(params.slug);

  if (!slug) {
    return (
      <AppScreen testID="artemis-awardee-invalid-screen">
        <CustomerShellPanel title="Awardee unavailable" description="The requested Artemis awardee profile is not valid." />
      </AppScreen>
    );
  }

  return <ArtemisAwardeeDetailScreen slug={slug} />;
}
