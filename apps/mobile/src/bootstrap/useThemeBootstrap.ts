import { mobileThemes, type MobileTheme } from '@tminuszero/design-tokens';
import { useColorScheme } from 'react-native';

export function useThemeBootstrap(): { scheme: 'light' | 'dark'; theme: MobileTheme } {
  const colorScheme = useColorScheme();
  const scheme = colorScheme === 'light' ? 'light' : 'dark';

  return {
    scheme,
    theme: mobileThemes[scheme]
  };
}
