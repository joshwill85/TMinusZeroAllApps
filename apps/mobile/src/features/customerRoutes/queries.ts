import { useQuery } from '@tanstack/react-query';
import type {
  CanonicalContractsRequest,
  CatalogCollectionRequest,
  CatalogEntityTypeV1,
  NewsStreamRequest,
  SatellitesRequest,
  SatelliteOwnersRequest
} from '@tminuszero/api-client';
import {
  canonicalContractDetailQueryOptions,
  canonicalContractsQueryOptions,
  catalogCollectionQueryOptions,
  catalogDetailQueryOptions,
  catalogHubQueryOptions,
  contentPageQueryOptions,
  infoHubQueryOptions,
  newsStreamQueryOptions,
  satelliteDetailQueryOptions,
  satelliteOwnerProfileQueryOptions,
  satelliteOwnersQueryOptions,
  satellitesQueryOptions
} from '@tminuszero/query';
import { useMobileApiClient } from '@/src/api/useMobileApiClient';

export function useNewsStreamQuery(request: NewsStreamRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...newsStreamQueryOptions(() => client.getNewsStream(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useCanonicalContractsQuery(request: CanonicalContractsRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...canonicalContractsQueryOptions(() => client.getCanonicalContracts(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useCanonicalContractDetailQuery(contractUid: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...canonicalContractDetailQueryOptions(contractUid || 'missing', () => client.getCanonicalContractDetail(String(contractUid))),
    enabled: (options?.enabled ?? true) && Boolean(contractUid)
  });
}

export function useSatellitesQuery(request: SatellitesRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...satellitesQueryOptions(() => client.getSatellites(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSatelliteDetailQuery(noradCatId: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...satelliteDetailQueryOptions(noradCatId || 'missing', () => client.getSatelliteDetail(String(noradCatId))),
    enabled: (options?.enabled ?? true) && Boolean(noradCatId)
  });
}

export function useSatelliteOwnersQuery(request: SatelliteOwnersRequest = {}, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...satelliteOwnersQueryOptions(() => client.getSatelliteOwners(request), request),
    enabled: options?.enabled ?? true
  });
}

export function useSatelliteOwnerProfileQuery(owner: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...satelliteOwnerProfileQueryOptions(owner || 'missing', () => client.getSatelliteOwnerProfile(String(owner))),
    enabled: (options?.enabled ?? true) && Boolean(owner)
  });
}

export function useInfoHubQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...infoHubQueryOptions(() => client.getInfoHub()),
    enabled: options?.enabled ?? true
  });
}

export function useContentPageQuery(slug: string | null, options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...contentPageQueryOptions(slug || 'missing', () => client.getContentPage(String(slug))),
    enabled: (options?.enabled ?? true) && Boolean(slug)
  });
}

export function useCatalogHubQuery(options?: { enabled?: boolean }) {
  const client = useMobileApiClient();

  return useQuery({
    ...catalogHubQueryOptions(() => client.getCatalogHub()),
    enabled: options?.enabled ?? true
  });
}

export function useCatalogCollectionQuery(
  entity: CatalogEntityTypeV1 | null,
  request: CatalogCollectionRequest = {},
  options?: { enabled?: boolean }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...catalogCollectionQueryOptions(entity || 'missing', () => client.getCatalogCollection(entity as CatalogEntityTypeV1, request), request),
    enabled: (options?.enabled ?? true) && Boolean(entity)
  });
}

export function useCatalogDetailQuery(
  entity: CatalogEntityTypeV1 | null,
  entityId: string | null,
  options?: { enabled?: boolean }
) {
  const client = useMobileApiClient();

  return useQuery({
    ...catalogDetailQueryOptions(entity || 'missing', entityId || 'missing', () => client.getCatalogDetail(entity as CatalogEntityTypeV1, String(entityId))),
    enabled: (options?.enabled ?? true) && Boolean(entity) && Boolean(entityId)
  });
}
