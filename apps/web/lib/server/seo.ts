import type { Metadata } from 'next';
import { getIndexingSiteUrl } from '@/lib/server/indexing';
import { buildSiteMeta, SITE_META } from '@/lib/server/siteMeta';

type SocialMetadataOptions = {
  imageUrl?: string;
  imageAlt?: string;
  openGraphTitle?: string;
  openGraphDescription?: string;
  openGraphType?: 'website' | 'article';
  twitterTitle?: string;
  twitterDescription?: string;
};

export type BreadcrumbItem = {
  name: string;
  item: string;
};

export function normalizeCanonicalPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

export function buildCanonicalUrl(canonicalPath: string) {
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return `${siteUrl}${normalizeCanonicalPath(canonicalPath)}`;
}

export function buildPageMetadata({
  title,
  description,
  canonical,
  robots,
  keywords,
  includeSocial = true,
  social
}: {
  title: string;
  description: string;
  canonical: string;
  robots?: Metadata['robots'];
  keywords?: Metadata['keywords'];
  includeSocial?: boolean;
  social?: SocialMetadataOptions;
}): Metadata {
  const canonicalPath = normalizeCanonicalPath(canonical);
  const pageUrl = buildCanonicalUrl(canonicalPath);
  const siteMeta = buildSiteMeta();
  const imageUrl = social?.imageUrl || siteMeta.ogImage;
  const imageAlt = social?.imageAlt || SITE_META.ogImageAlt;

  return {
    title,
    description,
    ...(keywords ? { keywords } : {}),
    alternates: { canonical: canonicalPath },
    ...(robots ? { robots } : {}),
    ...(includeSocial
      ? {
          openGraph: {
            title: social?.openGraphTitle || title,
            description: social?.openGraphDescription || description,
            url: pageUrl,
            type: social?.openGraphType || 'website',
            siteName: SITE_META.siteName,
            images: [
              {
                url: imageUrl,
                width: 1200,
                height: 630,
                alt: imageAlt,
                type: 'image/jpeg'
              }
            ]
          },
          twitter: {
            card: 'summary_large_image',
            title: social?.twitterTitle || social?.openGraphTitle || title,
            description:
              social?.twitterDescription ||
              social?.openGraphDescription ||
              description,
            images: [{ url: imageUrl, alt: imageAlt }]
          }
        }
      : {})
  };
}

export function buildBreadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: resolveSchemaUrl(item.item)
    }))
  };
}

export function buildWebPageJsonLd({
  canonical,
  name,
  description
}: {
  canonical: string;
  name: string;
  description: string;
}) {
  const pageUrl = buildCanonicalUrl(canonical);
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': pageUrl,
    url: pageUrl,
    name,
    description,
    isPartOf: { '@id': `${siteUrl}#website` },
    publisher: { '@id': `${siteUrl}#organization` }
  };
}

export function buildCollectionPageJsonLd({
  canonical,
  name,
  description,
  mainEntityId
}: {
  canonical: string;
  name: string;
  description: string;
  mainEntityId?: string;
}) {
  const pageUrl = buildCanonicalUrl(canonical);
  const siteUrl = getIndexingSiteUrl().replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': pageUrl,
    url: pageUrl,
    name,
    description,
    isPartOf: { '@id': `${siteUrl}#website` },
    publisher: { '@id': `${siteUrl}#organization` },
    ...(mainEntityId ? { mainEntity: { '@id': mainEntityId } } : {})
  };
}

function resolveSchemaUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return buildCanonicalUrl(value);
}
