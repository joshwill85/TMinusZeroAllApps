import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { buildSearchHref } from '@tminuszero/navigation';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';

type EntityRouteLandingProps = {
  eyebrow: string;
  title: string;
  description: string;
  searchQuery: string;
  canonicalWebPath: string;
  testID: string;
};

export function EntityRouteLanding({
  eyebrow,
  title,
  description,
  searchQuery,
  canonicalWebPath: _canonicalWebPath,
  testID
}: EntityRouteLandingProps) {
  const router = useRouter();
  void _canonicalWebPath;

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow={eyebrow} title={title} description={description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native route" tone="accent" />
          <CustomerShellBadge label="P0.1" tone="success" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Native handoff available"
        description="This deep link now stays in-app. Continue with native search until the richer destination screen ships."
      >
        <CustomerShellActionButton
          label="Search launches in app"
          onPress={() => {
            router.push(buildSearchHref(searchQuery) as Href);
          }}
        />
      </CustomerShellPanel>
    </AppScreen>
  );
}
