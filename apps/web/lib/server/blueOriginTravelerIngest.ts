import { cache } from 'react';
import type { BlueOriginPassenger } from '@/lib/types/blueOrigin';
import {
  buildBlueOriginFlightSlug,
  extractBlueOriginFlightCodeFromUrl,
  normalizeBlueOriginTravelerProfileUrl,
  normalizeBlueOriginTravelerRole
} from '@/lib/utils/blueOrigin';

const WIKIPEDIA_API_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_CATEGORY_TITLE = 'Category:New Shepard missions';
const LL2_API_BASE = 'https://ll.thespacedevs.com/2.2.0';
const WAYBACK_CDX_API_URL = 'https://web.archive.org/cdx/search/cdx';
const WAYBACK_NEWS_PREFIX = 'www.blueorigin.com/news/';
const WAYBACK_ASTRONAUTS_PAGE_URL = 'https://www.blueorigin.com/new-shepard/astronauts';
const REQUEST_TIMEOUT_MS = 9000;
const LL2_REQUEST_TIMEOUT_MS = 12000;
const WAYBACK_CDX_TIMEOUT_MS = 20000;
const WAYBACK_REQUEST_TIMEOUT_MS = 9000;
const CATEGORY_BATCH_LIMIT = 500;
const WIKITEXT_BATCH_SIZE = 20;
const PROFILE_BATCH_SIZE = 20;
const LL2_FETCH_RETRIES = 3;
const LL2_RETRY_BACKOFF_MS = 900;
const WAYBACK_FETCH_RETRIES = 1;
const WAYBACK_RETRY_BACKOFF_MS = 800;
const WAYBACK_FETCH_CONCURRENCY = 2;
const WAYBACK_MISSION_TIMESTAMP_FALLBACKS = 4;
const WAYBACK_ASTRONAUTS_TIMESTAMP_FALLBACKS = 3;

const NAME_DESCRIPTOR_STOPWORDS = new Set<string>([
  'action',
  'administration',
  'architect',
  'air',
  'astronaut',
  'attorney',
  'aviation',
  'black',
  'businessman',
  'businesswoman',
  'cables',
  'candidate',
  'capital',
  'ceo',
  'chairman',
  'chief',
  'co',
  'commercial',
  'commodity',
  'conservationist',
  'cofounder',
  'cohost',
  'daily',
  'developer',
  'doctor',
  'dr',
  'engineer',
  'entrepreneur',
  'executive',
  'equity',
  'explorer',
  'faa',
  'facebook',
  'federal',
  'filmmaker',
  'force',
  'founder',
  'global',
  'host',
  'insight',
  'labs',
  'linkedin',
  'markets',
  'investor',
  'lawyer',
  'meteorologist',
  'mission',
  'new',
  'office',
  'oprah',
  'origin',
  'operations',
  'passenger',
  'planet',
  'philanthropist',
  'pilot',
  'president',
  'professor',
  'reddit',
  'researcher',
  'scientist',
  'share',
  'shepard',
  'space',
  'states',
  'teacher',
  'times',
  'transportation',
  'united',
  'variation',
  'ventures',
  'vice',
  'york'
]);

type CategoryMember = {
  title: string;
};

type WikiCrewPerson = {
  name: string;
  wikiTitle: string | null;
  role: string | null;
};

type ParsedMissionCrew = {
  flightCode: string;
  launchDate: string | null;
  people: WikiCrewPerson[];
};

type WikiProfile = {
  title: string;
  fullUrl: string | null;
  imageUrl: string | null;
  extract: string | null;
};

type Ll2PaginatedResponse<T> = {
  next?: string | null;
  results?: T[];
};

type WaybackCdxResponseRow = [string?, string?, string?, string?];

type WaybackSnapshot = {
  missionUrl: string;
  flightCode: string;
  timestamps: string[];
};

type Ll2LaunchListItem = {
  id: string;
  name: string | null;
  net: string | null;
  launch_service_provider?: { name?: string | null } | null;
  rocket?: {
    spacecraft_stage?: {
      launch_crew?: Array<{
        role?: { role?: string | null } | null;
        astronaut?: {
          id?: number | null;
          url?: string | null;
          name?: string | null;
          nationality?: string | null;
          bio?: string | null;
          profile_image?: string | null;
          profile_image_thumbnail?: string | null;
          image?: {
            image_url?: string | null;
            thumbnail_url?: string | null;
            imageUrl?: string | null;
            thumbnailUrl?: string | null;
            url?: string | null;
          } | null;
          image_url?: string | null;
          imageUrl?: string | null;
          profileImage?: string | null;
          profileImageThumbnail?: string | null;
          wiki?: string | null;
        } | null;
      }>;
    } | null;
  } | null;
};

const withCache =
  typeof cache === 'function'
    ? cache
    : (<T extends (...args: any[]) => any>(fn: T): T => fn);

let ll2PassengersStaleCache: BlueOriginPassenger[] = [];
let waybackPassengersStaleCache: BlueOriginPassenger[] = [];
let waybackAstronautDirectoryStaleCache: BlueOriginPassenger[] = [];

export const fetchBlueOriginWikipediaPassengers = withCache(async (): Promise<BlueOriginPassenger[]> => {
  return fetchBlueOriginWikipediaPassengersRaw();
});

export const fetchBlueOriginLl2Passengers = withCache(async (): Promise<BlueOriginPassenger[]> => {
  return fetchBlueOriginLl2PassengersRaw();
});

export const fetchBlueOriginWaybackMissionPassengers = withCache(
  async (): Promise<BlueOriginPassenger[]> => {
    return fetchBlueOriginWaybackMissionPassengersRaw();
  }
);

export const fetchBlueOriginWaybackAstronautDirectoryPassengers = withCache(
  async (): Promise<BlueOriginPassenger[]> => {
    return fetchBlueOriginWaybackAstronautDirectoryPassengersRaw();
  }
);

export async function fetchBlueOriginWikipediaPassengersRaw(): Promise<BlueOriginPassenger[]> {
  try {
    const pageTitles = await fetchMissionPageTitles();
    if (pageTitles.length === 0) return [];

    const wikitextByPage = await fetchWikitextByPageTitles(pageTitles);
    if (wikitextByPage.size === 0) return [];

    const parsedMissions: ParsedMissionCrew[] = [];
    for (const [title, wikitext] of wikitextByPage.entries()) {
      const parsed = parseMissionCrewFromWikitext(title, wikitext);
      if (!parsed || parsed.people.length === 0) continue;
      parsedMissions.push(parsed);
    }

    if (parsedMissions.length === 0) return [];

    const personTitleSet = new Set<string>();
    for (const mission of parsedMissions) {
      for (const person of mission.people) {
        const wikiTitle = normalizeWikiTitle(person.wikiTitle);
        if (wikiTitle) personTitleSet.add(wikiTitle);
      }
    }

    const profilesByTitle = await fetchWikipediaProfilesByTitle([...personTitleSet]);

    const rows: BlueOriginPassenger[] = [];
    for (const mission of parsedMissions) {
      for (const person of mission.people) {
        const normalizedTitle = normalizeWikiTitle(person.wikiTitle);
        const profile = normalizedTitle ? profilesByTitle.get(normalizedTitle) || null : null;

        rows.push({
          id: `wikipedia:${mission.flightCode}:${slugifyPersonName(person.name)}`,
          missionKey: 'new-shepard',
          flightCode: mission.flightCode,
          flightSlug: buildBlueOriginFlightSlug(mission.flightCode),
          name: person.name,
          role: person.role || 'Passenger',
          nationality: null,
          launchId: null,
          launchName: `New Shepard | ${mission.flightCode.toUpperCase()}`,
          launchDate: mission.launchDate,
          profileUrl: profile?.fullUrl || null,
          imageUrl: profile?.imageUrl || null,
          bio: trimBio(profile?.extract || null),
          source: 'wikipedia:new-shepard-missions',
          confidence: 'medium'
        });
      }
    }

    return dedupeByFlightAndName(rows);
  } catch (error) {
    console.error('blue origin wikipedia traveler ingest error', error);
    return [];
  }
}

export async function fetchBlueOriginLl2PassengersRaw(): Promise<BlueOriginPassenger[]> {
  try {
    const launches = await fetchLl2NewShepardLaunches();
    if (!launches.length) return [];

    const rows: BlueOriginPassenger[] = [];
    for (const launch of launches) {
      const flightCode = normalizeFlightCode(extractFlightCodeFromText(launch.name));
      if (!flightCode) continue;
      const flightNumber = Number(flightCode.replace(/^ns-/i, ''));
      if (Number.isFinite(flightNumber) && flightNumber < 16) continue;

      const providerName = (launch.launch_service_provider?.name || '').trim().toLowerCase();
      const launchName = (launch.name || '').trim();
      const looksBlueOrigin =
        providerName.includes('blue origin') || launchName.toLowerCase().includes('new shepard');
      if (!looksBlueOrigin) continue;

      const crewRows = launch.rocket?.spacecraft_stage?.launch_crew || [];
      for (const crewRow of crewRows) {
        const astronaut = crewRow?.astronaut;
        const cleanedName = sanitizeCrewName(astronaut?.name || '');
        if (!cleanedName) continue;
        if (/mannequin|dummy|test payload/i.test(cleanedName)) continue;

        const imageUrl = normalizeAbsoluteUrl(
          astronaut?.profile_image_thumbnail ||
            astronaut?.profile_image ||
            astronaut?.image?.thumbnail_url ||
            astronaut?.image?.thumbnailUrl ||
            astronaut?.image?.image_url ||
            astronaut?.image?.imageUrl ||
            astronaut?.image_url ||
            astronaut?.imageUrl ||
            null
        );
        const wikiUrl = normalizeAbsoluteUrl(astronaut?.wiki || null);
        const astronautUrl = normalizeAbsoluteUrl(astronaut?.url || null);
        const profileUrl = wikiUrl || astronautUrl;
        const role = normalizeCrewRole(crewRow?.role?.role || null);

        rows.push({
          id: `ll2-api:${launch.id}:${slugifyPersonName(cleanedName)}`,
          missionKey: 'new-shepard',
          flightCode,
          flightSlug: buildBlueOriginFlightSlug(flightCode),
          name: cleanedName,
          role: role || 'Passenger',
          nationality: normalizeWikitextValue(astronaut?.nationality || '') || null,
          launchId: normalizeWikitextValue(launch.id || '') || null,
          launchName: launchName || `New Shepard | ${flightCode.toUpperCase()}`,
          launchDate: launch.net || null,
          profileUrl,
          imageUrl,
          bio: trimBio(astronaut?.bio || null),
          source: 'll2-api:new-shepard-detailed',
          confidence: 'high'
        });
      }
    }

    const deduped = dedupeByFlightAndName(rows);
    if (deduped.length) {
      ll2PassengersStaleCache = deduped;
    }
    return deduped;
  } catch (error) {
    console.error('blue origin ll2 traveler ingest error', error);
    if (ll2PassengersStaleCache.length) {
      return ll2PassengersStaleCache;
    }
    return [];
  }
}

export async function fetchBlueOriginWaybackMissionPassengersRaw(): Promise<BlueOriginPassenger[]> {
  try {
    const snapshots = await fetchWaybackMissionSnapshots();
    if (!snapshots.length) return [];

    const rows = await mapWithConcurrency(snapshots, WAYBACK_FETCH_CONCURRENCY, async (snapshot) => {
      const timestamps = snapshot.timestamps.length ? snapshot.timestamps : [];

      for (const timestamp of timestamps) {
        try {
          const snapshotUrl = buildWaybackSnapshotUrl(timestamp, snapshot.missionUrl);
          const html = await fetchTextWithRetry(
            snapshotUrl,
            WAYBACK_REQUEST_TIMEOUT_MS,
            WAYBACK_FETCH_RETRIES,
            WAYBACK_RETRY_BACKOFF_MS
          );
          if (!html) continue;
          const parsedRows = parseWaybackMissionPassengers(html, snapshot);
          if (parsedRows.length) return parsedRows;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `blue origin wayback mission fetch skipped for ${snapshot.flightCode} @ ${timestamp}: ${message}`
          );
        }
      }

      return [] as BlueOriginPassenger[];
    });

    const flattened = rows.flat();
    const deduped = dedupeByFlightAndName(flattened);
    if (deduped.length) {
      waybackPassengersStaleCache = deduped;
    }
    return deduped;
  } catch (error) {
    console.error('blue origin wayback mission traveler ingest error', error);
    if (waybackPassengersStaleCache.length) {
      return waybackPassengersStaleCache;
    }
    return [];
  }
}

export async function fetchBlueOriginWaybackAstronautDirectoryPassengersRaw(): Promise<BlueOriginPassenger[]> {
  try {
    const timestamps = await fetchWaybackAstronautDirectoryTimestamps();
    if (!timestamps.length) return [];

    for (const timestamp of timestamps) {
      try {
        const snapshotUrl = buildWaybackSnapshotUrl(timestamp, WAYBACK_ASTRONAUTS_PAGE_URL);
        const html = await fetchTextWithRetry(
          snapshotUrl,
          WAYBACK_REQUEST_TIMEOUT_MS,
          WAYBACK_FETCH_RETRIES,
          WAYBACK_RETRY_BACKOFF_MS
        );
        if (!html) continue;
        const parsedRows = parseWaybackAstronautDirectoryPassengers(html);
        if (!parsedRows.length) continue;

        const deduped = dedupeByFlightAndName(parsedRows);
        if (deduped.length) {
          waybackAstronautDirectoryStaleCache = deduped;
          return deduped;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`blue origin wayback astronaut directory fetch skipped @ ${timestamp}: ${message}`);
      }
    }

    return waybackAstronautDirectoryStaleCache.length ? waybackAstronautDirectoryStaleCache : [];
  } catch (error) {
    console.error('blue origin wayback astronaut directory ingest error', error);
    if (waybackAstronautDirectoryStaleCache.length) {
      return waybackAstronautDirectoryStaleCache;
    }
    return [];
  }
}

export async function fetchBlueOriginWikipediaProfilesByNames(names: string[]) {
  const lookups = new Map<
    string,
    {
      profileUrl: string | null;
      imageUrl: string | null;
      bio: string | null;
    }
  >();

  const dedupedNames = [...new Set(names.map((value) => sanitizeCrewName(value)).filter(Boolean))] as string[];
  if (!dedupedNames.length) return lookups;

  const profilesByTitle = await fetchWikipediaProfilesByTitle(dedupedNames);
  const unresolvedNames: string[] = [];

  for (const name of dedupedNames) {
    const titleKey = normalizeWikiTitle(name);
    const profile = titleKey ? profilesByTitle.get(titleKey) || null : null;
    if (!profile) {
      unresolvedNames.push(name);
      continue;
    }

    const key = normalizeNameKey(name);
    if (!key) continue;
    lookups.set(key, {
      profileUrl: profile.fullUrl || null,
      imageUrl: profile.imageUrl || null,
      bio: trimBio(profile.extract || null)
    });
  }

  for (const name of unresolvedNames) {
    const searchProfile = await fetchWikipediaProfileBySearch(name);
    if (!searchProfile) continue;
    if (!isReasonableWikipediaNameMatch(name, searchProfile.title)) continue;
    const key = normalizeNameKey(name);
    if (!key) continue;
    lookups.set(key, {
      profileUrl: searchProfile.fullUrl || null,
      imageUrl: searchProfile.imageUrl || null,
      bio: trimBio(searchProfile.extract || null)
    });
  }

  return lookups;
}

async function fetchMissionPageTitles() {
  const titles: string[] = [];
  let continuation: string | null = null;

  while (titles.length < CATEGORY_BATCH_LIMIT) {
    const url = new URL(WIKIPEDIA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'categorymembers');
    url.searchParams.set('cmtitle', WIKIPEDIA_CATEGORY_TITLE);
    url.searchParams.set('cmnamespace', '0');
    url.searchParams.set('cmlimit', 'max');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    if (continuation) {
      url.searchParams.set('cmcontinue', continuation);
    }

    const json = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS);
    const members = (json?.query?.categorymembers || []) as CategoryMember[];
    for (const member of members) {
      const title = normalizeTitle(member?.title);
      if (!title) continue;
      if (!isBlueOriginMissionTitle(title)) continue;
      if (!titles.includes(title)) {
        titles.push(title);
      }
    }

    continuation = typeof json?.continue?.cmcontinue === 'string' ? json.continue.cmcontinue : null;
    if (!continuation) break;
  }

  return titles.sort((a, b) => compareFlightCodes(extractFlightCodeFromTitle(a), extractFlightCodeFromTitle(b)));
}

async function fetchWikitextByPageTitles(pageTitles: string[]) {
  const byTitle = new Map<string, string>();

  for (let index = 0; index < pageTitles.length; index += WIKITEXT_BATCH_SIZE) {
    const chunk = pageTitles.slice(index, index + WIKITEXT_BATCH_SIZE);
    if (chunk.length === 0) continue;

    const url = new URL(WIKIPEDIA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('prop', 'revisions');
    url.searchParams.set('rvprop', 'content');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('titles', chunk.join('|'));
    url.searchParams.set('redirects', '1');

    const json = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS);
    const pages = Array.isArray(json?.query?.pages) ? json.query.pages : [];
    for (const page of pages) {
      const title = normalizeTitle(page?.title);
      const content = page?.revisions?.[0]?.content;
      if (!title || typeof content !== 'string' || !content.trim()) continue;
      if (!isBlueOriginMissionTitle(title)) continue;
      byTitle.set(title, content);
    }
  }

  return byTitle;
}

function parseMissionCrewFromWikitext(title: string, wikitext: string): ParsedMissionCrew | null {
  const flightCode = extractFlightCodeFromTitle(title);
  if (!flightCode) return null;

  const launchDate = parseLaunchDateFromWikitext(wikitext);
  const crewByName = new Map<string, WikiCrewPerson>();
  const rolesByIndex = parseRolesByIndex(wikitext);

  const crewMembersField = parseInfoboxCrewMembersField(wikitext);
  for (const person of crewMembersField) {
    const key = crewPersonKey(person);
    if (!key) continue;
    crewByName.set(key, person);
  }

  const crewTemplateRows = parseSpaceflightCrewRows(wikitext, rolesByIndex);
  for (const person of crewTemplateRows) {
    const key = crewPersonKey(person);
    if (!key) continue;

    const existing = crewByName.get(key);
    if (!existing) {
      crewByName.set(key, person);
      continue;
    }

    if (!existing.wikiTitle && person.wikiTitle) existing.wikiTitle = person.wikiTitle;
    if (!existing.role && person.role) existing.role = person.role;
  }

  const people = [...crewByName.values()];
  if (people.length === 0) return null;

  return {
    flightCode,
    launchDate,
    people
  };
}

function crewPersonKey(person: WikiCrewPerson) {
  const titleKey = normalizeWikiTitle(person.wikiTitle)?.toLowerCase() || null;
  if (titleKey) return `title:${titleKey}`;
  const nameKey = normalizeNameKey(person.name);
  return nameKey ? `name:${nameKey}` : null;
}

function parseInfoboxCrewMembersField(wikitext: string) {
  const people: WikiCrewPerson[] = [];
  const match = wikitext.match(/\|\s*crew_members\s*=\s*([\s\S]*?)(?:\n\|\s*[a-zA-Z0-9_]+\s*=|\n\}\})/i);
  if (!match?.[1]) return people;

  const links = extractWikiLinks(match[1]);
  for (const link of links) {
    const cleanedName = sanitizeCrewName(link.name);
    if (!cleanedName) continue;
    people.push({
      name: cleanedName,
      wikiTitle: link.title,
      role: null
    });
  }
  return people;
}

function parseRolesByIndex(wikitext: string) {
  const roles = new Map<number, string>();
  const pattern = /\|\s*position(\d+)\s*=\s*([^\n]+)/gi;
  for (const match of wikitext.matchAll(pattern)) {
    const index = Number(match[1]);
    const raw = normalizeWikitextValue(match[2]);
    if (!Number.isFinite(index) || !raw) continue;
    roles.set(index, raw);
  }
  return roles;
}

function parseSpaceflightCrewRows(wikitext: string, rolesByIndex: Map<number, string>) {
  const people: WikiCrewPerson[] = [];
  const pattern = /\|\s*crew(\d+)_(?:up|down)\s*=\s*([^\n]+)/gi;
  for (const match of wikitext.matchAll(pattern)) {
    const index = Number(match[1]);
    const rawValue = match[2] || '';
    const inlineRoleMatch = rawValue.match(/\|\s*position\d+(?:_(?:up|down))?\s*=\s*([^|]+)/i);
    const inlineRole = normalizeWikitextValue(inlineRoleMatch?.[1] || '');
    const primarySegment =
      rawValue.split(/\|\s*(?:position\d+(?:_(?:up|down))?|flights\d+(?:_(?:up|down))?|crew\d+_(?:up|down))\s*=/i)[0] ||
      rawValue;
    const links = extractWikiLinks(primarySegment);
    const role = Number.isFinite(index) ? rolesByIndex.get(index) || inlineRole || null : inlineRole || null;

    if (links.length > 0) {
      for (const link of links) {
        const cleanedName = sanitizeCrewName(link.name);
        if (!cleanedName) continue;
        people.push({
          name: cleanedName,
          wikiTitle: link.title,
          role
        });
      }
      continue;
    }

    const textName = sanitizeCrewName(primarySegment);
    if (!textName) continue;
    people.push({
      name: textName,
      wikiTitle: null,
      role
    });
  }
  return people;
}

function extractWikiLinks(raw: string) {
  const links: Array<{ title: string | null; name: string }> = [];
  const pattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

  for (const match of raw.matchAll(pattern)) {
    const rawTitle = match[1] || '';
    const rawLabel = match[2] || rawTitle;
    const title = normalizeWikitextValue(rawTitle);
    const name = normalizeWikitextValue(rawLabel);
    if (!name) continue;
    links.push({
      title: title || null,
      name
    });
  }

  return links;
}

function parseLaunchDateFromWikitext(wikitext: string) {
  const startDate = wikitext.match(/\|\s*launch_date\s*=\s*\{\{(?:Start date|start date)\|(\d{4})\|(\d{1,2})\|(\d{1,2})/);
  if (startDate?.[1] && startDate?.[2] && startDate?.[3]) {
    const year = Number(startDate[1]);
    const month = Number(startDate[2]);
    const day = Number(startDate[3]);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Date(Date.UTC(year, Math.max(0, month - 1), day, 0, 0, 0)).toISOString();
    }
  }

  const textualDate = wikitext.match(/\|\s*launch_date\s*=\s*[^,\n]*?([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (textualDate?.[1]) {
    const parsed = Date.parse(textualDate[1]);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

async function fetchWikipediaProfilesByTitle(titles: string[]) {
  const byTitle = new Map<string, WikiProfile>();
  for (let index = 0; index < titles.length; index += PROFILE_BATCH_SIZE) {
    const chunk = titles.slice(index, index + PROFILE_BATCH_SIZE);
    if (chunk.length === 0) continue;

    const url = new URL(WIKIPEDIA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('prop', 'pageimages|extracts|info');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('pithumbsize', '600');
    url.searchParams.set('exintro', '1');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('redirects', '1');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('titles', chunk.join('|'));

    const json = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS);
    const pages = Array.isArray(json?.query?.pages) ? json.query.pages : [];
    for (const page of pages) {
      const normalizedTitle = normalizeWikiTitle(page?.title);
      if (!normalizedTitle || page?.missing) continue;
      byTitle.set(normalizedTitle, {
        title: page.title,
        fullUrl: typeof page.fullurl === 'string' ? page.fullurl : null,
        imageUrl: typeof page.thumbnail?.source === 'string' ? page.thumbnail.source : null,
        extract: typeof page.extract === 'string' ? page.extract : null
      });
    }
  }
  return byTitle;
}

async function fetchWikipediaProfileBySearch(name: string) {
  const normalizedName = normalizeWikitextValue(name);
  if (!normalizedName) return null;

  const url = new URL(WIKIPEDIA_API_URL);
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', normalizedName);
  url.searchParams.set('gsrnamespace', '0');
  url.searchParams.set('gsrlimit', '1');
  url.searchParams.set('prop', 'pageimages|extracts|info');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('pithumbsize', '600');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');

  const json = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS);
  const pages = Array.isArray(json?.query?.pages) ? json.query.pages : [];
  const page = pages.find(
    (value: { missing?: unknown } | null | undefined) => Boolean(value) && !value?.missing
  ) as
    | {
        title?: string;
        fullurl?: string;
        thumbnail?: { source?: string };
        extract?: string;
      }
    | undefined;
  if (!page) return null;
  const normalizedTitle = normalizeWikiTitle(page?.title);
  if (!normalizedTitle) return null;
  return {
    title: page.title,
    fullUrl: typeof page.fullurl === 'string' ? page.fullurl : null,
    imageUrl: typeof page.thumbnail?.source === 'string' ? page.thumbnail.source : null,
    extract: typeof page.extract === 'string' ? page.extract : null
  } as WikiProfile;
}

async function fetchWaybackMissionSnapshots() {
  const url = new URL(WAYBACK_CDX_API_URL);
  url.searchParams.set('url', WAYBACK_NEWS_PREFIX);
  url.searchParams.set('matchType', 'prefix');
  url.searchParams.set('output', 'json');
  url.searchParams.set('fl', 'timestamp,original,statuscode,mimetype');
  url.searchParams.set('filter', 'statuscode:200');
  url.searchParams.set('filter', 'mimetype:text/html');
  url.searchParams.set('from', '2021');
  url.searchParams.set('limit', '5000');

  const payload = (await fetchJsonWithRetry(
    url.toString(),
    WAYBACK_CDX_TIMEOUT_MS,
    2,
    WAYBACK_RETRY_BACKOFF_MS
  )) as WaybackCdxResponseRow[];
  const rows = Array.isArray(payload) ? payload.slice(1) : [];
  if (!rows.length) return [] as WaybackSnapshot[];

  const orderedRows = rows
    .map((row) => ({
      timestamp: normalizeOptionalText(row?.[0] || ''),
      original: normalizeOptionalText(row?.[1] || '')
    }))
    .filter(
      (row): row is { timestamp: string; original: string } =>
        Boolean(row.timestamp && row.original && /^\d{8,14}$/.test(row.timestamp))
    )
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const snapshotsByMissionUrl = new Map<string, WaybackSnapshot>();

  for (const row of orderedRows) {
    const timestampRaw = row.timestamp;
    const originalRaw = row.original;
    if (!timestampRaw || !originalRaw) continue;

    const missionUrl = normalizeBlueOriginMissionUrl(originalRaw);
    if (!missionUrl) continue;
    const flightCode = extractFlightCodeFromMissionUrl(missionUrl);
    if (!flightCode) continue;
    const flightNumber = Number(flightCode.replace(/^ns-/i, ''));
    if (!Number.isFinite(flightNumber) || flightNumber < 16) continue;

    const existing = snapshotsByMissionUrl.get(missionUrl);
    if (!existing) {
      snapshotsByMissionUrl.set(missionUrl, {
        missionUrl,
        flightCode,
        timestamps: [timestampRaw]
      });
      continue;
    }

    if (existing.timestamps.includes(timestampRaw)) continue;
    if (existing.timestamps.length >= WAYBACK_MISSION_TIMESTAMP_FALLBACKS) continue;
    existing.timestamps.push(timestampRaw);
  }

  return [...snapshotsByMissionUrl.values()]
    .filter((snapshot) => snapshot.timestamps.length > 0)
    .sort((left, right) => compareFlightCodes(right.flightCode, left.flightCode));
}

async function fetchWaybackAstronautDirectoryTimestamps() {
  const url = new URL(WAYBACK_CDX_API_URL);
  url.searchParams.set('url', WAYBACK_ASTRONAUTS_PAGE_URL);
  url.searchParams.set('output', 'json');
  url.searchParams.set('fl', 'timestamp,original,statuscode,mimetype');
  url.searchParams.set('filter', 'statuscode:200');
  url.searchParams.set('filter', 'mimetype:text/html');
  url.searchParams.set('from', '2024');
  url.searchParams.set('limit', '100');

  const payload = (await fetchJsonWithRetry(
    url.toString(),
    WAYBACK_CDX_TIMEOUT_MS,
    2,
    WAYBACK_RETRY_BACKOFF_MS
  )) as WaybackCdxResponseRow[];
  const rows = Array.isArray(payload) ? payload.slice(1) : [];
  if (!rows.length) return [] as string[];

  return rows
    .map((row) => normalizeOptionalText(row?.[0] || ''))
    .filter((value): value is string => Boolean(value && /^\d{8,14}$/.test(value)))
    .sort((left, right) => right.localeCompare(left))
    .slice(0, WAYBACK_ASTRONAUTS_TIMESTAMP_FALLBACKS);
}

function parseWaybackAstronautDirectoryPassengers(html: string) {
  const mainHtml = extractMainHtml(html) || html;
  if (!mainHtml) return [] as BlueOriginPassenger[];

  const rows: BlueOriginPassenger[] = [];
  const sectionPattern =
    /<h2[^>]*>[\s\S]*?<span[^>]*>\s*NS-(\d{1,3})\s*<\/span>[\s\S]*?<span[^>]*>([^<]+)<\/span>[\s\S]*?<\/h2>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi;

  for (const sectionMatch of mainHtml.matchAll(sectionPattern)) {
    const flightCode = normalizeFlightCode(`ns-${sectionMatch[1] || ''}`);
    if (!flightCode) continue;
    const sectionHeadingHtml = sectionMatch[0] || '';
    const sectionHtml = sectionMatch[3] || '';
    if (!sectionHtml.trim()) continue;

    const headingText = decodeHtmlEntities(sectionHeadingHtml.replace(/<[^>]+>/g, ' '));
    const headingDateMatch = headingText.match(/\b([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b/);
    const launchDate = normalizeIsoDate(headingDateMatch?.[1] || null);
    const missionUrl = buildBlueOriginMissionUrl(flightCode);

    const liPattern = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
    for (const liMatch of sectionHtml.matchAll(liPattern)) {
      const cardHtml = liMatch[1] || '';
      if (!cardHtml.trim()) continue;

      const headingMatch = cardHtml.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
      const name = sanitizeCrewName(stripHtmlText(headingMatch?.[1] || ''));
      if (!name || !isLikelyPersonName(name)) continue;

      const paragraphMatch = cardHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      const bio = normalizeOptionalText(stripHtmlText(paragraphMatch?.[1] || ''));
      const imgTag = cardHtml.match(/<img\b[^>]*>/i)?.[0] || null;
      const imageUrl = imgTag ? extractImageUrlFromTag(imgTag) : null;

      rows.push({
        id: `blue-origin-wayback-astronaut-directory:${flightCode}:${slugifyPersonName(name)}`,
        missionKey: 'new-shepard',
        flightCode,
        flightSlug: buildBlueOriginFlightSlug(flightCode),
        name,
        role: 'Passenger',
        nationality: null,
        launchId: null,
        launchName: `New Shepard | ${flightCode.toUpperCase()}`,
        launchDate,
        profileUrl: missionUrl,
        imageUrl,
        bio: trimBio(bio),
        source: 'blue-origin-wayback:new-shepard-astronaut-directory',
        confidence: 'high'
      });
    }
  }

  return dedupeByFlightAndName(rows);
}

function parseWaybackMissionPassengers(html: string, snapshot: WaybackSnapshot) {
  const missionUrl = readCanonicalMissionUrl(html) || snapshot.missionUrl;
  const flightCode = snapshot.flightCode;
  const launchDate = extractMissionLaunchDate(html);
  const pageImageUrl = extractMissionImageUrl(html);
  const description = readMetaContentByName(html, 'description') || null;
  const mainHtml = extractMainHtml(html);
  const mainText = extractMainText(html);
  const headingCrew = extractCrewNamesFromMainHtml(html);
  const descriptionCrew = extractCrewNamesFromText(description);
  const textCrew = extractCrewNamesFromText(mainText);
  const crewNames = dedupeCrewNames(
    headingCrew.length >= 3
      ? headingCrew
      : descriptionCrew.length >= 3
        ? descriptionCrew
        : [...descriptionCrew, ...textCrew]
  );
  const crewImageUrl = extractCrewImageUrl(mainHtml, crewNames) || pageImageUrl;

  const textBios = extractCrewBios(mainText, crewNames);
  const htmlBios = extractCrewBiosFromMainHtml(mainHtml, crewNames);
  const biosByName = mergeCrewBioMaps(textBios, htmlBios);

  const missionRows = crewNames.map<BlueOriginPassenger>((name) => ({
    id: `blue-origin-wayback:${flightCode}:${slugifyPersonName(name)}`,
    missionKey: 'new-shepard',
    flightCode,
    flightSlug: buildBlueOriginFlightSlug(flightCode),
    name,
    role: 'Passenger',
    nationality: null,
    launchId: null,
    launchName: `New Shepard | ${flightCode.toUpperCase()}`,
    launchDate,
    profileUrl: missionUrl,
    imageUrl: crewImageUrl,
    bio: trimBio(biosByName.get(name) || null),
    source: 'blue-origin-wayback:new-shepard-mission-page',
    confidence: 'high'
  }));

  const rollupRows = extractMissionManifestPassengers(mainText, missionUrl, crewImageUrl);
  if (!missionRows.length) return dedupeByFlightAndName(rollupRows);
  if (!rollupRows.length) return dedupeByFlightAndName(missionRows);
  return dedupeByFlightAndName([...missionRows, ...rollupRows]);
}

function mergeCrewBioMaps(...maps: Array<Map<string, string>>) {
  const merged = new Map<string, string>();

  for (const map of maps) {
    for (const [name, bio] of map.entries()) {
      const normalizedBio = normalizeOptionalText(bio);
      if (!normalizedBio) continue;
      const existing = merged.get(name);
      if (!existing || normalizedBio.length > existing.length) {
        merged.set(name, normalizedBio);
      }
    }
  }

  return merged;
}

function extractCrewBiosFromMainHtml(mainHtml: string, crewNames: string[]) {
  const biosByName = new Map<string, string>();
  if (!mainHtml || !crewNames.length) return biosByName;

  const crewNameByKey = new Map<string, string>();
  for (const name of crewNames) {
    const key = normalizeNameKey(name);
    if (!key) continue;
    crewNameByKey.set(key, name);
  }
  if (!crewNameByKey.size) return biosByName;

  const sectionStart = findIndexCaseInsensitive(mainHtml, 'Meet the Crew');
  const scopedHtml = sectionStart >= 0 ? mainHtml.slice(sectionStart) : mainHtml;
  const headingBioPattern = /<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;

  for (const match of scopedHtml.matchAll(headingBioPattern)) {
    const headingText = decodeHtmlEntities((match[1] || '').replace(/<[^>]+>/g, ' '));
    const headingName = sanitizeCrewName(extractBestPersonName(headingText));
    if (!headingName || !isLikelyPersonName(headingName)) continue;

    const key = normalizeNameKey(headingName);
    if (!key) continue;
    const canonicalName = crewNameByKey.get(key);
    if (!canonicalName) continue;

    const bioText = decodeHtmlEntities((match[2] || '').replace(/<[^>]+>/g, ' '));
    const bio = normalizeOptionalText(bioText);
    if (!bio || bio.length < 24) continue;
    biosByName.set(canonicalName, bio);
  }

  return biosByName;
}

function extractCrewImageUrl(mainHtml: string, crewNames: string[]) {
  if (!mainHtml) return null;

  const surnameKeys = crewNames
    .map((name) => extractSurnameSearchKey(name))
    .filter(Boolean) as string[];
  const crewMarker = /crew|headshot|headshots|portrait|astronaut/i;

  let best: { url: string; score: number } | null = null;

  const figurePattern = /<figure[^>]*>[\s\S]*?<\/figure>/gi;
  for (const match of mainHtml.matchAll(figurePattern)) {
    const figureHtml = match[0] || '';
    const imgTag = figureHtml.match(/<img\b[^>]*>/i)?.[0] || null;
    if (!imgTag) continue;

    const imageUrl = extractImageUrlFromTag(imgTag);
    if (!imageUrl) continue;

    const figureText = normalizeSearchText(decodeHtmlEntities(figureHtml.replace(/<[^>]+>/g, ' ')));
    let score = crewMarker.test(figureText) ? 4 : 0;
    for (const surname of surnameKeys) {
      if (!surname) continue;
      if (figureText.includes(surname)) score += 2;
    }

    if (!best || score > best.score) {
      best = { url: imageUrl, score };
    }
  }

  if (best?.url) return best.url;

  const imgPattern = /<img\b[^>]*>/gi;
  for (const match of mainHtml.matchAll(imgPattern)) {
    const imgTag = match[0] || '';
    const imageUrl = extractImageUrlFromTag(imgTag);
    if (!imageUrl) continue;
    const altText = normalizeSearchText(extractAttributeValue(imgTag, 'alt') || '');
    if (!crewMarker.test(altText)) continue;
    return imageUrl;
  }

  return null;
}

function extractImageUrlFromTag(imgTag: string) {
  const src = extractAttributeValue(imgTag, 'src');
  if (src) {
    const normalizedSrc = normalizeMissionImageUrl(src);
    if (normalizedSrc) return normalizedSrc;
  }

  const srcSet = extractAttributeValue(imgTag, 'srcset');
  if (!srcSet) return null;
  const firstCandidate = srcSet
    .split(',')
    .map((part) => normalizeOptionalText(part))
    .filter(Boolean)[0];
  if (!firstCandidate) return null;
  const firstUrl = normalizeOptionalText(firstCandidate.split(/\s+/)[0] || '');
  return normalizeMissionImageUrl(firstUrl);
}

function extractAttributeValue(tag: string, attribute: string) {
  if (!tag || !attribute) return null;
  const pattern = new RegExp(`${escapeRegExp(attribute)}=["']([^"']+)["']`, 'i');
  const match = tag.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1]);
}

function extractSurnameSearchKey(name: string) {
  const normalized = normalizeOptionalText(name);
  if (!normalized) return null;
  const words = normalized
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return null;

  let surname = words[words.length - 1] as string;
  if (/^(jr|sr|ii|iii|iv|v)$/i.test(surname) && words.length > 1) {
    surname = words[words.length - 2] as string;
  }
  return normalizeSearchText(surname);
}

function normalizeSearchText(value: string | null | undefined) {
  const raw = normalizeOptionalText(value || '');
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMissionManifestPassengers(
  mainText: string,
  missionUrl: string,
  fallbackImageUrl: string | null
) {
  const section = extractMissionManifestSection(mainText);
  if (!section) return [] as BlueOriginPassenger[];
  const sourceMissionFlightCode = extractFlightCodeFromMissionUrl(missionUrl);

  const rows: BlueOriginPassenger[] = [];
  const entryPattern = /\bNS-(\d{1,3})\s*\(([^)]*)\)\s*:\s*([\s\S]*?)(?=\bNS-\d{1,3}\s*\(|$)/gi;

  for (const match of section.matchAll(entryPattern)) {
    const flightCode = normalizeFlightCode(`ns-${match[1] || ''}`);
    const entryDate = normalizeMissionManifestDate(match[2] || '');
    const segment = normalizeOptionalText(match[3] || '');
    if (!flightCode || !segment) continue;

    const crewCandidates = extractManifestCrewCandidates(segment);
    if (!crewCandidates.length) continue;

    for (const crew of crewCandidates) {
      const profileUrl = buildBlueOriginMissionUrl(flightCode);
      const imageUrl =
        sourceMissionFlightCode && sourceMissionFlightCode === flightCode ? fallbackImageUrl : null;
      rows.push({
        id: `blue-origin-wayback-rollup:${flightCode}:${slugifyPersonName(crew.name)}`,
        missionKey: 'new-shepard',
        flightCode,
        flightSlug: buildBlueOriginFlightSlug(flightCode),
        name: crew.name,
        role: 'Passenger',
        nationality: null,
        launchId: null,
        launchName: `New Shepard | ${flightCode.toUpperCase()}`,
        launchDate: entryDate,
        profileUrl,
        imageUrl,
        bio: trimBio(crew.bio),
        source: 'blue-origin-wayback:new-shepard-mission-rollup',
        confidence: 'medium'
      });
    }
  }

  return dedupeByFlightAndName(rows);
}

function extractMissionManifestSection(mainText: string) {
  if (!mainText) return null;
  const start = findIndexCaseInsensitive(mainText, 'New Shepard Astronauts by Mission');
  if (start < 0) return null;

  const tail = mainText.slice(start);
  const sectionEndMarkers = ['Follow Blue Origin on', 'Latest Posts', 'Back to News', 'Share this article'];
  let sectionEnd = tail.length;
  for (const marker of sectionEndMarkers) {
    const index = findIndexCaseInsensitive(tail, marker);
    if (index > 0 && index < sectionEnd) {
      sectionEnd = index;
    }
  }

  const section = normalizeOptionalText(
    tail
      .slice(0, sectionEnd)
      .replace(/\b(?:X|Facebook|LinkedIn|Reddit)\s+Share\b/gi, ' ')
      .replace(/\bShare\b/gi, ' ')
  );
  return section || null;
}

function normalizeMissionManifestDate(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value || '');
  if (!normalized) return null;
  const cleaned = normalized.replace(/\b([A-Za-z]{3})\./g, '$1');
  return normalizeIsoDate(cleaned);
}

type ManifestCrewCandidate = {
  name: string;
  bio: string | null;
};

function extractManifestCrewCandidates(segment: string) {
  let text = decodeHtmlEntities(segment)
    .replace(/\s+/g, ' ')
    .replace(/\ban?\s+undisclosed[^,.;]*/gi, ' ')
    .replace(/\bwho asked[^,.;]*/gi, ' ')
    .replace(/\bwho requested[^,.;]*/gi, ' ')
    .trim();
  if (!text) return [] as ManifestCrewCandidate[];

  text = text
    .replace(/\band\s+her\s+husband\b/gi, '; ')
    .replace(/\band\s+his\s+wife\b/gi, '; ')
    .replace(/\band\s+her\s+wife\b/gi, '; ')
    .replace(/\band\s+his\s+husband\b/gi, '; ')
    .replace(/\s+and\s+/gi, '; ');

  const fragments = text
    .split(';')
    .map((part) => normalizeOptionalText(part))
    .filter(Boolean) as string[];
  if (!fragments.length) return [] as ManifestCrewCandidate[];

  const candidates: ManifestCrewCandidate[] = [];
  const seen = new Set<string>();

  for (const fragment of fragments) {
    const names = extractManifestNamesFromFragment(fragment);
    if (!names.length) continue;

    const bio = trimBio(fragment);
    for (const name of names) {
      const key = normalizeNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      candidates.push({ name, bio: bio || null });
    }
  }

  return candidates;
}

function extractManifestNamesFromFragment(fragment: string) {
  let normalizedFragment = normalizeOptionalText(
    decodeHtmlEntities(fragment)
      .replace(/\b(?:X|Facebook|LinkedIn|Reddit)\s+Share\b/gi, ' ')
      .replace(/\bShare\b/gi, ' ')
  );
  if (!normalizedFragment) return [] as string[];

  const commaParts = normalizedFragment
    .split(',')
    .map((part) => normalizeOptionalText(part))
    .filter(Boolean) as string[];
  if (commaParts.length > 1) {
    const lastPart = commaParts[commaParts.length - 1] as string;
    if (looksLikeNameTail(lastPart)) {
      normalizedFragment = lastPart;
    } else {
      const firstPart = commaParts[0] as string;
      if (looksLikeNameTail(firstPart)) {
        normalizedFragment = firstPart;
      }
    }
  }

  normalizedFragment = normalizedFragment.replace(/[;:]+$/g, '');
  if (!normalizedFragment) return [] as string[];

  const tailNamePattern =
    /((?:Dr\.|H\.E\.|Mr\.|Mrs\.|Ms\.|Prof\.|Capt\.|Commander)?\s*[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]*(?:\s+\([^)]+\))?(?:\s+[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]*){1,3}(?:,\s*(?:Jr\.|Sr\.|II|III|IV))?)\s*\.?$/u;
  const tailMatch = normalizedFragment.match(tailNamePattern);
  if (!tailMatch?.[1]) return [] as string[];

  const rawCandidate = sanitizeCrewName(tailMatch[1].replace(/[.,;:]+$/g, ''));
  if (!rawCandidate) return [] as string[];
  const extracted = sanitizeCrewName(extractBestPersonName(rawCandidate));
  if (!extracted || !isLikelyPersonName(extracted)) return [] as string[];
  return [extracted];
}

function looksLikeNameTail(value: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return false;
  const pattern =
    /(?:Dr\.|H\.E\.|Mr\.|Mrs\.|Ms\.|Prof\.|Capt\.|Commander)?\s*[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]*(?:\s+\([^)]+\))?(?:\s+[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]+){1,3}(?:,\s*(?:Jr\.|Sr\.|II|III|IV))?/u;
  return pattern.test(normalized);
}

function readCanonicalMissionUrl(html: string) {
  const canonical = readMetaLinkHref(html, 'canonical');
  const normalized = normalizeBlueOriginMissionUrl(canonical);
  return normalized || null;
}

function extractMissionLaunchDate(html: string) {
  const publishedMeta = readMetaContentByProperty(html, 'article:published_time');
  const publishedIso = normalizeIsoDate(publishedMeta);
  if (publishedIso) return publishedIso;

  const mainText = extractMainText(html);
  const newsDateMatch = mainText.match(/\b(?:News\s*\|\s*)?([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})\b/);
  return normalizeIsoDate(newsDateMatch?.[1] || null);
}

function extractMissionImageUrl(html: string) {
  const candidates = [
    readMetaContentByProperty(html, 'og:image'),
    readMetaContentByName(html, 'twitter:image'),
    readMetaContentByProperty(html, 'twitter:image')
  ];
  for (const value of candidates) {
    const normalized = normalizeMissionImageUrl(value);
    if (normalized) return normalized;
  }
  return null;
}

function extractCrewNamesFromText(text: string | null | undefined) {
  const normalized = normalizeOptionalText(text || '');
  if (!normalized) return [] as string[];

  const patterns = [
    /crew includes(?:[^:]*?:\s*|\s+)([^.]{8,2400})\./i,
    /crew members?\s+are[:\s]+([^.]{8,2400})\./i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const names = splitCrewNames(match[1]);
    if (names.length) return names;
  }

  return [] as string[];
}

function splitCrewNames(rawList: string) {
  let text = decodeHtmlEntities(rawList)
    .replace(/\s+/g, ' ')
    .replace(/\ban\s+undisclosed[^,.;]*/gi, ' ')
    .replace(/\bwho asked[^,.;]*/gi, ' ')
    .replace(/\bwho requested[^,.;]*/gi, ' ')
    .trim();
  if (!text) return [] as string[];

  text = text.replace(/[;]+/g, ', ');
  text = text.replace(/\s+and\s+/gi, ', ');
  const tokens = text.split(',').map((value) => value.trim()).filter(Boolean);
  if (!tokens.length) return [] as string[];

  const names: string[] = [];
  for (const token of tokens) {
    if (/undisclosed|anonymous/i.test(token)) continue;
    const cleaned = sanitizeCrewName(
      token
        .replace(/^the\s+crew\s+includes\s*/i, '')
        .replace(/^the\s+crew\s+members?\s+(?:are|include)\s*/i, '')
        .replace(/[;:]+/g, ' ')
    );
    if (!cleaned) continue;
    const extractedName = extractBestPersonName(cleaned);
    if (!isLikelyPersonName(extractedName)) continue;
    if (!names.includes(extractedName)) {
      names.push(extractedName);
    }
  }

  return names;
}

function dedupeCrewNames(names: string[]) {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    const cleanedName = sanitizeCrewName(name);
    if (!cleanedName) continue;
    const key = normalizeNameKey(cleanedName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleanedName);
  }

  return deduped;
}

function isLikelyPersonName(value: string) {
  const cleaned = normalizeOptionalText(value);
  if (!cleaned) return false;
  if (/[;:]/.test(cleaned)) return false;
  if (/\b(ns-\d+|mission|crew|launch|flight|program)\b/i.test(cleaned)) return false;
  if (
    /\b(businessman|entrepreneur|investor|pilot|scientist|engineer|activist|philanthropist|co-host|author|astronaut)\b/i.test(
      cleaned
    )
  ) {
    return false;
  }

  const plain = cleaned.replace(/\([^)]*\)/g, ' ');
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (
    words
      .map((word) => normalizeDescriptorToken(word))
      .some((token) => token && NAME_DESCRIPTOR_STOPWORDS.has(token))
  ) {
    return false;
  }

  let properWordCount = 0;
  for (const word of words) {
    if (/^[A-Z](?:\.[A-Z])+\.?$/u.test(word)) {
      properWordCount += 1;
      continue;
    }
    if (/^[A-ZÀ-ÖØ-Ý][\p{L}\p{M}'’.-]*$/u.test(word)) {
      properWordCount += 1;
      continue;
    }
  }

  return properWordCount >= 2;
}

function extractBestPersonName(value: string) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return value;

  const words = normalized
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return value;

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  const commitCurrent = () => {
    if (currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
    currentStart = -1;
    currentLength = 0;
  };

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    if (isNameLikeWord(word)) {
      if (currentStart < 0) currentStart = index;
      currentLength += 1;
    } else if (currentLength > 0) {
      commitCurrent();
    }
  }
  if (currentLength > 0) commitCurrent();

  if (bestStart >= 0 && bestLength >= 2) {
    return words.slice(bestStart, bestStart + bestLength).join(' ');
  }

  return value;
}

function isNameLikeWord(word: string) {
  const descriptorToken = normalizeDescriptorToken(word);
  if (descriptorToken && NAME_DESCRIPTOR_STOPWORDS.has(descriptorToken)) return false;
  if (/^[A-Z](?:\.[A-Z])+\.?$/u.test(word)) return true;
  return /^[A-ZÀ-ÖØ-Ý][\p{Ll}\p{M}'’.-]*$/u.test(word);
}

function normalizeDescriptorToken(word: string) {
  return word
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase();
}

function extractCrewBios(mainText: string, crewNames: string[]) {
  const biosByName = new Map<string, string>();
  if (!mainText || !crewNames.length) return biosByName;

  const sectionStart = findIndexCaseInsensitive(mainText, 'Meet the Crew');
  if (sectionStart < 0) return biosByName;

  const sectionTail = mainText.slice(sectionStart + 'Meet the Crew'.length);
  const sectionEndMarkers = ['Follow Blue Origin on', 'Share this article', 'Latest Posts', 'Back to News'];
  let sectionEnd = sectionTail.length;
  for (const marker of sectionEndMarkers) {
    const index = findIndexCaseInsensitive(sectionTail, marker);
    if (index >= 0 && index < sectionEnd) {
      sectionEnd = index;
    }
  }

  const section = sectionTail.slice(0, sectionEnd);
  if (!section.trim()) return biosByName;

  for (let index = 0; index < crewNames.length; index += 1) {
    const name = crewNames[index] as string;
    const nextName = index < crewNames.length - 1 ? (crewNames[index + 1] as string) : null;
    const boundary = nextName ? escapeRegExp(nextName) : '(?:Follow Blue Origin on|Share this article|$)';
    const regex = new RegExp(`${escapeRegExp(name)}\\s+([\\s\\S]*?)(?=${boundary})`, 'i');
    const match = section.match(regex);
    if (!match?.[1]) continue;
    const bioText = normalizeOptionalText(match[1]) || null;
    if (!bioText || bioText.length < 24) continue;
    biosByName.set(name, bioText);
  }

  return biosByName;
}

function extractCrewNamesFromMainHtml(html: string) {
  const mainHtml = extractMainHtml(html);
  if (!mainHtml) return [] as string[];

  const sectionStart = findIndexCaseInsensitive(mainHtml, 'Meet the Crew');
  if (sectionStart < 0) return [] as string[];

  const sectionTail = mainHtml.slice(sectionStart + 'Meet the Crew'.length);
  const sectionEndMarkers = ['Follow Blue Origin on', 'Share this article', 'Latest Posts', 'Back to News'];
  let sectionEnd = sectionTail.length;
  for (const marker of sectionEndMarkers) {
    const index = findIndexCaseInsensitive(sectionTail, marker);
    if (index >= 0 && index < sectionEnd) {
      sectionEnd = index;
    }
  }
  const sectionHtml = sectionTail.slice(0, sectionEnd);
  if (!sectionHtml.trim()) return [] as string[];

  const headingPattern = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  const names: string[] = [];

  for (const match of sectionHtml.matchAll(headingPattern)) {
    const headingText = decodeHtmlEntities((match[1] || '').replace(/<[^>]+>/g, ' '));
    const cleaned = sanitizeCrewName(headingText);
    if (!cleaned) continue;
    if (!isLikelyPersonName(cleaned)) continue;
    if (!names.includes(cleaned)) {
      names.push(cleaned);
    }
  }

  return names;
}

function extractMainHtml(html: string) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  return mainMatch?.[1] || '';
}

function extractMainText(html: string) {
  const source = extractMainHtml(html) || html;

  let text = source;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  text = text.replace(/<\/(?:p|h\d|li|div|section|article|header|footer|main|br)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/\u00a0/g, ' ');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{2,}/g, '\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

function readMetaContentByName(html: string, name: string) {
  const pattern = new RegExp(
    `<meta[^>]+name=["']${escapeRegExp(name)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1]);
}

function readMetaContentByProperty(html: string, property: string) {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${escapeRegExp(property)}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1]);
}

function readMetaLinkHref(html: string, rel: string) {
  const pattern = new RegExp(
    `<link[^>]+rel=["']${escapeRegExp(rel)}["'][^>]+href=["']([^"']+)["'][^>]*>`,
    'i'
  );
  const match = html.match(pattern);
  if (!match?.[1]) return null;
  return decodeHtmlEntities(match[1]);
}

function normalizeBlueOriginMissionUrl(value: string | null | undefined) {
  const normalizedValue = normalizeOptionalText(value || '');
  if (!normalizedValue) return null;
  const raw = decodeHtmlEntities(normalizedValue);

  const unwrapped = unwrapWaybackUrl(raw) || raw;
  const normalized = normalizeBlueOriginTravelerProfileUrl(unwrapped, { allowOpenSource: true });
  if (!normalized) return null;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'blueorigin.com') return null;
  const pathname = parsed.pathname.toLowerCase();
  const flightCode = extractBlueOriginFlightCodeFromUrl(normalized);
  if (!flightCode || !flightCode.startsWith('ns-')) return null;

  if (pathname.startsWith('/news/')) {
    return `https://www.blueorigin.com/news/${flightCode}-mission-updates`;
  }
  if (pathname.startsWith('/missions/')) {
    return `https://www.blueorigin.com${pathname.replace(/\/+$/g, '')}`;
  }
  return null;
}

function normalizeMissionImageUrl(value: string | null | undefined) {
  const normalizedValue = normalizeOptionalText(value || '');
  if (!normalizedValue) return null;
  const raw = decodeHtmlEntities(normalizedValue);

  const unwrapped = unwrapWaybackUrl(raw) || raw;
  let parsed: URL;
  try {
    parsed = new URL(unwrapped);
  } catch {
    return null;
  }

  if (/web\.archive\.org$/i.test(parsed.hostname)) {
    const fromWayback = unwrapWaybackUrl(parsed.toString());
    if (fromWayback) {
      return normalizeMissionImageUrl(fromWayback);
    }
  }

  if (parsed.pathname === '/_next/image') {
    const inner = parsed.searchParams.get('url');
    if (inner) {
      const decodedInner = decodeURIComponent(inner);
      const normalizedInner = unwrapWaybackUrl(decodedInner) || decodedInner;
      const normalizedUrl = normalizeAbsoluteUrl(normalizedInner);
      if (normalizedUrl) return normalizedUrl;
    }
  }

  return normalizeAbsoluteUrl(parsed.toString());
}

function unwrapWaybackUrl(value: string | null | undefined) {
  const raw = normalizeOptionalText(value || '');
  if (!raw) return null;
  const absoluteRaw = raw.startsWith('/web/') ? `https://web.archive.org${raw}` : raw;
  const match = absoluteRaw.match(/\/web\/\d+(?:[a-z_]+)?\/(https?:\/\/.+)$/i);
  if (!match?.[1]) return null;
  return normalizeOptionalText(match[1]) || null;
}

function extractFlightCodeFromMissionUrl(value: string | null | undefined) {
  const flightCode = extractBlueOriginFlightCodeFromUrl(value);
  if (!flightCode || !flightCode.startsWith('ns-')) return null;
  return normalizeFlightCode(flightCode);
}

function buildBlueOriginMissionUrl(flightCode: string) {
  return `https://www.blueorigin.com/news/${flightCode.toLowerCase()}-mission-updates`;
}

function buildWaybackSnapshotUrl(timestamp: string, missionUrl: string) {
  return `https://web.archive.org/web/${timestamp}/${missionUrl}`;
}

function normalizeIsoDate(value: string | null | undefined) {
  const normalized = normalizeOptionalText(value || '');
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function decodeHtmlEntities(value: string) {
  if (!value) return value;
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;/gi, '-')
    .replace(/&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_match, digits) => {
      const codePoint = Number(digits);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

function stripHtmlText(value: string | null | undefined) {
  if (!value) return '';
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function findIndexCaseInsensitive(text: string, needle: string) {
  if (!text || !needle) return -1;
  return text.toLowerCase().indexOf(needle.toLowerCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const limit = Math.max(1, Math.trunc(concurrency) || 1);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index] as T, index);
    }
  });

  await Promise.all(workers);
  return results;
}

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TMinusZeroBot/1.0 (contact: support@tminuszero.app)'
      },
      next: { revalidate: 60 * 60 * 24 }
    });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status} for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  backoffMs: number
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return await fetchText(url, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b429\b|\b5\d\d\b|abort|timeout/i.test(message);
      lastError = error instanceof Error ? error : new Error(message);
      if (!retryable || attempt >= retries) break;
      const delay = backoffMs * attempt + Math.round(Math.random() * 350);
      await sleep(delay);
    }
  }

  throw lastError || new Error(`failed to fetch ${url}`);
}

async function fetchJson(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TMinusZeroBot/1.0 (contact: support@tminuszero.app)'
      },
      next: { revalidate: 60 * 60 * 24 }
    });
    if (!response.ok) {
      throw new Error(`fetch failed ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLl2NewShepardLaunches() {
  const launches: Ll2LaunchListItem[] = [];
  let nextUrl = `${LL2_API_BASE}/launch/?search=${encodeURIComponent('New Shepard')}&mode=detailed&limit=100`;
  let guard = 0;

  while (nextUrl && guard < 6) {
    guard += 1;
    const json = (await fetchJsonWithRetry(
      nextUrl,
      LL2_REQUEST_TIMEOUT_MS,
      LL2_FETCH_RETRIES,
      LL2_RETRY_BACKOFF_MS
    )) as Ll2PaginatedResponse<Ll2LaunchListItem>;
    const rows = Array.isArray(json?.results) ? json.results : [];
    launches.push(...rows);
    nextUrl = typeof json?.next === 'string' && json.next.trim() ? json.next : '';
  }

  return launches;
}

async function fetchJsonWithRetry(
  url: string,
  timeoutMs: number,
  retries: number,
  backoffMs: number
) {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= Math.max(1, retries); attempt += 1) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryable = /\b429\b|\b5\d\d\b|abort|timeout/i.test(message);
      lastError = error instanceof Error ? error : new Error(message);
      if (!retryable || attempt >= retries) break;
      const delay = backoffMs * attempt + Math.round(Math.random() * 250);
      await sleep(delay);
    }
  }

  throw lastError || new Error(`failed to fetch ${url}`);
}

async function sleep(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function dedupeByFlightAndName(items: BlueOriginPassenger[]) {
  const byKey = new Map<string, BlueOriginPassenger>();

  for (const item of items) {
    const flightCode = normalizeFlightCode(item.flightCode);
    const nameKey = normalizeNameKey(item.name);
    if (!flightCode || !nameKey) continue;
    const key = `${flightCode}:${nameKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    if (!existing.profileUrl && item.profileUrl) existing.profileUrl = item.profileUrl;
    if (!existing.imageUrl && item.imageUrl) existing.imageUrl = item.imageUrl;
    if (!existing.bio && item.bio) existing.bio = item.bio;
    if (!existing.launchDate && item.launchDate) existing.launchDate = item.launchDate;
  }

  return [...byKey.values()].sort((a, b) => {
    const dateDelta = Date.parse(b.launchDate || '') - Date.parse(a.launchDate || '');
    if (Number.isFinite(dateDelta) && dateDelta !== 0) return dateDelta;
    return a.name.localeCompare(b.name);
  });
}

function isBlueOriginMissionTitle(title: string) {
  return /^Blue Origin NS-\d+$/i.test(title.trim());
}

function extractFlightCodeFromTitle(title: string | null | undefined) {
  const match = (title || '').match(/\bNS-(\d+)\b/i);
  if (!match?.[1]) return null;
  return `ns-${match[1]}`.toLowerCase();
}

function compareFlightCodes(a: string | null, b: string | null) {
  const aNum = Number((a || '').replace(/^ns-/i, ''));
  const bNum = Number((b || '').replace(/^ns-/i, ''));
  if (!Number.isFinite(aNum) && !Number.isFinite(bNum)) return String(a || '').localeCompare(String(b || ''));
  if (!Number.isFinite(aNum)) return 1;
  if (!Number.isFinite(bNum)) return -1;
  return aNum - bNum;
}

function normalizeTitle(value: string | null | undefined) {
  const normalized = (value || '').trim();
  return normalized || null;
}

function normalizeWikiTitle(value: string | null | undefined) {
  const normalized = (value || '').trim().replace(/_/g, ' ');
  return normalized || null;
}

function normalizeFlightCode(value: string | null | undefined) {
  const normalized = (value || '').trim().toLowerCase();
  if (!/^ns-\d+$/.test(normalized)) return null;
  return normalized;
}

function normalizeNameKey(value: string | null | undefined) {
  const normalized = normalizeWikitextValue(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.toLowerCase() || null;
}

function normalizeWikitextValue(value: string) {
  let normalized = value || '';
  normalized = normalized.replace(/\{\{[^{}]*\}\}/g, ' ');
  normalized = normalized.replace(/<[^>]+>/g, ' ');
  normalized = normalized.replace(/\([^)]*\)/g, ' ');
  normalized = normalized.replace(/\[[^\]]+\]/g, ' ');
  normalized = normalized.replace(/&nbsp;/gi, ' ');
  normalized = normalized.replace(/'''/g, '');
  normalized = normalized.replace(/''/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || null;
}

function sanitizeCrewName(value: string | null | undefined) {
  const normalized = normalizeWikitextValue(value || '');
  if (!normalized) return null;
  if (/[|=]/.test(normalized)) return null;
  if (!/\p{L}/u.test(normalized)) return null;
  if (/(crew\d+_|position\d+|flights?\d+)/i.test(normalized)) return null;
  if (normalized.length > 96) return null;
  return normalized;
}

function normalizeCrewRole(value: string | null | undefined) {
  const raw = normalizeWikitextValue(value || '');
  return normalizeBlueOriginTravelerRole(raw);
}

function extractFlightCodeFromText(value: string | null | undefined) {
  const normalized = normalizeWikitextValue(value || '');
  const match = normalized.match(/\b(NS|NG)\s*[-_ ]?\s*(\d{1,3})\b/i);
  if (!match?.[1] || !match?.[2]) return null;
  return `${match[1]}-${Number(match[2])}`.toLowerCase();
}

function normalizeAbsoluteUrl(value: string | null | undefined) {
  const raw = normalizeWikitextValue(value || '');
  if (!raw) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

function isReasonableWikipediaNameMatch(name: string, title: string) {
  const normalizedName = normalizeComparisonKey(name);
  const normalizedTitle = normalizeComparisonKey(title);
  if (!normalizedName || !normalizedTitle) return false;
  if (normalizedName === normalizedTitle) return true;

  const tokens = normalizedName.split(' ').filter((token) => token.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((token) => normalizedTitle.includes(token));
}

function normalizeComparisonKey(value: string | null | undefined) {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slugifyPersonName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function trimBio(value: string | null) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}
