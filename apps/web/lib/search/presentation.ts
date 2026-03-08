import type { SearchResultType, SiteSearchResult } from '@/lib/search/shared';

const SEARCH_TYPE_LABELS: Record<SearchResultType, string> = {
  launch: 'Launch',
  hub: 'Hub',
  guide: 'Guide',
  news: 'News',
  contract: 'Contract',
  person: 'Person',
  recovery: 'Recovery',
  catalog: 'Catalog',
  page: 'Page'
};

const SEARCH_TYPE_EMPTY_TEXT: Record<SearchResultType, string> = {
  launch: 'Launch detail',
  hub: 'Program or mission hub',
  guide: 'Guide',
  news: 'News item',
  contract: 'Contract record',
  person: 'Crew, traveler, or astronaut',
  recovery: 'Recovery asset',
  catalog: 'Catalog entry',
  page: 'Site page'
};

export function getSiteSearchBadge(result: SiteSearchResult) {
  return result.badge || SEARCH_TYPE_LABELS[result.type];
}

export function getSiteSearchPreview(result: SiteSearchResult) {
  return result.subtitle || result.summary || SEARCH_TYPE_EMPTY_TEXT[result.type];
}

export function isExternalSearchUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

export function formatSiteSearchShortDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit'
  }).format(date);
}

export function formatSiteSearchLongDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(date);
}
