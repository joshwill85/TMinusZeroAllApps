import { RouteLoadingState } from '@/components/RouteLoadingState';

export default function Loading() {
  return (
    <RouteLoadingState
      eyebrow="Blue Origin Flight"
      title="Loading flight redirect"
      description="Resolving the canonical launch record for this Blue Origin mission."
    />
  );
}
