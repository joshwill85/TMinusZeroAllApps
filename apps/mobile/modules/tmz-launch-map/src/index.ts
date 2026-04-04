import { requireOptionalNativeModule } from 'expo-modules-core';
import TmzLaunchMapView from './TmzLaunchMapView';
import type { TmzLaunchMapCapabilities } from './TmzLaunchMap.types';

export type { TmzLaunchMapCapabilities, TmzLaunchMapProvider, TmzLaunchMapRenderMode, TmzLaunchMapViewProps } from './TmzLaunchMap.types';

type TmzLaunchMapNativeModule = {
  getCapabilitiesAsync(): Promise<TmzLaunchMapCapabilities>;
};

const nativeModule = requireOptionalNativeModule<TmzLaunchMapNativeModule>('TmzLaunchMap');

export { TmzLaunchMapView };

export async function getCapabilitiesAsync(): Promise<TmzLaunchMapCapabilities> {
  if (!nativeModule?.getCapabilitiesAsync) {
    return {
      isAvailable: false,
      provider: 'none',
      reason: 'The native launch map module is not available on this build.'
    };
  }

  return nativeModule.getCapabilitiesAsync();
}

export const getTmzLaunchMapCapabilitiesAsync = getCapabilitiesAsync;

export default nativeModule;
