import type { ArtemisProgramIntel } from '@/lib/server/artemisProgramIntel';
import type { ArtemisWorkbenchMode } from '@/components/artemis/ArtemisModeSwitch';
import type { ArtemisWorkbenchMission } from '@/components/artemis/ArtemisProgramWorkbenchDesktop';
import type { ArtemisTimelineEvent, ArtemisTimelineFilters } from '@/components/artemis/ArtemisTimelineExplorer';
import type {
  ArtemisContentItem,
  ArtemisDashboardView,
  ArtemisMissionHubKey,
  ArtemisMissionProgressCard,
  ArtemisProgramSnapshot
} from '@/lib/types/artemis';
import type { Launch } from '@/lib/types/launch';

export type ArtemisMissionWorkbenchCard = {
  key: ArtemisMissionHubKey;
  mission: string;
  href: string;
  status: string;
  summary: string;
  detail: string;
};

export type ArtemisTimelineInitialState = {
  mode: ArtemisWorkbenchMode;
  defaultMissionId: string | null;
  defaultSelectedEventId: string | null;
  initialFilters: ArtemisTimelineFilters;
};

export type ArtemisMissionControlProps = {
  initialView: ArtemisDashboardView;
  lastUpdatedLabel: string;
  programSnapshot: ArtemisProgramSnapshot;
  missions: readonly ArtemisWorkbenchMission[];
  missionCards: readonly ArtemisMissionWorkbenchCard[];
  missionLaunches: Record<ArtemisMissionHubKey, Launch | null>;
  missionProgress: ArtemisMissionProgressCard[];
  timelineEvents: readonly ArtemisTimelineEvent[];
  timelineInitialState: ArtemisTimelineInitialState;
  programIntel: ArtemisProgramIntel;
  articleItems: ArtemisContentItem[];
  photoItems: ArtemisContentItem[];
  socialItems: ArtemisContentItem[];
  dataItems: ArtemisContentItem[];
};

export type ArtemisDashboardNavItem = {
  id: ArtemisDashboardView;
  label: string;
  shortLabel: string;
  description: string;
};
