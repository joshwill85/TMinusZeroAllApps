'use client';

import { changedLaunchesSchemaV1, launchFeedSchemaV1 } from '@tminuszero/contracts';
import { z } from 'zod';
import type { ChangedLaunchesRequest, LaunchFeedRequest, LaunchFeedV1 } from '@tminuszero/api-client';

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
};

const arEligibleResponseSchema = z.object({
  generatedAt: z.string().optional(),
  launches: z.array(z.object({ launchId: z.string() }).passthrough()).default([])
});

const feedFilterOptionsSchema = z.object({
  providers: z.array(z.string()).default([]),
  locations: z.array(z.string()).default([]),
  states: z.array(z.string()).default([]),
  pads: z.array(z.string()).default([]),
  statuses: z.array(z.string()).default([])
});

const liveLaunchVersionSchema = z.object({
  tier: z.enum(['anon', 'free', 'premium']),
  intervalSeconds: z.number().int().nonnegative(),
  matchCount: z.number().int().nonnegative(),
  latestUpdateId: z.number().int().nullable(),
  version: z.string()
});

type FeedFilterOptionsRequest = {
  mode: 'public' | 'live';
  range: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  region: 'us' | 'non-us' | 'all';
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

type LiveLaunchVersionRequest = {
  range: 'today' | '7d' | 'month' | 'year' | 'past' | 'all';
  region: 'us' | 'non-us' | 'all';
  location?: string | null;
  state?: string | null;
  pad?: string | null;
  provider?: string | null;
  status?: 'go' | 'hold' | 'scrubbed' | 'tbd' | 'unknown' | null;
};

export class WebLaunchFeedAdapterError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(path: string, status: number, code: string | null) {
    super(code ? `Web route failed for ${path} (${status}: ${code})` : `Web route failed for ${path} (${status})`);
    this.name = 'WebLaunchFeedAdapterError';
    this.status = status;
    this.code = code;
  }
}

function appendQuery(path: string, params: Record<string, string | number | null | undefined>) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === '') return;
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

async function requestJson<T>(path: string, schema: { parse: (value: unknown) => T }, options: RequestOptions = {}) {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    cache: 'no-store',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : null;
    throw new WebLaunchFeedAdapterError(path, response.status, code);
  }

  return schema.parse(json);
}

export async function getLegacyLaunchFeed(request: LaunchFeedRequest): Promise<LaunchFeedV1> {
  const scope = request.scope ?? 'public';
  const qs = appendQuery(
    scope === 'watchlist'
      ? `/api/me/watchlists/${encodeURIComponent(String(request.watchlistId || 'missing'))}/launches`
      : `/api/${scope === 'live' ? 'live' : 'public'}/launches`,
    {
      range: request.range,
      from: request.from,
      to: request.to,
      location: request.location,
      state: request.state,
      pad: request.pad,
      provider: request.provider,
      status: request.status,
      sort: request.sort,
      region: request.region,
      limit: request.limit,
      offset: request.offset
    }
  );

  const payload = await requestJson(
    qs,
    z.object({
      launches: z.array(z.unknown()).default([]),
      hasMore: z.boolean().optional(),
      freshness: z.string().nullable().optional(),
      intervalMinutes: z.number().int().nonnegative().nullable().optional(),
      intervalSeconds: z.number().int().nonnegative().nullable().optional(),
      tier: z.enum(['anon', 'free', 'premium']).optional()
    })
  );

  return launchFeedSchemaV1.parse({
    launches: payload.launches,
    hasMore: payload.hasMore === true,
    nextCursor:
      payload.hasMore === true
        ? String((request.offset ?? 0) + (Array.isArray(payload.launches) ? payload.launches.length : 0))
        : null,
    freshness: payload.freshness ?? null,
    intervalMinutes: payload.intervalMinutes ?? null,
    intervalSeconds: payload.intervalSeconds ?? null,
    tier: payload.tier ?? null,
    scope
  });
}

export function getLegacyChangedLaunches(request: ChangedLaunchesRequest = {}) {
  return requestJson(
    appendQuery('/api/live/launches/changed', {
      hours: request.hours,
      region: request.region
    }),
    changedLaunchesSchemaV1
  );
}

export async function getArEligibleLaunchIds() {
  const payload = await requestJson('/api/public/launches/ar-eligible', arEligibleResponseSchema);
  return payload.launches
    .map((entry) => String(entry.launchId || '').trim())
    .filter(Boolean);
}

export function getFeedFilterOptions(request: FeedFilterOptionsRequest) {
  return requestJson(
    appendQuery('/api/filters', {
      mode: request.mode,
      range: request.range,
      region: request.region,
      location: request.location,
      state: request.state,
      pad: request.pad,
      provider: request.provider,
      status: request.status
    }),
    feedFilterOptionsSchema
  );
}

export function getLiveLaunchFeedVersion(request: LiveLaunchVersionRequest) {
  return requestJson(
    appendQuery('/api/live/launches/version', {
      range: request.range,
      region: request.region,
      location: request.location,
      state: request.state,
      pad: request.pad,
      provider: request.provider,
      status: request.status
    }),
    liveLaunchVersionSchema
  );
}

export type FeedFilterOptions = z.infer<typeof feedFilterOptionsSchema>;
export type LiveLaunchVersion = z.infer<typeof liveLaunchVersionSchema>;
