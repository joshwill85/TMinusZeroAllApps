import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellActionButton, CustomerShellBadge, CustomerShellHero, CustomerShellPanel } from '@/src/components/CustomerShell';

export function AccountRecoveryOnlyScreen({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  const router = useRouter();

  return (
    <AppScreen testID="account-recovery-only-screen">
      <CustomerShellHero eyebrow="Account" title={title} description={description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Billing recovery only" tone="warning" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel
        title="Premium required"
        description="This signed-in account currently has free access. Billing recovery, restore, support, privacy, and account deletion stay available until Premium is active again."
      >
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Membership & billing"
            onPress={() => {
              router.replace('/account/membership' as Href);
            }}
          />
          <CustomerShellActionButton
            label="Privacy & data"
            variant="secondary"
            onPress={() => {
              router.push('/legal/privacy-choices' as Href);
            }}
          />
          <CustomerShellActionButton
            label="Support"
            variant="secondary"
            onPress={() => {
              router.push('/support' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}
