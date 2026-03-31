import { getTierCapabilities, type ViewerTier } from './viewer';

export type ViewerCtaTarget = 'sign-in' | 'upgrade' | 'manage';
export type ViewerAccessContext = {
  isAuthed?: boolean;
};

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
  | 'enhanced_forecast';

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
    badgeLabel: 'Public',
    title: 'Browse on mobile without an account',
    description:
      'Browse launches, use filters, and open the calendar without an account. Premium unlocks follows, saved views, recurring calendar feeds, and advanced notifications.',
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
    minimumTier: 'anon',
    blockedTitle: 'Preferences are available on mobile',
    blockedDescription: 'Notification settings and device controls are available from this screen.',
    ctaLabel: 'Open settings',
    ctaTarget: 'manage'
  },
  launch_filters: {
    key: 'launch_filters',
    title: 'Launch filters',
    minimumTier: 'anon',
    blockedTitle: 'Launch filters are available',
    blockedDescription: 'Everyone on mobile can filter launches. Premium adds saved views and default filters.',
    ctaLabel: 'View Premium',
    ctaTarget: 'upgrade'
  },
  launch_calendar: {
    key: 'launch_calendar',
    title: 'Launch calendar',
    minimumTier: 'anon',
    blockedTitle: 'Launch calendar is available',
    blockedDescription: 'Everyone on mobile can browse the launch calendar. Premium adds recurring calendar feeds.',
    ctaLabel: 'View Premium',
    ctaTarget: 'upgrade'
  },
  one_off_calendar: {
    key: 'one_off_calendar',
    title: 'One-off calendar export',
    minimumTier: 'anon',
    blockedTitle: 'One-off calendar export is available',
    blockedDescription: 'Anyone on mobile can add an individual launch to a calendar from launch detail.',
    ctaLabel: 'View Premium',
    ctaTarget: 'upgrade'
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
    blockedDescription: 'Upgrade to enable launch reminders, follow scopes, preset-driven alerts, and status-change notifications on this account.',
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
  }
};

const viewerTierRank: Record<ViewerTier, number> = {
  anon: 0,
  premium: 1
};

export function getViewerTierCard(tier: ViewerTier) {
  return viewerTierCardManifest[normalizeViewerTierForDisplay(tier)];
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

export function getMobileViewerTierCard(tier: ViewerTier, context: ViewerAccessContext = {}) {
  const normalizedTier = normalizeViewerTierForDisplay(tier);
  if (normalizedTier !== 'anon' || !context.isAuthed) {
    return getViewerTierCard(normalizedTier);
  }

  return {
    ...viewerTierCardManifest.anon,
    badgeLabel: 'Signed in',
    title: 'You are signed in without Premium',
    description:
      'Your account is active. Upgrade to unlock follows, saved views, default filters, recurring calendar feeds, and advanced notifications on iPhone and Android.',
    ctaLabel: 'View Premium',
    ctaTarget: 'upgrade' as const
  };
}

export function getMobileViewerFeatureState(
  featureKey: ViewerFeatureKey,
  tier: ViewerTier,
  context: ViewerAccessContext = {}
) {
  const feature = getViewerFeatureState(featureKey, tier);
  if (feature.isAccessible || tier !== 'anon' || !context.isAuthed || feature.ctaTarget !== 'sign-in') {
    return feature;
  }

  return {
    ...feature,
    ctaLabel: 'Upgrade',
    ctaTarget: 'upgrade' as const
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

function normalizeViewerTierForDisplay(tier: ViewerTier): ViewerTier {
  return tier;
}
