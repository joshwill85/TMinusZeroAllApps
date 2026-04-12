export const BASIC_MOBILE_PUSH_PRELAUNCH_OPTIONS = [1, 5, 10, 60] as const;
export const PREMIUM_MOBILE_PUSH_PRELAUNCH_OPTIONS = [1, 5, 10, 30, 60, 120, 360, 720, 1440] as const;
export const DEFAULT_LAUNCH_MOBILE_PUSH_PRELAUNCH_OFFSETS = [10, 60] as const;
export const DEFAULT_BROAD_MOBILE_PUSH_PRELAUNCH_OFFSETS = [60] as const;

export type MobilePushPrelaunchScope = 'launch' | 'broad';

export function getMobilePushPrelaunchOptions(advancedAllowed: boolean) {
  return advancedAllowed ? PREMIUM_MOBILE_PUSH_PRELAUNCH_OPTIONS : BASIC_MOBILE_PUSH_PRELAUNCH_OPTIONS;
}

export function getDefaultMobilePushPrelaunchOffsets(scopeKind: MobilePushPrelaunchScope) {
  return [...(scopeKind === 'launch' ? DEFAULT_LAUNCH_MOBILE_PUSH_PRELAUNCH_OFFSETS : DEFAULT_BROAD_MOBILE_PUSH_PRELAUNCH_OFFSETS)];
}

export function getMobilePushMaxPrelaunchOffsets({
  advancedAllowed,
  scopeKind
}: {
  advancedAllowed: boolean;
  scopeKind: MobilePushPrelaunchScope;
}) {
  if (advancedAllowed) {
    return 3;
  }

  return scopeKind === 'launch' ? 2 : 1;
}
