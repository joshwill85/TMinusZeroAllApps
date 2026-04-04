import { useRouter, type Href } from 'expo-router';
import {
  getMobileViewerFeatureState,
  getMobileViewerTierCard,
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
  isAuthed?: boolean;
  featureKey?: ViewerFeatureKey;
  href?: Href;
  onPress?: () => void;
  showAction?: boolean;
  showBadge?: boolean;
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
  isAuthed = false,
  featureKey,
  href,
  onPress,
  showAction = true,
  showBadge = true,
  testID
}: ViewerTierCardProps) {
  const router = useRouter();
  const tierCard = getMobileViewerTierCard(tier, { isAuthed });
  const featureState = featureKey ? getMobileViewerFeatureState(featureKey, tier, { isAuthed }) : null;
  if (featureState?.isAccessible && tier === 'premium') {
    return null;
  }
  const title = featureState && !featureState.isAccessible ? featureState.blockedTitle : tierCard.title;
  const description = featureState && !featureState.isAccessible ? featureState.blockedDescription : tierCard.description;
  const actionLabel = featureState && !featureState.isAccessible ? featureState.ctaLabel : tierCard.ctaLabel;
  const ctaTarget = featureState && !featureState.isAccessible ? featureState.ctaTarget : tierCard.ctaTarget;
  const actionHref = href ?? resolveDefaultHref(ctaTarget);
  const badgeTone = tier === 'premium' ? 'accent' : 'warning';

  return (
    <CustomerShellPanel testID={testID} title={title} description={description}>
      {showBadge ? <CustomerShellBadge label={tierCard.badgeLabel} tone={badgeTone} /> : null}
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
