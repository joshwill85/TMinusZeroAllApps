import { requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType } from 'react';
import type { TmzLaunchMapViewProps } from './TmzLaunchMap.types';

let NativeTmzLaunchMapView: ComponentType<TmzLaunchMapViewProps> | null = null;

try {
  NativeTmzLaunchMapView = requireNativeViewManager<TmzLaunchMapViewProps>('TmzLaunchMap');
} catch {
  NativeTmzLaunchMapView = null;
}

export default function TmzLaunchMapView(props: TmzLaunchMapViewProps) {
  if (!NativeTmzLaunchMapView) {
    return null;
  }

  return <NativeTmzLaunchMapView {...props} />;
}
