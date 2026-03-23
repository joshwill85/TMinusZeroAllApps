import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { SatelliteDetailV1, SatelliteOwnerProfileV1, SatelliteOwnersResponseV1, SatellitesResponseV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { formatRouteDate, formatRouteNumber, openExternalCustomerUrl, RouteKeyValueRow, RouteListRow } from './shared';
import { useSatelliteDetailQuery, useSatelliteOwnerProfileQuery, useSatelliteOwnersQuery, useSatellitesQuery } from './queries';

export function SatellitesIndexScreen() {
  const router = useRouter();
  const satellitesQuery = useSatellitesQuery({ limit: 24, offset: 0 });
  const ownersQuery = useSatelliteOwnersQuery({ limit: 12, offset: 0 });
  const satellitesPayload = satellitesQuery.data as SatellitesResponseV1 | null;
  const ownersPayload = ownersQuery.data as SatelliteOwnersResponseV1 | null;
  const satellites: SatellitesResponseV1['items'] = satellitesPayload?.items ?? [];
  const owners: SatelliteOwnersResponseV1['items'] = ownersPayload?.items ?? [];

  return (
    <AppScreen testID="satellites-screen">
      <CustomerShellHero
        eyebrow="Satellites"
        title={satellitesQuery.data?.title ?? 'Satellite Catalog'}
        description={satellitesQuery.data?.description ?? 'Searchable NORAD records, owner hubs, and launch associations.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={satellitesQuery.isPending ? 'Loading' : `${satellites.length} satellites`} tone="accent" />
          <CustomerShellBadge label={ownersQuery.isPending ? 'Loading owners' : `${owners.length} owners`} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Snapshot" description="The most recently updated satellite and owner slices.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <CustomerShellMetric label="Satellites" value={formatRouteNumber(satellites.length)} />
          <CustomerShellMetric label="Owners" value={formatRouteNumber(owners.length)} />
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Browse satellites" description="Tap a NORAD entry to open native satellite detail.">
        <View style={{ gap: 10 }}>
          {satellitesQuery.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading satellites…</Text>
          ) : satellitesQuery.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {satellitesQuery.error instanceof Error ? satellitesQuery.error.message : 'Unable to load satellites.'}
            </Text>
          ) : satellites.length ? (
            satellites.map((satellite: SatellitesResponseV1['items'][number]) => (
              <RouteListRow
                key={satellite.noradCatId}
                title={satellite.name || `NORAD ${satellite.noradCatId}`}
                subtitle={buildSatelliteSubtitle(satellite)}
                meta={buildSatelliteMeta(satellite)}
                badge={satellite.objectType || 'satellite'}
                onPress={() => {
                  router.push(satellite.href as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No satellites matched the current slice.</Text>
          )}
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Owner hubs" description="Open the native owner index or a specific owner profile.">
        <View style={{ gap: 10 }}>
          {ownersQuery.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading owners…</Text>
          ) : ownersQuery.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {ownersQuery.error instanceof Error ? ownersQuery.error.message : 'Unable to load owners.'}
            </Text>
          ) : owners.length ? (
            owners.map((owner: SatelliteOwnersResponseV1['items'][number]) => (
              <RouteListRow
                key={owner.ownerCode}
                title={owner.ownerLabel}
                subtitle={`Latest update ${owner.lastSatcatUpdatedAt ? formatRouteDate(owner.lastSatcatUpdatedAt) : 'TBD'}`}
                meta={`${owner.satelliteCount} satellites`}
                badge={owner.ownerCode}
                onPress={() => {
                  router.push(owner.href as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No owner records matched the current slice.</Text>
          )}
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Actions" description="Jump to the owner index or return to the command deck.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open owner index"
            onPress={() => {
              router.push('/satellites/owners' as Href);
            }}
          />
          <CustomerShellActionButton
            label="Open info hub"
            variant="secondary"
            onPress={() => {
              router.push('/info' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function SatelliteDetailScreen({ noradCatId }: { noradCatId: string }) {
  const router = useRouter();
  const query = useSatelliteDetailQuery(noradCatId);
  const payload = query.data as SatelliteDetailV1 | null;
  const satellite = payload?.satellite ?? null;
  const ownerHref = satellite?.ownerHref ?? null;

  return (
    <AppScreen testID="satellite-detail-screen">
      <CustomerShellHero
        eyebrow="Satellites"
        title={satellite?.name ?? `NORAD ${noradCatId}`}
        description={payload?.description ?? 'Native satellite detail with orbit, owner, and related launch context.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={satellite?.ownerLabel ?? 'unknown owner'} tone="accent" />
          <CustomerShellBadge label={satellite?.objectType ?? 'object'} />
          {satellite?.satcatUpdatedAt ? <CustomerShellBadge label={formatRouteDate(satellite.satcatUpdatedAt)} tone="success" /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Summary" description="The native satellite summary and launch linkage.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading satellite detail…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load satellite detail.'}
            </Text>
          ) : satellite ? (
            <>
              <RouteKeyValueRow label="NORAD" value={String(satellite.noradCatId)} />
              <RouteKeyValueRow label="International designator" value={satellite.intlDes || '—'} />
              <RouteKeyValueRow label="Owner" value={satellite.ownerLabel || satellite.ownerCode || '—'} />
              <RouteKeyValueRow label="Launch date" value={formatRouteDate(satellite.launchDate)} />
              <RouteKeyValueRow label="Decay date" value={formatRouteDate(satellite.decayDate)} />
              <RouteKeyValueRow label="Period" value={satellite.periodMinutes != null ? `${satellite.periodMinutes} minutes` : '—'} />
            </>
          ) : null}
        </View>
      </CustomerShellPanel>

      {satellite?.orbit ? (
        <CustomerShellPanel title="Orbit" description="Orbit summary derived from the current catalog payload.">
          <View style={{ gap: 10 }}>
            <RouteKeyValueRow label="Epoch" value={formatOrbitValue(satellite.orbit.epoch)} />
            <RouteKeyValueRow label="Inclination" value={formatAngleValue(satellite.orbit.inclinationDeg)} />
            <RouteKeyValueRow label="RAAN" value={formatAngleValue(satellite.orbit.raanDeg)} />
            <RouteKeyValueRow label="Eccentricity" value={formatOrbitValue(satellite.orbit.eccentricity)} />
            <RouteKeyValueRow label="Mean motion" value={formatOrbitValue(satellite.orbit.meanMotionRevPerDay)} />
          </View>
        </CustomerShellPanel>
      ) : null}

      {payload?.relatedLaunch ? (
        <CustomerShellPanel title="Related launch" description="Open the linked launch detail when available.">
          <RouteListRow
            title={payload.relatedLaunch.name}
            subtitle={[payload.relatedLaunch.provider, payload.relatedLaunch.vehicle, formatRouteDate(payload.relatedLaunch.net)].filter(Boolean).join(' • ')}
            meta={payload.relatedLaunch.statusText || 'Launch'}
            onPress={() => {
              router.push(payload.relatedLaunch!.href as Href);
            }}
          />
        </CustomerShellPanel>
      ) : null}

      {ownerHref ? (
        <CustomerShellPanel title="Owner profile" description="Open the related owner hub.">
          <CustomerShellActionButton
            label="Open owner profile"
            onPress={() => {
              if (ownerHref.startsWith('/')) {
                router.push(ownerHref as Href);
                return;
              }
              void openExternalCustomerUrl(ownerHref);
            }}
          />
        </CustomerShellPanel>
      ) : null}
    </AppScreen>
  );
}

export function SatelliteOwnersScreen() {
  const router = useRouter();
  const ownersQuery = useSatelliteOwnersQuery({ limit: 24, offset: 0 });
  const ownersPayload = ownersQuery.data as SatelliteOwnersResponseV1 | null;
  const owners: SatelliteOwnersResponseV1['items'] = ownersPayload?.items ?? [];

  return (
    <AppScreen testID="satellite-owners-screen">
      <CustomerShellHero
        eyebrow="Satellites"
        title={ownersQuery.data?.title ?? 'Satellite Owners'}
        description={ownersQuery.data?.description ?? 'Owner hubs for the satellite catalog.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={ownersQuery.isPending ? 'Loading' : `${owners.length} owners`} tone="accent" />
          <CustomerShellBadge label="Native index" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Owners" description="Browse the owner index and drill into a specific owner profile.">
        <View style={{ gap: 10 }}>
          {ownersQuery.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading owner index…</Text>
          ) : ownersQuery.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {ownersQuery.error instanceof Error ? ownersQuery.error.message : 'Unable to load owner index.'}
            </Text>
          ) : owners.length ? (
            owners.map((owner: SatelliteOwnersResponseV1['items'][number]) => (
              <RouteListRow
                key={owner.ownerCode}
                title={owner.ownerLabel}
                subtitle={`Latest update ${owner.lastSatcatUpdatedAt ? formatRouteDate(owner.lastSatcatUpdatedAt) : 'TBD'}`}
                meta={`${owner.satelliteCount} satellites`}
                badge={owner.ownerCode}
                onPress={() => {
                  router.push(owner.href as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No owner rows were returned.</Text>
          )}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function SatelliteOwnerDetailScreen({ owner }: { owner: string }) {
  const router = useRouter();
  const query = useSatelliteOwnerProfileQuery(owner);
  const payload = query.data as SatelliteOwnerProfileV1 | null;
  const profile = payload?.profile ?? null;

  return (
    <AppScreen testID="satellite-owner-profile-screen">
      <CustomerShellHero
        eyebrow="Satellites"
        title={profile?.ownerLabel ?? owner}
        description={payload?.description ?? 'Owner profile with linked launches and satellites.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={profile?.ownerCode ?? owner} tone="accent" />
          <CustomerShellBadge label={profile ? `${profile.ownerSatelliteCount} satellites` : 'Loading'} />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Owner profile" description="Native owner metadata and launch-linked records.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading owner profile…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load owner profile.'}
            </Text>
          ) : profile ? (
            <>
              <RouteKeyValueRow label="Owner code" value={profile.ownerCode} />
              <RouteKeyValueRow label="Satellite count" value={String(profile.ownerSatelliteCount)} />
              <RouteKeyValueRow label="Last update" value={formatRouteDate(profile.lastSatcatUpdatedAt)} />
              <RouteKeyValueRow label="PAY" value={String(profile.typeCounts.PAY)} />
              <RouteKeyValueRow label="RB" value={String(profile.typeCounts.RB)} />
              <RouteKeyValueRow label="DEB" value={String(profile.typeCounts.DEB)} />
              <RouteKeyValueRow label="UNK" value={String(profile.typeCounts.UNK)} />
            </>
          ) : null}
        </View>
      </CustomerShellPanel>

      {payload?.relatedLaunches?.length ? (
        <CustomerShellPanel title="Related launches" description="Open the launch detail pages linked to this owner.">
          <View style={{ gap: 10 }}>
            {payload.relatedLaunches.map((launch: SatelliteOwnerProfileV1['relatedLaunches'][number]) => (
              <RouteListRow
                key={launch.id}
                title={launch.name}
                subtitle={[launch.provider, launch.vehicle, formatRouteDate(launch.net)].filter(Boolean).join(' • ')}
                meta={launch.statusText || 'Launch'}
                onPress={() => {
                  router.push(launch.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {payload?.satellites?.length ? (
        <CustomerShellPanel title="Satellites" description="Native satellite records for this owner.">
          <View style={{ gap: 10 }}>
            {payload.satellites.map((satellite: SatelliteOwnerProfileV1['satellites'][number]) => (
              <RouteListRow
                key={satellite.noradCatId}
                title={satellite.name || `NORAD ${satellite.noradCatId}`}
                subtitle={buildSatelliteSubtitle(satellite)}
                meta={buildSatelliteMeta(satellite)}
                onPress={() => {
                  router.push(satellite.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      <CustomerShellPanel title="Actions" description="Jump back to the owner list or open the broader satellite index.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open owner index"
            onPress={() => {
              router.push('/satellites/owners' as Href);
            }}
          />
          <CustomerShellActionButton
            label="Open satellites index"
            variant="secondary"
            onPress={() => {
              router.push('/satellites' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function buildSatelliteSubtitle(item: SatellitesResponseV1['items'][number] | SatelliteOwnerProfileV1['satellites'][number]) {
  return [item.ownerLabel || item.ownerCode || 'Unknown owner', item.objectType || 'Object'].filter(Boolean).join(' • ');
}

function buildSatelliteMeta(item: SatellitesResponseV1['items'][number] | SatelliteOwnerProfileV1['satellites'][number]) {
  return item.satcatUpdatedAt ? `Updated ${formatRouteDate(item.satcatUpdatedAt)}` : 'Update pending';
}

function formatOrbitValue(value: number | string | null | undefined) {
  if (value == null) {
    return '—';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value;
}

function formatAngleValue(value: number | null | undefined) {
  if (value == null) {
    return '—';
  }
  return `${value.toFixed(2)}°`;
}
