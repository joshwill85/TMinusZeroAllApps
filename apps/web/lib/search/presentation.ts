import type { SearchResultV1 } from '@tminuszero/contracts';
import type { SearchResultType, SiteSearchResult } from '@tminuszero/domain';

type SearchPresentationResult = Pick<SiteSearchResult, 'badge' | 'subtitle' | 'summary' | 'publishedAt'> &
  Partial<Pick<SiteSearchResult, 'url'>> &
  Partial<Pick<SearchResultV1, 'href'>> & {
    type: string;
  };

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

export function getSiteSearchBadge(result: SearchPresentationResult) {
  return result.badge || SEARCH_TYPE_LABELS[result.type as SearchResultType] || 'Page';
}

export function getSiteSearchPreview(result: SearchPresentationResult) {
  return result.subtitle || result.summary || SEARCH_TYPE_EMPTY_TEXT[result.type as SearchResultType] || 'Site page';
}

export function getSiteSearchHref(result: SearchPresentationResult) {
  return typeof result.href === 'string' && result.href.trim()
    ? result.href
    : typeof result.url === 'string' && result.url.trim()
      ? result.url
      : '/search';
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
