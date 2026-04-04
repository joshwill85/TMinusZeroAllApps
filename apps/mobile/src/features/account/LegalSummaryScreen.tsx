import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { MOBILE_SUPPORT_EMAIL } from '@/src/features/account/constants';
import { openExternalCustomerUrl } from '@/src/features/customerRoutes/shared';

type LegalSummarySection = {
  title: string;
  body: string;
  bullets?: string[];
};

type LegalSummaryAction = {
  label: string;
  href?: string;
  externalUrl?: string;
  variant?: 'primary' | 'secondary';
};

export function LegalSummaryScreen({
  eyebrow,
  title,
  description,
  lastUpdated,
  sections,
  actions = [],
  testID
}: {
  eyebrow: string;
  title: string;
  description: string;
  lastUpdated: string;
  sections: LegalSummarySection[];
  actions?: LegalSummaryAction[];
  testID: string;
}) {
  const router = useRouter();

  return (
    <AppScreen testID={testID}>
      <CustomerShellHero eyebrow={eyebrow} title={title} description={description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native legal" tone="accent" />
          <CustomerShellBadge label={lastUpdated} />
        </View>
      </CustomerShellHero>

      {actions.length > 0 ? (
        <CustomerShellPanel title="Related actions" description="Open the connected customer surfaces that are already native on mobile.">
          <View style={{ gap: 10 }}>
            {actions.map((action) => (
              <CustomerShellActionButton
                key={`${action.label}:${action.href || action.externalUrl || 'action'}`}
                label={action.label}
                variant={action.variant ?? 'primary'}
                onPress={() => {
                  if (action.externalUrl) {
                    void openExternalCustomerUrl(action.externalUrl);
                    return;
                  }
                  if (action.href) {
                    router.push(action.href as Href);
                  }
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {sections.map((section) => (
        <CustomerShellPanel key={section.title} title={section.title} description={section.body}>
          {section.bullets?.length ? (
            <View style={{ gap: 8 }}>
              {section.bullets.map((bullet) => (
                <Text key={bullet} style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
                  • {bullet}
                </Text>
              ))}
            </View>
          ) : null}
        </CustomerShellPanel>
      ))}

      <CustomerShellPanel title="Contact" description={`For formal legal or privacy questions, contact ${MOBILE_SUPPORT_EMAIL}.`} />
    </AppScreen>
  );
}
