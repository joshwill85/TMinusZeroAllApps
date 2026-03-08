export const ARTEMIS_SOURCE_URLS = {
  nasaCampaign: 'https://www.nasa.gov/humans-in-space/artemis/',
  nasaBlog: 'https://www.nasa.gov/blogs/artemis/',
  nasaTimeline: 'https://www.nasa.gov/reference/artemis-i-mission-timeline/',
  nasaMissionsFeed: 'https://www.nasa.gov/missions/artemis/feed/',
  nasaBlogFeed: 'https://www.nasa.gov/blogs/artemis/feed/',
  oigAudits: 'https://oig.nasa.gov/audits/',
  oigFeed: 'https://oig.nasa.gov/feed/',
  gaoArtemisQuery: 'https://www.gao.gov/search?search_api_fulltext=artemis',
  nasaBudgetHub: 'https://www.nasa.gov/budgets-plans-and-reports/',
  nasaBudgetRequestFy17: 'https://www.nasa.gov/fiscal-year-2017-budget-request/',
  nasaBudgetRequestFy18: 'https://www.nasa.gov/nasa-fiscal-year-2018-budget-request/',
  nasaBudgetRequestFy19: 'https://www.nasa.gov/nasa-fiscal-year-2019-budget-request/',
  nasaBudgetRequestFy20: 'https://www.nasa.gov/nasa-fiscal-year-2020-budget-request/',
  nasaBudgetRequestFy21: 'https://www.nasa.gov/nasa-fiscal-year-2021-budget-request/',
  nasaBudgetRequestFy22: 'https://www.nasa.gov/nasa-fiscal-year-2022-budget-request/',
  nasaBudgetRequestFy23: 'https://www.nasa.gov/nasa-fiscal-year-2023-budget-request/',
  nasaBudgetRequestFy24: 'https://www.nasa.gov/nasa-fiscal-year-2024-budget-request/',
  nasaBudgetRequestFy25: 'https://www.nasa.gov/fy-2025-budget-request/',
  nasaBudgetRequestFy26: 'https://www.nasa.gov/fy-2026-budget-request/',
  nasaBudgetTopicApiFy17: 'https://www.nasa.gov/wp-json/wp/v2/topic/480696?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy18: 'https://www.nasa.gov/wp-json/wp/v2/topic/476802?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy19: 'https://www.nasa.gov/wp-json/wp/v2/topic/476649?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy20: 'https://www.nasa.gov/wp-json/wp/v2/topic/475166?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy21: 'https://www.nasa.gov/wp-json/wp/v2/topic/475160?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy22: 'https://www.nasa.gov/wp-json/wp/v2/topic/474777?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy23: 'https://www.nasa.gov/wp-json/wp/v2/topic/474763?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy24: 'https://www.nasa.gov/wp-json/wp/v2/topic/474743?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy25: 'https://www.nasa.gov/wp-json/wp/v2/topic/629619?_fields=id,date,modified,link,title,content',
  nasaBudgetTopicApiFy26: 'https://www.nasa.gov/wp-json/wp/v2/topic/858878?_fields=id,date,modified,link,title,content',
  nasaBudgetPressReleaseApiFy25:
    'https://www.nasa.gov/wp-json/wp/v2/press-release/629789?_fields=id,date,modified,link,title,content',
  nasaBudgetPressReleaseApiFy26:
    'https://www.nasa.gov/wp-json/wp/v2/press-release/858847?_fields=id,date,modified,link,title,content',
  ntrsSearch: 'https://ntrs.nasa.gov/api/citations/search?q=artemis&size=25',
  usaspendingTopTier: 'https://api.usaspending.gov/api/v2/references/toptier_agencies/',
  usaspendingAwardSearch: 'https://api.usaspending.gov/api/v2/search/spending_by_award/',
  usaspendingNasaBudgetaryResources: 'https://api.usaspending.gov/api/v2/agency/080/budgetary_resources/',
  nasaImagesSearch: 'https://images-api.nasa.gov/search?q=Artemis&media_type=image&page=1',
  techportRoot: 'https://techport.nasa.gov'
} as const;

const USER_AGENT = 'TMinusZero/0.1 (+https://tminusnow.app)';

export async function fetchTextWithMeta(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*'
    }
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    text
  };
}

export async function fetchJsonWithMeta(url: string) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,*/*'
    }
  });

  const body = await response.text();
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    json,
    text: body
  };
}

export function stripHtml(text: string) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractRssItems(xml: string) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => ({
    title: decodeXml(findTag(item, 'title') || ''),
    link: decodeXml(findTag(item, 'link') || ''),
    pubDate: decodeXml(findTag(item, 'pubDate') || ''),
    description: decodeXml(findTag(item, 'description') || ''),
    categories: findTags(item, 'category')
      .map((value) => decodeXml(value))
      .map((value) => stripHtml(value))
      .filter((value) => value.length > 0),
    imageUrl:
      decodeXml(findAttribute(item, 'media:content', 'url') || '') ||
      decodeXml(
        extractMatch(decodeXml(findTag(item, 'content:encoded') || ''), /<a[^>]+href="([^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/i) ||
          extractMatch(decodeXml(findTag(item, 'content:encoded') || ''), /<img[^>]+src="([^"]+)"/i) ||
          ''
      ) ||
      null
  }));
}

function findTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return null;
  return match[1];
}

function findTags(xml: string, tag: string) {
  const rows = [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi'))];
  return rows.map((match) => match[1] || '').filter((value) => value.length > 0);
}

function findAttribute(xml: string, tag: string, attribute: string) {
  const match = xml.match(new RegExp(`<${tag}[^>]*\\b${attribute}="([^"]+)"`, 'i'));
  if (!match) return null;
  return match[1] || null;
}

function extractMatch(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return match[1] || null;
}

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
