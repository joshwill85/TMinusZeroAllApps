import { mobileThemes, type MobileTheme } from '@tminuszero/design-tokens';

export function useThemeBootstrap(): { scheme: 'light' | 'dark'; theme: MobileTheme } {
  const scheme = 'dark';

  return {
    scheme,
    theme: mobileThemes[scheme]
  };
}
