import { Pressable, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

const PROVIDER_QUICK_LINKS = [
  { slug: 'spacex', label: 'SpaceX' },
  { slug: 'blue-origin', label: 'Blue Origin' },
  { slug: 'nasa', label: 'NASA' },
  { slug: 'united-launch-alliance-ula', label: 'ULA' },
  { slug: 'rocket-lab', label: 'Rocket Lab' }
];

export default function LaunchProvidersIndexScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();

  return (
    <AppScreen testID="launch-providers-index-screen">
      <CustomerShellHero
        eyebrow="Provider Directory"
        title="Launch Providers"
        description="Native entry route for provider schedules. Pick a provider to continue."
      />

      <CustomerShellPanel title="Quick links">
        <View style={{ gap: 10 }}>
          {PROVIDER_QUICK_LINKS.map((provider) => (
            <Pressable
              key={provider.slug}
              onPress={() => {
                router.push((`/launch-providers/${provider.slug}`) as Href);
              }}
              style={({ pressed }) => ({
                borderRadius: 16,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
                paddingHorizontal: 14,
                paddingVertical: 12
              })}
            >
              <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>{provider.label}</Text>
            </Pressable>
          ))}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}
