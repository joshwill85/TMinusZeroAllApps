export type ViewerTier = 'anon' | 'free' | 'premium';
export type ViewerMode = 'public' | 'live';

export type ViewerCapabilities = {
  canUseSavedItems: boolean;
  canUseLaunchFilters: boolean;
  canUseLaunchCalendar: boolean;
  canUseOneOffCalendar: boolean;
  canUseLiveFeed: boolean;
  canUseChangeLog: boolean;
  canUseInstantAlerts: boolean;
  canManageFilterPresets: boolean;
  canManageFollows: boolean;
  canUseBasicAlertRules: boolean;
  canUseAdvancedAlertRules: boolean;
  canUseBrowserLaunchAlerts: boolean;
  canUseRecurringCalendarFeeds: boolean;
  canUseRssFeeds: boolean;
  canUseEmbedWidgets: boolean;
  canUseArTrajectory: boolean;
  canUseEnhancedForecastInsights: boolean;
  canUseLaunchDayEmail: boolean;
};

export type ViewerLimits = {
  presetLimit: number;
  filterPresetLimit: number;
  watchlistLimit: number;
  watchlistRuleLimit: number;
};

export const TIER_REFRESH_SECONDS: Record<ViewerTier, number> = {
  anon: 2 * 60 * 60,
  free: 15 * 60,
  premium: 15
};

export function resolveViewerTier({
  isAuthed,
  isPaid,
  isAdmin
}: {
  isAuthed: boolean;
  isPaid: boolean;
  isAdmin?: boolean;
}): ViewerTier {
  if (isPaid || isAdmin) return 'premium';
  if (isAuthed) return 'free';
  return 'anon';
}

export function tierToMode(tier: ViewerTier): ViewerMode {
  return tier === 'premium' ? 'live' : 'public';
}

export function getTierRefreshSeconds(tier: ViewerTier) {
  return TIER_REFRESH_SECONDS[tier];
}

export function getTierCapabilities(tier: ViewerTier): ViewerCapabilities {
  const isPremium = tier === 'premium';
  const isSignedIn = tier !== 'anon';

  return {
    canUseSavedItems: isPremium,
    canUseLaunchFilters: isSignedIn,
    canUseLaunchCalendar: isSignedIn,
    canUseOneOffCalendar: isSignedIn,
    canUseLiveFeed: isPremium,
    canUseChangeLog: isPremium,
    canUseInstantAlerts: isPremium,
    canManageFilterPresets: isPremium,
    canManageFollows: isPremium,
    canUseBasicAlertRules: isSignedIn,
    canUseAdvancedAlertRules: isPremium,
    canUseBrowserLaunchAlerts: isPremium,
    canUseRecurringCalendarFeeds: isPremium,
    canUseRssFeeds: isPremium,
    canUseEmbedWidgets: isPremium,
    canUseArTrajectory: isPremium,
    canUseEnhancedForecastInsights: isPremium,
    canUseLaunchDayEmail: isPremium
  };
}

export function getTierLimits(tier: ViewerTier): ViewerLimits {
  if (tier === 'premium') {
    return {
      presetLimit: 25,
      filterPresetLimit: 25,
      watchlistLimit: 5,
      watchlistRuleLimit: 200
    };
  }

  if (tier === 'free') {
    return {
      presetLimit: 0,
      filterPresetLimit: 0,
      watchlistLimit: 0,
      watchlistRuleLimit: 0
    };
  }

  return {
    presetLimit: 0,
    filterPresetLimit: 0,
    watchlistLimit: 0,
    watchlistRuleLimit: 0
  };
}

export function getNextAlignedRefreshMs(nowMs: number, intervalMs: number) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return nowMs + intervalMs;
  }
  const now = new Date(nowMs);
  const msPerDay = 24 * 60 * 60 * 1000;
  const msIntoDay =
    now.getHours() * 60 * 60 * 1000 +
    now.getMinutes() * 60 * 1000 +
    now.getSeconds() * 1000 +
    now.getMilliseconds();
  const nextOffset = ((Math.floor(msIntoDay / intervalMs) + 1) * intervalMs) % msPerDay;
  const delta = nextOffset - msIntoDay;
  return nowMs + (delta > 0 ? delta : msPerDay + delta);
}
