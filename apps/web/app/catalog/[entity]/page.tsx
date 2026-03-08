import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BRAND_NAME } from '@/lib/brand';
import { CatalogCollectionView } from '@/components/catalog/CatalogCollectionView';
import {
  buildCatalogCollectionPath,
  getCatalogEntityOption,
  parseCatalogEntity,
  resolveCatalogPage,
  resolveCatalogQuery,
  resolveCatalogRegion
} from '@/lib/utils/catalog';
import { hasPresentSearchParams, type RouteSearchParams } from '@/lib/utils/searchParams';

type SearchParams = RouteSearchParams;

export function generateMetadata({
  params,
  searchParams
}: {
  params: { entity: string };
  searchParams?: SearchParams;
}): Metadata {
  const entity = parseCatalogEntity(params.entity);
  if (!entity) {
    return {
      title: `Not found | ${BRAND_NAME}`,
      robots: { index: false, follow: false }
    };
  }

  const activeMeta = getCatalogEntityOption(entity);
  const query = resolveCatalogQuery(searchParams?.q);
  const page = resolveCatalogPage(searchParams?.page);
  const titleBase = `${activeMeta.label} | Catalog | ${BRAND_NAME}`;
  const title = query ? `${query} | ${titleBase}` : titleBase;
  const titleWithPage = page > 1 ? `${title} (Page ${page})` : title;

  return {
    title: titleWithPage,
    description: query ? `Search ${activeMeta.label.toLowerCase()} in the Launch Library 2 catalog.` : activeMeta.description,
    alternates: { canonical: buildCatalogCollectionPath(entity) },
    robots: hasPresentSearchParams(searchParams)
      ? {
          index: false,
          follow: true
        }
      : undefined
  };
}

export default async function CatalogEntityCollectionPage({
  params,
  searchParams
}: {
  params: { entity: string };
  searchParams?: SearchParams;
}) {
  const entity = parseCatalogEntity(params.entity);
  if (!entity) return notFound();

  return (
    <CatalogCollectionView
      activeEntity={entity}
      region={resolveCatalogRegion(searchParams?.region)}
      query={resolveCatalogQuery(searchParams?.q)}
      page={resolveCatalogPage(searchParams?.page)}
    />
  );
}
