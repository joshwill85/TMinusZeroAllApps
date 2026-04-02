import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getUserAccessEntitlementById } from '@/lib/server/entitlements';
import { parseLaunchRegion, US_PAD_COUNTRY_CODES } from '@/lib/server/us';
import { buildLaunchHref } from '@/lib/utils/launchLinks';
import type { LaunchFilter } from '@/lib/types/launch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_CACHE_CONTROL = 'public, max-age=0, must-revalidate';
const CDN_CACHE_CONTROL = 'public, s-maxage=900, stale-while-revalidate=900';
const FEED_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_ITEMS = 100;
const MAX_LOOKAHEAD_DAYS = 365;
const MAX_LOOKBACK_DAYS = 30;

export async function GET(request: Request, { params }: { params: { token: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 501, headers: { 'Cache-Control': 'no-store' } });
  }

  const rawParam = String(params.token || '');
  const format = resolveFeedFormat(request, rawParam);
  const token = parseTokenParam(rawParam);
  if (!token) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const rateLimited = await enforceDurableRateLimit(request, {
    scope: 'rss_feed',
    limit: 30,
    windowSeconds: 60,
    tokenKey: token
  });
  if (rateLimited) {
    return rateLimited;
  }

  const admin = createSupabaseAdminClient();
  const { data: feed, error: feedError } = await admin
    .from('rss_feeds')
    .select(
      'id,user_id,name,filters,cached_rss_xml,cached_rss_etag,cached_rss_generated_at,cached_atom_xml,cached_atom_etag,cached_atom_generated_at'
    )
    .eq('token', token)
    .maybeSingle();

  if (feedError) {
    console.error('rss feed lookup error', feedError);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!feed) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const userId = String((feed as any).user_id || '').trim();
  const access = await getUserAccessEntitlementById({ userId, admin });
  if (access.loadError || !access.entitlement) {
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!access.entitlement.isPaid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const nowMs = Date.now();
  const cached =
    format === 'atom'
      ? readCachedFeed({ body: (feed as any).cached_atom_xml, etag: (feed as any).cached_atom_etag, generatedAt: (feed as any).cached_atom_generated_at })
      : readCachedFeed({ body: (feed as any).cached_rss_xml, etag: (feed as any).cached_rss_etag, generatedAt: (feed as any).cached_rss_generated_at });

  const ifNoneMatch = request.headers.get('if-none-match');
  const headers: Record<string, string> = {
    'Cache-Control': TOKEN_CACHE_CONTROL,
    'CDN-Cache-Control': CDN_CACHE_CONTROL,
    'Content-Type': format === 'atom' ? 'application/atom+xml; charset=utf-8' : 'application/rss+xml; charset=utf-8'
  };

  if (cached && nowMs - cached.generatedAtMs < FEED_CACHE_TTL_MS) {
    headers.ETag = cached.etag;
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return new NextResponse(cached.body, { status: 200, headers });
  }

  const filters = safeFilterObject((feed as any).filters);
  const { from, to } = resolveBoundedWindow(filters, new Date());

  let query = admin
    .from('launches')
    .select('id,name,slug,provider,vehicle,pad_name,pad_short_code,pad_state,pad_country_code,net,net_precision,window_end,status_name,status_abbrev,hidden')
    .eq('hidden', false);

  const region = parseLaunchRegion(filters.region ?? 'us');
  if (region === 'us') query = query.in('pad_country_code', US_PAD_COUNTRY_CODES);
  if (region === 'non-us') query = query.not('pad_country_code', 'in', `(${US_PAD_COUNTRY_CODES.join(',')})`);

  if (from) query = query.gte('net', from);
  if (to) query = query.lt('net', to);
  if (filters.state) query = query.eq('pad_state', filters.state);
  if (filters.provider) query = query.eq('provider', filters.provider);
  if (filters.status && filters.status !== 'all') query = query.eq('status_name', filters.status);

  query = query.order('net', { ascending: true }).range(0, MAX_ITEMS - 1);

  const { data, error } = await query;
  if (error) {
    console.error('rss feed launches query error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }

  const siteUrl = getSiteUrl().replace(/\/+$/, '');
  const feedName = String((feed as any).name || '').trim() || 'Launch feed';
  const rows = Array.isArray(data) ? data : [];

  const selfRssUrl = `${siteUrl}/rss/${encodeURIComponent(token)}.xml`;
  const selfAtomUrl = `${siteUrl}/rss/${encodeURIComponent(token)}.atom`;

  const rssXml = buildRssXml({ siteUrl, selfUrl: selfRssUrl, feedName, items: rows });
  const atomXml = buildAtomXml({ siteUrl, selfUrl: selfAtomUrl, feedName, items: rows });

  const rssEtag = buildEtag(rssXml);
  const atomEtag = buildEtag(atomXml);
  const generatedAtIso = new Date(nowMs).toISOString();

  try {
    const { error: cacheError } = await admin
      .from('rss_feeds')
      .update({
        cached_rss_xml: rssXml,
        cached_rss_etag: rssEtag,
        cached_rss_generated_at: generatedAtIso,
        cached_atom_xml: atomXml,
        cached_atom_etag: atomEtag,
        cached_atom_generated_at: generatedAtIso
      })
      .eq('id', (feed as any).id);
    if (cacheError) console.warn('rss feed cache update warning', cacheError);
  } catch (err) {
    console.warn('rss feed cache update failed', err);
  }

  const body = format === 'atom' ? atomXml : rssXml;
  const etag = format === 'atom' ? atomEtag : rssEtag;
  headers.ETag = etag;
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(body, { status: 200, headers });
}

function parseTokenParam(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const token = raw.replace(/\.(xml|atom)$/i, '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) return null;
  return token;
}

function safeFilterObject(value: unknown): LaunchFilter {
  if (!value || typeof value !== 'object') return {};
  return value as LaunchFilter;
}

function resolveBoundedWindow(filters: LaunchFilter, now: Date) {
  const range = filters.range ?? '7d';
  const nowMs = now.getTime();

  const lookaheadDays =
    range === 'today'
      ? 1
      : range === 'month'
        ? 30
        : range === 'year'
          ? 365
          : range === '7d'
            ? 7
            : range === 'all'
              ? MAX_LOOKAHEAD_DAYS
              : 0;

  const lookbackDays = range === 'past' ? MAX_LOOKBACK_DAYS : range === 'all' ? MAX_LOOKBACK_DAYS : 0;

  const from = lookbackDays ? new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString() : now.toISOString();
  const to = lookaheadDays ? new Date(nowMs + Math.min(MAX_LOOKAHEAD_DAYS, lookaheadDays) * 24 * 60 * 60 * 1000).toISOString() : now.toISOString();

  return { from, to };
}

function buildRssXml({ siteUrl, selfUrl, feedName, items }: { siteUrl: string; selfUrl: string; feedName: string; items: any[] }) {
  const now = new Date();
  const feedTitle = `${feedName} — T-Minus Zero`;
  const feedLink = siteUrl;
  const feedDescription = 'Live launch schedule updates.';

  const itemXml = items
    .flatMap((row) => {
      const id = String(row?.id || '').trim();
      const name = String(row?.name || '').trim();
      if (!id || !name) return [];

      const netIso = row?.net ? new Date(row.net).toISOString() : null;
      const pubDate = netIso ? new Date(netIso).toUTCString() : now.toUTCString();

      const launchPath = buildLaunchHref({ id, name, slug: row?.slug || undefined });
      const link = `${siteUrl}${launchPath}`;

      const provider = String(row?.provider || 'Unknown') || 'Unknown';
      const vehicle = String(row?.vehicle || 'Unknown') || 'Unknown';
      const padName = String(row?.pad_name || 'Pad') || 'Pad';
      const padState = String(row?.pad_state || 'NA') || 'NA';
      const status = String(row?.status_name || 'unknown') || 'unknown';

      const description = [
        `Provider: ${provider}`,
        `Vehicle: ${vehicle}`,
        `Pad: ${padName}${padState ? `, ${padState}` : ''}`,
        netIso ? `NET: ${netIso}` : null,
        `Status: ${status}`
      ]
        .filter(Boolean)
        .join('\n');

      return [
        [
          '<item>',
          `<title>${escapeXml(name)}</title>`,
          `<link>${escapeXml(link)}</link>`,
          `<guid isPermaLink="false">${escapeXml(id)}</guid>`,
          `<pubDate>${escapeXml(pubDate)}</pubDate>`,
          `<description>${escapeXml(description)}</description>`,
          '</item>'
        ].join('')
      ];
    })
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escapeXml(feedTitle)}</title>`,
    `<link>${escapeXml(feedLink)}</link>`,
    `<description>${escapeXml(feedDescription)}</description>`,
    `<lastBuildDate>${escapeXml(now.toUTCString())}</lastBuildDate>`,
    `<atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    itemXml,
    '</channel>',
    '</rss>',
    ''
  ].join('\n');
}

function buildAtomXml({
  siteUrl,
  selfUrl,
  feedName,
  items
}: {
  siteUrl: string;
  selfUrl: string;
  feedName: string;
  items: any[];
}) {
  const nowIso = new Date().toISOString();
  const feedTitle = `${feedName} — T-Minus Zero`;
  const feedId = selfUrl;

  const entries = items
    .flatMap((row) => {
      const id = String(row?.id || '').trim();
      const name = String(row?.name || '').trim();
      if (!id || !name) return [];

      const netIso = row?.net ? new Date(row.net).toISOString() : null;
      const updated = netIso || nowIso;

      const launchPath = buildLaunchHref({ id, name, slug: row?.slug || undefined });
      const link = `${siteUrl}${launchPath}`;

      const provider = String(row?.provider || 'Unknown') || 'Unknown';
      const vehicle = String(row?.vehicle || 'Unknown') || 'Unknown';
      const padName = String(row?.pad_name || 'Pad') || 'Pad';
      const padState = String(row?.pad_state || 'NA') || 'NA';
      const status = String(row?.status_name || 'unknown') || 'unknown';

      const summary = [
        `Provider: ${provider}`,
        `Vehicle: ${vehicle}`,
        `Pad: ${padName}${padState ? `, ${padState}` : ''}`,
        netIso ? `NET: ${netIso}` : null,
        `Status: ${status}`
      ]
        .filter(Boolean)
        .join('\n');

      return [
        [
          '<entry>',
          `<title>${escapeXml(name)}</title>`,
          `<link href="${escapeXml(link)}" />`,
          `<id>${escapeXml(link)}</id>`,
          `<updated>${escapeXml(updated)}</updated>`,
          `<summary type="text">${escapeXml(summary)}</summary>`,
          '</entry>'
        ].join('')
      ];
    })
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `<title>${escapeXml(feedTitle)}</title>`,
    `<id>${escapeXml(feedId)}</id>`,
    `<updated>${escapeXml(nowIso)}</updated>`,
    `<link href="${escapeXml(siteUrl)}" />`,
    `<link href="${escapeXml(selfUrl)}" rel="self" type="application/atom+xml" />`,
    entries,
    '</feed>',
    ''
  ].join('\n');
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildEtag(body: string) {
  return `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
}

function resolveFeedFormat(request: Request, tokenParam: string): 'rss' | 'atom' {
  const lower = String(tokenParam || '').toLowerCase();
  if (lower.endsWith('.atom')) return 'atom';
  const url = new URL(request.url);
  const formatParam = url.searchParams.get('format');
  if (formatParam && formatParam.toLowerCase() === 'atom') return 'atom';
  return 'rss';
}

function readCachedFeed({
  body,
  etag,
  generatedAt
}: {
  body: unknown;
  etag: unknown;
  generatedAt: unknown;
}): { body: string; etag: string; generatedAtMs: number } | null {
  const cachedBody = typeof body === 'string' ? body : null;
  if (!cachedBody) return null;

  const cachedEtag = typeof etag === 'string' && etag.trim() ? etag.trim() : buildEtag(cachedBody);

  const generatedAtIso = typeof generatedAt === 'string' ? generatedAt : generatedAt instanceof Date ? generatedAt.toISOString() : null;
  const generatedAtMs = generatedAtIso ? Date.parse(generatedAtIso) : Number.NaN;
  if (!Number.isFinite(generatedAtMs)) return null;

  return { body: cachedBody, etag: cachedEtag, generatedAtMs };
}
