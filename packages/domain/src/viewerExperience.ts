import { getTierCapabilities, type ViewerTier } from './viewer';

export type ViewerCtaTarget = 'sign-in' | 'upgrade' | 'manage';

export type ViewerFeatureKey =
  | 'saved_items'
  | 'preferences'
  | 'launch_filters'
  | 'launch_calendar'
  | 'one_off_calendar'
  | 'live_feed'
  | 'change_log'
  | 'instant_alerts'
  | 'recurring_calendar_feeds'
  | 'rss_feeds'
  | 'embed_widgets'
  | 'ar_trajectory'
  | 'enhanced_forecast'
  | 'launch_day_email';

export type ViewerTierCard = {
  tier: ViewerTier;
  badgeLabel: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaTarget: ViewerCtaTarget;
};

export type ViewerFeatureManifestEntry = {
  key: ViewerFeatureKey;
  title: string;
  minimumTier: ViewerTier;
  blockedTitle: string;
  blockedDescription: string;
  ctaLabel: string;
  ctaTarget: ViewerCtaTarget;
};

export const viewerTierCardManifest: Record<ViewerTier, ViewerTierCard> = {
  anon: {
    tier: 'anon',
    badgeLabel: 'Anon',
    title: 'Browse now, sign in when you want control',
    description: 'Browse launches without an account, then sign in for faster refreshes, filters, calendar access, and basic alert controls across web, iPhone, and Android.',
    ctaLabel: 'Sign in',
    ctaTarget: 'sign-in'
  },
  free: {
    tier: 'free',
    badgeLabel: 'Free',
    title: 'Your account is active',
    description: 'Signed-in accounts unlock faster refreshes, launch filters, calendar access, one-off calendar adds, and basic mobile alert rules. Upgrade for saved presets, follows, browser alerts, and live operations tools.',
    ctaLabel: 'View Premium',
    ctaTarget: 'upgrade'
  },
  premium: {
    tier: 'premium',
    badgeLabel: 'Premium',
    title: 'Premium is active',
    description: 'Live refresh, saved presets, follows, advanced alerts, recurring feeds, and the full launch intelligence toolkit are available on this account.',
    ctaLabel: 'Manage plan',
    ctaTarget: 'manage'
  }
};

export const viewerFeatureManifest: Record<ViewerFeatureKey, ViewerFeatureManifestEntry> = {
  saved_items: {
    key: 'saved_items',
    title: 'Saved items',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks saved presets and follows',
    blockedDescription: 'Upgrade to keep saved filter presets, follows, and premium saved resources active across web, iPhone, and Android.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  preferences: {
    key: 'preferences',
    title: 'Preferences',
    minimumTier: 'free',
    blockedTitle: 'Preferences sync needs an account',
    blockedDescription: 'Sign in to manage notification settings, quiet hours, and account-level preferences.',
    ctaLabel: 'Sign in',
    ctaTarget: 'sign-in'
  },
  launch_filters: {
    key: 'launch_filters',
    title: 'Launch filters',
    minimumTier: 'free',
    blockedTitle: 'Sign in to unlock launch filters',
    blockedDescription: 'Create a free account to filter launches across web, iPhone, and Android.',
    ctaLabel: 'Sign in',
    ctaTarget: 'sign-in'
  },
  launch_calendar: {
    key: 'launch_calendar',
    title: 'Launch calendar',
    minimumTier: 'free',
    blockedTitle: 'Sign in to unlock the calendar',
    blockedDescription: 'Create a free account to browse the monthly launch calendar and open detailed schedule views.',
    ctaLabel: 'Sign in',
    ctaTarget: 'sign-in'
  },
  one_off_calendar: {
    key: 'one_off_calendar',
    title: 'One-off calendar export',
    minimumTier: 'free',
    blockedTitle: 'Sign in to add launches to your calendar',
    blockedDescription: 'Create a free account to add individual launches to your calendar from launch detail.',
    ctaLabel: 'Sign in',
    ctaTarget: 'sign-in'
  },
  live_feed: {
    key: 'live_feed',
    title: 'Live feed',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks the live feed',
    blockedDescription: 'Upgrade for the fastest refresh cadence and premium live launch coverage.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  change_log: {
    key: 'change_log',
    title: 'Change log',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks launch change tracking',
    blockedDescription: 'Upgrade to follow the detailed launch change log and status movements.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  instant_alerts: {
    key: 'instant_alerts',
    title: 'Instant alerts',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks advanced alerts',
    blockedDescription: 'Free accounts can use basic mobile alert rules. Upgrade for browser delivery plus preset-based and follow-based alerting.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  recurring_calendar_feeds: {
    key: 'recurring_calendar_feeds',
    title: 'Recurring calendar feeds',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks recurring calendar feeds',
    blockedDescription: 'Upgrade to generate persistent calendar feeds for your launch views.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  rss_feeds: {
    key: 'rss_feeds',
    title: 'RSS feeds',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks RSS feeds',
    blockedDescription: 'Upgrade to generate account-linked RSS feeds for launch tracking.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  embed_widgets: {
    key: 'embed_widgets',
    title: 'Embed widgets',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks embed widgets',
    blockedDescription: 'Upgrade to create and manage shareable launch widgets.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  ar_trajectory: {
    key: 'ar_trajectory',
    title: 'AR trajectory',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks AR trajectory',
    blockedDescription: 'Upgrade to access premium AR launch trajectory experiences where supported.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  enhanced_forecast: {
    key: 'enhanced_forecast',
    title: 'Enhanced forecast',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks enhanced forecast insights',
    blockedDescription: 'Upgrade for deeper forecast and operational launch context.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  },
  launch_day_email: {
    key: 'launch_day_email',
    title: 'Launch-day email',
    minimumTier: 'premium',
    blockedTitle: 'Premium unlocks launch-day email',
    blockedDescription: 'Upgrade to configure launch-day email delivery and premium account notifications.',
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade'
  }
};

const viewerTierRank: Record<ViewerTier, number> = {
  anon: 0,
  free: 1,
  premium: 2
};

export function getViewerTierCard(tier: ViewerTier) {
  return viewerTierCardManifest[tier];
}

export function canViewerAccessFeature(featureKey: ViewerFeatureKey, tier: ViewerTier) {
  return viewerTierRank[tier] >= viewerTierRank[viewerFeatureManifest[featureKey].minimumTier];
}

export function getViewerFeatureState(featureKey: ViewerFeatureKey, tier: ViewerTier) {
  const feature = viewerFeatureManifest[featureKey];

  return {
    ...feature,
    isAccessible: canViewerAccessFeature(featureKey, tier)
  };
}

export function getViewerTierSummary(tier: ViewerTier) {
  const capabilities = getTierCapabilities(tier);
  return {
    tier,
    card: getViewerTierCard(tier),
    capabilities
  };
}
