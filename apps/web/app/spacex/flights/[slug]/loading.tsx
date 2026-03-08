import { RouteLoadingState } from '@/components/RouteLoadingState';

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="SpaceX Flight Hub"
      title="Loading flight record"
      description="Pulling launch timing, booster stats, recovery targeting, and mission-linked context."
    />
  );
}
