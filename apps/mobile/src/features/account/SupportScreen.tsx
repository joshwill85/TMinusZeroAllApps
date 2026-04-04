import { Linking, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { getPublicSiteUrl } from '@/src/config/api';
import { MOBILE_SUPPORT_EMAIL } from '@/src/features/account/constants';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export function SupportScreen() {
  const router = useRouter();
  const { theme } = useMobileBootstrap();
  const publicSiteUrl = getPublicSiteUrl();
  const supportUrl = `${publicSiteUrl}/support`;

  async function openMail() {
    await Linking.openURL(`mailto:${MOBILE_SUPPORT_EMAIL}`);
  }

  return (
    <AppScreen testID="support-screen">
      <CustomerShellHero
        eyebrow="Support"
        title="Help & Contact"
        description="Customer support, billing guidance, privacy requests, and the fastest self-serve paths for the native app."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Customer support" tone="accent" />
          <CustomerShellBadge label="Native + web" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Contact us" description="Use email for bug reports, account help, billing questions, feature requests, and privacy requests.">
        <View style={{ gap: 10 }}>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            Email {MOBILE_SUPPORT_EMAIL}. Include the account email you use in the app, your device type, app version, and clear reproduction steps when reporting an issue.
          </Text>
          <CustomerShellActionButton label="Email support" onPress={() => void openMail()} />
          <CustomerShellActionButton
            label="Open support center"
            variant="secondary"
            onPress={() => {
              void openExternalCustomerUrl(supportUrl);
            }}
          />
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Fast self-serve paths" description="These flows are already available in the app and should be the first stop for common account or policy requests.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton label="Privacy choices" onPress={() => router.push('/legal/privacy-choices' as Href)} />
          <CustomerShellActionButton label="Privacy notice" variant="secondary" onPress={() => router.push('/legal/privacy' as Href)} />
          <CustomerShellActionButton label="Terms of service" variant="secondary" onPress={() => router.push('/legal/terms' as Href)} />
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            The native Privacy Choices screen covers account export and deletion. Browser-specific media and cookie controls stay on the web support and privacy pages.
          </Text>
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Billing and subscriptions" description="Premium billing stays native on mobile and should be managed through the correct billing provider.">
        <View style={{ gap: 8 }}>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            Use Account to purchase Premium, restore purchases, or open store management for App Store or Google Play billing.
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
            If you delete your account, cancel any active App Store or Google Play subscription in the store first if you do not want renewal to continue.
          </Text>
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}
