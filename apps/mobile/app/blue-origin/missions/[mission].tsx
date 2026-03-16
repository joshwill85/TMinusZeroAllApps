import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import {
  BlueOriginMissionScreen,
  normalizeBlueOriginMissionParam
} from '@/src/features/programHubs/blueOriginScreens';

export default function BlueOriginMissionRouteScreen() {
  const params = useLocalSearchParams<{ mission?: string | string[] }>();
  const mission = normalizeBlueOriginMissionParam(params.mission);

  if (!mission) {
    return <Redirect href={'/blue-origin/missions' as Href} />;
  }

  return <BlueOriginMissionScreen mission={mission} />;
}
