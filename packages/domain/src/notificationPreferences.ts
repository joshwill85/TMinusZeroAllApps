export type LaunchDayEmailPreferencePatch = {
  launchDayEmailEnabled?: boolean;
  launchDayEmailProviders?: readonly string[] | null;
  launchDayEmailStates?: readonly string[] | null;
};

export function hasLaunchDayEmailPreferenceInput(patch: LaunchDayEmailPreferencePatch | null | undefined) {
  if (!patch) {
    return false;
  }

  return (
    patch.launchDayEmailEnabled !== undefined ||
    patch.launchDayEmailProviders !== undefined ||
    patch.launchDayEmailStates !== undefined
  );
}
