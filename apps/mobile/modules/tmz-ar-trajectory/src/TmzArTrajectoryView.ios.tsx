import { requireNativeViewManager } from 'expo-modules-core'
import type { TmzArTrajectoryViewProps } from './TmzArTrajectory.types'

const NativeTmzArTrajectoryView = requireNativeViewManager<TmzArTrajectoryViewProps>('TmzArTrajectory')

export default function TmzArTrajectoryView(props: TmzArTrajectoryViewProps) {
  return <NativeTmzArTrajectoryView {...props} />
}
