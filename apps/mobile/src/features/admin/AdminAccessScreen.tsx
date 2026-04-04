import { useState } from 'react';
import { Text, View } from 'react-native';
import { ApiClientError } from '@tminuszero/api-client';
import { resolveAdminAccessOverrideErrorMessage } from '@tminuszero/domain';
import { useAdminAccessOverrideQuery, useUpdateAdminAccessOverrideMutation, useViewerEntitlementsQuery } from '@/src/api/queries';
import { AppScreen } from '@/src/components/AppScreen';
import { CustomerShellActionButton, CustomerShellBadge, CustomerShellHero, CustomerShellMetric, CustomerShellPanel } from '@/src/components/CustomerShell';

export function AdminAccessScreen() {
  const entitlementsQuery = useViewerEntitlementsQuery();
  const adminAccessOverrideQuery = useAdminAccessOverrideQuery();
  const updateAdminAccessOverrideMutation = useUpdateAdminAccessOverrideMutation();

  const adminAccessState = adminAccessOverrideQuery.data ?? null;
  const adminAccessOverride = adminAccessState?.adminAccessOverride ?? entitlementsQuery.data?.adminAccessOverride ?? null;
  const effectiveTier = adminAccessState?.effectiveTier ?? entitlementsQuery.data?.tier ?? 'anon';
  const effectiveTierSource = adminAccessState?.effectiveTierSource ?? entitlementsQuery.data?.effectiveTierSource ?? 'guest';
  const billingIsPaid = adminAccessState?.billingIsPaid ?? (entitlementsQuery.data?.billingIsPaid === true);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateAdminAccessOverride(next: 'anon' | 'premium' | null) {
    setMessage(null);
    setError(null);
    try {
      await updateAdminAccessOverrideMutation.mutateAsync({ adminAccessOverride: next });
      setMessage(
        next === null ? 'Default customer access restored.' : next === 'premium' ? 'Full-access test mode is active.' : 'Public-access test mode is active.'
      );
    } catch (nextError) {
      const fallback = nextError instanceof Error ? nextError.message : 'Unable to update admin access.';
      const code = nextError instanceof ApiClientError ? nextError.code : null;
      setError(resolveAdminAccessOverrideErrorMessage(code, fallback));
    }
  }

  const controlsDisabled = adminAccessOverrideQuery.isPending || updateAdminAccessOverrideMutation.isPending;

  return (
    <AppScreen testID="admin-access-screen">
      <CustomerShellHero
        eyebrow="Admin"
        title="Customer access testing"
        description="Switch this admin account between public and full customer access. Billing records and admin permissions stay unchanged."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Admin" />
          <CustomerShellBadge label={formatAdminAccessLabel(effectiveTier)} tone={effectiveTier === 'premium' ? 'accent' : 'default'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Current state" description="This changes customer access across web, iOS, and Android for the signed-in admin account.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric label="Current access" value={formatAdminAccessLabel(effectiveTier)} caption={formatAdminSourceLabel(effectiveTierSource)} />
          <CustomerShellMetric label="Real billing" value={billingIsPaid ? 'Active' : 'Inactive'} caption="Store or web subscription state" />
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Override" description="Pick the customer access mode to test on this account.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label={adminAccessOverride === null ? 'Using default' : 'Use default'}
            variant={adminAccessOverride === null ? 'primary' : 'secondary'}
            disabled={controlsDisabled}
            onPress={() => {
              void updateAdminAccessOverride(null);
            }}
          />
          <CustomerShellActionButton
            label={adminAccessOverride === 'anon' ? 'Public mode active' : 'Switch to public'}
            variant={adminAccessOverride === 'anon' ? 'primary' : 'secondary'}
            disabled={controlsDisabled}
            onPress={() => {
              void updateAdminAccessOverride('anon');
            }}
          />
          <CustomerShellActionButton
            label={adminAccessOverride === 'premium' ? 'Full-access mode active' : 'Switch to full access'}
            variant={adminAccessOverride === 'premium' ? 'primary' : 'secondary'}
            disabled={controlsDisabled}
            onPress={() => {
              void updateAdminAccessOverride('premium');
            }}
          />
          {message ? <Text style={{ color: '#7ff0bc', fontSize: 13, lineHeight: 19 }}>{message}</Text> : null}
          {error ? <Text style={{ color: '#ff9087', fontSize: 13, lineHeight: 19 }}>{error}</Text> : null}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function formatAdminAccessLabel(value: string) {
  return value === 'premium' ? 'Full access' : 'Public access';
}

function formatAdminSourceLabel(value: string) {
  if (value === 'admin_override') return 'Manual override';
  if (value === 'admin') return 'Admin default';
  if (value === 'subscription') return 'Paid subscription';
  if (value === 'anon') return 'Public access';
  return 'Guest session';
}
