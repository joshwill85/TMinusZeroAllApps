import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { CatalogCollectionV1, CatalogDetailV1, CatalogEntityTypeV1, CatalogHubV1 } from '@tminuszero/contracts';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellMetric,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { formatRouteDateTime, formatRouteNumber, openExternalCustomerUrl, RouteKeyValueRow, RouteListRow } from './shared';
import { useCatalogCollectionQuery, useCatalogDetailQuery, useCatalogHubQuery } from './queries';

type CatalogEntityMeta = {
  value: CatalogEntityTypeV1;
  label: string;
  description: string;
};

const CATALOG_ENTITY_META: readonly CatalogEntityMeta[] = [
  {
    value: 'agencies',
    label: 'Agencies',
    description: 'Launch service providers, manufacturers, and space agencies tied to the LL2 dataset.'
  },
  {
    value: 'astronauts',
    label: 'Astronauts',
    description: 'Crewed flight roster with status, agency, and mission links when available.'
  },
  {
    value: 'space_stations',
    label: 'Space Stations',
    description: 'Active and historic stations with ownership and orbit context.'
  },
  {
    value: 'expeditions',
    label: 'Expeditions',
    description: 'Station expeditions and associated crew activities.'
  },
  {
    value: 'docking_events',
    label: 'Docking Events',
    description: 'Vehicle dockings and departures for visiting spacecraft.'
  },
  {
    value: 'launcher_configurations',
    label: 'Launch Vehicles',
    description: 'Rocket configurations and variants with manufacturer context.'
  },
  {
    value: 'launchers',
    label: 'Reusable First Stages',
    description: 'Reusable cores and first stages with flight history when available.'
  },
  {
    value: 'spacecraft_configurations',
    label: 'Spacecraft',
    description: 'Crewed and uncrewed spacecraft configurations tracked by LL2.'
  },
  {
    value: 'locations',
    label: 'Locations',
    description: 'Launch sites and regions that host launch activity.'
  },
  {
    value: 'pads',
    label: 'Pads',
    description: 'Individual launch pads within each location.'
  },
  {
    value: 'events',
    label: 'Events',
    description: 'Non-launch events: landings, spacewalks, tests, and more.'
  }
] as const;

const CATALOG_REGION_OPTIONS = [
  { label: 'All regions', value: 'all' as const },
  { label: 'US only', value: 'us' as const }
] as const;

export function CatalogHubScreen() {
  const router = useRouter();
  const query = useCatalogHubQuery();
  const hub = query.data as CatalogHubV1 | null;
  const entities: CatalogHubV1['entities'] = hub?.entities ?? [];

  return (
    <AppScreen testID="catalog-screen">
      <CustomerShellHero
        eyebrow="Catalog"
        title={hub?.title ?? 'Launch Library 2 Catalog'}
        description={hub?.description ?? 'Browse collection pages for agencies, astronauts, vehicles, stations, locations, pads, and event references.'}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={hub ? `${entities.length} collections` : 'Loading'} tone="accent" />
          <CustomerShellBadge label="Native browse" />
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Collections" description="Open a native collection page for the selected Launch Library 2 entity.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading catalog hub…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load catalog hub.'}
            </Text>
          ) : entities.length ? (
            entities.map((entity: CatalogHubV1['entities'][number]) => (
              <RouteListRow
                key={entity.entity}
                title={entity.label}
                subtitle={entity.description}
                badge={entity.entity}
                onPress={() => {
                  router.push(`/catalog/${entity.entity}` as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No catalog collections were returned.</Text>
          )}
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function CatalogCollectionRouteScreen({ entity }: { entity: string }) {
  if (!isCatalogEntityType(entity)) {
    return <CatalogUnsupportedEntityScreen entity={entity} />;
  }

  return <CatalogCollectionScreen entity={entity} />;
}

export function CatalogDetailRouteScreen({ entity, entityId }: { entity: string; entityId: string }) {
  if (!isCatalogEntityType(entity)) {
    return <CatalogUnsupportedEntityScreen entity={entity} />;
  }

  return <CatalogDetailScreen entity={entity} entityId={entityId} />;
}

export function CatalogCollectionScreen({ entity }: { entity: CatalogEntityTypeV1 }) {
  const router = useRouter();
  const [region, setRegion] = useState<'all' | 'us'>('all');
  const [queryText, setQueryText] = useState('');
  const meta = getCatalogEntityMeta(entity);
  const query = useCatalogCollectionQuery(entity, {
    region,
    q: queryText.trim() || null,
    limit: 36,
    offset: 0
  });
  const collection = query.data as CatalogCollectionV1 | null;
  const items: CatalogCollectionV1['items'] = collection?.items ?? [];
  const querySummary = useMemo(() => {
    if (!collection) {
      return null;
    }

    const parts = [collection.region === 'us' ? 'US only' : 'All regions'];
    if (collection.query) {
      parts.push(`"${collection.query}"`);
    }
    return parts.join(' • ');
  }, [collection]);

  return (
    <AppScreen testID={`catalog-${entity}-screen`}>
      <CustomerShellHero eyebrow="Catalog" title={collection?.label ?? meta.label} description={collection?.description ?? meta.description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={entity} tone="accent" />
          <CustomerShellBadge label={collection ? `${items.length} items` : 'Loading'} />
          {querySummary ? <CustomerShellBadge label={querySummary} /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Filters" description="Narrow the native collection by region and query text.">
        <View style={{ gap: 12 }}>
          <View
            style={{
              borderRadius: 18,
              borderWidth: 1,
              borderColor: 'rgba(234, 240, 255, 0.1)',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              paddingHorizontal: 14,
              paddingVertical: 12
            }}
          >
            <Text style={{ color: '#9bb0bf', fontSize: 11, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              Search catalog
            </Text>
            <TextInput
              value={queryText}
              onChangeText={setQueryText}
              placeholder="name, description, agency, launch vehicle"
              placeholderTextColor="#8c9cad"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ color: '#eaf0ff', fontSize: 16, marginTop: 8, paddingVertical: 0 }}
            />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CATALOG_REGION_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                label={option.label}
                active={region === option.value}
                onPress={() => {
                  setRegion(option.value);
                }}
              />
            ))}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <CustomerShellMetric label="Shown" value={formatRouteNumber(items.length)} />
            <CustomerShellMetric label="Limit" value={String(collection?.limit ?? 36)} />
            <CustomerShellMetric label="Offset" value={String(collection?.offset ?? 0)} />
          </View>
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Results" description="Tap a row to open the native detail page.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading collection…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load catalog collection.'}
            </Text>
          ) : items.length ? (
            items.map((item: CatalogCollectionV1['items'][number]) => (
              <RouteListRow
                key={`${item.entityType}:${item.entityId}`}
                title={item.name}
                subtitle={item.description || meta.description}
                meta={buildCatalogItemMeta(item)}
                badge={item.entityType}
                onPress={() => {
                  router.push(item.href as Href);
                }}
              />
            ))
          ) : (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>No catalog items matched the current filters.</Text>
          )}
        </View>
      </CustomerShellPanel>

      <CustomerShellPanel title="Actions" description="Return to the catalog hub or keep browsing this collection.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open catalog hub"
            onPress={() => {
              router.push('/catalog' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

export function CatalogDetailScreen({ entity, entityId }: { entity: CatalogEntityTypeV1; entityId: string }) {
  const router = useRouter();
  const query = useCatalogDetailQuery(entity, entityId);
  const detail = query.data as CatalogDetailV1 | null;
  const meta = getCatalogEntityMeta(entity);

  return (
    <AppScreen testID="catalog-detail-screen">
      <CustomerShellHero eyebrow="Catalog" title={detail?.title ?? entityId} description={detail?.description ?? meta.description}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={detail?.label ?? meta.label} tone="accent" />
          <CustomerShellBadge label={entity} />
          {detail?.generatedAt ? <CustomerShellBadge label={formatRouteDateTime(detail.generatedAt)} /> : null}
        </View>
      </CustomerShellHero>

      <CustomerShellPanel title="Facts" description="Native catalog facts and reference metadata.">
        <View style={{ gap: 10 }}>
          {query.isPending ? (
            <Text style={{ color: '#d4e0eb', fontSize: 14, lineHeight: 21 }}>Loading catalog detail…</Text>
          ) : query.isError ? (
            <Text style={{ color: '#ff9aa9', fontSize: 14, lineHeight: 21 }}>
              {query.error instanceof Error ? query.error.message : 'Unable to load catalog detail.'}
            </Text>
          ) : detail ? (
            <>
              <RouteKeyValueRow label="Entity" value={detail.entity} />
              <RouteKeyValueRow label="Entity ID" value={entityId} />
              <RouteKeyValueRow label="Canonical route" value={detail.href} />
              <RouteKeyValueRow label="Image URL" value={detail.imageUrl ?? '—'} />
              {detail.facts.map((fact: CatalogDetailV1['facts'][number]) => (
                <RouteKeyValueRow key={`${fact.label}:${fact.value}`} label={fact.label} value={fact.value} />
              ))}
            </>
          ) : null}
        </View>
      </CustomerShellPanel>

      {detail?.links?.length ? (
        <CustomerShellPanel title="Links" description="Open catalog-connected internal and external surfaces.">
          <View style={{ gap: 10 }}>
            {detail.links.map((link: CatalogDetailV1['links'][number]) => (
              <RouteListRow
                key={`${link.label}:${link.href}`}
                title={link.label}
                subtitle={link.external ? 'External resource' : 'Native catalog surface'}
                badge={link.external ? 'external' : 'native'}
                onPress={() => {
                  if (link.external) {
                    void openExternalCustomerUrl(link.href);
                    return;
                  }
                  router.push(link.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      {detail?.relatedLaunches?.length ? (
        <CustomerShellPanel title="Related launches" description="Open the connected launch records.">
          <View style={{ gap: 10 }}>
            {detail.relatedLaunches.map((launch: CatalogDetailV1['relatedLaunches'][number]) => (
              <RouteListRow
                key={launch.id}
                title={launch.name}
                subtitle={[launch.provider, launch.vehicle, launch.net].filter(Boolean).join(' • ')}
                meta={launch.statusText || 'Launch'}
                onPress={() => {
                  router.push(launch.href as Href);
                }}
              />
            ))}
          </View>
        </CustomerShellPanel>
      ) : null}

      <CustomerShellPanel title="Actions" description="Return to the collection or the catalog hub.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open collection"
            onPress={() => {
              router.push(`/catalog/${entity}` as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}

function CatalogUnsupportedEntityScreen({ entity }: { entity: string }) {
  const router = useRouter();

  return (
    <AppScreen testID="catalog-unsupported-screen">
      <CustomerShellHero eyebrow="Catalog" title="Catalog unavailable" description="The requested catalog entity is not supported on mobile.">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label={entity || 'missing entity'} tone="warning" />
        </View>
      </CustomerShellHero>
      <CustomerShellPanel title="Actions" description="Return to the catalog hub.">
          <CustomerShellActionButton
            label="Open catalog hub"
            onPress={() => {
              router.push('/catalog' as Href);
            }}
          />
      </CustomerShellPanel>
    </AppScreen>
  );
}

function FilterChip({
  label,
  active,
  onPress
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(34, 211, 238, 0.22)' : 'rgba(234, 240, 255, 0.08)',
        backgroundColor: active ? 'rgba(34, 211, 238, 0.1)' : pressed ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)',
        paddingHorizontal: 12,
        paddingVertical: 8
      })}
    >
      <Text style={{ color: active ? '#6fe8ff' : '#d4e0eb', fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

function buildCatalogItemMeta(item: CatalogCollectionV1['items'][number]) {
  const parts = [item.countryCodes.length ? item.countryCodes.join(', ') : null, item.launchCount != null ? `${item.launchCount} launches` : null].filter(Boolean);
  return parts.length ? parts.join(' • ') : item.entityId;
}

function getCatalogEntityMeta(entity: CatalogEntityTypeV1) {
  return CATALOG_ENTITY_META.find((entry) => entry.value === entity) || CATALOG_ENTITY_META[0];
}

function isCatalogEntityType(value: string): value is CatalogEntityTypeV1 {
  return CATALOG_ENTITY_META.some((entry) => entry.value === value);
}
