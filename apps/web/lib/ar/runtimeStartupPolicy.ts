import type { ArClientProfile } from '@/lib/ar/clientProfile';
import type { ArRuntimePoseMode, ArRuntimeXrLaunchState } from '@/lib/ar/runtimeSelector';

export function isManagedWebXrAutoStartProfile(profile: ArClientProfile) {
  return profile === 'android_chrome' || profile === 'android_samsung_internet';
}

type AutoStartWebXrOptions = {
  profile: ArClientProfile;
  policyHydrated: boolean;
  poseMode: ArRuntimePoseMode;
  xrSupport: 'unknown' | 'supported' | 'unsupported';
  xrActive: boolean;
  xrLaunchState: ArRuntimeXrLaunchState;
  autoStartAttempted: boolean;
};

export function shouldAutoStartWebXr({
  profile,
  policyHydrated,
  poseMode,
  xrSupport,
  xrActive,
  xrLaunchState,
  autoStartAttempted
}: AutoStartWebXrOptions) {
  if (!isManagedWebXrAutoStartProfile(profile)) return false;
  if (!policyHydrated) return false;
  if (poseMode !== 'webxr') return false;
  if (xrSupport !== 'supported') return false;
  if (xrActive) return false;
  if (xrLaunchState === 'blocked' || xrLaunchState === 'starting') return false;
  if (autoStartAttempted) return false;
  return true;
}
