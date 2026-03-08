import type { Launch } from '@/lib/types/launch';
import { isStarshipProgramLaunch } from '@/lib/utils/starship';

export function isStarshipLaunch(
  launch: Pick<Launch, 'name' | 'mission' | 'programs' | 'vehicle' | 'rocket'>
) {
  return isStarshipProgramLaunch(launch);
}
