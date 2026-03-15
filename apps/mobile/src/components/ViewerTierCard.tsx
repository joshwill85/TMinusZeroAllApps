import { useRouter, type Href } from 'expo-router';
import {
  getViewerFeatureState,
  getViewerTierCard,
  type ViewerFeatureKey,
  type ViewerTier
} from '@tminuszero/domain';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellPanel
} from '@/src/components/CustomerShell';

type ViewerTierCardProps = {
  tier: ViewerTier;
  featureKey?: ViewerFeatureKey;
  href?: Href;
  onPress?: () => void;
  showAction?: boolean;
  testID?: string;
};

function resolveDefaultHref(ctaTarget: 'sign-in' | 'upgrade' | 'manage'): Href {
  if (ctaTarget === 'sign-in') {
    return '/sign-in';
  }
  return '/profile';
}

export function ViewerTierCard({
  tier,
  featureKey,
  href,
  onPress,
  showAction = true,
  testID
}: ViewerTierCardProps) {
  const router = useRouter();
  const tierCard = getViewerTierCard(tier);
  const featureState = featureKey ? getViewerFeatureState(featureKey, tier) : null;
  const title = featureState && !featureState.isAccessible ? featureState.blockedTitle : tierCard.title;
  const description = featureState && !featureState.isAccessible ? featureState.blockedDescription : tierCard.description;
  const actionLabel = featureState && !featureState.isAccessible ? featureState.ctaLabel : tierCard.ctaLabel;
  const ctaTarget = featureState && !featureState.isAccessible ? featureState.ctaTarget : tierCard.ctaTarget;
  const actionHref = href ?? resolveDefaultHref(ctaTarget);
  const badgeTone = tier === 'premium' ? 'accent' : tier === 'free' ? 'success' : 'warning';

  return (
    <CustomerShellPanel testID={testID} title={title} description={description}>
      <CustomerShellBadge label={tierCard.badgeLabel} tone={badgeTone} />
      {showAction ? (
        <CustomerShellActionButton
          label={actionLabel}
          onPress={() => {
            if (onPress) {
              onPress();
              return;
            }
            router.push(actionHref);
          }}
          testID={testID ? `${testID}-action` : undefined}
        />
      ) : null}
    </CustomerShellPanel>
  );
}
