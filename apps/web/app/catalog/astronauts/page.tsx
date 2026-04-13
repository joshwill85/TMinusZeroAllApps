import type { Metadata } from 'next';
import { CatalogCollectionView } from '@/components/catalog/CatalogCollectionView';
import { BRAND_NAME } from '@/lib/brand';
import {
  buildCatalogCollectionPath,
  getCatalogEntityOption,
  resolveCatalogPage,
  resolveCatalogQuery,
  resolveCatalogRegion
} from '@/lib/utils/catalog';
import { hasPresentSearchParams, type RouteSearchParams } from '@/lib/utils/searchParams';

type SearchParams = RouteSearchParams;

const ASTRONAUTS_ENTITY = 'astronauts' as const;

export function generateMetadata({
  searchParams
}: {
  searchParams?: SearchParams;
}): Metadata {
  const activeMeta = getCatalogEntityOption(ASTRONAUTS_ENTITY);
  const query = resolveCatalogQuery(searchParams?.q);
  const page = resolveCatalogPage(searchParams?.page);
  const titleBase = `${activeMeta.label} | Catalog | ${BRAND_NAME}`;
  const title = query ? `${query} | ${titleBase}` : titleBase;
  const titleWithPage = page > 1 ? `${title} (Page ${page})` : title;

  return {
    title: titleWithPage,
    description: query
      ? `Search ${activeMeta.label.toLowerCase()} in the Launch Library 2 catalog.`
      : activeMeta.description,
    alternates: { canonical: buildCatalogCollectionPath(ASTRONAUTS_ENTITY) },
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined
  };
}

export default function CatalogAstronautCollectionPage({
  searchParams
}: {
  searchParams?: SearchParams;
}) {
  return (
    <CatalogCollectionView
      activeEntity={ASTRONAUTS_ENTITY}
      region={resolveCatalogRegion(searchParams?.region)}
      query={resolveCatalogQuery(searchParams?.q)}
      page={resolveCatalogPage(searchParams?.page)}
    />
  );
}
