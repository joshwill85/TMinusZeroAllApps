import { RouteLoadingState } from '@/components/RouteLoadingState';

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Launch Detail"
      title="Loading launch detail"
      description="Pulling launch timing, vehicle context, weather signals, and mission evidence."
    />
  );
}
