import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LaunchFaaAirspaceMapV1 } from '@tminuszero/contracts';
import type { MobileTheme } from '@tminuszero/design-tokens';
import { getCapabilitiesAsync, TmzLaunchMapView, type TmzLaunchMapCapabilities } from '@/modules/tmz-launch-map';

type MapPadPayload = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  label?: string | null | undefined;
  shortCode?: string | null | undefined;
  locationName?: string | null | undefined;
};

type LaunchFaaMapCardProps = {
  theme: MobileTheme;
  mapData: LaunchFaaAirspaceMapV1 | null | undefined;
  onOpenFullscreen: () => void;
  onOpenPadMap: () => void;
};

type PadSatelliteMapCardProps = {
  theme: MobileTheme;
  pad: MapPadPayload;
  onOpenPadMap: () => void;
};

type NativeLaunchMapViewportProps = {
  advisoriesJson: string;
  boundsJson: string | null;
  padJson: string | null;
  height: number;
  interactive: boolean;
};

export function LaunchFaaMapCard({ theme, mapData, onOpenFullscreen, onOpenPadMap }: LaunchFaaMapCardProps) {
  const capabilities = useLaunchMapCapabilities();
  const advisoriesJson = useMemo(() => JSON.stringify(mapData?.advisories ?? []), [mapData]);
  const boundsJson = useMemo(() => (mapData?.bounds ? JSON.stringify(mapData.bounds) : null), [mapData]);
  const padJson = useMemo(() => (mapData?.pad ? JSON.stringify(mapData.pad) : null), [mapData]);
  const polygonCount = useMemo(
    () => (mapData?.advisories ?? []).reduce((total, advisory) => total + advisory.polygons.length, 0),
    [mapData]
  );

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden'
      }}
    >
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>FAA launch zone map</Text>
        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
          Satellite view of launch-day FAA polygons and the launch pad footprint.
        </Text>
      </View>

      <Pressable onPress={onOpenFullscreen} accessibilityRole="button">
        <MapViewportFrame
          theme={theme}
          capabilities={capabilities}
          advisoriesJson={advisoriesJson}
          boundsJson={boundsJson}
          padJson={padJson}
          interactive={false}
          height={220}
          emptyTitle="FAA launch zone map"
          emptyBody={
            mapData?.advisoryCount
              ? 'Launch-day FAA geometry is available, but the native map renderer is not ready on this build.'
              : 'Launch-day FAA geometry is not available for this launch yet.'
          }
        />
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 12
        }}
      >
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {(mapData?.advisoryCount ?? 0)} zone{(mapData?.advisoryCount ?? 0) === 1 ? '' : 's'} • {polygonCount} polygon
          {polygonCount === 1 ? '' : 's'}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <MapActionChip theme={theme} label="Full screen" onPress={onOpenFullscreen} accent={false} />
          <MapActionChip theme={theme} label="Open pad in Maps" onPress={onOpenPadMap} accent />
        </View>
      </View>
    </View>
  );
}

export function PadSatelliteMapCard({ theme, pad, onOpenPadMap }: PadSatelliteMapCardProps) {
  const capabilities = useLaunchMapCapabilities();
  const padJson = useMemo(
    () =>
      JSON.stringify({
        latitude: pad.latitude ?? null,
        longitude: pad.longitude ?? null,
        label: pad.shortCode || pad.label || 'Launch pad',
        shortCode: pad.shortCode ?? null,
        locationName: pad.locationName ?? null
      }),
    [pad]
  );

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.stroke,
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        overflow: 'hidden'
      }}
    >
      <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, gap: 6 }}>
        <Text style={{ color: theme.foreground, fontSize: 15, fontWeight: '700' }}>Pad satellite view</Text>
        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 20 }}>
          Tap the preview to open the pad in your platform map app.
        </Text>
      </View>

      <Pressable onPress={onOpenPadMap} accessibilityRole="button">
        <MapViewportFrame
          theme={theme}
          capabilities={capabilities}
          advisoriesJson="[]"
          boundsJson={null}
          padJson={padJson}
          interactive={false}
          height={220}
          emptyTitle="Pad satellite view"
          emptyBody="Native map preview unavailable on this build. Open the pad in your platform map app."
        />
      </Pressable>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 12
        }}
      >
        <Text style={{ color: theme.muted, fontSize: 12 }}>{pad.shortCode || pad.label || pad.locationName || 'Launch pad'}</Text>
        <MapActionChip theme={theme} label="Open in Maps" onPress={onOpenPadMap} accent />
      </View>
    </View>
  );
}

export function NativeLaunchMapViewport({
  advisoriesJson,
  boundsJson,
  padJson,
  height,
  interactive
}: NativeLaunchMapViewportProps) {
  return (
    <TmzLaunchMapView
      advisoriesJson={advisoriesJson}
      boundsJson={boundsJson}
      padJson={padJson}
      interactive={interactive}
      style={{ height, width: '100%' }}
    />
  );
}

function MapViewportFrame({
  theme,
  capabilities,
  advisoriesJson,
  boundsJson,
  padJson,
  interactive,
  height,
  emptyTitle,
  emptyBody
}: {
  theme: MobileTheme;
  capabilities: TmzLaunchMapCapabilities | null;
  advisoriesJson: string;
  boundsJson: string | null;
  padJson: string | null;
  interactive: boolean;
  height: number;
  emptyTitle: string;
  emptyBody: string;
}) {
  const nativeReady = capabilities?.isAvailable === true;

  return (
    <View style={{ height, overflow: 'hidden', borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.stroke }}>
      {nativeReady ? (
        <NativeLaunchMapViewport
          advisoriesJson={advisoriesJson}
          boundsJson={boundsJson}
          padJson={padJson}
          height={height}
          interactive={interactive}
        />
      ) : (
        <View
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            padding: 14,
            backgroundColor: '#09111f'
          }}
        >
          <Text style={{ color: theme.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{emptyTitle}</Text>
          <Text style={{ color: theme.foreground, fontSize: 16, fontWeight: '700', marginTop: 6 }}>Native map unavailable</Text>
          <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19, marginTop: 6 }}>{emptyBody}</Text>
        </View>
      )}
    </View>
  );
}

function MapActionChip({
  theme,
  label,
  onPress,
  accent
}: {
  theme: MobileTheme;
  label: string;
  onPress: () => void;
  accent: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: accent ? theme.accent : theme.stroke,
        backgroundColor: accent ? 'rgba(124, 92, 255, 0.12)' : 'transparent',
        paddingHorizontal: 12,
        paddingVertical: 7
      }}
    >
      <Text style={{ color: accent ? theme.accent : theme.foreground, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function useLaunchMapCapabilities() {
  const [capabilities, setCapabilities] = useState<TmzLaunchMapCapabilities | null>(null);

  useEffect(() => {
    let active = true;
    void getCapabilitiesAsync()
      .then((nextCapabilities) => {
        if (active) {
          setCapabilities(nextCapabilities);
        }
      })
      .catch(() => {
        if (active) {
          setCapabilities({
            isAvailable: false,
            provider: 'none',
            reason: 'The native launch map module is unavailable.'
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return capabilities;
}
