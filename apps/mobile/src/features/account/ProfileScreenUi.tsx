import { Text, View } from 'react-native';
import { CustomerShellActionButton } from '@/src/components/CustomerShell';

export function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

export function formatTierLabel(tier: 'anon' | 'premium', isAuthed = false) {
  void isAuthed;
  if (tier === 'premium') {
    return 'Full access';
  }
  return 'Public';
}

export function buildAccessCaption({
  tier,
  isAuthed,
  effectiveTierSource,
  billingIsPaid
}: {
  tier: 'anon' | 'premium';
  isAuthed: boolean;
  effectiveTierSource: string;
  billingIsPaid: boolean;
}) {
  if (tier === 'premium' || billingIsPaid || effectiveTierSource === 'subscription') {
    return 'All features are active on this account.';
  }
  return isAuthed ? 'This account currently uses public access.' : 'Public access is active on this device.';
}

export function formatEffectiveTierSource(value: string) {
  if (value === 'admin_override') {
    return 'Included access';
  }
  if (value === 'admin') {
    return 'Included access';
  }
  if (value === 'subscription') {
    return 'Paid subscription';
  }
  if (value === 'anon') {
    return 'Public access';
  }
  return 'Guest session';
}

export function formatMembershipStatusLabel({
  tier,
  effectiveTierSource,
  status,
  cancelAtPeriodEnd
}: {
  tier: 'anon' | 'premium';
  effectiveTierSource: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase();

  void effectiveTierSource;
  if (normalizedStatus === 'past_due' || normalizedStatus === 'unpaid' || normalizedStatus === 'incomplete') {
    return 'Billing issue';
  }
  if (normalizedStatus === 'canceled' || normalizedStatus === 'expired' || normalizedStatus === 'incomplete_expired') {
    return 'Canceled';
  }
  if (tier === 'premium') {
    return cancelAtPeriodEnd ? 'Cancels at period end' : 'Active';
  }
  return 'Public access';
}

export function buildMembershipStatusCaption({
  tier,
  isAuthed,
  effectiveTierSource,
  currentPeriodEnd,
  cancelAtPeriodEnd
}: {
  tier: 'anon' | 'premium';
  isAuthed: boolean;
  effectiveTierSource: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}) {
  void effectiveTierSource;
  if (currentPeriodEnd) {
    return cancelAtPeriodEnd ? `Access is scheduled to end on ${formatDate(currentPeriodEnd)}.` : `Renews on ${formatDate(currentPeriodEnd)}.`;
  }
  if (tier === 'premium') {
    return isAuthed ? 'Full access is active on this account.' : 'Full access is active on this device.';
  }
  return isAuthed ? 'Premium can be purchased or restored on this device.' : 'Sign in to manage purchases and profile details.';
}

export function formatBillingProvider(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatBillingStatus(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isStoreManagedBillingProvider(value: string) {
  return value === 'apple_app_store' || value === 'google_play';
}

export function formatManagementProviderLabel(value: string) {
  if (value === 'apple_app_store') {
    return 'App Store';
  }
  if (value === 'google_play') {
    return 'Google Play';
  }
  return 'store';
}

export function buildBillingMessage(provider: string, isPaid: boolean, isStoreReady: boolean) {
  if (provider === 'stripe' && isPaid) {
    return 'This subscription is billed on the web. Billing changes are not available inside the iOS or Android app.';
  }
  if (provider === 'apple_app_store' && isPaid) {
    return 'Manage or cancel this subscription in the App Store.';
  }
  if (provider === 'google_play' && isPaid) {
    return 'Manage or cancel this subscription in Google Play.';
  }
  if (isStoreReady) {
    return 'Native billing is available on this device. Pricing, renewal terms, and legal links appear below before purchase.';
  }
  return 'Store billing is not available for this platform or current build configuration yet.';
}

export function BillingPurchaseNotice({
  displayName,
  priceLabel,
  provider,
  onOpenPrivacy,
  onOpenTerms
}: {
  displayName: string | null | undefined;
  priceLabel: string | null | undefined;
  provider: string;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}) {
  const storeLabel = formatManagementProviderLabel(provider);

  return (
    <View
      style={{
        gap: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(111, 232, 255, 0.18)',
        backgroundColor: 'rgba(111, 232, 255, 0.06)',
        paddingHorizontal: 14,
        paddingVertical: 14
      }}
    >
      <Text style={{ color: '#eaf0ff', fontSize: 15, fontWeight: '700' }}>{displayName || 'Premium'}</Text>
      <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
        {priceLabel ? `${priceLabel} billed through ${storeLabel}.` : `Price is shown by ${storeLabel} before you confirm purchase.`}
      </Text>
      <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
        Auto-renewing subscription. Renews until canceled. Manage or cancel from {storeLabel} settings after purchase.
      </Text>
      <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>
        By continuing, you agree to the Terms of Service and acknowledge the Privacy Notice.
      </Text>
      <CustomerShellActionButton label="Terms of service" variant="secondary" onPress={onOpenTerms} />
      <CustomerShellActionButton label="Privacy notice" variant="secondary" onPress={onOpenPrivacy} />
    </View>
  );
}
