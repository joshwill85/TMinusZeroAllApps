export const mobileColorTokens = {
  background: '#06131d',
  surface: '#0d2230',
  foreground: '#f2f7fb',
  muted: '#9ab3c5',
  accent: '#6fe8ff',
  stroke: 'rgba(111, 232, 255, 0.18)'
} as const;

export type MobileTheme = {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  stroke: string;
};

export const mobileThemes: Record<'light' | 'dark', MobileTheme> = {
  light: {
    background: '#f4f8fb',
    surface: '#ffffff',
    foreground: '#08121a',
    muted: '#5f7384',
    accent: '#0c8db8',
    stroke: 'rgba(12, 141, 184, 0.16)'
  },
  dark: mobileColorTokens
};
