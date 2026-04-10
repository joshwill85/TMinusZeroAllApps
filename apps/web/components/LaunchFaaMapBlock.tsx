'use client';

import type { LaunchFaaAirspaceMapV1 } from '@tminuszero/contracts';
import type { LaunchFaaMapRenderMode } from '@/lib/maps/providerTypes';
import { LaunchFaaMapAppleClient } from '@/components/LaunchFaaMapAppleClient';
import { LaunchFaaMapClient } from '@/components/LaunchFaaMapClient';

type Props = {
  data: LaunchFaaAirspaceMapV1 | null;
  renderMode: LaunchFaaMapRenderMode;
  googleMapsApiKey?: string | null;
  appleMapsAuthorizationToken?: string | null;
  padMapsHref?: string | null;
  padMapsLinkLabel?: string;
  unavailableMessage: string;
};

export function LaunchFaaMapBlock({
  data,
  renderMode,
  googleMapsApiKey = null,
  appleMapsAuthorizationToken = null,
  padMapsHref = null,
  padMapsLinkLabel,
  unavailableMessage
}: Props) {
  const canRenderGoogle = renderMode === 'google' && Boolean(googleMapsApiKey && data?.hasRenderableGeometry);
  const canRenderApple = renderMode === 'apple' && Boolean(appleMapsAuthorizationToken && data?.hasRenderableGeometry);

  if (canRenderGoogle && data && googleMapsApiKey) {
    return <LaunchFaaMapClient apiKey={googleMapsApiKey} data={data} padMapsHref={padMapsHref} openMapsLabel={padMapsLinkLabel} />;
  }

  if (canRenderApple && data && appleMapsAuthorizationToken) {
    return (
      <LaunchFaaMapAppleClient
        authorizationToken={appleMapsAuthorizationToken}
        data={data}
        padMapsHref={padMapsHref}
        openMapsLabel={padMapsLinkLabel}
      />
    );
  }

  if (data?.advisoryCount) {
    return (
      <div className="rounded-xl border border-dashed border-stroke bg-[rgba(255,255,255,0.02)] px-3 py-3 text-sm text-text3">
        {unavailableMessage}
      </div>
    );
  }

  return null;
}
