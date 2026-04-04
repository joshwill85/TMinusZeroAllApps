import type { ViewProps } from 'react-native';

export type TmzLaunchMapProvider = 'apple' | 'google' | 'none';
export type TmzLaunchMapRenderMode = 'auto' | 'pad' | 'faa';

export type TmzLaunchMapCapabilities = {
  isAvailable: boolean;
  provider: TmzLaunchMapProvider;
  reason: string | null;
};

export type TmzLaunchMapViewProps = ViewProps & {
  advisoriesJson: string;
  boundsJson?: string | null;
  padJson?: string | null;
  interactive?: boolean;
  renderMode?: TmzLaunchMapRenderMode;
};
