import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { isInternalBlueOriginRevalidateTokenValid } from '@/lib/server/env';
import { parseLaunchParam } from '@/lib/utils/launchParams';
import { parseBlueOriginTravelerSlug } from '@/lib/utils/blueOrigin';

const MAX_TRAVELER_SLUGS = 200;
const MAX_LAUNCH_IDS = 200;
const BASE_PATHS = [
  '/blue-origin',
  '/blue-origin/travelers',
  '/blue-origin/flights',
  '/blue-origin/missions/new-shepard',
  '/sitemap.xml',
  '/sitemap-launches.xml',
  '/sitemap-entities.xml'
] as const;

export const runtime = 'nodejs';

type RevalidateRequestBody = {
  source?: unknown;
  reason?: unknown;
  travelerSlugs?: unknown;
  launchIds?: unknown;
};

export async function POST(request: Request) {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!isInternalBlueOriginRevalidateTokenValid(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: RevalidateRequestBody;
  try {
    payload = (await request.json()) as RevalidateRequestBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const travelerParse = normalizeTravelerSlugs(payload.travelerSlugs);
  const launchParse = normalizeLaunchIds(payload.launchIds);

  const revalidatePaths = new Set<string>(BASE_PATHS);

  for (const travelerSlug of travelerParse.accepted.slice(0, MAX_TRAVELER_SLUGS)) {
    revalidatePaths.add(`/blue-origin/travelers/${travelerSlug}`);
  }

  for (const launchId of launchParse.accepted.slice(0, MAX_LAUNCH_IDS)) {
    revalidatePaths.add(`/launches/${launchId}`);
  }

  for (const path of revalidatePaths) {
    revalidatePath(path);
  }

  return NextResponse.json({
    ok: true,
    source: normalizeOptionalText(payload.source),
    reason: normalizeOptionalText(payload.reason),
    revalidatedPaths: revalidatePaths.size,
    acceptedTravelerSlugs: travelerParse.accepted.slice(0, MAX_TRAVELER_SLUGS),
    acceptedLaunchIds: launchParse.accepted.slice(0, MAX_LAUNCH_IDS),
    rejectedTravelerSlugs: travelerParse.rejected,
    rejectedLaunchIds: launchParse.rejected
  });
}

function parseBearerToken(value: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  const token = match[1].trim();
  return token || null;
}

function normalizeTravelerSlugs(value: unknown) {
  if (!Array.isArray(value)) return { accepted: [] as string[], rejected: [] as string[] };

  const seen = new Set<string>();
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const entry of value) {
    const normalized = parseBlueOriginTravelerSlug(typeof entry === 'string' ? entry : null);
    if (!normalized) {
      rejected.push(String(entry || ''));
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    accepted.push(normalized);
  }

  if (accepted.length > MAX_TRAVELER_SLUGS) {
    rejected.push(...accepted.slice(MAX_TRAVELER_SLUGS));
  }

  return {
    accepted: accepted.slice(0, MAX_TRAVELER_SLUGS),
    rejected
  };
}

function normalizeLaunchIds(value: unknown) {
  if (!Array.isArray(value)) return { accepted: [] as string[], rejected: [] as string[] };

  const seen = new Set<string>();
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const entry of value) {
    const parsed = parseLaunchParam(typeof entry === 'string' ? entry : '');
    const launchId = parsed?.launchId || null;
    if (!launchId) {
      rejected.push(String(entry || ''));
      continue;
    }
    if (seen.has(launchId)) continue;
    seen.add(launchId);
    accepted.push(launchId);
  }

  if (accepted.length > MAX_LAUNCH_IDS) {
    rejected.push(...accepted.slice(MAX_LAUNCH_IDS));
  }

  return {
    accepted: accepted.slice(0, MAX_LAUNCH_IDS),
    rejected
  };
}

function normalizeOptionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}
