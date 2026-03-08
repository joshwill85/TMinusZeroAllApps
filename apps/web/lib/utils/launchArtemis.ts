import type { Launch } from '@/lib/types/launch';
import { isArtemisProgramLaunch } from '@/lib/utils/artemis';

export function isArtemisLaunch(launch: Pick<Launch, 'name' | 'mission'> & { programs?: Launch['programs'] }) {
  return isArtemisProgramLaunch(launch);
}
