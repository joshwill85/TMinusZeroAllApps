import { requireNativeViewManager } from 'expo-modules-core'
import type { TmzLaunchMapViewProps } from './TmzLaunchMap.types'

const NativeTmzLaunchMapView = requireNativeViewManager<TmzLaunchMapViewProps>('TmzLaunchMap')

export default function TmzLaunchMapView(props: TmzLaunchMapViewProps) {
  return <NativeTmzLaunchMapView {...props} />
}
